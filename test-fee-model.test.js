// Smoke test del modello fee per broker×categoria + calibrazione (estratto da tengine.js)
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/tengine.js', 'utf8');

function extract(name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error(name + ' non trovata');
    const end = src.indexOf('\n}', start);
    return src.slice(start, end + 2);
}
// Costanti su UNA riga (const NOME = ...;) o blocco multilinea chiuso da "};"
function extractConst(name) {
    const start = src.indexOf('const ' + name + ' =');
    if (start < 0) throw new Error(name + ' non trovata');
    const endInline = src.indexOf(';\n', start);
    const block = src.slice(start, endInline + 1);
    if (block.includes('{') && !block.includes('}')) {
        const end = src.indexOf('\n};', start);
        return src.slice(start, end + 3);
    }
    return block;
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

const code = extractConst('BROKER_FEE_PCT') + '\n'
    + extractConst('FEE_CALIB_MIN') + '\n'
    + extractConst('FEE_CALIB_MAX') + '\n'
    + 'const _feeCalibCache = {};\nconst _feeCalibLastSig = {};\n'
    + extract('getFeeCategory') + '\n'
    + extract('getRawBreakevenPct') + '\n'
    + extract('getFeeCalibFactor') + '\n'
    + extract('updateFeeCalibration') + '\n'
    + extract('getNetBreakevenPct') + '\n'
    + 'return { getFeeCategory, getRawBreakevenPct, getFeeCalibFactor, updateFeeCalibration, getNetBreakevenPct };';

const api = new Function('window', 'localStorage', 'getAssetType', code)(
    sandbox.window, sandbox.localStorage, sandbox.getAssetType);

let failures = 0;
function check(desc, actual, expected) {
    const ok = Math.abs(actual - expected) < 1e-9;
    if (!ok) failures++;
    console.log(`  ${ok ? 'OK ' : 'FAIL'}  ${desc} (atteso ${expected}, ottenuto ${actual})`);
}

// Categoria ai fini del costo
check('getFeeCategory: crypto', api.getFeeCategory('BTCUSD') === 'CRYPTO' ? 1 : 0, 1);
check('getFeeCategory: LIT (ETF) -> STOCK', api.getFeeCategory('LIT') === 'STOCK' ? 1 : 0, 1);
check('getFeeCategory: OANDA:XAU -> COMMODITY', api.getFeeCategory('OANDA:XAU_USD') === 'COMMODITY' ? 1 : 0, 1);

// Tabella per broker
check('alp crypto = 0.65', api.getRawBreakevenPct('BTCUSD', 'alp'), 0.65);
check('alp azioni = 0.15', api.getRawBreakevenPct('AAPL', 'alp'), 0.15);
check('capd forex = 0.05', api.getRawBreakevenPct('OANDA:EUR_USD', 'capd'), 0.05);
check('capd materie = 0.10 (spread CFD piu largo)', api.getRawBreakevenPct('OANDA:XAU_USD', 'capd'), 0.10);
check('fh materie = 0.05 (storico)', api.getRawBreakevenPct('OANDA:XAU_USD', 'fh'), 0.05);
check('ctx sconosciuto -> fallback fh', api.getRawBreakevenPct('BTCUSD', 'boh'), 0.65);

// Calibrazione: guardie anti-rumore
api.updateFeeCalibration('alp', 'CRYPTO', 5, 0.4, 50);   // stima < 0.5$ -> ignorata
check('guardia stima<0.5$: fattore resta 1', api.getFeeCalibFactor('alp', 'CRYPTO'), 1);
api.updateFeeCalibration('alp', 'CRYPTO', 5, 4, 3);      // <5 trade -> ignorata
check('guardia <5 trade: fattore resta 1', api.getFeeCalibFactor('alp', 'CRYPTO'), 1);

// Calibrazione crypto: passo 0.5 verso il target (reale 6$, stimato 4$ -> target 1.5)
api.updateFeeCalibration('alp', 'CRYPTO', 6, 4, 50);
check('passo 1: 1 + 0.5*(1.5-1) = 1.25', api.getFeeCalibFactor('alp', 'CRYPTO'), 1.25);
// Stessi dati -> stessa firma -> NESSUN passo (prima convergeva a ogni render)
api.updateFeeCalibration('alp', 'CRYPTO', 6, 4, 50);
check('firma identica: nessun passo (resta 1.25)', api.getFeeCalibFactor('alp', 'CRYPTO'), 1.25);
// Dati NUOVI -> passo successivo
api.updateFeeCalibration('alp', 'CRYPTO', 6.5, 4, 50);
check('dati nuovi: 1.25 + 0.5*(1.625-1.25) = 1.4375', api.getFeeCalibFactor('alp', 'CRYPTO'), 1.4375);

// Pavimento crypto: fee osservate ~zero NON portano la stima sotto il listino
// Alpaca (fattore min 0.77): protezione della soglia anti-churn del TP.
api.updateFeeCalibration('alrt', 'CRYPTO', 0, 10, 50);
check('pavimento crypto: 1 + 0.5*(0.77-1) = 0.885', api.getFeeCalibFactor('alrt', 'CRYPTO'), 0.885);
api.updateFeeCalibration('alrt', 'CRYPTO', 0.0001, 10, 50);
check('pavimento crypto, passo 2: 0.885 + 0.5*(0.77-0.885) = 0.8275', api.getFeeCalibFactor('alrt', 'CRYPTO'), 0.8275);

// Azioni: fee reali ~zero ammesse fino a fattore 0.2, INDIPENDENTE dal crypto
api.updateFeeCalibration('alp', 'STOCK', 0, 5, 30);
check('pavimento azioni: 1 + 0.5*(0.2-1) = 0.6', api.getFeeCalibFactor('alp', 'STOCK'), 0.6);
check('fattore crypto NON toccato dalla calibrazione azioni', api.getFeeCalibFactor('alp', 'CRYPTO'), 1.4375);

// Clamp del target verso l'alto (reale enorme -> target clampato a 3)
api.updateFeeCalibration('capd', 'CRYPTO', 1000, 2, 50);
check('clamp target a 3: 1 + 0.5*(3-1) = 2', api.getFeeCalibFactor('capd', 'CRYPTO'), 2);

// La stima effettiva applica il fattore della PROPRIA categoria
check('getNetBreakevenPct crypto = 0.65 * 1.4375', api.getNetBreakevenPct('BTCUSD', 'alp'), 0.65 * 1.4375);
check('getNetBreakevenPct azioni = 0.15 * 0.6', api.getNetBreakevenPct('AAPL', 'alp'), 0.15 * 0.6);
check('contesto non calibrato: base * 1', api.getNetBreakevenPct('OANDA:EUR_USD', 'capd'), 0.05);

// Persistenza per contesto+categoria
check('fattore persistito (fee_calib_alp_CRYPTO)', parseFloat(store['fee_calib_alp_CRYPTO']), 1.4375);
check('fattore persistito (fee_calib_alp_STOCK)', parseFloat(store['fee_calib_alp_STOCK']), 0.6);

console.log(failures === 0 ? '\nTUTTI I TEST PASSANO' : `\n${failures} TEST FALLITI`);
process.exit(failures === 0 ? 0 : 1);
