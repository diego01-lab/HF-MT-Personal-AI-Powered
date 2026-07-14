// Smoke test del modello fee per-broker + calibrazione (estratto da tengine.js)
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/tengine.js', 'utf8');

function extract(name, isConst = false) {
    const needle = isConst ? 'const ' + name + ' = {' : 'function ' + name + '(';
    const start = src.indexOf(needle);
    if (start < 0) throw new Error(name + ' non trovata');
    const end = src.indexOf(isConst ? '\n};' : '\n}', start);
    return src.slice(start, end + (isConst ? 3 : 2));
}

const store = {};
const sandbox = {
    window: { getBrokerCtx: () => sandbox.__ctx },
    localStorage: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
    },
    getAssetType: (sym) => {
        // Come il vero getAssetType: prefisso OANDA valutato PRIMA del suffisso USD
        if (sym.includes('OANDA:XAU') || sym === 'LIT') return 'COMMODITY';
        if (sym.includes('OANDA')) return 'FOREX';
        if (/USD$|USDT$/.test(sym) && sym.length >= 6 && !/^(AAPL|MSFT)/.test(sym)) return 'CRYPTO';
        return 'STOCK';
    },
    __ctx: 'fh',
};

const code = extract('BROKER_FEE_PCT', true) + '\n'
    + 'const _feeCalibCache = {};\n'
    + extract('getRawBreakevenPct') + '\n'
    + extract('getFeeCalibFactor') + '\n'
    + extract('updateFeeCalibration') + '\n'
    + extract('getNetBreakevenPct') + '\n'
    + 'return { getRawBreakevenPct, getFeeCalibFactor, updateFeeCalibration, getNetBreakevenPct };';

const api = new Function('window', 'localStorage', 'getAssetType', code)(
    sandbox.window, sandbox.localStorage, sandbox.getAssetType);

let failures = 0;
function check(desc, actual, expected) {
    const ok = Math.abs(actual - expected) < 1e-9;
    if (!ok) failures++;
    console.log(`  ${ok ? 'OK ' : 'FAIL'}  ${desc} (atteso ${expected}, ottenuto ${actual})`);
}

// Tabella per broker
check('alp crypto = 0.65', api.getRawBreakevenPct('BTCUSD', 'alp'), 0.65);
check('alp azioni = 0.15', api.getRawBreakevenPct('AAPL', 'alp'), 0.15);
check('capd forex = 0.05', api.getRawBreakevenPct('OANDA:EUR_USD', 'capd'), 0.05);
check('capd materie = 0.10 (spread CFD piu largo)', api.getRawBreakevenPct('OANDA:XAU_USD', 'capd'), 0.10);
check('fh materie = 0.05 (storico)', api.getRawBreakevenPct('OANDA:XAU_USD', 'fh'), 0.05);
check('LIT (ETF, COMMODITY senza OANDA) = costo azioni', api.getRawBreakevenPct('LIT', 'capd'), 0.15);
check('ctx sconosciuto -> fallback fh', api.getRawBreakevenPct('BTCUSD', 'boh'), 0.65);
check('ctx implicito da window.getBrokerCtx', api.getRawBreakevenPct('OANDA:XAU_USD'), 0.05); // __ctx=fh

// Calibrazione: guardie anti-rumore
api.updateFeeCalibration('alp', 5, 0.5, 50);   // stima < 1$ -> ignorata
check('guardia stima<1$: fattore resta 1', api.getFeeCalibFactor('alp'), 1);
api.updateFeeCalibration('alp', 5, 4, 5);      // <10 trade -> ignorata
check('guardia <10 trade: fattore resta 1', api.getFeeCalibFactor('alp'), 1);

// Calibrazione: EMA verso il target (reale 6$, stimato 4$ -> target 1.5)
api.updateFeeCalibration('alp', 6, 4, 50);
check('EMA primo passo: 1 + 0.2*(1.5-1) = 1.1', api.getFeeCalibFactor('alp'), 1.1);
api.updateFeeCalibration('alp', 6, 4, 50);
check('EMA secondo passo: 1.1 + 0.2*(1.5-1.1) = 1.18', api.getFeeCalibFactor('alp'), 1.18);

// Clamp del target (reale enorme -> target clampato a 3)
api.updateFeeCalibration('alrt', 1000, 2, 50);
check('clamp target a 3: 1 + 0.2*(3-1) = 1.4', api.getFeeCalibFactor('alrt'), 1.4);

// La stima effettiva applica il fattore
check('getNetBreakevenPct = base * fattore (0.65*1.18)', api.getNetBreakevenPct('BTCUSD', 'alp'), 0.65 * 1.18);
check('contesto non calibrato: base * 1', api.getNetBreakevenPct('BTCUSD', 'capd'), 0.65);

// Persistenza
check('fattore persistito in localStorage', parseFloat(store['fee_calib_alp']), 1.18);

console.log(failures === 0 ? '\nTUTTI I TEST PASSANO' : `\n${failures} TEST FALLITI`);
process.exit(failures === 0 ? 0 : 1);
