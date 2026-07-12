// Test standalone della logica di ricostruzione cronologia (syncAlpacaHistory).
// Estrae il blocco reale da app.js e lo esegue su scenari simulati.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/app.js', 'utf8');

const fnStart = src.indexOf('async function syncAlpacaHistory');
const start = src.indexOf('let addedNew = false;', fnStart);
const endMarker = "pushRow('SHORT', price, qty, 0, null);";
const end = src.indexOf(endMarker, start);
if (start < 0 || end < 0) { console.error('FAIL: blocco non trovato in app.js'); process.exit(1); }
// Include la chiusura del forEach
const block = src.slice(start, src.indexOf('});', end) + 3);

function normFillSym(s) { return (s || '').replace('/', '').replace('USDT', 'USD'); }

function runSync(activities, { tradeHistory = [], brokerEntryBasis = {}, activePositions = {} } = {}) {
    // Le statistiche LIFETIME (executedTrades, grossProfit, winTrades, grossLoss)
    // sono variabili globali in app.js aggiornate dentro pushRow: qui le dichiariamo
    // localmente così il blocco estratto gira isolato senza ReferenceError.
    const fn = new Function('activities', 'tradeHistory', 'brokerEntryBasis', 'activePositions', 'normFillSym',
        'let executedTrades = 0, grossProfit = 0, grossLoss = 0, winTrades = 0;\n' + block + '; return { tradeHistory, addedNew };');
    return fn(activities, tradeHistory, brokerEntryBasis, activePositions, normFillSym);
}

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log(`  OK  ${name}`);
    else { console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); failures++; }
}

const T = (m) => new Date(Date.UTC(2026, 5, 11, 10, m)).toISOString();

// 1. Long roundtrip: BUY 10@100 poi SELL 10@110 → una riga LONG, pnl +100
{
    const r = runSync([
        { id: 'b1', side: 'buy', price: '100', qty: '10', symbol: 'AAPL', transaction_time: T(0) },
        { id: 's1', side: 'sell', price: '110', qty: '10', symbol: 'AAPL', transaction_time: T(30) },
    ]);
    const rows = r.tradeHistory;
    check('long: una sola riga', rows.length === 1, `rows=${rows.length}`);
    const t = rows[0] || {};
    check('long: type LONG', t.type === 'LONG', t.type);
    check('long: entry 100', t.entryPrice === 100, t.entryPrice);
    check('long: exit 110', t.exitPrice === 110, t.exitPrice);
    check('long: pnl +100', t.pnl === 100, t.pnl);
    check('long: durata reale 30min', t.exitTime - t.entryTime === 30 * 60000, t.exitTime - t.entryTime);
}

// 2. Short su azioni: SELL 5@50 (apre, con posizione SHORT attiva) poi BUY 5@45 → una riga SHORT, pnl +25
{
    const r = runSync([
        { id: 's2', side: 'sell', price: '50', qty: '5', symbol: 'TSLA', transaction_time: T(0) },
        { id: 'b2', side: 'buy', price: '45', qty: '5', symbol: 'TSLA', transaction_time: T(10) },
    ], { activePositions: { 'TSLA': { type: 'SHORT' } } });
    const rows = r.tradeHistory;
    check('short: una sola riga', rows.length === 1, `rows=${rows.length}`);
    const t = rows[0] || {};
    check('short: type SHORT', t.type === 'SHORT', t.type);
    check('short: entry 50', t.entryPrice === 50, t.entryPrice);
    check('short: pnl +25', t.pnl === 25, t.pnl);
}

// 3. Chiusura long aperto fuori finestra: solo SELL, con entry annotato da closeTrade
{
    const r = runSync([
        { id: 's3', side: 'sell', price: '200', qty: '2', symbol: 'NVDA', transaction_time: T(5) },
    ], { brokerEntryBasis: { 'NVDA': { price: 180, time: Date.UTC(2026, 5, 10), type: 'LONG' } } });
    const t = r.tradeHistory[0] || {};
    check('fuori-finestra: entry annotato 180', t.entryPrice === 180, t.entryPrice);
    check('fuori-finestra: pnl +40', t.pnl === 40, t.pnl);
    check('fuori-finestra: type LONG', t.type === 'LONG', t.type);
}

// 4. SELL orfana (nessun basis): riga neutra filtrabile (entry=exit, pnl 0)
{
    const r = runSync([
        { id: 's4', side: 'sell', price: '30', qty: '1', symbol: 'AMD', transaction_time: T(0) },
    ]);
    const t = r.tradeHistory[0] || {};
    check('orfana: pnl 0 e entry=exit', t.pnl === 0 && t.entryPrice === t.exitPrice, JSON.stringify(t));
}

