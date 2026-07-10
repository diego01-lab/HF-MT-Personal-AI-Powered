/**
 * Gestore delle connessioni WebSocket ai dati Alpaca (Market Data)
 * Gestisce separatamente i flussi Stocks (IEX) e Crypto (v1beta3)
 */
window.AlpacaPaperManager = (function () {
    let wsStocks = null;
    let wsCrypto = null;

    let keyId = null;
    let secretKey = null;

    // Use proxy in web browser to avoid CORS/403 issues
    const BASE_URL = !!(window.Capacitor) ? 'https://paper-api.alpaca.markets' : '/proxy/alpaca';

    let activeSubs = new Set();
    let callbacks = {};

    let cryptoWsFailed = false;
    let cryptoWsErrCount = 0;

    let stocksAuthenticated = false;
    let cryptoAuthenticated = false;

    function init(config) {
        callbacks = config.callbacks || {};
    }

    function setKeys(newKey, newSecret) {
        keyId = newKey;
        secretKey = newSecret;
    }

    function isStocksConnected() {
        return wsStocks && wsStocks.readyState === WebSocket.OPEN;
    }

    function isCryptoConnected() {
        return wsCrypto && wsCrypto.readyState === WebSocket.OPEN;
    }

    function connectStocks() {
        if (!keyId || !secretKey) return;
        if (wsStocks && wsStocks.readyState <= 1) return; // CONNECTING or OPEN

        console.log("[AlpacaDataManager] Connessione Stocks (IEX)...");
        wsStocks = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');

        wsStocks.onopen = () => {
            console.log("[AlpacaDataManager] Stocks Connesso. Invio Auth.");
            wsStocks.send(JSON.stringify({
                action: 'auth',
                key: keyId,
                secret: secretKey
            }));
        };

        wsStocks.onclose = () => {
            console.log("[AlpacaDataManager] Stocks Disconnesso.");
            wsStocks = null;
            stocksAuthenticated = false;
            // Riconnessione gestita dall'app chiamante se necessario
            if (callbacks.onStocksClose) callbacks.onStocksClose();
        };

        wsStocks.onerror = (err) => {
            console.error("[AlpacaDataManager] Errore Stocks:", err);
            if (callbacks.onStocksError) callbacks.onStocksError(err);
        };

        wsStocks.onmessage = (event) => {
            const data = JSON.parse(event.data);
            data.forEach(msg => {
                if (msg.T === 'success' && msg.msg === 'authenticated') {
                    console.log("[AlpacaDataManager] Stocks Autenticato.");
                    stocksAuthenticated = true;
                    syncSubscriptions();
                } else if (msg.T === 't' || msg.T === 'q') {
                    let sym = msg.S;
                    const price = msg.T === 't' ? msg.p
                        : (msg.bp > 0 && msg.ap > 0 ? (msg.bp + msg.ap) / 2 : (msg.ap || msg.bp));
                    if (!price || price <= 0) return;

                    if (callbacks.onPriceUpdate) callbacks.onPriceUpdate(sym, price, Date.now(), 'STOCK');
                } else if (msg.T === 'error') {
                    console.error("[AlpacaDataManager] Errore da server Stocks:", msg.msg);
                    if (msg.msg.includes('limit exceeded') && callbacks.onLimitExceeded) {
                        callbacks.onLimitExceeded('STOCK');
                    }
                }
            });
        };
    }

    function connectCrypto() {
        if (!keyId || !secretKey) return;
        if (wsCrypto && wsCrypto.readyState <= 1) return;
        if (cryptoWsFailed) {
            if (callbacks.onCryptoFallback) callbacks.onCryptoFallback();
            return;
        }

        console.log("[AlpacaDataManager] Connessione Crypto (v1beta3)...");
        try {
            wsCrypto = new WebSocket('wss://stream.data.alpaca.markets/v1beta3/crypto/us');
        } catch (e) {
            console.warn("[AlpacaDataManager] Errore creazione WebSocket Crypto, fallback.");
            cryptoWsFailed = true;
            if (callbacks.onCryptoFallback) callbacks.onCryptoFallback();
            return;
        }

        wsCrypto.onopen = () => {
            console.log("[AlpacaDataManager] Crypto Connesso. Invio Auth.");
            wsCrypto.send(JSON.stringify({
                action: 'auth',
                key: keyId,
                secret: secretKey
            }));
        };

        wsCrypto.onclose = () => {
            console.log("[AlpacaDataManager] Crypto Disconnesso.");
            wsCrypto = null;
            cryptoAuthenticated = false;
            if (callbacks.onCryptoClose) callbacks.onCryptoClose();
        };

        wsCrypto.onerror = (err) => {
            cryptoErrCount++;
            if (cryptoErrCount >= 2) {
                cryptoWsFailed = true;
                if (callbacks.onCryptoFallback) callbacks.onCryptoFallback();
            }
            if (callbacks.onCryptoError) callbacks.onCryptoError(err);
        };

        wsCrypto.onmessage = (event) => {
            const data = JSON.parse(event.data);
            data.forEach(msg => {
                if (msg.T === 'success' && msg.msg === 'authenticated') {
                    console.log("[AlpacaDataManager] Crypto Autenticato.");
                    cryptoAuthenticated = true;
                    cryptoErrCount = 0;
                    syncSubscriptions();
                } else if (msg.T === 't' || msg.T === 'q') {
                    let sym = msg.S;
                    const price = msg.T === 't' ? msg.p
                        : (msg.bp > 0 && msg.ap > 0 ? (msg.bp + msg.ap) / 2 : (msg.ap || msg.bp));
                    if (!price || price <= 0) return;

                    if (callbacks.onPriceUpdate) callbacks.onPriceUpdate(sym, price, Date.now(), 'CRYPTO');
                }
            });
        };
    }

    function disconnect() {
        if (wsStocks) {
            wsStocks.onclose = null;
            wsStocks.close();
            wsStocks = null;
        }
        if (wsCrypto) {
            wsCrypto.onclose = null;
            wsCrypto.close();
            wsCrypto = null;
        }
        stocksAuthenticated = false;
        cryptoAuthenticated = false;
        activeSubs.clear();
    }

    function syncSubscriptions() {
        const requiredSubs = new Set(callbacks.getRequiredSymbols ? callbacks.getRequiredSymbols() : []);

        let stocksToSub = [];
        let stocksToUnsub = [];
        let cryptoToSub = [];
        let cryptoToUnsub = [];

        // Aggiungi nuovi
        requiredSubs.forEach(s => {
            if (!activeSubs.has(s)) {
                if (callbacks.isCrypto && callbacks.isCrypto(s)) {
                    cryptoToSub.push(s);
                } else {
                    stocksToSub.push(s);
                }
                activeSubs.add(s);
            }
        });

        // Rimuovi vecchi
        activeSubs.forEach(s => {
            if (!requiredSubs.has(s)) {
                if (callbacks.isCrypto && callbacks.isCrypto(s)) {
                    cryptoToUnsub.push(s);
                } else {
                    stocksToUnsub.push(s);
                }
                activeSubs.delete(s);
            }
        });

        // Invia Stocks
        if (stocksAuthenticated && wsStocks && wsStocks.readyState === WebSocket.OPEN) {
            if (stocksToSub.length > 0) wsStocks.send(JSON.stringify({ action: 'subscribe', trades: stocksToSub }));
            if (stocksToUnsub.length > 0) wsStocks.send(JSON.stringify({ action: 'unsubscribe', trades: stocksToUnsub }));
        }

        // Invia Crypto
        if (cryptoAuthenticated && wsCrypto && wsCrypto.readyState === WebSocket.OPEN) {
            const formatCrypto = (arr) => arr.map(sym => {
                let alpacaSym = sym;
                if (alpacaSym.startsWith('BINANCE:')) alpacaSym = alpacaSym.replace('BINANCE:', '');
                if (!alpacaSym.includes('/')) {
                    if (alpacaSym.endsWith('USD')) alpacaSym = alpacaSym.replace('USD', '/USD');
                    else if (alpacaSym.endsWith('USDT')) alpacaSym = alpacaSym.replace('USDT', '/USDT');
                }
                return alpacaSym;
            });

            if (cryptoToSub.length > 0) wsCrypto.send(JSON.stringify({ action: 'subscribe', trades: formatCrypto(cryptoToSub) }));
            if (cryptoToUnsub.length > 0) wsCrypto.send(JSON.stringify({ action: 'unsubscribe', trades: formatCrypto(cryptoToUnsub) }));
        }
    }

    async function getAccount() {
        if (!keyId || !secretKey) return null;
        const res = await fetch(`${BASE_URL}/v2/account`, {
            headers: { 'apca-api-key-id': keyId, 'apca-api-secret-key': secretKey }
        });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    }

    async function getPositions() {
        if (!keyId || !secretKey) return [];
        const res = await fetch(`${BASE_URL}/v2/positions`, {
            headers: { 'apca-api-key-id': keyId, 'apca-api-secret-key': secretKey }
        });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    }

    async function getOpenOrders(symbol = null) {
        if (!keyId || !secretKey) return [];
        let url = `${BASE_URL}/v2/orders?status=open`;
        if (symbol) url += `&symbols=${encodeURIComponent(symbol)}`;
        const res = await fetch(url, {
            headers: { 'apca-api-key-id': keyId, 'apca-api-secret-key': secretKey }
        });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    }

    async function cancelOrder(orderId) {
        if (!keyId || !secretKey) return;
        const res = await fetch(`${BASE_URL}/v2/orders/${orderId}`, {
            method: 'DELETE',
            headers: { 'apca-api-key-id': keyId, 'apca-api-secret-key': secretKey }
        });
        if (!res.ok) throw new Error(await res.text());
    }

    async function createOrder(symbol, qty, side, type = 'market', tif = 'day') {
        if (!keyId || !secretKey) return null;

        let alpacaSym = symbol.replace('.OANDA', '').trim();
        if (alpacaSym.includes(':')) alpacaSym = alpacaSym.split(':')[1];
        if (alpacaSym.includes('USDT')) alpacaSym = alpacaSym.replace('USDT', '/USD');
        if (alpacaSym.includes('_')) {
            alpacaSym = alpacaSym.replace('_', '/');
        } else if (alpacaSym.length === 6 && !alpacaSym.includes('/')) {
            alpacaSym = alpacaSym.substring(0, 3) + '/' + alpacaSym.substring(3);
        }

        try {
            const openOrders = await getOpenOrders(alpacaSym);
            for (const order of openOrders) {
                if (order.status !== 'pending_cancel' && order.status !== 'pending_replace') {
                    await cancelOrder(order.id);
                }
            }
            if (openOrders.length > 0) await new Promise(resolve => setTimeout(resolve, 600));
        } catch (e) { console.warn("[AlpacaPaperManager] Errore cancellazione ordini preventivi:", e); }

        let finalTif = tif;
        if (alpacaSym.includes('/') || alpacaSym.includes('BTC') || alpacaSym.includes('ETH')) finalTif = 'gtc';
        const body = {
            symbol: alpacaSym,
            qty: qty.toString(),
            side: side.toLowerCase(),
            type: type,
            time_in_force: finalTif
        };
        console.log("[ALPACA ORDER DEBUG] Body:", JSON.stringify(body));

        const response = await fetch(`${BASE_URL}/v2/orders`, {
            method: 'POST',
            headers: {
                'apca-api-key-id': keyId,
                'apca-api-secret-key': secretKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[ALPACA] Errore creazione ordine (Status: ${response.status}):`, errText);
            // Salva l'errore per il circuit breaker globale in app.js
            try { window.__lastAlpacaOrderError = errText.toLowerCase(); } catch (_) { }
            throw new Error(`Alpaca Order failed: ${response.status} - ${errText}`);
        }

        return await response.json();
    }


    async function closePosition(symbol) {
        if (!keyId || !secretKey) return;
        const res = await fetch(`${BASE_URL}/v2/positions/${encodeURIComponent(symbol)}`, {
            method: 'DELETE',
            headers: { 'apca-api-key-id': keyId, 'apca-api-secret-key': secretKey }
        });
        if (!res.ok) throw new Error(await res.text());
    }

    let cryptoErrCount = 0;

    return {
        init,
        setKeys,
        connectStocks,
        connectCrypto,
        disconnect,
        syncSubscriptions,
        isStocksConnected,
        isCryptoConnected,
        getAccount,
        getPositions,
        getOpenOrders,
        cancelOrder,
        createOrder,
        closePosition
    };
})();
