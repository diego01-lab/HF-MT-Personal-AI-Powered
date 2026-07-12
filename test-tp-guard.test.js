// Test standalone del filtro anti-churn sul take-profit (tpAllowed).
// Estrae le funzioni REALI da tengine.js e le esegue con dipendenze stub,
// verificando che il TP fasullo da spread (es. UNIUSD/AAVEUSD del CSV) venga
// bloccato e che i TP legittimi continuino a scattare.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/tengine.js', 'utf8');

function extract(name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) { console.error(`FAIL: ${name} non trovata in tengine.js`); process.exit(1); }
    // Chiusura: prima riga che è esattamente "}" (le funzioni target terminano così)
    const end = src.indexOf('\n}', start);
    if (end < 0) { console.error(`FAIL: chiusura di ${name} non trovata`); process.exit(1); }
    return src.slice(start, end + 2);
}

// Ambiente stub: assetType/spread configurabili per scenario, SL_GRACE_MS reale.
function makeTpAllowed({ assetType = 'CRYPTO', spreadPct = 0.1 } = {}) {
    const fn = new Function(
        'getAssetType', 'getSpreadPctFor', 'SL_GRACE_MS',
        extract('getNetBreakevenPct') + '\n' + extract('tpAllowed') + '\n return tpAllowed;'
    );
    return fn(() => assetType, () => spreadPct, 45000);
}

let failures = 0;
function check(desc, actual, expected) {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? 'OK ' : 'FAIL'}  ${desc} (atteso ${expected}, ottenuto ${actual})`);
}

const GRACE = 15000, POST = 60000; // età posizione: dentro/fuori i 45s di grazia

// --- Scenario del CSV: crypto a spread sottile, TP adattivo minuscolo ---
// UNIUSD: il "TP" scattava a un guadagno lordo ~0.2-0.3% sull'ultimo prezzo,
// ma la vendita al bid chiudeva sotto l'ingresso. Ora deve essere BLOCCATO.
const crypto = makeTpAllowed({ assetType: 'CRYPTO', spreadPct: 0.1 }); // netFloor = 0.65+0.1 = 0.75
check('churn: TP minuscolo 0.3% dentro grazia -> bloccato', crypto('UNIUSD', 0.30, 0.20, GRACE), false);
check('churn: TP minuscolo 0.3% fuori grazia  -> bloccato', crypto('UNIUSD', 0.30, 0.20, POST), false);
check('churn: 0.6% (< netFloor 0.75) fuori grazia -> bloccato', crypto('AAVEUSD', 0.60, 0.20, POST), false);

// --- TP legittimi crypto: profitto netto reale, devono passare ---
check('legit: 1.5% fuori grazia -> permesso', crypto('BTCUSD', 1.50, 1.50, POST), true);
check('legit: 1.5% dentro grazia (>= netFloor+cost 1.40) -> permesso', crypto('BTCUSD', 1.50, 1.50, GRACE), true);

// --- Grazia C: sopra netFloor ma sotto netFloor+cost, dentro i 45s -> bloccato ---
// 1.0% > effTP 0.8% e > netFloor 0.75, ma < netFloor+cost (1.40): la grazia lo ferma.
check('grazia: 1.0% dentro grazia -> bloccato', crypto('ETHUSD', 1.00, 0.80, GRACE), false);
check('grazia: 1.0% stesso caso fuori grazia -> permesso', crypto('ETHUSD', 1.00, 0.80, POST), true);

// --- effTP non ancora raggiunto: sempre bloccato ---
check('sotto il TP impostato -> bloccato', crypto('BTCUSD', 1.20, 1.50, POST), false);

// --- Azioni: costo/spread minimi, comportamento invariato ---
const stock = makeTpAllowed({ assetType: 'STOCK', spreadPct: 0.02 }); // netFloor = 0.15+0.02 = 0.17
check('azione: TP 1.5% -> permesso (invariato)', stock('AAPL', 1.50, 1.50, POST), true);

// --- Spread live largo: il netFloor sale, un TP "ok" sul lordo viene frenato ---
const wide = makeTpAllowed({ assetType: 'CRYPTO', spreadPct: 1.2 }); // netFloor = 0.65+1.2 = 1.85
check('spread largo 1.2%: TP 1.5% sotto netFloor 1.85 -> bloccato', wide('DOGEUSD', 1.50, 1.50, POST), false);

console.log(failures === 0 ? '\nTUTTI I TEST PASSANO' : `\n${failures} TEST FALLITI`);
process.exit(failures === 0 ? 0 : 1);
