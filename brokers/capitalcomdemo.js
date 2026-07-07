/**
 * Gestore Capital.com (Demo)
 */
window.CapitalDemoManager = (function() {
    const BASE_URL = 'https://demo-api-capital.backend-capital.com';
    let apiKey = null;
    let identifier = null;
    let password = null;
    
    let session = { cst: null, sec: null, t: 0 };
    let lastLoginAt = 0;
    
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
        const since = Date.now() - lastLoginAt;
        if (since < 1100) await new Promise(r => setTimeout(r, 1100 - since));
        lastLoginAt = Date.now();
        
        try {
            const res = await httpReq('/api/v1/session', {
                method: 'POST',
                headers: { 'X-CAP-API-KEY': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password })
            });
            if (res.ok) {
                const cst = res.headers['cst'];
                const sec = res.headers['x-security-token'];
                if (cst && sec) {
                    session = { cst, sec, t: Date.now() };
                    console.log("[CapitalDemoManager] Sessione creata.");
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
            console.warn("[CapitalDemoManager] Errore fetchPrices:", e);
        }
        return {};
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
        startPolling,
        stopPolling
    };
})();
