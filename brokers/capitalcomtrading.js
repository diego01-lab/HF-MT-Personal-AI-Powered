/**
 * Gestore Capital.com (Trading/Live)
 */
window.CapitalTradingManager = (function() {
    const BASE_URL = 'https://api-capital.backend-capital.com';
    let apiKey = null;
    let identifier = null;
    let password = null;
    
    let session = { cst: null, sec: null, t: 0 };
    let lastLoginAt = 0;
    // Login concorrenti condivise: all'apertura della scheda Capital 4-5 punti
    // dell'app (preload, storico, sync conto, polling) chiamano login() quasi
    // insieme; senza dedup ognuno spara un POST /session → raffica → 429.
    // _loginPromise fa condividere UNA sola richiesta a tutti i chiamanti.
    let _loginPromise = null;
    // Backoff dopo un 429 su /session (Capital limita duramente la creazione di
    // sessioni): durante la finestra login() non ritenta il POST.
    let _rateLimitedUntil = 0;
    const CAPITAL_SESSION_BACKOFF_MS = 30000;

    let callbacks = {};
    let pollingInterval = null;

    function init(config) {
        callbacks = config.callbacks || {};
    }

    function setCredentials(key, ident, pass) {
        apiKey = key;
        identifier = ident;
        password = pass;
    }

    async function httpReq(path, { method = 'GET', headers = {}, body = null } = {}) {
        const url = BASE_URL + path;
        const CH = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
        if (CH) {
            const res = await CH.request({ url, method, headers, data: body ? JSON.parse(body) : undefined });
            const lower = {};
            Object.entries(res.headers || {}).forEach(([k, v]) => { lower[k.toLowerCase()] = v; });
            return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.data, headers: lower };
        }
        const res = await fetch(url, { method, headers, body });
        return {
            ok: res.ok, status: res.status, json: () => res.json(),
            headers: { get cst() { return res.headers.get('CST'); }, get 'x-security-token'() { return res.headers.get('X-SECURITY-TOKEN'); } }
        };
    }

    async function login() {
        if (!apiKey || !identifier || !password) return false;
        // Una sola login in volo: i chiamanti concorrenti condividono la stessa
        // promise invece di sparare N POST /session (causa dei 429).
        if (_loginPromise) return _loginPromise;
        _loginPromise = _doLogin();
        try { return await _loginPromise; } finally { _loginPromise = null; }
    }

    async function _doLogin() {
        // Backoff attivo dopo un 429: aspetta la fine della finestra prima di
        // riprovare, così al massimo un POST /session ogni CAPITAL_SESSION_BACKOFF_MS.
        const nowB = Date.now();
        if (nowB < _rateLimitedUntil) await new Promise(r => setTimeout(r, _rateLimitedUntil - nowB));
        const since = Date.now() - lastLoginAt;
        if (since < 1100) await new Promise(r => setTimeout(r, 1100 - since));
        lastLoginAt = Date.now();

        try {
            const res = await httpReq('/api/v1/session', {
                method: 'POST',
                headers: { 'X-CAP-API-KEY': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password })
            });
            if (res.status === 429) {
                _rateLimitedUntil = Date.now() + CAPITAL_SESSION_BACKOFF_MS;
                console.warn(`[CapitalTradingManager] 429 su /session: troppe sessioni, backoff ${CAPITAL_SESSION_BACKOFF_MS / 1000}s.`);
                return false;
            }
            if (res.ok) {
                const cst = res.headers['cst'];
                const sec = res.headers['x-security-token'];
                if (cst && sec) {
                    session = { cst, sec, t: Date.now() };
                    console.log("[CapitalTradingManager] Sessione creata.");
                    return true;
                }
                return false;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    async function authedReq(path, opts = {}) {
        if (!session.cst || (Date.now() - session.t > 9 * 60 * 1000)) {
            const ok = await login();
            if (!ok) throw new Error("Auth failed");
        }
        opts.headers = opts.headers || {};
        opts.headers['X-CAP-API-KEY'] = apiKey;
        opts.headers['CST'] = session.cst;
        opts.headers['X-SECURITY-TOKEN'] = session.sec;
        if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
        
        const res = await httpReq(path, opts);
        if (res.status === 401) {
            const ok = await login();
            if (!ok) throw new Error("Re-Auth failed");
            opts.headers['CST'] = session.cst;
            opts.headers['X-SECURITY-TOKEN'] = session.sec;
            return await httpReq(path, opts);
        }
        return res;
    }

    async function fetchPrices(epics) {
        if (!epics || epics.length === 0) return {};
        try {
            const res = await authedReq(`/api/v1/markets?epics=${epics.join(',')}`);
            if (res.ok) {
                const data = await res.json();
                let results = {};
                if (data.marketDetails) {
                    data.marketDetails.forEach(m => {
                        results[m.instrument.epic] = {
                            bid: m.snapshot.bid,
                            ask: m.snapshot.offer,
                            updateTime: m.snapshot.updateTime
                        };
                    });
                }
                return results;
            }
        } catch (e) {
            console.warn("[CapitalTradingManager] Errore fetchPrices:", e);
        }
        return {};
    }

    // Riepilogo conto: array degli account (con balance/available/profitLoss).
    async function getAccount() {
        try {
            const res = await authedReq('/api/v1/accounts');
            if (res.ok) {
                const data = await res.json();
                return (data && data.accounts) || [];
            }
        } catch (e) { console.warn("[CapitalTradingManager] Errore getAccount:", e); }
        return [];
    }

    // Posizioni aperte reali sul conto: array di { position, market } (vedi API).
    async function getPositions() {
        try {
            const res = await authedReq('/api/v1/positions');
            if (res.ok) {
                const data = await res.json();
                return (data && data.positions) || [];
            }
        } catch (e) { console.warn("[CapitalTradingManager] Errore getPositions:", e); }
        return [];
    }

    // Storico transazioni (TRADE con P&L). lastPeriodS = finestra in secondi.
    async function getTransactions(lastPeriodS = 86400) {
        try {
            const res = await authedReq(`/api/v1/history/transactions?lastPeriod=${lastPeriodS}`);
            if (res.ok) {
                const data = await res.json();
                return (data && data.transactions) || [];
            }
        } catch (e) { console.warn("[CapitalTradingManager] Errore getTransactions:", e); }
        return [];
    }

    function startPolling() {
        if (pollingInterval) clearInterval(pollingInterval);
        pollingInterval = setInterval(async () => {
            if (!callbacks.getRequiredEpics) return;
            const epics = callbacks.getRequiredEpics();
            if (epics.length > 0) {
                const prices = await fetchPrices(epics);
                if (callbacks.onPrices) callbacks.onPrices(prices);
            }
        }, 1000);
    }

    function stopPolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }

    return {
        init,
        setCredentials,
        login,
        authedReq,
        fetchPrices,
        getAccount,
        getPositions,
        getTransactions,
        startPolling,
        stopPolling
    };
})();
