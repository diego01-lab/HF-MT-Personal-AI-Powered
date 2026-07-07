/**
 * Gestore della connessione WebSocket a Finnhub
 * Isola la logica di rete dal motore dell'interfaccia utente.
 */
window.FinnhubManager = (function() {
    let ws = null;
    let apiKey = null;
    let activeSubs = new Set();
    let callbacks = {};
    let reconnectionTimer = null;

    function init(config) {
        apiKey = config.apiKey;
        callbacks = config.callbacks || {};
    }
    
    function isConnected() {
        return ws && ws.readyState === WebSocket.OPEN;
    }
    
    function updateApiKey(newKey) {
        apiKey = newKey;
    }

    function connect() {
        if (ws) ws.close(); // Pulisce eventuali socket vecchi
        if (!apiKey) return;
        
        console.log("[FinnhubManager] Avvio Finnhub Stream...");
        ws = new WebSocket(`wss://ws.finnhub.io?token=${apiKey}`);
        
        ws.onopen = () => {
            console.log("[FinnhubManager] Connesso.");
            if (callbacks.onStatusChange) callbacks.onStatusChange('connected');
            activeSubs.clear();
            syncSubscriptions();
        };
        
        ws.onclose = () => {
            console.log("[FinnhubManager] Disconnesso.");
            if (callbacks.onStatusChange) callbacks.onStatusChange('disconnected');
            ws = null;
        };
        
        ws.onerror = (err) => {
            console.error("[FinnhubManager] Errore WebSocket", err);
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'trade') {
                const now = Date.now();
                data.data.forEach(trade => {
                    let sym = trade.s;
                    if (sym.startsWith('BINANCE:')) sym = sym.replace('BINANCE:', '');
                    if (callbacks.onPriceUpdate) callbacks.onPriceUpdate(sym, trade.p, now);
                });
            }
        };
    }
    
    function disconnect() {
        if (ws) {
            ws.onclose = null; // Impedisce eventuali trigger spuri
            ws.close();
            ws = null;
        }
        activeSubs.clear();
        if (callbacks.onStatusChange) callbacks.onStatusChange('disconnected');
    }

    function syncSubscriptions() {
        if (!isConnected()) return;
        
        const requiredArray = callbacks.getRequiredSymbols ? callbacks.getRequiredSymbols() : [];
        const requiredSubs = new Set(requiredArray);
        
        // Aggiunge le nuove
        requiredSubs.forEach(s => {
            if (!activeSubs.has(s)) {
                let fhSym = s;
                if (callbacks.isCrypto && callbacks.isCrypto(s) && !s.includes(':')) fhSym = 'BINANCE:' + s;
                console.log(`[FH WS] Subscribe: ${fhSym}`);
                ws.send(JSON.stringify({ 'type': 'subscribe', 'symbol': fhSym }));
                activeSubs.add(s);
            }
        });
        
        // Rimuove le vecchie
        activeSubs.forEach(s => {
            if (!requiredSubs.has(s)) {
                let fhSym = s;
                if (callbacks.isCrypto && callbacks.isCrypto(s) && !s.includes(':')) fhSym = 'BINANCE:' + s;
                console.log(`[FH WS] Unsubscribe: ${fhSym}`);
                ws.send(JSON.stringify({ 'type': 'unsubscribe', 'symbol': fhSym }));
                activeSubs.delete(s);
            }
        });
    }

    return { 
        init, 
        connect, 
        disconnect, 
        syncSubscriptions, 
        isConnected,
        updateApiKey
    };
})();
