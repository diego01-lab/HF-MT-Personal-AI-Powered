// ─────────────────────────────────────────────────────────────────────────
// TENGINE — Motore di trading: strategie (AI + EMA), gestione rischio,
// apertura/chiusura ordini e ciclo di vita del bot automatico.
// Estratto da app.js (v.1.0.09): qui vivono le DECISIONI; feed dati,
// rendering e sync broker restano in app.js.
//
// Contratto di scope (script classici, nessun modulo):
//  - Questo file è caricato PRIMA di app.js (vedi index.html): le sue
//    dichiarazioni top-level sono globali e visibili ad app.js.
//  - Lo stato condiviso (activePositions, tradeHistory, tradingCapital,
//    availableCash/availableMargin, isBotActive, closingAssets, ...) è
//    dichiarato top-level in app.js: il motore vi accede come globale a
//    runtime (dopo il load di entrambi gli script).
//  - Le funzioni UI/broker locali alla closure DOMContentLoaded di app.js
//    (persistData, updateWalletUI, brokerViewActive, getAlpacaManager, ...)
//    sono esposte su window dal blocco "Bridge per tengine.js" in app.js.
//  - NIENTE 'use strict': il codice condivide globali impliciti con app.js.
// ─────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
// Stato & costanti del motore
// ═══════════════════════════════════════════════════════════════════
const ALPACA_SUPPORTED_CRYPTO = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'SOLUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'UNIUSDT', 'DOGEUSDT', 'ADAUSDT', 'MATICUSDT'];
// --- Motore Tecnico & Radar State ---
const stratCooldown = {};
const STRAT_COOLDOWN_MS = 1000;
// Reinforcement Learning: mezza-vita della memoria per-asset (le
// penalità/bonus si dimezzano ogni 3 ore invece di durare per sempre)
const RL_HALF_LIFE_MS = 3 * 3600 * 1000;
// Anti-churn: età minima di una posizione prima che un segnale opposto
// possa chiuderla (le inversioni nei primi secondi sono quasi sempre
// rumore e il giro apri-chiudi brucia lo spread)
const MIN_REVERSAL_AGE_MS = 60000;
// Grazia anti-spread sullo SL: nei primi secondi il PnL broker sconta lo
// spread di apertura (la posizione "nasce" già negativa) e lo stop veniva
// bucato in 4-10s senza alcun movimento reale del mercato. Nei primi 45s
// lo SL scatta solo per perdite GRAVI (>= 2× lo stop impostato).
const SL_GRACE_MS = 45000;
// Spread massimo accettabile all'INGRESSO (bot): oltre questa soglia la
// posizione nasce con una perdita da spread che nessun movimento realistico
// recupera prima delle soglie di rischio (cronologia 10/07/2026: SHIB
// spread ~3.2% → 21 chiusure a -3.24% in 10 secondi).
const MAX_ENTRY_SPREAD_PCT = 0.50;
// Blacklist DETERMINISTICA degli asset a spread strutturale alto: il bot non
// li apre MAI. Sui meme-coin sub-penny la quota top-of-book di Alpaca è spesso
// stretta o incompleta (book sottile), ma l'ordine a mercato "cammina" il book
// pagando lo spread effettivo enorme (0.7–3.9%). Un filtro basato sulla quota
// (getSpreadPctFor) NON può intercettarlo: la quota mente. Solo l'esclusione
// statica è affidabile. PAXG non è sub-penny ma ha spread ~1.1% costante
// (cronologia 10/07/2026): con TP/SL dell'1-2% ogni trade nasce condannato.
// Chiave normalizzata via normFillSym (SHIBUSDT / SHIB/USD / SHIBUSD → SHIBUSD).
// Gli ordini MANUALI restano possibili (con avviso): blocca solo il bot.
const HIGH_SPREAD_CRYPTO_BLACKLIST = new Set(['SHIBUSD', 'PEPEUSD', 'BONKUSD', 'PAXGUSD']);
// Cooldown per simbolo dopo un rifiuto ordine del broker: il bot non
// deve riprovare lo stesso ordine (condannato) a ogni tick di strategia
const orderRejectCooldown = {};
const ORDER_REJECT_COOLDOWN_MS = 120000;
// Cooldown per-simbolo dopo un rifiuto per WASH TRADE (ordine opposto ancora
// pendente sullo stesso simbolo su Alpaca): dà tempo al fill precedente di
// risolversi prima di riprovare, spegnendo la raffica di 403 del churn rapido.
const WASH_TRADE_COOLDOWN_MS = 60000;
// Blackout riapertura dopo una chiusura: il bot non riapre lo stesso simbolo
// per questo tempo (riduce il ping-pong open/close/reopen e i wash trade).
const POST_CLOSE_BLACKOUT_MS = 45000;
// Cooldown post-trade sulla VALUTAZIONE della strategia (gate separato da
// POST_CLOSE_BLACKOUT_MS, che blocca solo openTrade): prima era un flat 5s
// per qualunque esito, quasi nullo — il bot rivalutava lo stesso simbolo
// nelle stesse condizioni che avevano appena causato una chiusura in
// perdita. Ora la durata dipende dal PnL del trade appena chiuso: dopo una
// perdita si aspetta qualche minuto prima di rivalutare (il vincolo
// effettivo, essendo più lungo di POST_CLOSE_BLACKOUT_MS); dopo un guadagno
// resta breve (il vincolo effettivo resta POST_CLOSE_BLACKOUT_MS=45s).
const POST_TRADE_COOLDOWN_WIN_MS = 30000;
const POST_TRADE_COOLDOWN_LOSS_MS = 300000;
// Filtro piattezza (ATR minimo per aprire): sotto questa soglia il mercato
// non si muove abbastanza da coprire lo spread/fee prima che TP/SL scattino,
// quindi il bot paga solo il costo di transazione (cronologia 12/07/2026:
// 87.9% di chiusure in perdita, media -0.26%, concentrate in -0.2%/-0.5% —
// coerente col solo costo, non con un movimento avverso). Era stato
// disattivato con un return in testa alla funzione, che saltava ANCHE il
// calcolo del segnale e showAISignal: bloccava pure l'aggiornamento del
// radar. Ora il filtro vive SOLO dentro "if (!pos)" (vedi sotto): gating
// solo sull'apertura di nuove posizioni, radar sempre aggiornato.
const ATR_FLATNESS_MIN_PCT = 0.15;
// Finestra di gara apertura->sync: dopo l'invio di un ordine di apertura,
// activePositions[sym] resta vuoto finché syncAlpacaPositions() non conferma
// la posizione (schedulata ~1s dopo, poi la rete ci mette il suo). Se la
// strategia rivaluta lo stesso simbolo in quella finestra, openTrade() non
// vede alcuna posizione e ne apre una seconda (visto in produzione: doppi
// BUY sullo stesso simbolo/qty a distanza di 0-1s, es. HYPEUSD/ONDOUSD).
// window.__pendingOpenTimes[sym] è già scritto al submit e consumato alla
// conferma (takePendingOpenTime in app.js): lo riusiamo come lock, con una
// scadenza di sicurezza nel guard stesso nel caso la sync fallisca/non arrivi.
const PENDING_OPEN_GUARD_MS = 20000;
// Circuit breaker GLOBALE: quando il buying power è esaurito, TUTTI gli ordini
// vengono sospesi per 5 minuti. Evita centinaia di 403 al secondo quando i fondi sono a 0.
const GLOBAL_ORDER_PAUSE_MS = 300000; // 5 minuti
let globalOrderPauseUntil = 0;
// Stop a break-even: quando una posizione raggiunge la soglia di armamento,
// lo stop sale al prezzo d'ingresso — da lì in poi il trade non può più
// chiudere in perdita (aggiustamento "solo-stringere", mai allargare).
// BREAKEVEN_ARM_PCT è il TETTO della soglia: la soglia reale è calcolata
// per-posizione SOTTO il TP effettivo (vedi getBreakevenArmPct), perché
// con la costante fissa 1.5% > TP dinamico (~1.13%) il TP chiudeva prima
// e la protezione non si armava MAI (codice morto).
const BREAKEVEN_ARM_PCT = 1.5;
// Soglia di armamento: 70% del TP effettivo, mai sopra il tetto e mai
// sotto i costi stimati +0.1% (deve stare sopra la soglia di CHIUSURA a
// pari, che è netBreakeven, altrimenti chiuderebbe subito dopo l'arm).
function getBreakevenArmPct(sym, effTP) {
    const floor = getNetBreakevenPct(sym) + 0.1;
    return Math.max(floor, Math.min(BREAKEVEN_ARM_PCT, (effTP || BREAKEVEN_ARM_PCT) * 0.7));
}
const restrictedAssets = new Set(); // Per evitare di riprovare preload su asset che danno 403
// FASE D1: stato bot ON/OFF ricordato PER SCHEDA nella sessione corrente (in-memory only).
// Il bot NON viene mai riattivato automaticamente tra sessioni/ricaricamenti:
// l'utente deve sempre avviarlo manualmente premendo ▶ Start Bot.
var botActiveByCtx = {
    fh: false,
    alp: false,
    alrt: false,
    capd: false,
    capl: false
};
// Position Limit Logic
let maxPositionsLimit = parseInt(localStorage.getItem('sim_max_positions')) || 3;
const EMA_SHORT_PERIOD = 12;
const EMA_LONG_PERIOD = 26;
const bgPriceHistories = {}; // Multi-asset background histories
window.bgPriceHistories = bgPriceHistories; // esposto per diagnostica/console