// 5. Dedup: rieseguire il sync sugli stessi fill non duplica le righe
{
    const state = { tradeHistory: [], brokerEntryBasis: {}, activePositions: {} };
    const fills = [
        { id: 'b5', side: 'buy', price: '10', qty: '3', symbol: 'BTC/USD', transaction_time: T(0) },
        { id: 's5', side: 'sell', price: '12', qty: '3', symbol: 'BTC/USD', transaction_time: T(20) },
    ];
    runSync(fills, state);
    runSync(fills, state);
    check('dedup: una riga dopo due sync', state.tradeHistory.length === 1, state.tradeHistory.length);
    check('crypto: pnl +6', state.tradeHistory[0].pnl === 6, state.tradeHistory[0].pnl);
}

// 6. Acquisti multipli → costo medio: BUY 1@100, BUY 1@110, SELL 2@120 → pnl (120-105)*2 = +30
{
    const r = runSync([
        { id: 'b6a', side: 'buy', price: '100', qty: '1', symbol: 'MSFT', transaction_time: T(0) },
        { id: 'b6b', side: 'buy', price: '110', qty: '1', symbol: 'MSFT', transaction_time: T(5) },
        { id: 's6', side: 'sell', price: '120', qty: '2', symbol: 'MSFT', transaction_time: T(10) },
    ]);
    const t = r.tradeHistory[0] || {};
    check('costo medio: entry 105', t.entryPrice === 105, t.entryPrice);
    check('costo medio: pnl +30', t.pnl === 30, t.pnl);
}

// 7. Lo short NON inquina il long successivo (bug del vecchio codice):
//    short 5@50→45, poi long 5@60→66: il long deve avere entry 60, non un mix
{
    const r = runSync([
        { id: 's7', side: 'sell', price: '50', qty: '5', symbol: 'META', transaction_time: T(0) },
        { id: 'b7', side: 'buy', price: '45', qty: '5', symbol: 'META', transaction_time: T(10) },
        { id: 'b7b', side: 'buy', price: '60', qty: '5', symbol: 'META', transaction_time: T(20) },
        { id: 's7b', side: 'sell', price: '66', qty: '5', symbol: 'META', transaction_time: T(30) },
    ], { activePositions: { 'META': { type: 'SHORT' } } });
    const rows = r.tradeHistory;
    check('sequenza: due righe', rows.length === 2, rows.length);
    const shortRow = rows.find(t => t.type === 'SHORT') || {};
    const longRow = rows.find(t => t.type === 'LONG') || {};
    check('sequenza: short pnl +25', shortRow.pnl === 25, shortRow.pnl);
    check('sequenza: long entry 60 (non inquinato)', longRow.entryPrice === 60, longRow.entryPrice);
    check('sequenza: long pnl +30', longRow.pnl === 30, longRow.pnl);
}

// 8. Fix E (12/07/2026): un ordine di chiusura che fila in PIÙ fill parziali
//    deve propagare il motivo REALE (SL/TP/BREAKEVEN) a TUTTI i fill, non
//    solo al primo. Prima del fix, brokerEntryBasis veniva cancellato dal
//    primo match: dal secondo fill in poi il motivo ricadeva sul generico
//    BROKER_SYNC (osservato in produzione: 45/58 righe di cronologia senza
//    motivo reale). BUY 100@1.0 poi due SELL parziali (60 + 40) che
//    esauriscono lo stesso lotto: entrambe le righe devono avere reason SL.
{
    const r = runSync([
        { id: 'b8', side: 'buy', price: '1.0', qty: '100', symbol: 'ARBUSD', transaction_time: T(0) },
        { id: 's8a', side: 'sell', price: '0.9', qty: '60', symbol: 'ARBUSD', transaction_time: T(30) },
        { id: 's8b', side: 'sell', price: '0.9', qty: '40', symbol: 'ARBUSD', transaction_time: T(45) },
    ], { brokerEntryBasis: { 'ARBUSD': { price: 1.0, time: Date.UTC(2026, 5, 11), type: 'LONG', reason: 'SL' } } });
    const rows = r.tradeHistory;
    check('fill multipli: due righe (60+40)', rows.length === 2, rows.length);
    const reasons = rows.map(t => t.reason);
    check('fill multipli: PRIMO fill motivo reale SL', reasons[0] === 'SL', reasons[0]);
    check('fill multipli: SECONDO fill motivo reale SL (non BROKER_SYNC)', reasons[1] === 'SL', reasons[1]);
    check('fill multipli: qty 60 sul primo', rows[0].amount === 60, rows[0].amount);
    check('fill multipli: qty 40 sul secondo', rows[1].amount === 40, rows[1].amount);
}

console.log(failures === 0 ? '\nTUTTI I TEST PASSANO' : `\n${failures} TEST FALLITI`);
process.exit(failures === 0 ? 0 : 1);