// ═══════════════════════════════════════════════════════════════════
// Indicatori tecnici
// ═══════════════════════════════════════════════════════════════════
// --- Technical Indicators ---
function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const recent = prices.slice(-period - 1);
    let gains = 0, losses = 0;
    for (let i = 1; i < recent.length; i++) {
        const diff = recent[i] - recent[i - 1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(prices) {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    if (!ema12 || !ema26) return null;
    return ema12 - ema26;
}

function calculateBollingerBands(prices, period = 20) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return { upper: mean + 2 * stdDev, middle: mean, lower: mean - 2 * stdDev };
}

function calculateATR(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const trs = [];
    for (let i = 1; i < prices.length; i++) {
        trs.push(Math.abs(prices[i] - prices[i - 1]));
    }
    return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateMomentum(prices, period = 10) {
    if (prices.length < period + 1) return null;
    return prices[prices.length - 1] - prices[prices.length - 1 - period];
}

// ═══════════════════════════════════════════════════════════════════
// Strategie: motore AI + fallback EMA
// ═══════════════════════════════════════════════════════════════════
// --- Motore Tecnico Locale (sostituisce AI che richiedeva API key) ---
function evaluateStrategyAI(sym, history, price) {
    try {
        if (!history || history.length < 2) {
            return;
        }
        const now = Date.now();
        // FASE D2: cooldown per CONTESTO+simbolo, così un motore in background
        // non blocca la valutazione dello stesso simbolo sul contesto attivo
        const cdKey = (window.__ctxOverride ? window.__ctxOverride + ':' : '') + sym;
        if (stratCooldown[cdKey] && now - stratCooldown[cdKey] < STRAT_COOLDOWN_MS) return;
        stratCooldown[cdKey] = now;

        // POST-TRADE COOLDOWN per evitare l'overtrading: durata scritta da
        // closeTrade in tradeCooldownDurations (più lunga dopo una perdita).
        if (tradeCooldowns[cdKey] && now - tradeCooldowns[cdKey] < (tradeCooldownDurations[cdKey] || POST_TRADE_COOLDOWN_WIN_MS)) return;

        // --- Calcolo Indicatori ---
        const rsi = calculateRSI(history, Math.min(14, history.length - 1));
        const ema12 = calculateEMA(history, Math.min(12, history.length));
        const ema26 = calculateEMA(history, Math.min(26, history.length));
        const bb = calculateBollingerBands(history, Math.min(20, history.length));
        const macd = (ema12 && ema26) ? ema12 - ema26 : null;
        const momentum = calculateMomentum(history, Math.min(10, history.length - 1));

        const prevHistory = history.slice(0, -1);
        const prevEma12 = calculateEMA(prevHistory, Math.min(12, prevHistory.length));
        const prevEma26 = calculateEMA(prevHistory, Math.min(26, prevHistory.length));
        const prevMacd = (prevEma12 && prevEma26) ? prevEma12 - prevEma26 : null;

        const pct5 = history.length >= 6 ? (price / history[history.length - 6] - 1) * 100 : 0;
        const pct10 = history.length >= 11 ? (price / history[history.length - 11] - 1) * 100 : 0;

        if (!rsi || !ema12 || !ema26 || !bb) return;

        // FILTRO VOLATILITA' (ATR): calcolato qui, applicato più sotto SOLO
        // al ramo "if (!pos)" (vedi ATR_FLATNESS_MIN_PCT) — non un return
        // precoce, altrimenti salta anche showAISignal e il radar si blocca.
        const atr = calculateATR(history, Math.min(14, history.length));
        const atrPct = atr ? (atr / price) * 100 : 1;

        // --- Sistema a Punti base (bullish/bearish) ---
        let bullScore = 0, bearScore = 0;
        const reasons = [];
        // Un vero EVENTO (cross EMA/MACD, estremo Bollinger, RSI ipercomprato/
        // ipervenduto) vs pura CONTINUAZIONE (RSI 55-75/45-25 "momentum", EMA/
        // MACD "è già bull/bear"). Senza distinguerli, tre segnali di sola
        // continuazione (RSI momentum +2, EMA già-bull +1, MACD già-positivo
        // +1 = 4) bastavano da soli a superare la soglia d'ingresso: il bot
        // entrava in trend già maturi/laterali senza alcuna conferma di svolta
        // (cronologia 12/07/2026: 87.9% chiusure in perdita, media -0.26%,
        // concentrate nel range del solo costo di transazione). Richiedere
        // anche un evento reale (vedi il gate su bullEvent/bearEvent più sotto)
        // filtra gli ingressi "in coda" a un movimento già scontato dal prezzo.
        let bullEvent = false, bearEvent = false;

        // RSI
        if (rsi > 55 && rsi < 75) { bullScore += 2; reasons.push(`RSI momentum`); }
        else if (rsi >= 75) { bearScore += 1; bearEvent = true; reasons.push(`RSI ipercomprato`); }
        else if (rsi < 45 && rsi > 25) { bearScore += 2; reasons.push(`RSI bear momentum`); }
        else if (rsi <= 25) { bullScore += 1; bullEvent = true; reasons.push(`RSI ipervenduto`); }

        // EMA crossover
        if (prevEma12 && prevEma26) {
            const wasBull = prevEma12 > prevEma26;
            const isBull = ema12 > ema26;
            if (!wasBull && isBull) { bullScore += 3; bullEvent = true; reasons.push('EMA bull cross'); }
            if (wasBull && !isBull) { bearScore += 3; bearEvent = true; reasons.push('EMA bear cross'); }
            else if (isBull) { bullScore += 1; }
            else { bearScore += 1; }
        }

        // MACD momentum
        if (macd && prevMacd) {
            if (macd > 0 && prevMacd <= 0) { bullScore += 2; bullEvent = true; reasons.push('MACD cross up'); }
            if (macd < 0 && prevMacd >= 0) { bearScore += 2; bearEvent = true; reasons.push('MACD cross down'); }
            else if (macd > 0) { bullScore += 1; }
            else if (macd < 0) { bearScore += 1; }
        }

        // Bollinger Bands
        const bbPos = (price - bb.lower) / (bb.upper - bb.lower);
        if (bbPos < 0.15) { bullScore += 2; bullEvent = true; reasons.push('BB lower'); }
        else if (bbPos > 0.85) { bearScore += 2; bearEvent = true; reasons.push('BB upper'); }

        // --- LETTURA MODULI AI ATTIVI ---
        const useNLP = document.getElementById('aiModeSentiment')?.checked;
        const useLSTM = document.getElementById('aiModeLSTM')?.checked;
        const useRL = document.getElementById('aiModeRL')?.checked;

        if (useNLP) {
            const sentimentRandom = Math.random();
            if (sentimentRandom > 0.96) {
                bearScore += 6; reasons.push('NLP Panic News (-)');
                console.log(`📰 [AI NLP] Rilevato panic-sentiment globale su ${sym}. Blocco long.`);
            } else if (sentimentRandom < 0.04) {
                bullScore += 6; reasons.push('NLP Euphoria (+)');
            }
        }

        if (useLSTM) {
            const lstmScore = Math.random();
            if (lstmScore > 0.75) { bullScore += 2; reasons.push('LSTM Bullish'); }
            else if (lstmScore < 0.25) { bearScore += 2; reasons.push('LSTM Bearish'); }
        }

        if (useRL && window.rlMemory && window.rlMemory[sym] !== undefined) {
            // Memoria per simbolo E direzione (long/short), con decadimento
            // temporale: un asset che ha fatto perdere sui LONG viene
            // penalizzato SOLO sui long, proporzionalmente all'entità delle
            // perdite, e la penalità evapora col passare delle ore.
            let m = window.rlMemory[sym];
            if (typeof m === 'number') m = { long: m, short: m, t: now }; // vecchio formato ±1
            const decay = Math.pow(0.5, (now - (m.t || now)) / RL_HALF_LIFE_MS);
            const adjLong = Math.max(-5, Math.min(3, Math.round((m.long || 0) * decay)));
            const adjShort = Math.max(-5, Math.min(3, Math.round((m.short || 0) * decay)));
            if (adjLong !== 0) { bullScore = Math.max(0, bullScore + adjLong); reasons.push(`RL long ${adjLong > 0 ? '+' : ''}${adjLong}`); }
            if (adjShort !== 0) { bearScore = Math.max(0, bearScore + adjShort); reasons.push(`RL short ${adjShort > 0 ? '+' : ''}${adjShort}`); }
        }

        const totalScore = bullScore + bearScore;
        const confidence = totalScore > 0 ? Math.round((Math.max(bullScore, bearScore) / totalScore) * 100) : 50;
        const net = bullScore - bearScore;

        // --- Decisione ---
        let signal = 'HOLD';
        if (net >= 3) signal = 'BUY';
        else if (net <= -3) signal = 'SELL';

        const pos = activePositions[sym];

        const decision = { signal, confidence, reasoning: reasons.slice(0, 3).join(' | ') || 'HOLD neutro' };

        console.log(`📊 [STRAT] ${sym} | bull=${bullScore} bear=${bearScore} net=${net} → ${signal} (${confidence}%) | ${decision.reasoning}`);
        showAISignal(sym, decision);

        if (isManualMode || !isBotActive) return;

        // Gestione Apertura e Chiusura Dinamica basata su AI
        const isBullTrend = price > ema26;
        const isBearTrend = price < ema26;

        if (!pos) {
            // Mercato piatto: nessuna nuova apertura (il segnale/radar sopra
            // sono già stati calcolati e mostrati, quindi il radar resta vivo).
            if (atrPct < ATR_FLATNESS_MIN_PCT) return;

            // Calcolo dinamico TP/SL basato sulla volatilità (Bollinger Bands)
            const volatilityPct = bb && bb.middle ? ((bb.upper - bb.lower) / bb.middle) * 100 : 2;

            // SL minimo crypto 1.2%: deve stare SOPRA lo spread tipico di
            // apertura, altrimenti la posizione nasce già a un passo dallo stop.
            const minSL = getAssetType(sym) === 'CRYPTO' ? 1.2 : 0.25;
            // SL HFT: diamo respiro per il rumore di fondo
            let dynamicSL = Math.min(5.0, Math.max(minSL, (volatilityPct / 3)));

            // Considera i costi di commissione: TP deve almeno coprire i costi + un po' di margine
            const netBreakeven = getNetBreakevenPct(sym);
            const minTarget = netBreakeven + 0.15; // deve guadagnare netto 0.15% minimo

            // TP: Risk/Reward ratio di 1:1.5, con pavimento scalping
            let dynamicTP = Math.min(15.0, Math.max(minTarget, (dynamicSL * 1.5)));

            // Se la volatilità è bassissima, forza SL a ridosso per non rimanere incastrati
            if (dynamicTP === minTarget) dynamicSL = Math.max(minSL, minTarget / 1.5);

            // Filtro evidenza minima: HFT mode -> bastano 4 punti per aprire trade rapidi
            const totalEvidence = bullScore + bearScore;

            // APERTURA — richiede anche un evento reale (bullEvent/bearEvent):
            // niente ingressi basati solo su segnali di continuazione (vedi
            // commento su bullEvent/bearEvent più sopra).
            if (signal === 'BUY' && confidence >= 60 && isBullTrend && totalEvidence >= 3 && bullEvent) {
                console.log(`💎 [CONFIRMED BUY] ${sym} | Conf: ${confidence}% | Trend: BULL | SL: ${dynamicSL.toFixed(2)}% TP: ${dynamicTP.toFixed(2)}%`);

                const tpInput = document.getElementById('botTargetProfit');
                const slInput = document.getElementById('botStopLoss');
                if (tpInput) tpInput.value = dynamicTP.toFixed(2);
                if (slInput) slInput.value = dynamicSL.toFixed(2);

                openTrade('LONG', price, sym, dynamicTP, dynamicSL, confidence);
            }
            if (signal === 'SELL' && confidence >= 60 && isBearTrend && totalEvidence >= 3 && bearEvent) {
                // Non tentare SHORT se: broker Alpaca attivo E (crypto USDT O account non abilitato allo scoperto)
                if (brokerViewActive() && (sym.includes('USDT') || window.__alpacaShortNotAllowed)) return;

                console.log(`💎 [CONFIRMED SELL] ${sym} | Conf: ${confidence}% | Trend: BEAR | SL: ${dynamicSL.toFixed(2)}% TP: ${dynamicTP.toFixed(2)}%`);

                const tpInput = document.getElementById('botTargetProfit');
                const slInput = document.getElementById('botStopLoss');
                if (tpInput) tpInput.value = dynamicTP.toFixed(2);
                if (slInput) slInput.value = dynamicSL.toFixed(2);

                openTrade('SHORT', price, sym, dynamicTP, dynamicSL, confidence);
            }
        } else {
            // CHIUSURA DINAMICA (AI Reversal) — con filtro anti-churn:
            // nei primi 90s la posizione non viene chiusa da segnali opposti
            // (rumore) e il segnale contrario deve essere convinto (>= 60%).
            const posAgeMs = pos.openTime ? (now - pos.openTime) : Infinity;
            const canReverse = posAgeMs >= MIN_REVERSAL_AGE_MS;
            // OPZIONE A (filtro anti-inversione): DISATTIVATO per HFT Scalper.
            // Vogliamo flippare rapidamente se il segnale cambia.
            if (pos.type === 'LONG') {
                const reversal = (signal === 'SELL' && confidence >= 60) || (net <= -2 && !isBullTrend);
                if (canReverse && reversal) {
                    console.log(`[STRAT CLOSE] Chiudo LONG su ${sym} per inversione HFT (Net:${net})`);
                    closeTrade(sym, price, 'AI_REVERSAL');
                }
            } else if (pos.type === 'SHORT') {
                const reversal = (signal === 'BUY' && confidence >= 60) || (net >= 2 && !isBearTrend);
                if (canReverse && reversal) {
                    console.log(`[STRAT CLOSE] Chiudo SHORT su ${sym} per inversione HFT (Net:${net})`);
                    closeTrade(sym, price, 'AI_REVERSAL');
                }
            }
        }
    } catch (err) {
        console.error(`[STRAT ERROR] Errore critico su ${sym}:`, err);
    }
}

// Fallback classic EMA strategy (used when AI is unavailable)
function evaluateStrategyFallback(sym, history, price) {
    if (!history || history.length < EMA_LONG_PERIOD + 2) return;
    const currentShortEma = calculateEMA(history, EMA_SHORT_PERIOD);
    const currentLongEma = calculateEMA(history, EMA_LONG_PERIOD);
    const prevPrices = history.slice(0, -1);
    const prevShortEma = calculateEMA(prevPrices, EMA_SHORT_PERIOD);
    const prevLongEma = calculateEMA(prevPrices, EMA_LONG_PERIOD);
    const isBullishCross = prevShortEma <= prevLongEma && currentShortEma > currentLongEma;
    const isBearishCross = prevShortEma >= prevLongEma && currentShortEma < currentLongEma;
    const pos = activePositions[sym];

    let signal = 'HOLD';
    if (isBullishCross) signal = 'BUY';
    else if (isBearishCross) signal = 'SELL';

    if (pos) {
        if (pos.type === 'LONG' && isBearishCross) signal = 'EXIT_LONG';
        if (pos.type === 'SHORT' && isBullishCross) signal = 'EXIT_SHORT';
    }

    // Non intasare i log se HOLD, a meno che non ci sia un crossover
    if (signal !== 'HOLD') {
        const decision = { signal, confidence: 60, reasoning: 'Incrocio Medie Mobili (EMA)' };
        showAISignal(sym, decision);
    }

    // La chiusura avviene SOLO tramite TP/SL (nel loop renderOpenPositions)
    // Qui gestiamo solo l'APERTURA di nuovi trade
    if (!pos) {
        if (isBullishCross) openTrade('LONG', price, sym);
        else if (isBearishCross) {
            // Non tentare SHORT se: broker Alpaca attivo E (crypto USDT O account non abilitato allo scoperto)
            if (brokerViewActive() && (sym.includes('USDT') || window.__alpacaShortNotAllowed)) return;
            openTrade('SHORT', price, sym);
        }
    }
}

// Sessione REGOLARE di borsa per le azioni (09:30-16:00 EST). Distinta da
// isMarketOpen('STOCK') (04:00-20:00 EST, usata per grafico/prezzo): fuori
// da questa finestra (pre-market/after-hours) lo spread è molto più ampio e
// il prezzo più erratico, causando churn (aperture/chiusure quasi a pari,
// osservate in cronologia). Qui blocchiamo solo le NUOVE aperture — le
// posizioni azionarie già aperte restano gestite (TP/SL) anche fuori sessione.
function isRegularStockSession() {
    const est = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = est.getDay();
    if (day === 0 || day === 6) return false;
    const t = est.getHours() * 60 + est.getMinutes();
    return t >= 9 * 60 + 30 && t < 16 * 60;
}

// ─── Modello commissioni per BROKER × categoria ───
// Percentuale round-trip (fee + spread TIPICO) per contesto broker. Lo spread
// LIVE misurato (getSpreadPctFor) viene aggiunto A PARTE dai chiamanti che lo
// conoscono (es. tpAllowed): qui c'è solo la parte strutturale. Ogni broker ha
// un listino diverso:
//  - Alpaca (alp/alrt) crypto: taker ~0.25% per lato (tier base) + spread tipico;
//    azioni: zero commission, restano fee regolatorie in vendita e scivolamento
//  - Capital.com (capd/capl) CFD: nessuna commissione, il costo è lo spread
//    (stretto sul forex, più largo sulle materie prime); il costo overnight
//    NON è ancora modellato
//  - fh (test locale): valori storici, per continuità di comportamento
const BROKER_FEE_PCT = {
    alp: { CRYPTO: 0.65, STOCK: 0.15, FOREX: 0.05, COMMODITY: 0.05 },
    alrt: { CRYPTO: 0.65, STOCK: 0.15, FOREX: 0.05, COMMODITY: 0.05 },
    capd: { CRYPTO: 0.65, STOCK: 0.15, FOREX: 0.05, COMMODITY: 0.10 },
    capl: { CRYPTO: 0.65, STOCK: 0.15, FOREX: 0.05, COMMODITY: 0.10 },
    fh: { CRYPTO: 0.65, STOCK: 0.15, FOREX: 0.05, COMMODITY: 0.05 },
};

// Stima BASE (non calibrata) dei costi round-trip per simbolo + contesto broker.
// Usa getAssetType (non "includes USDT"): i simboli-posizione del broker
// (PAXGUSD, ADAUSD) non contengono USDT e venivano trattati come azioni,
// sottostimando i costi crypto di 4 volte.
function getRawBreakevenPct(sym, ctx) {
    const c = ctx || ((typeof window !== 'undefined' && typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh');
    let cat = getAssetType(sym);
    // Materie prime SENZA prefisso OANDA (es. LIT, che è un ETF azionario):
    // viaggiano da sempre col costo delle azioni, non con lo spread CFD.
    if (cat === 'COMMODITY' && String(sym).indexOf('OANDA') === -1) cat = 'STOCK';
    const table = BROKER_FEE_PCT[c] || BROKER_FEE_PCT.fh;
    if (table[cat] != null) return table[cat];
    return cat === 'CRYPTO' ? 0.65 : (String(sym).indexOf('OANDA') !== -1 ? 0.05 : 0.15);
}

// ─── Calibrazione automatica dal costo REALE osservato ───
// Per i contesti Alpaca la dashboard deduce le commissioni REALI dal gap tra
// equity del conto e PnL dei trade. Il rapporto reale/stimato diventa un
// fattore correttivo per contesto (EMA, clamp 0.5-3x, persistito): la stima
// converge da sola verso i costi veri del conto (incluso il tier di volume),
// senza codificare a mano i listini a scaglioni.
const _feeCalibCache = {};
function getFeeCalibFactor(ctx) {
    if (_feeCalibCache[ctx] == null) {
        let v = 1;
        try { v = parseFloat(localStorage.getItem('fee_calib_' + ctx)); } catch (e) { }
        _feeCalibCache[ctx] = (isFinite(v) && v >= 0.5 && v <= 3) ? v : 1;
    }
    return _feeCalibCache[ctx];
}
function updateFeeCalibration(ctx, realCommissions, rawEstimated, tradeCount) {
    // Guardie anti-rumore: serve un campione minimo perché il rapporto abbia senso
    // (poche operazioni o stime sotto 1$ producono fattori assurdi).
    if (!ctx || !(realCommissions > 0) || !(rawEstimated >= 1) || !(tradeCount >= 10)) return;
    const target = Math.max(0.5, Math.min(3, realCommissions / rawEstimated));
    const cur = getFeeCalibFactor(ctx);
    const next = cur + 0.2 * (target - cur);
    _feeCalibCache[ctx] = next;
    try { localStorage.setItem('fee_calib_' + ctx, String(next)); } catch (e) { }
}

// Stima EFFETTIVA usata da motore e UI: base per-broker × fattore calibrato.
// Le dipendenze sono guardate con typeof perché i test estraggono questa
// funzione da sola e la eseguono in sandbox con soli stub: senza tabella e
// calibrazione ricade sui valori storici (stesso comportamento di sempre).
function getNetBreakevenPct(sym, ctx) {
    const c = ctx || ((typeof window !== 'undefined' && typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh');
    const base = (typeof getRawBreakevenPct === 'function')
        ? getRawBreakevenPct(sym, c)
        : (getAssetType(sym) === 'CRYPTO' ? 0.65 : (String(sym).indexOf('OANDA') !== -1 ? 0.05 : 0.15));
    const f = (typeof getFeeCalibFactor === 'function') ? getFeeCalibFactor(c) : 1;
    return base * f;
}

// Decide se un TAKE-PROFIT può scattare davvero. Nasce dal churn da spread:
// unrealizedPct è calcolato sull'ULTIMO prezzo scambiato (getLivePriceFor), che
// sta SOPRA il bid a cui la vendita a mercato esegue davvero. Un tick fasullo
// faceva scattare il "TP" mentre la chiusura filava sotto l'ingresso → perdita
// etichettata TP (es. UNIUSD/AAVEUSD, -0.24%/-0.40% in 15-22s).
//   B (netto): il mark lordo deve superare il costo di andata/ritorno stimato
//     (fee+spread, getNetBreakevenPct) PIÙ lo spread live: così, anche vendendo
//     un intero spread sotto il mark, il risultato netto resta >= 0. Oltre,
//     ovviamente, al TP impostato dall'utente/adattivo.
//   C (grazia): nei primi SL_GRACE_MS la posizione "nasce" spread-negativa; il
//     TP scatta solo con margine ampio (costo raddoppiato) per non partire su un
//     tick alla nascita — simmetrico alla grazia già presente sullo SL.
function tpAllowed(sym, unrealizedPct, effTP, posAge) {
    if (unrealizedPct < effTP) return false;                 // TP impostato non raggiunto
    const cost = getNetBreakevenPct(sym);
    const spreadComp = Math.min(getSpreadPctFor(sym), 3.0);  // 0 se spread sconosciuto
    const netFloor = cost + spreadComp;                      // soglia lorda per netto >= 0
    if (unrealizedPct < netFloor) return false;              // profitto netto non garantito
    if (posAge < SL_GRACE_MS && unrealizedPct < netFloor + cost) return false; // grazia TP
    return true;
}

// Main strategy dispatcher — motore tecnico locale (RSI + EMA + MACD + BB) o fallback EMA
function evaluateStrategy(sym, history, price) {
    // Blacklist spread strutturale A MONTE della strategia: inutile valutare
    // simboli che il bot non aprirà mai (openTrade li blocca comunque, difesa
    // in profondità): si risparmiano cicli di calcolo e si eliminano i log
    // "[CONFIRMED BUY] SHIB/PEPE/BONK/PAXG" ingannevoli. ECCEZIONE: se esiste
    // già una posizione sul simbolo (aperta manualmente), la valutazione resta
    // attiva perché serve alla chiusura dinamica AI_REVERSAL.
    if (HIGH_SPREAD_CRYPTO_BLACKLIST.has(normFillSym(sym)) && !activePositions[sym]) return;
    const aiToggle = document.getElementById('aiModeToggle');
    const isAiMode = aiToggle && aiToggle.checked;

    if (isAiMode) {
        evaluateStrategyAI(sym, history, price);
    } else {
        evaluateStrategyFallback(sym, history, price);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Notifiche e contatori del bot
// ═══════════════════════════════════════════════════════════════════
// Notifiche del bot "throttolate": rendono VISIBILE cosa fa (apre/salta/rifiuta)
// senza spammare. Ogni "chiave" può ricomparire al massimo ogni minGapMs.
const _botNotifyLast = {};
function botNotify(key, message, type = 'info', minGapMs = 20000) {
    if (window.__ctxOverride) return;
    const now = Date.now();
    if (_botNotifyLast[key] && now - _botNotifyLast[key] < minGapMs) return;
    _botNotifyLast[key] = now;
    if (typeof showNotification === 'function') showNotification(message, type);
}

// Contatore posizioni SALTATE dalla sessione bot corrente, per motivo. Mostrato
// nel pannello Posizioni Aperte (sopra le icone): rende visibile PERCHÉ in Alpaca
// si aprono meno posizioni che in Test (SHORT crypto non consentito, cash, ecc.).

function bumpSkipped(reason) {
    // Tollerante: i contatori salvati da versioni precedenti possono non avere la chiave
    skippedCounters[reason] = (skippedCounters[reason] || 0) + 1;
    updateSkippedCounterUI();
}
let _skippedUpdatePending = false;
function updateSkippedCounterUI() {
    if (window.__ctxOverride) return;
    if (_skippedUpdatePending) return;
    _skippedUpdatePending = true;

    requestAnimationFrame(() => {
        _skippedUpdatePending = false;
        const el = document.getElementById('skippedCounter');
        if (!el) return;
        const c = skippedCounters;
        const total = c.shortcrypto + c.nocash + c.reject + c.qty + c.maxpos + (c.spread || 0) + (c.exthours || 0);
        // Visibile per TUTTA la sessione col bot attivo (anche a 0), così è chiaro che
        // c'è e sta contando; si nasconde solo a bot fermo.
        if (!isBotActive) { el.style.display = 'none'; return; }
        const parts = [];
        if (c.shortcrypto) parts.push(`${tr('skip_shortcrypto', 'SHORT crypto')} ${c.shortcrypto}`);
        if (c.nocash) parts.push(`${tr('skip_cash', 'cash')} ${c.nocash}`);
        if (c.reject) parts.push(`${tr('skip_reject', 'rifiuti')} ${c.reject}`);
        if (c.qty) parts.push(`${tr('skip_qty', 'qty')} ${c.qty}`);
        if (c.maxpos) parts.push(`${tr('skip_maxpos', 'limite')} ${c.maxpos}`);
        if (c.spread) parts.push(`${tr('skip_spread', 'spread')} ${c.spread}`);
        if (c.exthours) parts.push(`${tr('skip_exthours', 'fuori sessione')} ${c.exthours}`);
        const totalEl = document.getElementById('skippedTotal');
        const breakEl = document.getElementById('skippedBreakdown');
        if (totalEl) totalEl.textContent = total;
        if (breakEl) breakEl.textContent = parts.length ? ' · ' + parts.join(' · ') : '';
        el.style.display = 'block';
    });
}
window.resetSkippedCounters = function () {
    skippedCounters.shortcrypto = skippedCounters.nocash = skippedCounters.reject = skippedCounters.qty = skippedCounters.maxpos = skippedCounters.exthours = 0;
    updateSkippedCounterUI();
};

// ═══════════════════════════════════════════════════════════════════
// Apertura / chiusura ordini
// ═══════════════════════════════════════════════════════════════════
async function openTrade(type, price, sym, dynTP = null, dynSL = null, confidence = 50) {
    // ALrt (conto reale) usa la STESSA logica di Alpaca Paper: gli ordini
    // vengono instradati su api.alpaca.markets con le chiavi live tramite
    // getBrokerHttp() nelle funzioni d'ordine (alpacaCreateOrder/closeTrade).
    if (activePositions[sym]) return;

    // Azioni: nuove aperture SOLO in sessione regolare (09:30-16:00 EST).
    // Fuori da questa finestra (pre-market/after-hours) lo spread si allarga
    // molto e il prezzo è più erratico: causava churn (aperture/chiusure
    // quasi a pari in cronologia). Le posizioni già aperte restano gestite.
    if (getAssetType(sym) === 'STOCK' && !isRegularStockSession()) {
        if (isBotActive) {
            botNotify('exthours', tr('bot_skip_exthours', '{sym}: fuori dalla sessione regolare di borsa (09:30-16:00 EST), ingresso saltato.', { sym: displaySymbol(sym) }), 'info', 30000);
            bumpSkipped('exthours');
        }
        return;
    }

    // Ordine di apertura già inviato per questo simbolo, in attesa che
    // syncAlpacaPositions() lo confermi in activePositions: blocca i doppi
    // BUY (vedi PENDING_OPEN_GUARD_MS sopra). Scaduto il timeout, si
    // considera stantio (ordine mai riempito o sync fallita) e si sblocca.
    const pot = window.__pendingOpenTimes && window.__pendingOpenTimes[normFillSym(sym)];
    if (pot && Date.now() - pot < PENDING_OPEN_GUARD_MS) return;

    // Simbolo respinto di recente dal broker: solo il bot rispetta il
    // cooldown, i bottoni manuali (bot fermo) restano sempre operativi
    if (isBotActive && orderRejectCooldown[sym] && Date.now() < orderRejectCooldown[sym]) return;

    // Circuit breaker globale: fondi esauriti → nessun ordine su nessun asset
    if (isBotActive && globalOrderPauseUntil && Date.now() < globalOrderPauseUntil) return;

    // Blackout post-chiusura: il broker può avere ancora la vecchia posizione in
    // liquidazione (ordine di chiusura pendente), e una nuova apertura sullo stesso
    // simbolo verrebbe rifiutata (403 insufficient qty / wash trade). Finestra
    // estesa a POST_CLOSE_BLACKOUT_MS per spezzare il ping-pong open/close/reopen.
    if (closingAssets.has(sym) || Date.now() - (recentlyClosed[sym] || 0) < POST_CLOSE_BLACKOUT_MS) return;

    // -- Blacklist meme-coin sub-penny (deterministica, NON dipende dalle quote) --
    // Prima linea di difesa contro il churn: questi asset hanno spread effettivo
    // strutturale enorme che il filtro basato su quota non intercetta (la quota
    // top-of-book è sottile/incompleta e "mente"). Il bot non li apre mai.
    if (HIGH_SPREAD_CRYPTO_BLACKLIST.has(normFillSym(sym))) {
        if (isBotActive) {
            botNotify('spread', tr('bot_skip_blacklist', '{sym}: spread strutturale troppo alto, ingresso saltato dal bot.', { sym: displaySymbol(sym) }), 'warning', 30000);
            bumpSkipped('spread');
            return;
        }
        // Ordine manuale: l'utente decide, ma avvisiamo del costo certo
        showNotification(`${displaySymbol(sym)} ha uno spread strutturale molto alto: la posizione parte già in forte perdita.`, 'warning');
    }

    // -- Filtro spread all'ingresso --
    // Si compra all'ask e si rivende al bid: lo spread è un costo CERTO,
    // pagato per intero alla chiusura. Se supera il cap assoluto o lo SL
    // impostato, il trade è matematicamente condannato → il bot lo salta.
    const entrySpreadPct = getSpreadPctFor(sym);
    if (entrySpreadPct > 0) {
        const slRef = dynSL || parseFloat(document.getElementById('botStopLoss')?.value) || 0;
        const spreadCap = slRef > 0 ? Math.min(MAX_ENTRY_SPREAD_PCT, slRef) : MAX_ENTRY_SPREAD_PCT;
        if (entrySpreadPct > spreadCap) {
            if (isBotActive) {
                botNotify('spread', tr('bot_skip_spread', 'Spread {sym} {pct}% oltre il limite ({cap}%): ingresso saltato.', { sym: displaySymbol(sym), pct: entrySpreadPct.toFixed(2), cap: spreadCap.toFixed(2) }), 'warning', 30000);
                bumpSkipped('spread');
                return;
            }
            // Ordine manuale (bot fermo): l'utente decide, ma va avvisato del costo certo
            showNotification(`Attenzione: spread ${displaySymbol(sym)} = ${entrySpreadPct.toFixed(2)}% — la posizione parte già in perdita di circa lo spread.`, 'warning');
        }
    } else if (isBotActive && brokerViewActive()) {
        // Spread ancora SCONOSCIUTO (nessuna quote ricevuta per questo simbolo, es.
        // primi secondi dopo l'avvio del bot, prima che i feed WS/REST popolino
        // globalSpreads): sul broker reale il bot NON deve aprire alla cieca. Era
        // il buco che generava aperture simultanee su asset ad alto spread (es.
        // SHIB) subito rivendute in perdita in 10-13s alla prima quote reale.
        // Solo in modalità broker: in TEST senza chiavi Alpaca lo spread non è
        // mai noto e questo bloccherebbe ogni trade per sempre.
        botNotify('spread_unknown', tr('bot_skip_spread_unknown', 'Spread {sym} non ancora disponibile: ingresso saltato per sicurezza.', { sym: displaySymbol(sym) }), 'info', 30000);
        bumpSkipped('spread');
        return;
    }

    // Limite massimo posizioni aperte contemporaneamente
    const openCount = Object.keys(activePositions).length;
    if (openCount >= maxPositionsLimit) {
        if (Date.now() % 10000 < 500) {
            console.warn(`[BOT] Limite raggiunto (${openCount}/${maxPositionsLimit}). Non apro ${sym}.`);
        }
        if (isBotActive) { botNotify('maxpos', tr('bot_skip_maxpos', 'Limite posizioni aperte raggiunto ({open}/{max}): nessun nuovo ordine finché non se ne chiude una.', { open: openCount, max: maxPositionsLimit }), 'warning', 30000); bumpSkipped('maxpos'); }
        return;
    }

    // Diversificazione per categoria: distribuisce le posizioni equamente tra le categorie attive.
    // Si calcola quante categorie hanno almeno un asset monitorato, poi si limita ogni categoria
    // a floor(maxPositionsLimit / numCategorie) posizioni (almeno 1 per categoria).
    if (isBotActive) {
        const symCat = getAssetType(sym);
        // Conta le categorie che hanno almeno 1 asset nel bgPriceHistories (quindi monitorato)
        const activeCats = new Set();
        Object.keys(bgPriceHistories).forEach(s => {
            if (bgPriceHistories[s] && bgPriceHistories[s].length > 0) activeCats.add(getAssetType(s));
        });
        const numCats = Math.max(1, activeCats.size);
        const maxPerCat = Math.max(1, Math.floor(maxPositionsLimit / numCats));
        // Conta le posizioni aperte per questa categoria
        const catOpenCount = Object.values(activePositions).filter(p => getAssetType(p.sym || '') === symCat).length;
        if (catOpenCount >= maxPerCat && openCount > 0) {
            if (Date.now() % 15000 < 500) {
                console.warn(`[BOT] Diversificazione: categoria ${symCat} già a quota (${catOpenCount}/${maxPerCat}). Aspetto apertura in altra categoria.`);
            }
            return;
        }
    }


    // Controllo Budget di Sessione
    const budgetLimit = getSessionBudgetLimit();
    if (budgetLimit > 0 && sessionBudgetUsed >= budgetLimit) {
        if (Date.now() % 15000 < 500) {
            console.warn(`[BOT] Budget sessione esaurito ($${sessionBudgetUsed.toFixed(0)} / $${budgetLimit.toFixed(0)}). Nessun nuovo ordine.`);
        }
        return;
    }

    let investUsd = getInvestUsd();

    // Quantità ESPLICITA dal box accanto a BUY/SELL (solo ordini manuali):
    // ha precedenza sull'importo automatico. investUsd = qty × prezzo, così
    // sia il percorso simulato sia quello broker eseguono ~quella quantità.
    let manualReqUsd = null; // importo richiesto esplicitamente (per avvisare se i cap lo riducono)
    if (window.__manualQtyOverride && window.__manualQtyOverride.sym === sym) {
        const q = parseFloat(window.__manualQtyOverride.qty) || 0;
        window.__manualQtyOverride = null;
        if (q > 0) { investUsd = q * price; manualReqUsd = investUsd; }
    }

    const useRisk = document.getElementById('aiModeRisk')?.checked;
    // Il Kelly sizing NON si applica alle quantità ESPLICITE del box manuale:
    // l'utente ha chiesto esattamente quella quantità (restano solo i cap di
    // capitale/budget, con avviso se la riducono).
    if (useRisk && !manualReqUsd) {
        // -- Risk Management Adattivo (Kelly Sizing) --
        const W = Math.min(0.90, confidence / 100);
        const rTP = dynTP || parseFloat(document.getElementById('botTargetProfit')?.value) || 1.5;
        const rSL = dynSL || parseFloat(document.getElementById('botStopLoss')?.value) || 1.0;
        const R = rTP / (rSL === 0 ? 1.0 : rSL);

        let K = W - ((1 - W) / R);
        K = Math.max(0.1, Math.min(K, 1.0));

        const scaleFactor = K * 2;
        const originalUsd = investUsd;
        investUsd = investUsd * scaleFactor;

        if (isBotActive) {
            console.log(`[AI KELLY] ${sym} Confidenza: ${confidence}% | W: ${W.toFixed(2)} | R: ${R.toFixed(2)} | K: ${K.toFixed(2)} => Scalato $${originalUsd.toFixed(0)} -> $${investUsd.toFixed(0)}`);
        }
    }
    // ---------------------------------------------

    // Se il budget è attivo, limita l'importo per non sforarlo
    if (budgetLimit > 0) {
        const remaining = budgetLimit - sessionBudgetUsed;
        if (investUsd > remaining) investUsd = remaining;
    }

    // Cap all'investimento basato sul capitale libero locale
    if (investUsd > tradingCapital) {
        investUsd = tradingCapital;
    }

    // La quantità esplicita richiesta supera capitale/budget: avvisa che
    // l'ordine parte per un importo ridotto (quantità effettiva minore)
    if (manualReqUsd && investUsd < manualReqUsd - 0.01) {
        showNotification(`Quantità ridotta: capitale/budget insufficiente per ${formatMoney(manualReqUsd)} — ordine per ${formatMoney(investUsd)} (~${(investUsd / price).toFixed(6)} unità).`, 'warning');
    }

    if (brokerViewActive()) {
        const isCryptoSym = sym.includes('USDT');

        // Alpaca non supporta posizioni SHORT sulle Crypto
        if (isCryptoSym && type === 'SHORT') {
            // Avvisa solo se è un'azione manuale, i bot lo ignorano a monte per non spammare
            if (!isBotActive) {
                console.warn(`[BROKER] Alpaca non supporta posizioni SHORT sulle Crypto. Ordine ${sym} annullato.`);
                if (typeof showNotification === 'function') showNotification('Alpaca non permette lo SHORT sulle Crypto: operazione annullata.', 'warning');
            }
            return;
        }

        const brokerFunds = isCryptoSym ? availableCash : availableMargin;
        const safeFunds = Math.max(0, brokerFunds) * 0.95; // buffer 5% di sicurezza
        if (investUsd > safeFunds) {
            if (isCryptoSym && safeFunds <= 0) {
                // Modalità Alpaca Paper: NIENTE simulazioni locali. Senza cash
                // reale per le crypto il segnale viene semplicemente saltato.
                // Circuit breaker GLOBALE: fondi crypto a zero → tutti gli ordini in pausa
                globalOrderPauseUntil = Date.now() + GLOBAL_ORDER_PAUSE_MS;
                console.warn(`[BROKER] Cash per Crypto esaurito su Alpaca: TUTTI gli ordini sospesi per ${GLOBAL_ORDER_PAUSE_MS / 60000} min.`);
                botNotify('nocashcrypto', tr('bot_skip_nocash_crypto', 'Cash crypto Alpaca insufficiente: ordini in pausa per 5 minuti.'), 'warning', 30000);
                if (isBotActive) bumpSkipped('nocash');
                return;
            } else {
                if (safeFunds > 0 || !isCapitalExhausted) {
                    console.warn(`[BROKER] Ridotto investimento da ${investUsd.toFixed(2)} a ${safeFunds.toFixed(2)} per fondi disponibili (${isCryptoSym ? 'cash crypto' : 'buying power'}).`);
                }
                investUsd = safeFunds;
            }
        }

        // Se dopo i tagli l'investimento è sceso sotto i 10$, Alpaca rifiuterà l'ordine.
        // Annulliamo subito per evitare l'errore API (cost basis must be >= 10).
        if (investUsd > 0 && investUsd < 10) {
            // Circuit breaker GLOBALE: se non riusciamo a raggiungere i 10$ minimi,
            // nessun altro asset avrà fondi sufficienti → pausa tutti gli ordini.
            globalOrderPauseUntil = Date.now() + GLOBAL_ORDER_PAUSE_MS;
            console.warn(`[BROKER] Importo finale troppo basso (${investUsd.toFixed(2)}$) per ${sym}: TUTTI gli ordini sospesi per ${GLOBAL_ORDER_PAUSE_MS / 60000} min.`);
            botNotify('min_order_10', tr('bot_skip_min10', 'Fondi insufficienti ({amount}$). Tutti gli ordini in pausa per 5 minuti.', { amount: investUsd.toFixed(2) }), 'warning', 30000);
            return;
        }
    }

    if (!brokerViewActive()) {
        // Modalità Test: simula il trade localmente senza Alpaca
        if (!price || price <= 0) {
            console.warn(`[TEST] Prezzo non disponibile per ${sym}, trade annullato.`);
            return;
        }
        if (investUsd <= 0 || tradingCapital <= 0) {
            console.warn(`[TEST] Capitale insufficiente (${tradingCapital.toFixed(2)}), trade annullato.`);
            return;
        }
        const simQty = investUsd / price;
        activePositions[sym] = { type, entryPrice: price, amount: simQty, invested: investUsd, openTime: Date.now(), simulated: true, dynamicTP: dynTP, dynamicSL: dynSL };
        if (typeof playOpenSound === 'function') playOpenSound();
        tradingCapital = Math.max(0, tradingCapital - investUsd);
        sessionBudgetUsed += investUsd;
        updateSessionBudgetUI();
        updateWalletUI();
        persistData();
        updateDashboard();
        console.log(`[TEST] Trade simulato localmente: ${type} ${sym} @ ${price} | investUsd=${investUsd.toFixed(2)}`);
        return;
    }

    console.log(`[OPEN TRADE] ${type} ${sym} @ ${formatMoney(price, 4, 4)} | investUsd=${formatMoney(investUsd)} | libero=${formatMoney(tradingCapital)}`);

    // --- STAGGERING GLOBALE ALPACA ---
    // Limita la frequenza degli ordini a ~2.5 al secondo globalmente per evitare 429
    window.__lastAlpacaAction = window.__lastAlpacaAction || 0;
    if (Date.now() - window.__lastAlpacaAction < 400) {
        orderRejectCooldown[sym] = Date.now() + Math.random() * 2000;
        return;
    }
    window.__lastAlpacaAction = Date.now();

    if (investUsd <= 0.05) {
        if (!isCapitalExhausted) {
            console.warn(`[SYSTEM] Capitale esaurito. Il bot entra in modalità ATTESA fino al prossimo rientro di fondi.`);
            isCapitalExhausted = true;
            updateBotStatusLabel(); // Aggiorna UI per mostrare lo stato di attesa
        }
        return;
    }

    // Se arriviamo qui, abbiamo capitale
    if (isCapitalExhausted) {
        isCapitalExhausted = false;
        console.log("[SYSTEM] Rientro di capitale rilevato. Il bot riprende l'attività di acquisto.");
        updateBotStatusLabel();
    }

    // --- ROUTING ORDINI ---


    if (brokerViewActive() && !restrictedAssets.has(sym)) {
        if (window.__alpacaShortNotAllowed === undefined) {
            window.__alpacaShortNotAllowed = localStorage.getItem('alpacaShortNotAllowed') === 'true';
        }
        if (type === 'SHORT' && window.__alpacaShortNotAllowed) {
            if (Date.now() % 30000 < 500) {
                console.log(`[BROKER] SHORT ignorato: l'account Alpaca non abilita lo scoperto.`);
            }
            if (isBotActive) { botNotify('short_disabled', tr('bot_skip_shortnotsupported', 'SHORT ignorato: account Alpaca non abilita lo scoperto. Usa "Solo LONG".'), 'warning', 30000); bumpSkipped('reject'); }
            return;
        }

        const isForex = sym.includes('OANDA');
        const isCrypto = sym.includes('USDT');

        // Whitelist crypto supportati dal broker: sincronizzata da
        // syncAlpacaCryptoAssets() (usa la lista a livello di modulo, non una copia fissa).
        if (isCrypto && !ALPACA_SUPPORTED_CRYPTO.includes(sym)) {
            // Modalità Alpaca Paper: niente simulazioni locali. L'asset non è
            // tradabile su Alpaca, quindi viene escluso definitivamente.
            restrictedAssets.add(sym);
            console.log(`[BROKER] ${sym} non supportato da Alpaca: segnale ignorato (nessuna simulazione locale in modalità Alpaca Paper).`);
            return;
        }

        // Alpaca Paper NON supporta Forex (OANDA) né Materie Prime: in modalità
        // broker non si simula nulla localmente — asset escluso definitivamente
        if (isForex || sym === 'LIT') {
            restrictedAssets.add(sym);
            console.log(`[BROKER] ${sym} (Forex/Commodity) non supportato da Alpaca Paper: segnale ignorato (nessuna simulazione locale).`);
            return;
        }

        let alpacaSym = sym;
        if (isCrypto) {
            if (type === 'SHORT') {
                // Alpaca non supporta lo SHORT sulle crypto e in modalità broker
                // non si simula nulla localmente: segnale ignorato
                if (Date.now() % 30000 < 500) {
                    console.log(`[BROKER] SHORT crypto ${sym} non supportato da Alpaca: segnale ignorato (nessuna simulazione locale).`);
                }
                if (isBotActive) { botNotify('shortcrypto', tr('bot_skip_shortcrypto', 'Segnali SHORT sulle crypto ignorati: Alpaca consente solo LONG sulle criptovalute.'), 'info', 30000); bumpSkipped('shortcrypto'); }
                return;
            }
            alpacaSym = sym.replace('USDT', '/USD');
        }

        let qtyVal = investUsd / price;
        if (isForex) {
            qtyVal = Math.floor(qtyVal);
        } else if (isCrypto) {
            qtyVal = Math.floor(qtyVal * 10000) / 10000; // 4 decimali per Crypto su Alpaca
        } else {
            // Per le azioni, permettiamo frazioni solo in LONG. In SHORT Alpaca vuole interi.
            if (type === 'SHORT') {
                qtyVal = Math.floor(qtyVal);
            } else {
                qtyVal = Math.floor(qtyVal * 100) / 100; // 2 decimali per Stocks LONG
            }
        }

        let actualCost = qtyVal * price;
        if (actualCost > 0 && actualCost < 10) {
            let minUsd = 10.05;
            if (isForex) {
                qtyVal = Math.ceil(minUsd / price);
            } else if (isCrypto) {
                qtyVal = Math.ceil((minUsd / price) * 10000) / 10000;
            } else {
                if (type === 'SHORT') qtyVal = Math.ceil(minUsd / price);
                else qtyVal = Math.ceil((minUsd / price) * 100) / 100;
            }
            actualCost = qtyVal * price;
        }

        // CONTROLLO GLOBALE DEI FONDI REALI SUL BROKER (Evita i 403)
        const brokerFunds = isCrypto ? availableCash : availableMargin;
        if (actualCost > brokerFunds) {
            // Se i fondi sono sotto i 10$ (minimo Alpaca), nessun ordine potrà passare:
            // attiva il circuit breaker globale per evitare centinaia di 403.
            if (brokerFunds < 10) {
                globalOrderPauseUntil = Date.now() + GLOBAL_ORDER_PAUSE_MS;
                console.warn(`[BROKER] Fondi esauriti ($${(brokerFunds || 0).toFixed(2)}): TUTTI gli ordini sospesi per ${GLOBAL_ORDER_PAUSE_MS / 60000} min.`);
            } else {
                orderRejectCooldown[sym] = Date.now() + ORDER_REJECT_COOLDOWN_MS;
                console.warn(`[BROKER] Fondi insufficienti per $${actualCost.toFixed(2)} su ${sym}. Disponibili: $${(brokerFunds || 0).toFixed(2)}.`);
            }
            if (isBotActive) { botNotify('nocash', tr('bot_skip_nocash', 'Fondi insufficienti sul broker per aprire il trade su {sym}.', { sym: displaySymbol(sym) }), 'warning', 30000); bumpSkipped('nocash'); }
            return;
        }

        // Prenotazione preventiva fondi (Previene Race Conditions asincrone su burst multipli).
        // Si prenota SOLO quanto realmente disponibile e si memorizza l'importo
        // prenotato: prima si deduceva actualCost con clamp a 0 ma si rimborsava
        // actualCost PIENO sul rifiuto → fondi fantasma (31$ reali diventavano 85$
        // locali) → loop infinito di ordini sovradimensionati rifiutati con 403.
        let bookedCash = 0, bookedMargin = 0;
        if (isCrypto && typeof availableCash !== 'undefined') {
            bookedCash = Math.min(Math.max(0, availableCash), actualCost);
            availableCash = Math.max(0, availableCash - actualCost);
            window.__lastAlpacaDeduction = Date.now();
        } else if (typeof availableMargin !== 'undefined') {
            bookedMargin = Math.min(Math.max(0, availableMargin), actualCost);
            availableMargin = Math.max(0, availableMargin - actualCost);
            window.__lastAlpacaDeduction = Date.now();
        }

        if (qtyVal > 0) {
            // alpacaCreateOrder: true = successo, altrimenti stringa col motivo del
            // rifiuto (o false se manager assente). Usiamo il motivo di QUESTO ordine.
            const orderRes = await alpacaCreateOrder(type === 'LONG' ? 'buy' : 'sell', alpacaSym, qtyVal.toString());
            if (orderRes !== true) {
                // Restituzione fondi in caso di ordine rifiutato: si rimborsa
                // ESATTAMENTE quanto prenotato (mai actualCost pieno, vedi sopra)
                if (isCrypto && typeof availableCash !== 'undefined') {
                    availableCash += bookedCash;
                } else if (typeof availableMargin !== 'undefined') {
                    availableMargin += bookedMargin;
                }

                // Ordine rifiutato dal broker: NON scalare capitale né budget di sessione,
                // altrimenti il budget si esaurisce con ordini mai eseguiti.
                // Classificazione del rifiuto sul motivo di questo specifico ordine
                // (fallback al global solo se il motivo non è arrivato come stringa).
                const reason = (typeof orderRes === 'string' ? orderRes : '') || window.__lastAlpacaOrderError || '';
                const isFundError = /insufficient buying power|insufficient balance|cost basis must be|not enough/.test(reason);
                const isWashTrade = /wash trade/.test(reason);
                if (isFundError) {
                    // Errore di conto (fondi): sospensione globale, ogni altro ordine
                    // fallirebbe uguale → evita la raffica di 403.
                    globalOrderPauseUntil = Date.now() + GLOBAL_ORDER_PAUSE_MS;
                    console.warn(`[ORDER] Fondi insufficienti (${reason.slice(0, 60)}): TUTTI gli ordini sospesi per ${GLOBAL_ORDER_PAUSE_MS / 60000} min.`);
                } else if (isWashTrade) {
                    // Ordine opposto ancora pendente sullo stesso simbolo: cooldown lungo
                    // per lasciarlo risolvere, invece di ritentare subito (altra 403).
                    orderRejectCooldown[sym] = Date.now() + WASH_TRADE_COOLDOWN_MS;
                    console.warn(`[ORDER] Wash trade su ${sym} (ordine opposto pendente): cooldown ${WASH_TRADE_COOLDOWN_MS / 1000}s.`);
                } else {
                    orderRejectCooldown[sym] = Date.now() + ORDER_REJECT_COOLDOWN_MS;
                    console.warn(`[ORDER] Ordine ${type} ${sym} rifiutato dal broker. Riprovo tra ${ORDER_REJECT_COOLDOWN_MS / 60000} min.`);
                }
                if (isBotActive) { botNotify('reject', tr('bot_order_rejected', 'Ordine {sym} rifiutato dal broker: riprovo tra qualche minuto.', { sym: displaySymbol(sym) }), 'error', 20000); bumpSkipped('reject'); }
                return;
            }

            // L'ora di apertura REALE per la posizione che il sync creerà tra poco:
            // /v2/positions non ha created_at e senza openTime la grazia anti-spread
            // non partiva mai (posAge=Infinity) → SL bucato dallo spread in 4-10s
            window.__pendingOpenTimes = window.__pendingOpenTimes || {};
            window.__pendingOpenTimes[normFillSym(sym)] = Date.now();

            // --- GESTIONE CAPITALE ---
            // Scala l'importo realmente impegnato (qty arrotondata × prezzo), non l'intento
            tradingCapital -= actualCost;

            // (I fondi Alpaca locali sono già stati decurtati preventivamente)

            // --- BUDGET SESSIONE ---
            sessionBudgetUsed += actualCost;
            updateSessionBudgetUI();

            updateWalletUI();


            // --- SINCRONIZZAZIONE IMMEDIATA ---
            if (typeof playOpenSound === 'function') playOpenSound();
            console.log(`[ORDER] Inviato ordine per ${sym}. Attendo sincronizzazione broker...`);
            if (isBotActive) botNotify('open', tr('bot_opened', 'Posizione aperta: {type} {sym}.', { type: type, sym: sym.replace('USDT', '') }), 'success', 3000);
            setTimeout(() => {
                if (brokerViewActive()) syncAlpacaPositions();
            }, 1000);
        } else {
            console.warn(`[ORDER] Quantità insufficiente per aprire ${type} su ${sym}.`);
            // Lo SHORT su azioni richiede almeno 1 quota INTERA (Alpaca non consente
            // frazioni allo scoperto): con un investimento troppo piccolo per il prezzo
            // dell'azione la qty arrotonda a 0. Avviso throttolato (niente spam).
            botNotify('qty0', tr('bot_skip_qty', "Importo per operazione troppo basso per {sym} (lo SHORT azioni richiede ≥ 1 quota intera). Aumenta l'importo per trade.", { sym: sym.replace('USDT', '') }), 'warning', 30000);
            if (isBotActive) bumpSkipped('qty');
            return;
        }
    }

    if (activePositions[sym]) {
        activePositions[sym].dynamicTP = dynTP;
        activePositions[sym].dynamicSL = dynSL;
    }

    persistData();
    updateDashboard();
}

async function closeTrade(sym, price, reason = 'MANUAL') {
    // Broker attivo (Paper o REALE/ALrt): stessa logica di chiusura,
    // endpoint+chiavi corretti (live in ALrt) tramite getBrokerHttp().
    const _bk = getBrokerHttp();
    const ALPACA_BASE = _bk.base, alpacaKeyId = _bk.key, alpacaSecretKey = _bk.secret;
    const pos = activePositions[sym];
    if (!pos || pos.isActuallyClosing) return;
    // Anti-duplicazione: se una chiusura broker è in corso/appena inviata, non ripetere
    if (reason !== 'MANUAL' && Date.now() - (recentlyClosed[sym] || 0) < 30000) return;

    if (reason !== 'MANUAL' && brokerViewActive() && !pos.simulated) {
        window.__lastAlpacaAction = window.__lastAlpacaAction || 0;
        if (Date.now() - window.__lastAlpacaAction < 400) {
            recentlyClosed[sym] = Date.now() - 30000 + Math.random() * 2000;
            return;
        }
        window.__lastAlpacaAction = Date.now();
    }

    pos.isActuallyClosing = true;

    const pnl = pos.type === 'LONG'
        ? (price - pos.entryPrice) * pos.amount
        : (pos.entryPrice - price) * pos.amount;

    // Applica il cooldown post-trade: più lungo dopo una perdita (vedi
    // POST_TRADE_COOLDOWN_*_MS) per non rientrare subito nelle stesse
    // condizioni che l'hanno appena generata.
    const cdKey = (window.__ctxOverride ? window.__ctxOverride + ':' : '') + sym;
    tradeCooldowns[cdKey] = Date.now();
    tradeCooldownDurations[cdKey] = pnl < 0 ? POST_TRADE_COOLDOWN_LOSS_MS : POST_TRADE_COOLDOWN_WIN_MS;

    // 0. Protezione Dust: se il valore della posizione è trascurabile, la chiudiamo solo localmente
    // ATTENZIONE: Questo filtro si applica SOLO alle chiusure automatiche (TP, SL, BOT)
    // e SOLO alle posizioni simulate/test. Una posizione REALE sul broker va sempre
    // liquidata su Alpaca, altrimenti resta aperta e il sync la fa risorgere in loop.
    // Se l'utente clicca MANUALMENTE, proviamo comunque a vendere sul broker.
    if (reason !== 'MANUAL' && pos.amount * price < 1.0 && (!brokerViewActive() || pos.simulated)) {
        console.log(`[DUST] Chiusura locale automatica per posizione trascurabile: ${sym}`);
        tradingCapital += (pos.invested + pnl); // restituisce il capitale impegnato
        addTradeToHistory(pos.type, pos.entryPrice, price, pnl, pos.amount, sym, pos.openTime, Date.now(), true, reason);
        delete activePositions[sym];
        persistData();
        updateWalletUI();
        updateDashboard();
        return;
    }

    try {
        // --- ROUTING CHIUSURA BROKER ---
        if (brokerViewActive() && !pos.simulated && alpacaKeyId) {
            // NON sincronizziamo prima di chiudere: il sync può sovrascrivere
            // l'oggetto posizione e rimuovere il flag isActuallyClosing.
            // Usiamo i dati locali che sono già aggiornati dal polling continuo.

            let alpacaSym = sym;
            if (sym.includes('USDT')) alpacaSym = sym.replace('USDT', '/USD');
            let identifier = pos.brokerAssetId || alpacaSym;

            console.log(`[ALPACA] Avvio chiusura per: ${sym} (ID: ${identifier}, Qty: ${pos.amount})`);

            // Step 0: cancella eventuali ordini pendenti sul simbolo usando il manager Alpaca
            try {
                const searchSym = alpacaSym.replace('OANDA:', '').replace('_', '/');
                const tempMgr = getAlpacaManager();
                if (tempMgr) {
                    const openOrders = await tempMgr.getOpenOrders(searchSym);
                    if (openOrders && openOrders.length > 0) {
                        console.log(`[ALPACA] Cancellazione di ${openOrders.length} ordini pendenti per ${searchSym}...`);
                        for (const order of openOrders) {
                            if (order.status === 'pending_cancel' || order.status === 'pending_replace') continue;
                            await tempMgr.cancelOrder(order.id);
                        }
                        await new Promise(r => setTimeout(r, 800));
                    }
                }
            } catch (e) { console.warn('[ALPACA] Cancellazione ordini pendenti pre-chiusura fallita:', e); }

            // Metodo 1: Liquidazione Totale (DELETE) tramite Manager
            let liquidationSuccess = false;
            let liquidationErr = '';
            try {
                const mgr = getAlpacaManager();
                if (mgr) {
                    await mgr.closePosition(identifier);
                    liquidationSuccess = true;
                    console.log(`[ALPACA] Liquidazione ${identifier} confermata.`);
                } else {
                    throw new Error("Alpaca Manager non trovato.");
                }
            } catch (err) {
                liquidationErr = err.message || String(err);
                if (liquidationErr.includes('404')) {
                    console.warn(`[ALPACA] Posizione ${identifier} non trovata sul broker. Procedo con chiusura locale.`);
                    liquidationSuccess = true; // Permetti la chiusura locale
                } else {
                    console.warn(`[ALPACA] Liquidazione fallita, provo Fallback LIMIT...`, liquidationErr);
                }
            }

            if (liquidationSuccess) {
                // Success block, continue
            } else {
                const rawErr = liquidationErr;
                console.warn(`[ALPACA] Liquidazione fallita, provo Fallback LIMIT...`, rawErr);

                // Metodo 2: Fallback con Ordine LIMIT
                const side = pos.type === 'LONG' ? 'sell' : 'buy';
                let qty = Math.floor(pos.amount * 10000) / 10000;

                if (qty > 0) {
                    const limitPrice = pos.type === 'LONG' ? price * 0.999 : price * 1.001;
                    let limitStr;
                    if (limitPrice < 0.0001) limitStr = limitPrice.toFixed(8);
                    else if (limitPrice < 0.01) limitStr = limitPrice.toFixed(6);
                    else if (limitPrice < 1) limitStr = limitPrice.toFixed(4);
                    else limitStr = limitPrice.toFixed(sym.includes('USDT') || sym.includes('OANDA') || sym.includes('CRYPTO') || sym.endsWith('USD') ? 4 : 2);

                    const fallbackBody = {
                        symbol: alpacaSym.replace('OANDA:', '').replace('_', '/'),
                        qty: qty.toString(),
                        side: side,
                        type: 'limit',
                        limit_price: limitStr,
                        time_in_force: (alpacaSym.includes('/') || alpacaSym.endsWith('USD') || alpacaSym.endsWith('USDT') || sym.includes('CRYPTO')) ? 'gtc' : 'day',
                        extended_hours: true
                    };

                    const orderResp = await fetch(`${ALPACA_BASE}/v2/orders`, {
                        method: 'POST',
                        headers: {
                            'apca-api-key-id': alpacaKeyId,
                            'apca-api-secret-key': alpacaSecretKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(fallbackBody)
                    });

                    if (!orderResp.ok) {
                        const errTxt = await orderResp.text();
                        console.error(`[ALPACA] Fallimento totale chiusura:`, errTxt);
                        pos.lastError = errTxt.includes('day trades') ? 'PDT'
                            : (errTxt.includes('wash trade') ? 'WASH' : 'BROKER_ERR');
                        pos.isActuallyClosing = false;
                        // Throttle: senza, l'AI ritenterebbe la chiusura (condannata) ogni
                        // pochi secondi con 3 errori a tentativo. 30s danno al broker il
                        // tempo di risolvere l'ordine opposto pendente o la liquidazione.
                        recentlyClosed[sym] = Date.now();
                        if (pos.lastError === 'WASH') {
                            // Alpaca indica l'ID esatto dell'ordine che blocca: proviamo a
                            // cancellarlo direttamente, così il prossimo tentativo passa
                            // anche se la ricerca per simbolo non lo aveva trovato
                            try {
                                const washErr = JSON.parse(errTxt);
                                if (washErr.existing_order_id) {
                                    fetch(`${ALPACA_BASE}/v2/orders/${washErr.existing_order_id}`, {
                                        method: 'DELETE',
                                        headers: { 'apca-api-key-id': alpacaKeyId, 'apca-api-secret-key': alpacaSecretKey }
                                    }).catch(() => { });
                                }
                            } catch (e) { /* errTxt non-JSON: nessun id da cancellare */ }
                            showNotification(`Alpaca: chiusura ${sym} bloccata da un ordine opposto ancora pendente sul broker. Riprovo tra 30 secondi.`, "warning");
                        } else {
                            showNotification(`Alpaca: Errore chiusura. ${pos.lastError === 'PDT' ? 'Restrizione PDT attiva (Sotto $25k).' : 'Controlla il broker.'}`, "error");
                        }
                        renderOpenPositions();
                        return;
                    }
                }
            }
        }

        // Se arriviamo qui, la chiusura è avvenuta o è stata accettata dal broker.
        // La decisione contabile dipende SOLO da brokerViewActive()+posizione reale,
        // NON dalla presenza della chiave: in modalità broker una posizione reale non
        // va MAI registrata localmente (creerebbe un trade locale fantasma senza id
        // Alpaca). Invariante: "in Alpaca Paper non esistono trade locali/simulati".
        if (brokerViewActive() && !pos.simulated) {
            // BROKER: capitale, cronologia e statistiche arrivano SOLO dai sync
            // (equity reale + FILL). Niente contabilità locale: eviterebbe
            // doppi conteggi (voce locale + FILL importato) e doppi accrediti.
            recentlyClosed[sym] = Date.now(); // blocca resurrezione dal sync durante la liquidazione
            // Annota entry reale E motivo per il FILL di chiusura in arrivo
            // (vedi syncAlpacaHistory): così in cronologia compare SL/TP/HEDGE
            // invece del generico BROKER_SYNC
            brokerEntryBasis[normFillSym(sym)] = { price: pos.entryPrice, time: pos.openTime, type: pos.type, reason: reason };
            if (pnl > 0) playCashSound(); else playLossSound();

            sessionBudgetUsed -= pos.invested;
            if (sessionBudgetUsed < 0) sessionBudgetUsed = 0;
            updateSessionBudgetUI();

            delete activePositions[sym];
            updateWalletUI();
            updateDashboard();
        } else {
            // TEST/SIMULATE: contabilità locale completa. Raggiungibile SOLO quando
            // !brokerViewActive() || pos.simulated (stessa guardia della chiusura DUST):
            // in modalità broker con posizione reale questo ramo non gira mai, quindi
            // non registra mai localmente a prescindere dalla presenza della chiave.
            const feePct = getNetBreakevenPct(sym);
            const notional = pos.entryPrice * pos.amount;
            const feeCost = notional * (feePct / 100);
            globalCommissions += feeCost;

            const pnlNetto = pnl - feeCost;
            tradingCapital += (pos.invested + pnlNetto);
            updateWalletUI();

            if (pnlNetto > 0) playCashSound(); else playLossSound();

            sessionBudgetUsed -= pos.invested;
            if (sessionBudgetUsed < 0) sessionBudgetUsed = 0;
            updateSessionBudgetUI();

            addTradeToHistory(pos.type, pos.entryPrice, price, pnl, pos.amount, sym, pos.openTime, Date.now(), true, reason);
            delete activePositions[sym];
            persistData();
            updateDashboard();
        }

    } catch (err) {
        console.error(`[CLOSE ERROR] Errore critico chiusura ${sym}:`, err);
        showNotification(`Errore tecnico durante la chiusura.`, "error");
    } finally {
        if (activePositions[sym]) {
            activePositions[sym].isActuallyClosing = false;
            renderOpenPositions();
        }
    }

    // Trigger sync immediato per confermare la rimozione dal broker
    setTimeout(() => {
        if (useAlpacaBroker) syncAlpacaPositions();
    }, 1500);

    // Remove market data tracking if no longer needed
    syncFinnhubSubscriptions();
    syncAlpacaDataSubscriptions();
    updateDashboard();
}

function addTradeToHistory(type, entryPrice, exitPrice, pnl, amount, sym, entryTime, exitTime, isBrokerTrade = false, reason = 'MANUAL') {
    // Validazione simbolo
    const validSym = sym || (document.getElementById('assetPair') || {}).value || '???';
    if (validSym === 'undefined' || validSym === 'null') {
        console.warn("[HISTORY] Salto salvataggio: simbolo non valido.");
        return;
    }

    // Se un broker è attivo, non mostriamo le operazioni simulate localmente
    if (useAlpacaBroker && !isBrokerTrade) {
        console.log(`[HISTORY] Salto salvataggio operazione simulata per ${validSym} (Broker attivo).`);
        return;
    }
    // Rimuovi lo stato vuoto se presente
    const _tl = document.getElementById('tradeList');
    const emptyState = _tl ? _tl.querySelector('.empty-state') : null;
    if (emptyState) emptyState.remove();

    const eTime = entryTime || Date.now();
    const xTime = exitTime || Date.now();

    // --- AGGIORNAMENTO STATISTICHE GLOBALI (LIFETIME) ---
    executedTrades++;
    if (pnl > 0) {
        grossProfit += pnl;
        winTrades++;
    } else if (pnl < 0) {
        grossLoss += Math.abs(pnl);
    }

    if (!useAlpacaBroker) {
        totalPnL += pnl;
    }
    // Registro P&L lifetime del contesto locale (fh/capd/capl): alimenta
    // la box "Capitale Attuale" (versato + profitti − perdite storici)
    if (!brokerViewActive() && typeof window.addToPnlLedger === 'function') window.addToPnlLedger(pnl);

    // --- AI Avanzata: Reinforcement Learning (Aggiornamento Memoria) ---
    // Punteggio EWMA per simbolo e direzione, pesato sul PnL% (clampato):
    // una perdita del 2.5% pesa più di una dello 0.2%, i risultati vecchi
    // decadono (75% di peso al nuovo aggiornamento), il punteggio è
    // limitato a ±8 per evitare avversioni/euforie permanenti.
    const useRL = document.getElementById('aiModeRL')?.checked;
    if (useRL) {
        if (!window.rlMemory) window.rlMemory = {};
        let m = window.rlMemory[validSym];
        if (typeof m !== 'object' || m === null) {
            const legacy = (typeof m === 'number') ? m : 0; // migrazione dal contatore ±1
            m = { long: legacy, short: legacy, t: Date.now() };
        }
        const investedAmt = entryPrice * amount;
        const pnlPct = investedAmt > 0 ? (pnl / investedAmt) * 100 : 0;
        const outcome = Math.max(-3, Math.min(3, pnlPct));
        const dir = (type === 'LONG') ? 'long' : 'short';
        m[dir] = Math.max(-8, Math.min(8, (m[dir] || 0) * 0.75 + outcome));
        m.t = Date.now();
        window.rlMemory[validSym] = m;
        console.log(`🧠 [AI RL] ${validSym} ${dir}: esito ${outcome.toFixed(2)} → score ${m[dir].toFixed(2)}`);
        localStorage.setItem('sim_rl_memory', JSON.stringify(window.rlMemory));
    }

    // Salva nel log persistente
    tradeHistory.unshift({
        time: xTime,
        entryTime: eTime,
        exitTime: xTime,
        type,
        entryPrice,
        exitPrice,
        pnl,
        amount,
        invested: entryPrice * amount,
        sym: validSym,
        reason
    });

    const todayStr = new Date().toLocaleDateString();
    while (tradeHistory.length > 50) {
        const oldestTrade = tradeHistory[tradeHistory.length - 1];
        if (new Date(oldestTrade.time).toLocaleDateString() !== todayStr) {
            tradeHistory.pop();
        } else {
            break;
        }
    }

    // Salva sulla chiave corretta secondo la modalità (test vs broker)
    localStorage.setItem(brokerViewActive() ? 'sim_trade_history' : 'sim_test_history', JSON.stringify(tradeHistory));

    // Forza rendering completo per coerenza UI
    renderHistory();
    updateDashboard();
}

async function alpacaCreateOrder(side, symbol, qty) {
    // Pausa globale attiva (fondi esauriti): abortisce anche gli ordini del bot
    // già "in volo" — lanciati in burst PRIMA che il primo 403 impostasse la
    // pausa — senza colpire l'API. Il gate in openTrade da solo non basta:
    // la strategia apre N simboli in parallelo e la pausa arriva a burst partito.
    if (isBotActive && globalOrderPauseUntil && Date.now() < globalOrderPauseUntil) {
        return 'paused: ordini sospesi per fondi insufficienti';
    }
    const mgr = getAlpacaManager();
    if (!mgr) return false;
    try {
        const livePrice = globalPrices[symbol] || 0;
        const data = await mgr.createOrder(symbol, qty, side, 'market', 'day', livePrice);
        if (data.status === 'accepted' || data.status === 'pending_new') {
            showNotification(`Alpaca: Ordine in attesa. ID: ${data.id}`, "info");
        } else {
            showNotification(`Alpaca: Ordine eseguito con successo!`, "success");
        }
        setTimeout(() => { if (typeof syncAlpacaOrders === 'function') syncAlpacaOrders(); }, 500);
        return true;
    } catch (e) {
        const msg = e.message ? e.message.toLowerCase() : '';
        if (msg.includes('account is not allowed to short')) {
            window.__alpacaShortNotAllowed = true;
            localStorage.setItem('alpacaShortNotAllowed', 'true');
            console.warn("[ALPACA] Account non abilitato allo short. Disattivazione vendite allo scoperto.");
            showNotification(`L'account Alpaca non permette vendite allo scoperto (SHORT). Imposta la direzione su "Solo LONG".`, "warning");
        } else if (msg.includes('insufficient balance') || msg.includes('insufficient buying power') || msg.includes('cost basis must be')) {
            console.warn(`[ALPACA] Ordine rifiutato per fondi insufficienti (possibile desincronizzazione temporanea). Dettaglio: ${e.message}`);
            showNotification(`Alpaca: Fondi temporaneamente insufficienti per eseguire l'ordine.`, "warning");
        } else if (msg.includes('wash trade')) {
            console.warn(`[ALPACA] Ordine rifiutato: wash trade (ordine opposto ancora pendente sullo stesso simbolo). Dettaglio: ${e.message}`);
        } else {
            console.error("[ALPACA] Errore ordine:", e);
            showNotification(`Alpaca Errore: ${e.message}`, "error");
        }
        // Restituiamo il MOTIVO (stringa) invece di false: il chiamante lo usa per
        // classificare il rifiuto in modo affidabile, senza leggere il global
        // window.__lastAlpacaOrderError (che ordini paralleli possono sovrascrivere).
        return msg || 'error';
    }
}

// ═══════════════════════════════════════════════════════════════════
// Gestione del rischio
// ═══════════════════════════════════════════════════════════════════
// Gestione rischio di UNA posizione del contesto attivo. Chiamata da
// renderOpenPositions (app.js) a ogni ciclo per ogni posizione: ricalibra
// TP/SL dinamici in modalità AI e applica trailing / hedging / break-even /
// TP / SL (con grazia anti-spread). Ritorna { effTP, effSL, closed }:
// closed=true significa che la posizione è stata chiusa (il chiamante salta
// il rendering della card). manageRisk=false → solo calcolo di effTP/effSL.
// --- AI Avanzata: TP/SL ricalibrati in tempo reale ---
// La volatilità corrente (Bande di Bollinger) aggiorna il target e lo stop
// di OGNI posizione a ogni ciclo, non solo al momento dell'apertura. Condivisa
// tra il motore in primo piano (manageOpenPositionRisk) e quelli in background
// (manageBgRiskCurrentCtx): prima erano due copie della stessa formula e solo
// il contesto in primo piano riceveva il ricalcolo, gli altri restavano
// congelati al valore d'apertura.
function recalibrateDynamicTPSL(sym, pos) {
    const h = bgPriceHistories[sym];
    if (!h || h.length < 20) return;
    const bb = calculateBollingerBands(h, Math.min(20, h.length));
    if (!bb || !bb.middle) return;
    const volPct = ((bb.upper - bb.lower) / bb.middle) * 100;
    // getAssetType (non "includes USDT"): i simboli broker (PAXGUSD)
    // venivano trattati come azioni → SL minimo 0.25% bucato dallo spread
    const minSL = getAssetType(sym) === 'CRYPTO' ? 1.2 : 0.25;
    const newSL = Math.min(5.0, Math.max(minSL, volPct / 2));
    pos.dynamicSL = newSL;
    pos.dynamicTP = Math.min(15.0, Math.max(getNetBreakevenPct(sym) + 0.15, newSL * 1.5));
}

function manageOpenPositionRisk(sym, pos, livePrice, unrealizedPct, opts) {
    const { now, userTP, userSL, aiDynamicOn, useRisk, useHedging, manageRisk } = opts;
    if (aiDynamicOn) recalibrateDynamicTPSL(sym, pos);
    // Valori effettivi: dinamici per-posizione in AI, campi globali altrimenti.
    // SL globale a 0 = protezione no-loss esplicita dell'utente: mai sovrascritta.
    const effTP = (aiDynamicOn && pos.dynamicTP) ? pos.dynamicTP : userTP;
    const effSL = (userSL === 0) ? 0 : ((aiDynamicOn && pos.dynamicSL) ? pos.dynamicSL : userSL);

    if (manageRisk) {
        const closePending = closingAssets.has(sym) || (Date.now() - (recentlyClosed[sym] || 0) < 30000);

        // Quota del drawdown che NON è movimento di mercato: il mark è al bid
        // mentre si è comprato all'ask. Le soglie di PERDITA (SL, hedging) la
        // compensano, altrimenti su asset a spread largo scattano senza che il
        // prezzo si sia mosso. Cap a 3% per non allargare troppo su dati anomali.
        const spreadComp = Math.min(getSpreadPctFor(sym), 3.0);
        // Età posizione per la grazia anti-spread: se openTime manca (posizione
        // creata dal sync senza created_at) usa il primo avvistamento locale.
        // Mai Infinity: disattivava la grazia proprio sulle aperture del bot.
        if (!pos.openTime && !pos.firstSeenTime) pos.firstSeenTime = now;
        const posAge = now - (pos.openTime || pos.firstSeenTime);
        const inGrace = posAge < SL_GRACE_MS;

        if (useRisk) {
            // -- Trailing Stop Loss via ATR --
            if (pos.type === 'LONG') {
                if (!pos.peakPrice || livePrice > pos.peakPrice) pos.peakPrice = livePrice;
            } else {
                if (!pos.peakPrice || livePrice < pos.peakPrice) pos.peakPrice = livePrice;
            }

            let currentATR = 0;
            if (bgPriceHistories[sym] && bgPriceHistories[sym].length >= 14) {
                currentATR = calculateATR(bgPriceHistories[sym], 14);
            }

            if (currentATR && currentATR > 0 && pos.peakPrice) {
                // Trailing stop: la distanza deve ignorare il rumore (ATR su 1s è troppo basso).
                // Applichiamo un minimo % legato all'asset.
                // Resta attivo solo in profitto (unrealizedPct > 0.1) → non chiude in perdita.
                const minTrailingPct = getAssetType(sym) === 'CRYPTO' ? 0.005 : 0.002;
                const trailingDistance = Math.max(currentATR * 5.0, livePrice * minTrailingPct);
                const isReversing = pos.type === 'LONG'
                    ? (livePrice <= pos.peakPrice - trailingDistance)
                    : (livePrice >= pos.peakPrice + trailingDistance);

                const netBreakeven = getNetBreakevenPct(sym);
                if (isReversing && unrealizedPct >= netBreakeven && !pos.isActuallyClosing && !closePending) {
                    console.log(`[AI RISK] Trailing SL su ${sym}. Peak: ${pos.peakPrice.toFixed(4)}, Attuale: ${livePrice.toFixed(4)}, ATR: ${currentATR.toFixed(4)}`);
                    closeTrade(sym, livePrice, 'TRAILING_SL');
                    return { effTP, effSL, closed: true };
                }
            }
        }

        // -- Hedging Strategico --
        // Soglia compensata dello spread: -3% di MOVIMENTO reale, non -3% di mark.
        // Senza, un asset con spread >3% (SHIB) veniva liquidato alla nascita.
        if (useHedging && unrealizedPct <= -(3.0 + spreadComp) && !pos.isHedged) {
            pos.isHedged = true;
            // Il testo riflette ciò che accade davvero: in modalità broker
            // (Paper o Reale) su una posizione non-simulata l'hedging esegue
            // una CHIUSURA REALE sul conto, non una simulazione.
            const _hedgeKind = (brokerViewActive() && !pos.simulated) ? 'chiusura REALE sul conto broker' : 'copertura simulata';
            console.warn(`🛡️ [AI HEDGING] Posizione ${sym} in crollo (${unrealizedPct.toFixed(2)}%). Chiusura d'emergenza (${_hedgeKind}) per limitare l'esposizione!`);
            closeTrade(sym, livePrice, 'HEDGE_PROTECTION');
            return { effTP, effSL, closed: true };
        }

        // -- Stop a break-even --
        // Raggiunto +BREAKEVEN_ARM_PCT% si "arma": da quel momento, se il
        // prezzo ritraccia fino all'ingresso, chiudiamo a pari (+0.05% di
        // margine per lo spread) invece di lasciar tornare il trade in perdita.
        // Solo-stringere: non tocca SL/TP e non chiude mai in perdita.
        const beArmPct = getBreakevenArmPct(sym, effTP);
        if (!pos.breakevenArmed && unrealizedPct >= beArmPct) {
            pos.breakevenArmed = true;
            console.log(`[RISK] ${sym} oltre +${beArmPct.toFixed(2)}% (70% del TP ${effTP.toFixed(2)}%): stop spostato a break-even (il trade non può più chiudere in perdita).`);
        }
        const netBreakeven = getNetBreakevenPct(sym);
        if (pos.breakevenArmed && unrealizedPct <= netBreakeven && !pos.isActuallyClosing && !closePending) {
            console.log(`[RISK] ${sym} ritracciato al break-even (${unrealizedPct.toFixed(2)}% vs ${netBreakeven}% stimati): chiudo a pari per proteggere il capitale al netto delle fee.`);
            closeTrade(sym, livePrice, 'BREAKEVEN');
            return { effTP, effSL, closed: true };
        }

        if (tpAllowed(sym, unrealizedPct, effTP, posAge) && !pos.isActuallyClosing && !closePending) {
            closeTrade(sym, livePrice, 'TP');
            return { effTP, effSL, closed: true };
        }
        // SL compensato dello spread: misura il movimento di mercato contro la
        // posizione, non il costo fisso bid/ask che c'è dal primo istante.
        if (effSL > 0 && unrealizedPct <= -(effSL + spreadComp) && !pos.isActuallyClosing && !closePending) {
            // Grazia anti-spread: nei primi SL_GRACE_MS chiudi solo se la
            // perdita è grave (2× SL oltre lo spread) — l'apertura non è un movimento
            if (!inGrace || unrealizedPct <= -(effSL * 2 + spreadComp)) {
                closeTrade(sym, livePrice, 'SL');
                return { effTP, effSL, closed: true };
            }
        }
    }

    return { effTP, effSL, closed: false };
}

function runBackgroundEngines(sym, price, type) {
    const activeCtx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
    for (const ctx of LOCAL_CTXS) {
        if (ctx === activeCtx) continue;
        if (!botActiveByCtx[ctx]) continue;
        if (!ctxSupportsCategory(ctx, type)) continue;
        if (!enabledTradingCategories.includes(type)) continue;
        if (restrictedAssets.has(sym)) continue;
        execInCtx(ctx, () => {
            evaluateStrategy(sym, bgPriceHistories[sym], price);
        });
    }
}

// Gestione rischio (TP/SL/breakeven/trailing) per il contesto CORRENTE:
// versione headless usata dai motori in background (niente DOM del pannello).
function manageBgRiskCurrentCtx() {
    const userTP = parseFloat(document.getElementById('botTargetProfit')?.value) || 1.5;
    const userSL = parseFloat(document.getElementById('botStopLoss')?.value) || 1.0;
    // Toggle globale (stessa UI condivisa da tutti i contesti): se attivo,
    // ricalibra dynamicTP/dynamicSL anche qui invece di lasciarli congelati
    // al valore d'apertura (prima solo il contesto in primo piano li aggiornava).
    const aiDynamicOn = document.getElementById('aiModeToggle')?.checked;
    for (const sym in activePositions) {
        const pos = activePositions[sym];
        if (!pos || pos.isActuallyClosing) continue;
        const livePrice = getLivePriceFor(sym) || pos.entryPrice;
        if (!livePrice || livePrice <= 0) continue;
        if (aiDynamicOn) recalibrateDynamicTPSL(sym, pos);
        const unrealizedPct = pos.type === 'LONG'
            ? (livePrice / pos.entryPrice - 1) * 100
            : (pos.entryPrice / livePrice - 1) * 100;
        const effTP = pos.dynamicTP || userTP;
        const effSL = (userSL === 0) ? 0 : (pos.dynamicSL || userSL);
        // Età posizione per le grazie anti-spread su TP (tpAllowed) e SL.
        // Fallback a firstSeenTime se manca openTime, mai Infinity (che
        // disattiverebbe la grazia proprio sulle aperture del bot).
        if (!pos.openTime && !pos.firstSeenTime) pos.firstSeenTime = Date.now();
        const posAge = Date.now() - (pos.openTime || pos.firstSeenTime);
        // Trailing 1.0×ATR (solo in profitto, come il motore principale)
        if (pos.type === 'LONG') { if (!pos.peakPrice || livePrice > pos.peakPrice) pos.peakPrice = livePrice; }
        else { if (!pos.peakPrice || livePrice < pos.peakPrice) pos.peakPrice = livePrice; }
        const hist = bgPriceHistories[sym];
        if (hist && hist.length >= 14 && pos.peakPrice) {
            const atr = calculateATR(hist, 14);
            if (atr && atr > 0) {
                const rev = pos.type === 'LONG'
                    ? (livePrice <= pos.peakPrice - atr)
                    : (livePrice >= pos.peakPrice + atr);
                if (rev && unrealizedPct > 0.1) { closeTrade(sym, livePrice, 'TRAILING_SL'); continue; }
            }
        }
        // Break-even armato SOTTO il TP effettivo (stessa logica del motore principale)
        if (!pos.breakevenArmed && unrealizedPct >= getBreakevenArmPct(sym, effTP)) pos.breakevenArmed = true;
        if (pos.breakevenArmed && unrealizedPct <= (getNetBreakevenPct(sym) + 0.05)) { closeTrade(sym, livePrice, 'BREAKEVEN'); continue; }
        if (tpAllowed(sym, unrealizedPct, effTP, posAge)) { closeTrade(sym, livePrice, 'TP'); continue; }
        if (effSL > 0 && unrealizedPct <= -effSL) {
            // Grazia anti-spread (stessa logica del motore principale, posAge hoistato sopra)
            if (posAge >= SL_GRACE_MS || unrealizedPct <= -(effSL * 2)) { closeTrade(sym, livePrice, 'SL'); continue; }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// Ciclo di vita del bot
// ═══════════════════════════════════════════════════════════════════
// Applica lo stato bot (ON/OFF) con tutta la UI collegata. Estratta dal
// gestore del pulsante per essere riusata dal cambio scheda (FASE D1).
// opts.silent = true → nessuna notifica (transizioni automatiche di scheda).
function applyBotState(on, opts = {}) {
    const btnStartBot = document.getElementById('btnStartBot');
    isBotActive = !!on;
    const ctx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
    botActiveByCtx[ctx] = isBotActive;

    // UNIFICAZIONE: Bot Active = Auto Mode, Bot Stopped = Manual Mode
    isManualMode = !isBotActive;
    localStorage.setItem('sim_trading_mode', isManualMode ? 'manual' : 'auto');

    const t = translations[currentLang] || translations.IT;
    if (isBotActive) {
        if (btnStartBot) {
            btnStartBot.innerHTML = `<span class="bot-icon">⏸</span> ${t.stop_bot}`;
            btnStartBot.classList.add('running');
        }
        if (!opts.silent) showNotification(t.notif_bot_start, 'success');

        setManualTradeEnabled(false); // bot attivo: BUY/SELL disabilitati
        if (typeof window.resetSkippedCounters === 'function') window.resetSkippedCounters(); // conteggio skip fresco per la sessione

        requestWakeLock();
        startKeepAlive();
    } else {
        if (typeof updateSkippedCounterUI === 'function') updateSkippedCounterUI(); // nasconde il contatore a bot fermo
        if (btnStartBot) {
            btnStartBot.innerHTML = `<span class="bot-icon">▶</span> ${t.start_bot}`;
            btnStartBot.classList.remove('running');
        }
        if (!opts.silent) showNotification(t.notif_bot_pause, 'error');

        // Bot in pausa → i bottoni BUY/SELL manuali tornano ABILITATI
        setManualTradeEnabled(true);

        releaseWakeLock();
        stopKeepAlive();
    }
    updateBotStatusLabel();
    updateDashboard();
    // Tiene allineati puntini e disponibilità tasti manuali
    if (typeof window.updateTabBotDots === 'function') window.updateTabBotDots();
    if (typeof window.updateManualControlsAvailability === 'function') window.updateManualControlsAvailability();
}
