// --- Global Alpaca Request Queue (serialized with spacing & exponential backoff) ---
(function () {
    const _origFetch = window.fetch;
    const ALPACA_MIN_GAP_MS = 250;      // min ms between consecutive Alpaca API calls
    const ALPACA_MAX_BACKOFF_MS = 15000; // max backoff on repeated 429s
    let _queue = [];
    let _processing = false;
    let _lastCallTime = 0;
    let _backoffMs = 0;                  // current exponential backoff (0 = none)
    let _consecutive429 = 0;

    function _isAlpacaREST(url) {
        return url.includes('/proxy/alpaca') || (url.includes('api.alpaca.markets') && !url.includes('stream.data'));
    }

    async function _processQueue() {
        if (_processing || _queue.length === 0) return;
        _processing = true;
        while (_queue.length > 0) {
            const { args, resolve, reject } = _queue.shift();
            // Enforce minimum gap + any active backoff
            const waitUntil = _lastCallTime + ALPACA_MIN_GAP_MS + _backoffMs;
            const delay = waitUntil - Date.now();
            if (delay > 0) await new Promise(r => setTimeout(r, delay));

            try {
                const res = await _origFetch.apply(window, args);
                _lastCallTime = Date.now();
                if (res.status === 429) {
                    _consecutive429++;
                    _backoffMs = Math.min(ALPACA_MAX_BACKOFF_MS, 1000 * Math.pow(2, _consecutive429 - 1));
                    console.warn(`[ALPACA QUEUE] 429 hit (#${_consecutive429}). Backoff: ${_backoffMs}ms. Queue depth: ${_queue.length}`);
                } else {
                    if (_consecutive429 > 0) console.log(`[ALPACA QUEUE] Recovered from 429 backoff.`);
                    _consecutive429 = 0;
                    _backoffMs = 0;
                }
                resolve(res);
            } catch (e) {
                _lastCallTime = Date.now();
                reject(e);
            }
        }
        _processing = false;
    }

    window.fetch = function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (!_isAlpacaREST(url)) return _origFetch.apply(this, args);
        // Enqueue Alpaca REST calls
        return new Promise((resolve, reject) => {
            _queue.push({ args, resolve, reject });
            _processQueue();
        });
    };

    // Expose for debugging
    window.__alpacaQueue = { get depth() { return _queue.length; }, get backoff() { return _backoffMs; } };
})();

// --- Global User Interaction Tracker (to fix AudioContext autoplay warnings) ---
window.userHasInteracted = false;
const markInteraction = () => { window.userHasInteracted = true; };
['click', 'touchstart', 'keydown'].forEach(evt => document.addEventListener(evt, markInteraction, { once: true }));

// Inizializzazione Audio Context al primo clic per superare il blocco browser
document.addEventListener('click', () => {
    if (typeof AudioContext !== 'undefined') {
        try {
            const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (tempCtx.state === 'suspended') tempCtx.resume().catch(() => { });
        } catch (e) { }
    }
}, { once: true });

// ─────────────────────────────────────────────────────────────────────
// TOOLTIP FLOTTANTI — motore JS con portale su <body>
// I tooltip CSS (::after su [data-tooltip]) vengono ritagliati da ogni
// antenato con overflow:hidden/auto (pannelli scrollabili) o dallo stesso
// elemento (box con overflow:hidden per contenere effetti decorativi), così
// alcuni non arrivavano mai in primo piano. Qui rendiamo il tooltip in un
// unico elemento #jsTooltip in position:fixed appeso al <body>: fuori da
// qualsiasi contenitore, appare SEMPRE davanti a tutto. La classe .js-tt su
// <html> disattiva i tooltip CSS (vedi styles.css) per non duplicarli.
// ─────────────────────────────────────────────────────────────────────
(function initFloatingTooltips() {
    // Segnala al CSS che il motore JS è attivo (progressive enhancement:
    // senza JS restano i tooltip CSS classici).
    document.documentElement.classList.add('js-tt');

    let tip = null;      // elemento #jsTooltip (creato pigramente)
    let arrow = null;    // freccia interna
    let current = null;  // elemento [data-tooltip] attualmente mostrato

    const GAP = 10;      // distanza tooltip↔elemento
    const EDGE = 8;      // margine minimo dal bordo viewport

    function ensureTip() {
        if (tip) return;
        tip = document.createElement('div');
        tip.id = 'jsTooltip';
        tip.setAttribute('role', 'tooltip');
        arrow = document.createElement('div');
        arrow.className = 'jstt-arrow';
        tip.appendChild(arrow);
        document.body.appendChild(tip);
    }

    function hide() {
        current = null;
        if (tip) tip.classList.remove('visible');
    }

    function show(el) {
        const text = el.getAttribute('data-tooltip');
        if (!text) { hide(); return; }
        current = el;
        ensureTip();
        // textContent: dato inserito come testo puro, nessun rischio XSS
        // (il primo figlio è la freccia, che va preservata).
        tip.textContent = text;
        tip.appendChild(arrow);
        position(el);
    }

    function position(el) {
        const r = el.getBoundingClientRect();
        // Rendi misurabile il tooltip senza mostrarlo (evita flicker in alto a sx)
        tip.style.left = '0px';
        tip.style.top = '0px';
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Verticale: per gli elementi nella fascia ALTA dello schermo (header,
        // barre in cima ai pannelli) preferiamo aprire SOTTO — così il tooltip
        // non copre titolo/intestazioni; altrimenti apriamo SOPRA. In entrambi i
        // casi, se dal lato scelto non c'è spazio, si ripiega sull'altro.
        const roomAbove = r.top - GAP - EDGE;
        const roomBelow = vh - r.bottom - GAP - EDGE;
        const preferBelow = r.top < vh * 0.30;
        let placeTop;
        if (preferBelow) {
            placeTop = (roomBelow < th && roomAbove > roomBelow);
        } else {
            placeTop = !(roomAbove < th && roomBelow > roomAbove);
        }
        let top = placeTop ? (r.top - th - GAP) : (r.bottom + GAP);
        // Clamp verticale di sicurezza dentro il viewport
        top = Math.max(EDGE, Math.min(top, vh - th - EDGE));
        // Orizzontale: centrato sull'elemento, poi clampato al viewport
        let centerX = r.left + r.width / 2;
        let left = centerX - tw / 2;
        left = Math.max(EDGE, Math.min(left, vw - tw - EDGE));

        tip.classList.toggle('place-top', placeTop);
        tip.classList.toggle('place-bottom', !placeTop);
        tip.style.left = Math.round(left) + 'px';
        tip.style.top = Math.round(top) + 'px';

        // Freccia: punta al centro dell'elemento, clampata dentro il tooltip
        let arrowX = centerX - left;
        arrowX = Math.max(12, Math.min(arrowX, tw - 12));
        arrow.style.left = Math.round(arrowX - 6) + 'px';

        tip.classList.add('visible');
    }

    // Delegazione: funziona anche per elementi [data-tooltip] creati a runtime
    document.addEventListener('mouseover', (e) => {
        const el = e.target.closest && e.target.closest('[data-tooltip]');
        if (el && el !== current) show(el);
    });
    document.addEventListener('mouseout', (e) => {
        if (!current) return;
        const el = e.target.closest && e.target.closest('[data-tooltip]');
        // esci solo quando il puntatore lascia davvero l'elemento attivo
        if (el === current && !current.contains(e.relatedTarget)) hide();
    });
    // Accessibilità da tastiera
    document.addEventListener('focusin', (e) => {
        const el = e.target.closest && e.target.closest('[data-tooltip]');
        if (el) show(el);
    });
    document.addEventListener('focusout', () => hide());

    // Nascondi quando cambia il layout sotto il tooltip (scroll di pannelli,
    // resize, click) per non lasciare tooltip "appesi" in posizione sbagliata.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('click', hide, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
})();

// Gestione Service Worker con errore silenzioso in dev
// if ('serviceWorker' in navigator) {
//     window.addEventListener('load', () => {
//         navigator.serviceWorker.register('sw.js')
//             .then(reg => console.log('SW: Registrato correttamente'))
//             .catch(err => {
//                 // Silenzioso su localhost se manca SSL
//                 if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
//                     console.warn('SW: Registrazione saltata (richiede HTTPS)');
//                 }
//             });
//     });
// }

// Soppressione errori comuni causati da estensioni Chrome (Password managers, ecc)
window.onunhandledrejection = (event) => {
    if (event.reason && event.reason.message && event.reason.message.includes('A listener indicated an asynchronous response')) {
        event.preventDefault();
    }
};

// --- Error Handler ---
window.onerror = function (message, source, lineno, colno, error) {
    console.error("ERRORE GLOBALE:", message, "a", source, "riga", lineno);
    const el = document.getElementById('currentPrice');
    if (el) el.textContent = 'ERRORE: ' + message;
};

console.log("App: Script app.js caricato correttamente.");

// --- API Base URLs ---
// Capacitor (app nativa): chiamate dirette ad Alpaca (no CORS in WebView)
// Browser (sviluppo): usa il proxy locale server.js
const IS_NATIVE_APP = !!(window.Capacitor);
const ALPACA_BASE = IS_NATIVE_APP ? 'https://paper-api.alpaca.markets' : '/proxy/alpaca';
const ALPACA_DATA_BASE = IS_NATIVE_APP ? 'https://data.alpaca.markets' : '/proxy/alpaca-data';
// Alpaca Trading API REALE (stadio ALrt): SOLO letture — stato conto,
// posizioni, ordini e storico. Nessun ordine viene mai inviato al conto reale.
const ALPACA_LIVE_BASE = IS_NATIVE_APP ? 'https://api.alpaca.markets' : '/proxy/alpaca-live';
console.log(`[ENV] Modalità: ${IS_NATIVE_APP ? 'App Nativa (Capacitor)' : 'Browser (Proxy)'}`);

// Login bypass rimosso per sicurezza — usare Google OAuth

// --- Google Auth Logic (Global & Immediate) ---
window.parseJwt = function (token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
};

// Versione app: SORGENTE UNICA per Web/Android/iOS. Mostrata accanto a data/ora,
// nel modale "Informazioni app" e sotto il login. Il suffisso lettera identifica
// la singola build; il numero va tenuto allineato al versionName Android/iOS.
window.APP_VERSION = 'v.1.0.23';
(function applyAppVersion() {
    const v = window.APP_VERSION;
    ['appVersion', 'appVersionTag', 'loginBuildTag'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
    });
})();

// Consenso legale OBBLIGATORIO prima di qualunque accesso (Google o Ospite).
// Registrato e mantenuto nel DB locale (localStorage 'sim_legal_accepted').
window.hasLegalConsent = function () {
    const check = document.getElementById('loginConsentCheck');
    if (check && check.checked) return true;
    try { return !!localStorage.getItem('sim_legal_accepted'); } catch (e) { return false; }
};
function requireLegalConsent() {
    if (window.hasLegalConsent()) return true;
    try {
        if (typeof showNotification === 'function') {
            showNotification('Per accedere devi accettare Termini di Servizio, EULA e Privacy Policy.', 'warning');
        }
    } catch (e) { /* notifiche non ancora pronte */ }
    const row = document.querySelector('.login-consent-row');
    if (row) { row.classList.add('consent-flash'); setTimeout(() => row.classList.remove('consent-flash'), 1300); }
    return false;
}

window.processGoogleLogin = function (response) {
    if (!requireLegalConsent()) return; // niente accesso senza consenso
    console.log("Google Auth: Elaborazione credenziali...");
    try {
        const user = window.parseJwt(response.credential);
        if (user) {
            console.log("Google Auth: Utente decodificato:", user.name);
            localStorage.setItem('sim_user', JSON.stringify(user));
            updateProfileUI();
            unlockApp();
        } else {
            console.error("Google Auth: token non valido.");
        }
    } catch (err) {
        console.error("Google Auth Error:", err);
    }
};

// All'avvio, controlla se c'è un login in sospeso
const pendingLogin = localStorage.getItem('pending_google_login');
if (pendingLogin) {
    localStorage.removeItem('pending_google_login');
    window.processGoogleLogin({ credential: pendingLogin });
}




window.enterAsGuest = function () {
    if (!requireLegalConsent()) return; // niente accesso senza consenso
    console.log("App: Accesso come ospite (Solo Visualizzazione)...");
    const guestUser = { name: 'Ospite', picture: '' };
    localStorage.setItem('sim_user', JSON.stringify(guestUser));

    // Rimosso demo money: senza broker non si trada

    updateProfileUI();
    unlockApp();
    showNotification("Benvenuto! Collega Alpaca per iniziare a fare trading.", "info");
};



function updateProfileUI() {
    try {
        const userNameEl = document.getElementById('userName');
        const userPictureEl = document.getElementById('userPicture');
        const userProfileEl = document.getElementById('userProfile');

        const savedUser = JSON.parse(localStorage.getItem('sim_user'));
        if (savedUser && userProfileEl) {
            userProfileEl.classList.remove('hidden');
            if (userNameEl) userNameEl.textContent = savedUser.name;
            if (userPictureEl) {
                // Solo URL https (la foto arriva da Google): blocca schemi
                // arbitrari eventualmente iniettati in localStorage
                if (savedUser.picture && /^https:\/\//i.test(savedUser.picture)) {
                    userPictureEl.src = savedUser.picture;
                    userPictureEl.onerror = function () {
                        this.onerror = null;
                        this.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(savedUser.name) + '&background=3b82f6&color=fff';
                    };
                } else {
                    userPictureEl.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(savedUser.name) + '&background=3b82f6&color=fff';
                }
            }
        }
    } catch (e) {
        console.warn("App: Profilo non ancora disponibile o errore parsing:", e);
    }
}

function unlockApp() {
    console.log("App: Tentativo di sblocco...");

    const overlay = document.getElementById('loginOverlay');
    const main = document.getElementById('appMain');

    if (!overlay || !main) {
        // Se il DOM non è pronto, riprova tra 100ms
        console.log("App: DOM non pronto, riprovo sblocco...");
        setTimeout(unlockApp, 100);
        return;
    }

    updateProfileUI();

    overlay.style.display = 'none';
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    overlay.setAttribute('style', 'display: none !important');

    main.classList.remove('blurred');
    main.style.filter = 'none';

    console.log("App: Sblocco completato.");

    // Primo accesso senza chiavi broker: onboarding obbligatorio (serve una fonte dati)
    try { if (typeof window.maybeStartBrokerOnboarding === 'function') window.maybeStartBrokerOnboarding(); } catch (e) { /* non bloccare l'app */ }
}

function handleLogout() {
    localStorage.removeItem('sim_user');
    window.location.reload();
}

// --- Onboarding broker OBBLIGATORIO (primo accesso senza chiavi) ---
// C'è almeno una chiave broker? Senza, il radar e il grafico non ricevono dati.
window.hasAnyBrokerKey = function () {
    try {
        return !!(localStorage.getItem('finnhub_api_key') ||
            localStorage.getItem('alpaca_key_id') ||
            localStorage.getItem('alpaca_live_key_id') ||
            localStorage.getItem('capital_demo_key') ||
            localStorage.getItem('capital_live_key'));
    } catch (e) { return true; } // storage negato: non bloccare l'utente
};

(function initBrokerOnboarding() {
    const ov = document.getElementById('onboardingOverlay');
    if (!ov) return;
    let pollTimer = null;

    // I pulsanti dell'onboarding riusano le schermate chiavi esistenti (un click
    // sul relativo pulsante nell'header), così apertura/salvataggio non si duplicano.
    const wire = (btnId, targetId) => {
        const b = document.getElementById(btnId);
        if (b) b.addEventListener('click', () => { const t = document.getElementById(targetId); if (t) t.click(); });
    };
    wire('onbBtnFinnhub', 'apiSettingsBtn');
    wire('onbBtnAlpacaPaper', 'alpacaSettingsBtn');
    wire('onbBtnAlpacaLive', 'alpacaLiveSettingsBtn');
    wire('onbBtnCapitalDemo', 'capitalSettingsBtn');
    wire('onbBtnCapitalLive', 'capitalLiveSettingsBtn');

    function keys() {
        try {
            return {
                fh: !!localStorage.getItem('finnhub_api_key'),
                ap: !!localStorage.getItem('alpaca_key_id'),
                al: !!localStorage.getItem('alpaca_live_key_id'),
                capd: !!localStorage.getItem('capital_demo_key'),
                capl: !!localStorage.getItem('capital_live_key')
            };
        } catch (e) { return { fh: true, ap: false, al: false, capd: false, capl: false }; }
    }

    function refresh() {
        const k = keys();
        const badge = (id, ok) => {
            const el = document.getElementById(id);
            if (!el) return;
            const t = translations[currentLang] || translations.IT || {};
            el.textContent = ok ? '✓ ' + (t.onb_connected || 'Collegato') : (t.onb_todo || 'Da configurare');
            el.classList.toggle('ok', ok);
        };
        badge('onbStatusFinnhub', k.fh);
        badge('onbStatusAlpacaPaper', k.ap);
        badge('onbStatusAlpacaLive', k.al);
        badge('onbStatusCapitalDemo', k.capd);
        badge('onbStatusCapitalLive', k.capl);
        const any = k.fh || k.ap || k.al || k.capd || k.capl;
        const enter = document.getElementById('onbEnterBtn');
        if (enter) {
            enter.disabled = !any;
            enter.textContent = any ? 'Entra nella dashboard' : 'Configura almeno un broker per continuare';
            enter.style.opacity = any ? '1' : '0.5';
            enter.style.cursor = any ? 'pointer' : 'not-allowed';
        }
        // Appena c'è una chiave, l'onboarding può chiudersi (ma lasciamo scegliere all'utente)
        return any;
    }

    const enterBtn = document.getElementById('onbEnterBtn');
    if (enterBtn) enterBtn.addEventListener('click', () => {
        if (!window.hasAnyBrokerKey()) return; // obbligatorio: almeno una chiave
        window.finishBrokerOnboarding();
    });

    window.finishBrokerOnboarding = function () {
        ov.classList.add('hidden');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

    window.maybeStartBrokerOnboarding = function () {
        if (window.hasAnyBrokerKey()) return; // già configurato: niente onboarding
        ov.classList.remove('hidden');
        refresh();
        if (!pollTimer) pollTimer = setInterval(refresh, 700); // rileva il salvataggio chiave
    };
})();

// --- Localization System ---
// ─── Traduzioni: caricate da file esterni languages.<lingua>.json ───
// Le 5 lingue supportate vivono in languages.it.json, languages.en.json,
// languages.es.json, languages.fr.json, languages.de.json (84 chiavi ciascuna).
const translations = {};
const SUPPORTED_LANGS = ['IT', 'EN', 'ES', 'FR', 'DE'];
async function loadLanguage(lang) {
    lang = SUPPORTED_LANGS.includes(lang) ? lang : 'IT';
    if (translations[lang]) return translations[lang]; // già in cache
    try {
        // ?v=N: cache buster — da incrementare quando cambiano le traduzioni
        const res = await fetch(`languages.${lang.toLowerCase()}.json?v=5`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        translations[lang] = await res.json();
        console.log(`[LANG] Caricato languages.${lang.toLowerCase()}.json (${Object.keys(translations[lang]).length} chiavi)`);
        return translations[lang];
    } catch (e) {
        console.error(`[LANG] Impossibile caricare languages.${lang.toLowerCase()}.json:`, e.message);
        if (lang !== 'IT') return loadLanguage('IT'); // fallback italiano
        return null;
    }
}

let currentLang = localStorage.getItem('sim_lang') || 'IT';

// Helper per stringhe generate da JS: chiave tradotta con fallback
function tr(key, fallback, vars) {
    const t = translations[currentLang] || translations.IT || {};
    let s = t[key] || fallback;
    // Placeholder {nome} sostituiti a runtime: permette di tradurre messaggi
    // dinamici (simbolo, percentuali, importi) senza perdere i dettagli.
    if (vars && typeof s === 'string') {
        for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
    }
    return s;
}

// Escaping HTML per dati esterni (simboli/ordini dal broker) interpolati
// in template innerHTML: difesa in profondità contro XSS.
function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─────────────────────────────────────────────────────────────────
// SISTEMA LEGALE: modale ToS/EULA/Privacy, consenso onboarding,
// disclaimer bloccante al primo avvio. I documenti vivono in legal.js
// (window.LEGAL_DOCS), le etichette UI nei file lingua.
// ─────────────────────────────────────────────────────────────────
let currentLegalDoc = 'tos';

// Apre il modale legale sul documento richiesto ('tos' | 'eula' | 'privacy')
window.openLegalDoc = function (docKey) {
    currentLegalDoc = docKey || 'tos';
    const modal = document.getElementById('legalModal');
    if (!modal) return;
    renderLegalModal();
    modal.classList.remove('hidden');
};

function renderLegalModal() {
    const docs = (window.LEGAL_DOCS || {})[currentLang] || (window.LEGAL_DOCS || {}).IT;
    const contentEl = document.getElementById('legalModalContent');
    const titleEl = document.getElementById('legalModalTitle');
    if (!docs || !contentEl) return;
    const doc = docs[currentLegalDoc] || docs.tos;
    if (titleEl) titleEl.textContent = doc.title;
    contentEl.innerHTML = doc.html; // contenuto statico interno (legal.js), nessun dato esterno
    contentEl.scrollTop = 0;
    // Tab attiva + etichette (i titoli brevi delle tab vengono dai documenti)
    document.querySelectorAll('.legal-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.doc === currentLegalDoc);
    });
}

// Rigenera nella lingua corrente i testi legali composti (consenso con link,
// etichette dei link). Chiamata da updateLanguage() a ogni cambio lingua.
window.renderLegalTexts = function () {
    const t = translations[currentLang] || translations.IT || {};
    const docs = (window.LEGAL_DOCS || {})[currentLang] || (window.LEGAL_DOCS || {}).IT || {};
    const linkFor = (key) => `<a href="#" onclick="event.stopPropagation(); window.openLegalDoc('${key}'); return false;">${escHtml((docs[key] || {}).title || key)}</a>`;

    const consentEl = document.getElementById('legalConsent');
    if (consentEl && t.legal_consent) {
        consentEl.innerHTML = t.legal_consent
            .replace('{tos}', linkFor('tos'))
            .replace('{eula}', linkFor('eula'))
            .replace('{privacy}', linkFor('privacy'));
    }
    // Link nel disclaimer e nelle Note Legali del modale Info
    const linkIds = {
        disclaimerLinkTos: 'tos', infoLinkTos: 'tos',
        disclaimerLinkEula: 'eula', infoLinkEula: 'eula',
        disclaimerLinkPrivacy: 'privacy', infoLinkPrivacy: 'privacy'
    };
    for (const id in linkIds) {
        const el = document.getElementById(id);
        if (el && docs[linkIds[id]]) el.textContent = docs[linkIds[id]].title;
    }
    // Etichette brevi delle tab del modale
    const tabTos = document.getElementById('legalTabTos');
    const tabPrivacy = document.getElementById('legalTabPrivacy');
    if (tabTos && t.legal_tab_tos) tabTos.textContent = t.legal_tab_tos;
    if (tabPrivacy && t.legal_tab_privacy) tabPrivacy.textContent = t.legal_tab_privacy;
    // Se il modale legale è aperto, ri-renderizza il documento nella nuova lingua
    const modal = document.getElementById('legalModal');
    if (modal && !modal.classList.contains('hidden')) renderLegalModal();
};

// Cablaggio (script deferred: il DOM è già disponibile)
(function initLegalSystem() {
    const acceptBtn = document.getElementById('disclaimerAcceptBtn');
    // Checkbox di consenso esplicito: finché non è spuntata (18 anni +
    // Contratto di Servizio + EULA + Privacy) il bottone resta disabilitato.
    const consentCheck = document.getElementById('disclaimerCheck');
    if (acceptBtn && consentCheck) {
        acceptBtn.disabled = !consentCheck.checked;
        consentCheck.addEventListener('change', () => {
            acceptBtn.disabled = !consentCheck.checked;
        });
    }
    if (acceptBtn) {
        acceptBtn.addEventListener('click', () => {
            if (consentCheck && !consentCheck.checked) return; // difesa extra
            try {
                localStorage.setItem('sim_legal_accepted', JSON.stringify({ v: 1, ts: Date.now() }));
            } catch (e) { /* storage negato: si riproporrà al prossimo avvio */ }
            const ov = document.getElementById('disclaimerOverlay');
            if (ov) ov.style.display = 'none';
            // Allinea la checkbox di consenso del login (stesso record nel DB locale)
            if (typeof window.syncLoginConsent === 'function') window.syncLoginConsent();
        });
    }
    const closeBtn = document.getElementById('closeLegalBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => {
        document.getElementById('legalModal').classList.add('hidden');
    });
    const modal = document.getElementById('legalModal');
    if (modal) modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden'); // click sullo sfondo chiude
    });
    document.querySelectorAll('.legal-tab').forEach(btn => {
        btn.addEventListener('click', () => { currentLegalDoc = btn.dataset.doc; renderLegalModal(); });
    });
})();

// Gate del consenso nel banner di login: finché la checkbox non è spuntata i
// pulsanti Google e Ospite restano bloccati. Alla spunta il consenso è scritto
// nel DB locale (localStorage 'sim_legal_accepted') e mantenuto tra gli accessi.
(function initLoginConsentGate() {
    const check = document.getElementById('loginConsentCheck');
    const actions = document.getElementById('loginActions');
    if (!check || !actions) return;

    const recordConsent = () => {
        try {
            localStorage.setItem('sim_legal_accepted', JSON.stringify({
                v: 1, ts: Date.now(), tos: true, eula: true, privacy: true, via: 'login'
            }));
        } catch (e) { /* storage negato */ }
    };
    const applyState = () => {
        actions.classList.toggle('consent-required', !check.checked);
    };

    // Consenso già presente nel DB locale: mantienilo (checkbox spuntata).
    try { if (localStorage.getItem('sim_legal_accepted')) check.checked = true; } catch (e) { /* ignore */ }
    applyState();

    check.addEventListener('change', () => {
        if (check.checked) recordConsent();
        applyState();
    });

    // Permette di ri-sincronizzare la checkbox dopo l'accettazione del disclaimer
    // bloccante di primo avvio (che scrive lo stesso record nel DB locale).
    window.syncLoginConsent = function () {
        try { if (localStorage.getItem('sim_legal_accepted')) check.checked = true; } catch (e) { /* ignore */ }
        applyState();
    };
})();

// Pulsante Google custom: la libreria GSI viene caricata SOLO al click (non
// all'avvio), così la semplice apertura della schermata di login non contatta
// Google e non produce l'errore "origin not allowed" in console quando l'origine
// non è autorizzata. Il login Google funziona quando l'origine è autorizzata.
(function initGoogleLoginButton() {
    const btn = document.getElementById('googleLoginBtn');
    if (!btn) return;

    // App nativa (Capacitor): la WebView blocca il flusso Google web (GIS), quindi
    // usiamo il plugin nativo @capgo/capacitor-social-login. Richiede un client
    // OAuth **Android** (package com.hfmtpersonalaipowered.app + SHA-1) registrato
    // in Google Cloud; il webClientId qui sotto è il client **Web** usato come
    // serverClientId per farci restituire un idToken (JWT) con i claim del profilo.
    if (window.Capacitor) {
        const WEB_CLIENT_ID = '129853397925-fb6jhq9a4cgu1df4clfhigf320chtj76.apps.googleusercontent.com';
        const nWarn = (m) => { if (typeof showNotification === 'function') showNotification(m, 'warning'); };
        const nInfo = (m) => { if (typeof showNotification === 'function') showNotification(m, 'info'); };
        let slInitialized = false;
        // Nel setup senza bundler i plugin nativi Capacitor sono esposti su
        // window.Capacitor.Plugins.<Nome> dal bridge nativo.
        const getSocialLogin = () => (window.Capacitor.Plugins && window.Capacitor.Plugins.SocialLogin) || null;

        async function nativeGoogleLogin() {
            if (!requireLegalConsent()) return; // consenso obbligatorio prima di tutto
            const SL = getSocialLogin();
            if (!SL) { nWarn('Login Google non disponibile su questa build.'); return; }
            // Feedback immediato al tap: così l'utente sa che il pulsante ha reagito
            // anche se l'apertura del flusso Google richiede un istante.
            nInfo('Apertura accesso Google…');
            try {
                if (!slInitialized) {
                    await SL.initialize({ google: { webClientId: WEB_CLIENT_ID } });
                    slInitialized = true;
                }
                // NON passare "scopes" qui: il plugin richiede già di default
                // email + profile + openid (bastano per avere nome/email/foto
                // nell'idToken). Passando scopes custom, il plugin pretende una
                // MainActivity modificata (ModifiedMainActivityForSocialLoginPlugin)
                // e altrimenti rifiuta con "You CANNOT use scopes without modifying
                // the main activity" — che è esattamente l'errore che vedevamo.
                const res = await SL.login({ provider: 'google', options: {} });
                const r = (res && res.result) || {};
                if (r.idToken) {
                    // Stesso percorso del web: l'idToken (JWT) viene decodificato e sblocca l'app
                    window.processGoogleLogin({ credential: r.idToken });
                } else if (r.profile) {
                    // Fallback senza idToken: costruiamo l'utente dal profilo restituito
                    const p = r.profile;
                    if (!requireLegalConsent()) return;
                    localStorage.setItem('sim_user', JSON.stringify({ name: p.name, email: p.email, picture: p.imageUrl }));
                    updateProfileUI();
                    unlockApp();
                } else {
                    nWarn('Accesso Google non riuscito.');
                }
            } catch (e) {
                // Prima questo blocco faceva solo console.warn: qualunque errore del
                // login nativo (es. OAuth non configurato) rendeva il pulsante muto,
                // "sembra non fare nulla". Ora distinguiamo l'annullamento dell'utente
                // (benigno) da un errore reale, che va mostrato.
                const msg = (e && (e.message || e.errorMessage)) ? String(e.message || e.errorMessage) : String(e);
                const cancelled = /cancel|annull|dismiss|12501|user.?closed|closed.?by.?user/i.test(msg);
                if (cancelled) {
                    console.warn('[GoogleAuth nativo] annullato dall\'utente:', msg);
                    nInfo('Accesso Google annullato.');
                    return;
                }
                console.error('[GoogleAuth nativo] errore login:', msg, e);
                // DEVELOPER_ERROR / status 10 = il client OAuth Android (package
                // com.hfmtpersonalaipowered.app + SHA-1 della firma dell'APK) non è
                // registrato/allineato su Google Cloud per il progetto 129853397925.
                let hint = 'Accesso Google non riuscito.';
                if (/DEVELOPER_ERROR|status(?:\s*code)?\s*[:=]?\s*10\b|\(10\)/i.test(msg)) {
                    hint = 'Accesso Google non riuscito: configurazione OAuth. Registra la SHA-1 della firma dell\'APK nel client OAuth Android (com.hfmtpersonalaipowered.app) su Google Cloud.';
                } else if (/network|timeout|host|unreachable/i.test(msg)) {
                    hint = 'Accesso Google non riuscito: problema di rete. Riprova.';
                }
                nWarn(hint + (msg ? ' — ' + msg.slice(0, 140) : ''));
            }
        }

        btn.addEventListener('click', nativeGoogleLogin);
        return; // in app nativa NON usiamo il flusso GIS web sottostante
    }

    const CLIENT_ID = '129853397925-fb6jhq9a4cgu1df4clfhigf320chtj76.apps.googleusercontent.com';
    let gsiLoading = false;

    const warn = (msg) => { if (typeof showNotification === 'function') showNotification(msg, 'warning'); };

    function startGoogleFlow() {
        if (!(window.google && google.accounts && google.accounts.id)) {
            warn('Google Sign-In non disponibile su questa origine. Usa "Enter as Guest".');
            return;
        }
        try {
            google.accounts.id.initialize({
                client_id: CLIENT_ID,
                callback: window.handleCredentialResponse,
                ux_mode: 'popup'
            });
            // Mostra il selettore account/One Tap. Se l'origine non è autorizzata
            // l'errore compare solo ORA (al click), non all'apertura del login.
            google.accounts.id.prompt();
        } catch (e) {
            warn('Accesso Google non riuscito. Usa "Enter as Guest".');
        }
    }

    function ensureGsiThen(cb) {
        if (window.google && google.accounts && google.accounts.id) { cb(); return; }
        if (gsiLoading) return;
        gsiLoading = true;
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = () => { gsiLoading = false; cb(); };
        s.onerror = () => { gsiLoading = false; warn('Impossibile caricare Google Sign-In.'); };
        document.head.appendChild(s);
    }

    btn.addEventListener('click', () => {
        if (!requireLegalConsent()) return; // consenso obbligatorio prima di tutto
        ensureGsiThen(startGoogleFlow);
    });
})();

// Locale per date/orari coerente con la lingua selezionata
function uiLocale() {
    return ({ IT: 'it-IT', EN: 'en-US', ES: 'es-ES', FR: 'fr-FR', DE: 'de-DE' })[currentLang] || 'it-IT';
}

let isBotActive = false;
let isCapitalExhausted = false;
let sessionBudgetUsed = 0;
let skippedCounters = { shortcrypto: 0, nocash: 0, reject: 0, qty: 0, maxpos: 0, spread: 0, exthours: 0 }; // Totale investito nella sessione corrente (in $) — globale per accesso pre-init
let isManualMode = true; // Il bot parte sempre FERMO ad ogni avvio — l'utente deve avviarlo manualmente
let useAlpacaBroker = false; // L'app parte SEMPRE in test mode; il broker si attiva solo dal toggle
let alpacaKeyId = localStorage.getItem('alpaca_key_id') || '';
let alpacaSecretKey = localStorage.getItem('alpaca_secret_key') || '';
// Chiavi Alpaca Trading API REALE (solo monitoraggio conto: LED ALPrt / Test)
let alpacaLiveKeyId = localStorage.getItem('alpaca_live_key_id') || '';
let alpacaLiveSecretKey = localStorage.getItem('alpaca_live_secret_key') || '';
// Stadio 3 dell'interruttore broker: monitoraggio del conto reale attivo
window.liveMonitorActive = false;
// ─── Capital.com (Demo e Reale) ───
// Autenticazione come da documentazione ufficiale (open-api.capital.com):
// header X-CAP-API-KEY + sessione POST /api/v1/session {identifier(email), password
// della API Key} → token CST e X-SECURITY-TOKEN negli header di risposta (validi
// ~10 minuti di inattività; il polling li mantiene vivi, su 401 si rifà il login).
let capDemoKey = localStorage.getItem('capital_demo_key') || '';
let capDemoIdent = localStorage.getItem('capital_demo_ident') || '';
let capDemoPass = localStorage.getItem('capital_demo_pass') || '';
let capLiveKey = localStorage.getItem('capital_live_key') || '';
let capLiveIdent = localStorage.getItem('capital_live_ident') || '';
let capLivePass = localStorage.getItem('capital_live_pass') || '';
// Modalità Capital.com attiva: 'off' | 'demo' | 'live' (stadi 3/4 del selettore broker)
window.capitalMode = 'off';
// ─── Gate connessioni broker ───
// All'AVVIO nessuna connessione parte da sola, anche con le chiavi configurate:
// è l'UTENTE a scegliere quali collegare (leve sotto i LED, o attivando la
// scheda di un broker — anche quella è una scelta esplicita).
// UPDATE: Su richiesta esplicita, Finnhub viene attivato di default all'avvio.
window.__connAllowed = { fh: false, alp: false, capd: false };
let finnhubApiKey = localStorage.getItem('finnhub_api_key') || '';
// Ricorda se Finnhub ha già restituito 403 sulle candles (piano gratuito): evita di riprovare a ogni avvio
window.finnhubForbidden = localStorage.getItem('finnhub_candles_forbidden') === 'true';
let useFinnhubData = false;
let bgFinnhubWs = null;
const wsThrottleMap = {};
let bgAlpacaWs = null;
let bgAlpacaCryptoWs = null;
let alpacaCryptoAuthenticated = false;
let isSoundEnabled = localStorage.getItem('sim_sound_enabled') !== 'false';
let currentCurrency = localStorage.getItem('sim_currency') || 'USD';
let enabledTradingCategories = JSON.parse(localStorage.getItem('bot_enabled_categories')) || ['CRYPTO', 'STOCK', 'FOREX', 'COMMODITY'];
let lastOrderTimes = {};
let recentlyClosed = {}; // sym → timestamp: blocca ri-chiusure/resurrezioni durante la liquidazione broker
let closingAssets = new Set();
// Contesti locali (portafogli simulati): condiviso con tengine.js (runBackgroundEngines)
var LOCAL_CTXS = ['fh', 'capd', 'capl'];
// Entry note al momento della chiusura (sym normalizzato → {price, time, type}):
// permette a syncAlpacaHistory di calcolare il PnL corretto anche quando il fill
// di apertura è più vecchio della finestra di 50 attività scaricata da Alpaca.
let brokerEntryBasis = {};
// Normalizza i simboli per confrontare fill Alpaca (BTC/USD o BTCUSD) e simboli interni (BTCUSDT)
function normFillSym(s) { return (s || '').replace('/', '').replace('USDT', 'USD'); }
// Ora di apertura annotata da openTrade per la posizione che il sync sta per
// creare (/v2/positions non fornisce created_at). Consumata una sola volta;
// valida 10 minuti, oltre è stantia (ordine mai riempito o posizione già nota).
function takePendingOpenTime(sym) {
    const pot = window.__pendingOpenTimes;
    const ns = normFillSym(sym);
    if (!pot || !pot[ns]) return null;
    const t = pot[ns];
    delete pot[ns];
    return (Date.now() - t < 600000) ? t : null;
}
// Nome asset in forma compatta e leggibile per la UI (ADAUSD, EUR_USD, AAPL):
// stessa resa in TUTTI i pannelli (Radar, Posizioni, Ordinate, Cronologia).
function displaySymbol(s) { return (s || '').replace('OANDA:', '').replace('/', '').replace('USDT', 'USD'); }
// Simbolo interno → formato Alpaca crypto ("BTC/USD"). Difensivo: accetta anche
// simboli già con slash o senza suffisso USDT. Un solo simbolo malformato nel
// batch fa rifiutare l'INTERA richiesta quotes con 400 (visto nei log).
function toAlpacaCryptoSym(s) {
    s = s || '';
    if (s.includes('/')) return s;
    if (s.endsWith('USDT')) return s.slice(0, -4) + '/USD';
    if (s.endsWith('USD')) return s.slice(0, -3) + '/USD';
    return s;
}
// Prezzo live per un simbolo posizione. Le posizioni sincronizzate dal broker
// usano i simboli Alpaca (ADAUSD, BTC/USD) mentre i prezzi del feed sono
// indicizzati con i simboli interni (ADAUSDT): senza queste varianti il lookup
// falliva e la UI mostrava il prezzo di ENTRATA al posto del Live.
function getLivePriceFor(sym) {
    const gp = window.globalPrices;
    if (!gp) return 0;
    let p = gp[sym];
    if (p > 0) return p;
    const s = (sym || '').replace('/', '');       // BTC/USD → BTCUSD
    p = gp[s];
    if (p > 0) return p;
    if (s.endsWith('USD')) {
        p = gp[s + 'T'];                           // ADAUSD → ADAUSDT
        if (p > 0) return p;
    }
    return 0;
}
// Spread bid/ask live per simbolo (% sul mid), alimentato dalle quote WS/REST.
// Serve al filtro d'ingresso e alle soglie di rischio: comprare all'ask e
// rivendere al bid costa l'intero spread anche senza alcun movimento di mercato.
window.globalSpreads = window.globalSpreads || {};
function recordSpread(sym, bid, ask) {
    const b = parseFloat(bid), a = parseFloat(ask);
    if (!(b > 0) || !(a > 0) || a < b) return;
    window.globalSpreads[sym] = { pct: ((a - b) / ((a + b) / 2)) * 100, t: Date.now() };
}
function getSpreadPctFor(sym) {
    const gs = window.globalSpreads;
    if (!gs) return 0;
    const s = (sym || '').replace('/', '');
    const q = gs[sym] || gs[s] || (s.endsWith('USD') ? gs[s + 'T'] : null);
    // Quote più vecchie di 5 minuti: inaffidabili, meglio dichiarare "sconosciuto" (0)
    if (!q || Date.now() - q.t > 300000) return 0;
    return q.pct;
}
let activePositions = {};
let tradeCooldowns = {};
// Durata del cooldown per-simbolo scritta da closeTrade insieme a
// tradeCooldowns: più lunga dopo una perdita (vedi POST_TRADE_COOLDOWN_*_MS
// in tengine.js), così il bot non rientra subito nelle stesse condizioni
// che hanno appena generato la perdita.
let tradeCooldownDurations = {};
let autoBuyPending = null;
let lastRenderedPositionsStr = '';
let portfolioBalance = 0;
let tradingCapital = 0;
let globalTotalRealizedPnL = 0;
let globalCommissions = 0;
window.__globalCommissions = 0;
window.__trueRealizedPnL = 0;
let sessionInitialCapital = NaN;
let currentPrice = 0;
let previousPrice = 0;
let availableMargin = 0; // Buying Power / Margine Disponibile
let availableCash = 0;   // Cash non marginabile: limite reale per gli ordini Crypto su Alpaca (letto/scritto anche da tengine.js)
let lastAlpacaEquityLog = 0;
let lastAlpacaStatusLogTime = 0;
let alpacaPollingInterval = null;

// Dashboard Stats Global
let totalPnL = parseFloat(localStorage.getItem('sim_total_pnl')) || 0;
let executedTrades = parseInt(localStorage.getItem('sim_executed_trades')) || 0;
let winTrades = parseInt(localStorage.getItem('sim_win_trades')) || 0;
let grossProfit = parseFloat(localStorage.getItem('sim_gross_profit')) || 0;
// La cronologia viene caricata in DOMContentLoaded: loadTestState() (test) dalle chiavi
// sim_test_*, oppure il ramo broker da sim_trade_history. Qui solo inizializzazione.
let tradeHistory = [];
let grossLoss = parseFloat(localStorage.getItem('sim_gross_loss')) || 0;
// Flag persistente: l'account Alpaca non è abilitato allo short.
// Caricato subito all'avvio così le strategie lo leggono correttamente sin dal primo tick.
window.__alpacaShortNotAllowed = localStorage.getItem('alpacaShortNotAllowed') === 'true';

function updateLanguage() {
    if (!translations || (!translations[currentLang] && !translations.IT)) {
        console.error("App: Traduzioni non caricate per", currentLang);
        return;
    }
    const t = translations[currentLang] || translations.IT;

    // Mapper IDs to Translation Keys
    const elementMaps = {
        'lblApiModalTitle': 'api_modal_title',
        'lblApiModalDesc': 'api_modal_desc',
        'lblApiModalNote': 'api_modal_note',
        'lblApiStep1': 'api_step1',
        'lblApiStep2': 'api_step2',
        'lblApiStep3': 'api_step3',
        'apiKeyInput': 'api_key_placeholder',
        'lblAlpacaModalTitle': 'alpaca_modal_title',
        'lblAlpacaModalDesc': 'alpaca_modal_desc',
        'lblAlpacaModalNote': 'alpaca_modal_note',
        'lblAlpacaModalWarn': 'alpaca_modal_warn',
        'lblAlpacaModalRegister': 'alpaca_modal_register',
        'lblSettingsTitle': 'settings_title',
        'lblAppVolume': 'app_volume',
        'lblSoundOnOff': 'sound_on_off',
        'lblMuteNotifications': 'mute_notifications',
        'lblAppInfoRow': 'app_info_row',
        'triTipFh': 'tri_tip_fh',
        'triTipAlp': 'tri_tip_alp',
        'triTipAlrt': 'tri_tip_alrt',
        'lblAlpacaLiveModalTitle': 'alpaca_live_modal_title',
        'lblAlpacaLiveModalDesc': 'alpaca_live_modal_desc',
        'lblAlpacaLiveModalWarn': 'alpaca_live_modal_warn',
        'lblAlpacaLiveModalCosts': 'alpaca_live_modal_costs',
        'lblAlpacaLiveModalLiability': 'alpaca_live_modal_liability',
        'lblAlpacaLiveModalRegister': 'alpaca_live_modal_register',
        'saveAlpacaLiveBtn': 'btn_save_config',
        // 'testAlpacaLiveBtn' rimosso dalla mappa: come il gemello Paper
        // ('testAlpacaBtn'), il bottone TEST circolare ha testo fisso "TEST" —
        // la traduzione "Test Connessione" non sta nel cerchio e va a capo.
        'btnAlpacaLiveClose': 'btn_cancel',
        'lblRoiDaily': 'roi_daily',
        'lblEquityTotal': 'equity_total',
        'lblInitialCapTitle': 'initial_cap',
        'lblCashBalance': 'cash_balance',
        'lblBuyingPower': 'buying_power',
        'lblMarketValue': 'market_value',
        'lblPnlDaily': 'pnl_daily',
        'lblTradesToday': 'trades_today',
        'lblWinRateTitle': 'win_rate',
        'lblGrossProfitTitle': 'gross_profit',
        'lblGrossLossTitle': 'gross_loss',
        'lblPnlRealized': 'pnl_realized',
        'lblPnlUnrealized': 'pnl_unrealized',
        'forexStatus': 'status_24_5',
        'commodityStatus': 'status_24_5',
        'radarCategory': 'radar_live_global',
        'cancelApiBtn': 'btn_cancel',
        'saveApiBtn': 'btn_save_connect',
        'cancelDepositBtn': 'btn_cancel_back',
        'saveAlpacaBtn': 'btn_save_config',
        // 'testAlpacaBtn' rimosso dalla mappa: il bottone TEST circolare ha testo fisso "TEST"
        // "Annulla" (non "Chiudi"): btn_close resta ai bottoni chiudi-posizione
        'btnAlpacaClose': 'btn_cancel',
        'lblTestModeTitle': 'test_mode_title',
        'lblBrokerConnections': 'broker_connections',
        'syncBadgeBroker': 'sync_broker',
        'syncBadgeTest': 'sync_test',
        'lblNoPendingOrders': 'no_pending_orders',
        'lblPendingOrdersText': 'pending_orders_title',
        'skippedLabel': 'skipped_label',
        'btnSimulatePaypal': 'btn_simulate_payment',
        'lblAppTitle': 'app_title',
        'radarTitle': 'radar_title',
        'radarSubtitle': 'radar_subtitle',
        'lblTargetProfit': 'target_profit',
        'lblStopLoss': 'stop_loss',
        'lblAutoTrading': 'auto_trading',
        'lblAiMode': 'ai_mode',
        'lblMaxPos': 'max_pos',
        'lblBotCategories': 'bot_categories',
        'perfPanelTitle': 'perf_panel',
        'lblExecutedTrades': 'executed_trades',
        'lblWinRate': 'win_rate',
        'lblGrossProfit': 'gross_profit',
        'lblGrossLoss': 'gross_loss',
        'lblTotalPnL': 'total_pnl',
        'lblAlgoLogic': 'algo_logic',
        'lblOpenPosText': 'open_pos',
        'btnBuy': 'buy_long',
        'btnSell': 'sell_short',
        'btnClose': 'close_pos',
        'lblPortfolio': 'portfolio',
        'lblDeposit': 'deposit',
        'lblWithdraw': 'withdraw',
        'lblMarketHours': 'market_hours',
        'lblLivePrices': 'live_prices',
        'lblCatCrypto': 'cat_crypto',
        'lblCatStock': 'cat_stock',
        'lblCatForex': 'cat_forex',
        'lblCatCommodity': 'cat_commodity',
        'lblCapitalManagement': 'cap_mgmt',
        'btnWithdrawAll': 'withdraw_all',
        'lblInitialCap': 'initial_cap',
        'lblTradingCap': 'trading_cap',
        'lblFreeMargin': 'free_margin',
        'lblTradeQty': 'trade_qty',
        'lblPerOp': 'per_op',
        'lblOpMargin': 'op_margin',
        'lblRealTimePrice': 'realtime_price',
        'lblExecutedTrades': 'executed_trades',
        'lblHistoryText': 'history_title',
        'btnClearHistory': 'clear_history',
        'lblTradeSide': 'trade_side',
        'lblTradePrice': 'trade_price',
        'lblTradePnL': 'trade_pnl',
        'lblWaitingSignals': 'waiting_signals',
        'lblNoOpenPositions': 'no_open_positions',
        'lblRadarTitle': 'radar_title',
        'radarDesc': 'radar_desc',
        'lblAlgoLogic': 'algo_logic',
        'lblLogicEMA_desc': 'logic_ema_desc',
        'lblEmaFast': 'ema_fast',
        'lblEmaSlow': 'ema_slow',
        'lblBuyRule': 'buy_rule',
        'lblSellRule': 'sell_rule',
        'lblOppositeSignal': 'opposite_signal',
        'lblLogicAI_desc': 'logic_ai_desc',
        'lblRsiDesc': 'rsi_desc',
        'lblMacdDesc': 'macd_desc',
        'lblBbDesc': 'bb_desc',
        'lblAiConfidence': 'ai_confidence',
        'lblAppDesc': 'app_desc',
        'lblEduOnly': 'edu_only',
        'closeInfoBtn': 'i_understand',
        'btnResetAll': 'reset_all',
        // Tooltips
        'btnAddFunds': 'tip_deposit',
        'btnWithdrawFunds': 'tip_withdraw',
        'lblWsIndicator': 'tip_ws',
        'lblCryptoTooltip': 'tip_crypto',
        'lblForexTooltip': 'tip_forex',
        'lblCommodityTooltip': 'tip_commodity',
        'lblStockTooltip': 'tip_stock',
        // Pannello bot: etichette precedentemente hardcoded in HTML
        'lblStimaBuyingPower': 'stima_buying_power',
        'lblTargetProfitLabel': 'take_profit_label',
        'lblStopLossLabel': 'stop_loss_label',
        'lblSessionBudget': 'session_budget_label',
        // Modale prelievo + stato crypto (prima hardcoded)
        'btnSimulateWithdraw': 'btn_confirm_withdraw',
        'cancelWithdrawBtn': 'btn_cancel',
        'cryptoStatus': 'status_24_7',
        // Descrizioni dei 5 moduli AI (prima hardcoded in italiano)
        'aiDescSentiment': 'ai_desc_sentiment',
        'aiDescLSTM': 'ai_desc_lstm',
        'aiDescRisk': 'ai_desc_risk',
        'aiDescRL': 'ai_desc_rl',
        'aiDescHedging': 'ai_desc_hedging',
        // Sistema legale (disclaimer + note legali)
        'disclaimerTitle': 'disclaimer_title',
        'disclaimerBody': 'disclaimer_body',
        'disclaimerAcceptBtn': 'disclaimer_accept',
        'disclaimerCheckLabel': 'disclaimer_checkbox',
        'lblLegalNotes': 'legal_notes_title',
        // --- Nuovi inserimenti ---
        'lblSubtitleFrancaLogin': 'subtitle_franca',
        'lblSubtitleFrancaApp': 'subtitle_franca',
        'lblSubtitleFrancaModal': 'subtitle_franca',
        'lblLoginPlatform': 'login_platform',
        'lblLoginInst': 'login_instruction',
        'lblLegalConsent': 'login_consent_text',
        'lblGuestBtn': 'login_guest_btn',
        'lblLoginFooter': 'login_footer',
        'lblOnbTitle': 'onb_title',
        'lblOnbDesc': 'onb_desc',
        'lblOnbFinnhubCats': 'onb_fh_cats',
        'lblOnbAlpacaPaperCats': 'onb_ap_cats',
        'lblOnbAlpacaLiveCats': 'onb_al_cats',
        'lblOnbCapitalDemoCats': 'onb_capd_cats',
        'lblOnbCapitalLiveCats': 'onb_capl_cats',
        'lblPaypalSubtitle': 'paypal_subtitle',
        'lblNoKeysAlpacaPaper': 'no_keys',
        'lblNoKeysAlpacaLive': 'no_keys',
        'onbBtnFinnhub': 'btn_configure',
        'onbBtnAlpacaPaper': 'btn_configure',
        'onbBtnAlpacaLive': 'btn_configure',
        'onbEnterBtn': 'onb_enter_btn',
    };

    for (let id in elementMaps) {
        const el = document.getElementById(id);
        if (el) {
            const translationKey = elementMaps[id];
            const translatedText = t[translationKey];
            if (translatedText === undefined || translatedText === null) continue; // traduzione mancante: lascia il testo/tooltip di default (mai 'undefined')

            if (translationKey.startsWith('tip_')) {
                el.setAttribute('data-tooltip', translatedText);
            } else {
                if (el.tagName === 'INPUT') {
                    el.placeholder = translatedText; // gli input traducono il placeholder
                } else if (['BUTTON', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'LABEL', 'P', 'STRONG', 'DIV', 'SMALL', 'B', 'LI'].includes(el.tagName)) {
                    // Special handling for buttons with icons
                    if (id === 'btnStartBot') {
                        el.innerHTML = `<span class="bot-icon">${isBotActive ? '⏸' : '▶'}</span> ${isBotActive ? t.stop_bot : t.start_bot}`;
                    } else if (id === 'lblAiMode') {
                        el.innerHTML = `<span style="font-size: 1.1rem;">🤖</span> ${t.ai_mode}`;
                    } else if (id === 'lblDeposit' || id === 'lblWithdraw') {
                        // Keep the symbol (+ / -)
                        const symbol = id === 'lblDeposit' ? '+ ' : '- ';
                        const key = id === 'lblDeposit' ? 'deposit' : 'withdraw';
                        el.textContent = symbol + t[key];
                    } else if (id.startsWith('lblCat')) {
                        // Keep the icon (first part of innerHTML if exists or hardcoded)
                        const iconMap = { 'lblCatCrypto': '🔸', 'lblCatStock': '📈', 'lblCatForex': '💱', 'lblCatCommodity': '⛽' };
                        el.textContent = (iconMap[id] || '') + ' ' + translatedText;
                    } else {
                        if (id.startsWith('lblLogic') || id === 'lblAppDesc' || id === 'lblEduOnly' || translatedText.includes('<')) {
                            el.innerHTML = translatedText;
                        } else {
                            el.textContent = translatedText;
                        }
                    }
                }
            }
        }
    }

    // Tooltip: mappa separata da elementMaps, così lo stesso ID può avere
    // sia il testo che il tooltip tradotti (es. btnBuy, openPosTitle, ...)
    const tooltipMaps = {
        'btnAppInfo': 'tip_app_info',
        'btnAppSettings': 'tip_app_settings',
        'apiSettingsBtn': 'tip_finnhub_btn',
        'alpacaSettingsBtn': 'tip_alpaca_btn',
        'alpacaLiveSettingsBtn': 'tip_alpaca_live_btn',
        'statusFH': 'tip_status_fh',
        'statusAL': 'tip_status_al',
        'statusALrt': 'tip_status_alprt',
        'btnToggleSound': 'tip_sound',
        'btnLogout': 'tip_logout',
        'radarHeading': 'tip_radar_scan',
        'radarCategory': 'tip_radar_global',
        'sessionROI': 'tip_session_roi',
        'boxEquity': 'tip_equity',
        'boxInitialCap': 'tip_initial_cap',
        'boxCash': 'tip_cash',
        'boxBuyingPower': 'tip_buying_power',
        'boxMarketValue': 'tip_market_value',
        'boxPnlDaily': 'tip_pnl_daily',
        'boxTradeQty': 'tip_trade_qty',
        'boxTakeProfit': 'tip_take_profit',
        'boxStopLoss': 'tip_stop_loss_field',
        'sessionBudgetContainer': 'tip_session_budget',
        'boxPerfPanel': 'tip_perf_panel',
        'boxTradesToday': 'tip_trades_today',
        'boxWinRate': 'tip_win_rate',
        'boxGrossProfit': 'tip_gross_profit',
        'boxGrossLoss': 'tip_gross_loss',
        'boxPnlRealized': 'tip_pnl_realized',
        'boxPnlUnrealized': 'tip_pnl_unrealized',
        'btnStartBot': 'tip_start_bot',
        'lblAiMode': 'tip_ai_mode',
        'aiModeToggleLabel': 'tip_ai_toggle',
        'btnBuy': 'tip_buy',
        'btnSell': 'tip_sell',
        'openPosTitle': 'tip_open_pos',
        'posTabCrypto': 'tip_tab_crypto',
        'posTabStock': 'tip_tab_stock',
        'posTabForex': 'tip_tab_forex',
        'posTabCommodity': 'tip_tab_commodity',
        'lblHistoryTitle': 'tip_history',
        'btnClearHistory': 'tip_clear_history',
        'lblTradeSide': 'tip_trade_side',
        'lblTradePrice': 'tip_trade_price',
        'lblTradePnL': 'tip_trade_pnl',
        'assetIcon': 'tip_asset_icon',
        'assetPair': 'tip_asset_select',
        // Export CSV e ordinamento dei 3 pannelli (Aperte / Ordini / Cronologia)
        'btnExportHistory': 'tip_export_history',
        'btnExportOpenPositions': 'tip_export_open',
        'btnExportPendingOrders': 'tip_export_orders',
        // Tooltip prima hardcoded in italiano nell'HTML
        'capitalSettingsBtn': 'tip_capital_btn',
        'capitalLiveSettingsBtn': 'tip_capital_live_btn',
        'statusCAP': 'tip_status_cap',
        'statusCAPL': 'tip_status_capl',
        'boxDepositedTotal': 'tip_deposited_total',
        'boxCurrentCapital': 'tip_current_capital',
        'boxPnlCommissions': 'tip_pnl_commissions',
        'boxPnlNet': 'tip_pnl_net',
        'boxWinningTrades': 'tip_winning_trades',
        'boxLosingTrades': 'tip_losing_trades',
        'boxBreakevenTrades': 'tip_breakeven_trades',
        'boxCommissions': 'tip_commissions',
        'skippedCounter': 'tip_skipped',
        'manualQty': 'tip_manual_qty',
        'armFHTip': 'tip_bot_arm_fh',
        'armALPTip': 'tip_bot_arm_alp',
        'armALrtTip': 'tip_bot_arm_alrt',
        'armCAPDTip': 'tip_bot_arm_capd',
        'armCAPLTip': 'tip_bot_arm_capl',
    };
    for (const id in tooltipMaps) {
        const el = document.getElementById(id);
        const tipText = t[tooltipMaps[id]];
        if (el && tipText) el.setAttribute('data-tooltip', tipText);
    }

    // Testi legali composti (consenso con link, titoli documenti)
    if (typeof window.renderLegalTexts === 'function') window.renderLegalTexts();

    // Update Start/Stop button specifically
    const btnStart = document.getElementById('btnStartBot');
    if (btnStart) {
        btnStart.innerHTML = `<span class="bot-icon">${isBotActive ? '⏸' : '▶'}</span> ${isBotActive ? t.stop_bot : t.start_bot}`;
    }

    // Update bot status labels
    updateBotStatusLabel();
    // Aggiorna le label dinamiche definite dentro DOMContentLoaded (se già inizializzate)
    if (typeof window.updateTestLabel === 'function') window.updateTestLabel();
    if (typeof window.__i18nRefresh === 'function') window.__i18nRefresh();
}

function formatDuration(ms) {
    if (!ms || ms < 0) return '0s';
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));

    let res = [];
    if (hours > 0) res.push(`${hours}h`);
    if (minutes > 0) res.push(`${minutes}m`);
    if (seconds > 0 || res.length === 0) res.push(`${seconds}s`);
    return res.join(' ');
}

function updateBotStatusLabel() {
    const botStatusEl = document.getElementById('botStatus');
    const algoTitleEl = document.getElementById('algoTitle');
    const logicEMAEl = document.getElementById('logicEMA');
    const logicAIEl = document.getElementById('logicAI');

    if (!botStatusEl || (!translations[currentLang] && !translations.IT)) return;

    const t = translations[currentLang] || translations.IT;
    const isAiMode = localStorage.getItem('sim_ai_mode') !== 'false'; // Default true

    // Aggiornamento testuale del titolo strategia nel pannello info
    if (algoTitleEl) {
        algoTitleEl.textContent = isAiMode ? (t.algo_ai || "AI Avanzata") : (t.algo_ema || "EMA Standard");
        algoTitleEl.style.color = isAiMode ? "#8b5cf6" : "#3b82f6";
    }

    // Toggle visibilità blocchi tecnici
    if (logicEMAEl) logicEMAEl.style.display = isAiMode ? 'none' : 'block';
    if (logicAIEl) logicAIEl.style.display = isAiMode ? 'block' : 'none';

    if (isManualMode) {
        botStatusEl.textContent = t.manual_mode;
        botStatusEl.className = 'stat-value';
        botStatusEl.style.color = '#94a3b8';
    } else if (isBotActive && isCapitalExhausted) {
        botStatusEl.textContent = "IN ATTESA (Capitale 0)";
        botStatusEl.className = 'stat-value';
        botStatusEl.style.color = '#f59e0b';
    } else if (isBotActive) {
        botStatusEl.textContent = isAiMode ? t.auto_ai : t.auto_ema;
        botStatusEl.className = 'stat-value status-active';
        botStatusEl.style.color = '#10b981';
    } else {
        botStatusEl.textContent = "BOT DISATTIVATO";
        botStatusEl.className = 'stat-value';
        botStatusEl.style.color = '#ef4444';
    }
}

// --- Disponibilità Categorie Asset ---
// Una categoria è "disponibile e attiva" quando è supportata dal broker selezionato
// E il suo mercato è aperto. Usata per disattivare le checkbox e filtrare la combo grafico.
function isMarketOpenForCategory(type) {
    if (type === 'CRYPTO') return true; // 24/7
    const est = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = est.getDay(), h = est.getHours(), m = est.getMinutes();
    if (type === 'FOREX' || type === 'COMMODITY') {
        if (day === 5 && h >= 17) return false;   // Ven sera
        if (day === 6) return false;              // Sab
        if (day === 0 && h < 17) return false;    // Dom fino a riapertura
        if (day >= 1 && day <= 4 && h === 17) return false; // Pausa giornaliera (17:00-18:00 EST)
        return true;
    }
    if (type === 'STOCK') {
        if (day === 0 || day === 6) return false; // weekend
        const t = h * 60 + m;
        return t >= 4 * 60 && t < 20 * 60;   // Extended Hours: 04:00-20:00 EST
    }
    return true;
}
function isCategorySupportedByBroker(type) {
    // Capital.com (Demo/Reale): solo Forex e Materie Prime (CFD). Alpaca (Paper/
    // Live): solo Crypto e Azioni. Finnhub (FH): tutte, ma serve la chiave.
    if (window.capitalMode && window.capitalMode !== 'off') {
        return type === 'FOREX' || type === 'COMMODITY';
    }
    if (typeof useAlpacaBroker !== 'undefined' && useAlpacaBroker) {
        return type === 'CRYPTO' || type === 'STOCK';
    }
    return !!finnhubApiKey;
}
function categoryAvailability(type) {
    const supported = isCategorySupportedByBroker(type);
    const open = isMarketOpenForCategory(type);
    return { supported, open, available: supported && open };
}
window.categoryAvailability = categoryAvailability;

// Etichette della legenda del grafico: visibili SOLO per le categorie supportate
// dal broker della scheda visualizzata (indipendente dagli orari: l'etichetta
// resta anche a mercato chiuso, sparisce solo se il broker non copre la categoria).
function updateChartLegendVisibility() {
    const map = { legCRYPTO: 'CRYPTO', legSTOCK: 'STOCK', legFOREX: 'FOREX', legCOMMODITY: 'COMMODITY' };
    for (const id in map) {
        const el = document.getElementById(id);
        if (el) el.style.display = isCategorySupportedByBroker(map[id]) ? 'flex' : 'none';
    }
}

// Riallinea insieme checkbox categorie + combo grafico + legenda + serie del
// grafico alla disponibilità corrente (broker della scheda + orari di mercato).
// La combo è filtrata da window.applyComboAvailabilityFilter, definita DENTRO il
// closure DOMContentLoaded (usa assetPairSelect/VALID_SYMBOLS, non visibili qui).
window.refreshCategoryAvailability = function () {
    try { if (typeof renderCategorySelection === 'function') renderCategorySelection(); } catch (e) { }
    try { if (typeof window.applyComboAvailabilityFilter === 'function') window.applyComboAvailabilityFilter(); } catch (e) { }
    try { updateChartLegendVisibility(); } catch (e) { }
    try { if (typeof window.refreshChartSeriesVisibility === 'function') window.refreshChartSeriesVisibility(); } catch (e) { }
    // Pannello "Prezzi Live": solo le categorie supportate dal broker della scheda
    try {
        const ovMap = { 'ov-CRYPTO': 'CRYPTO', 'ov-STOCK': 'STOCK', 'ov-FOREX': 'FOREX', 'ov-COMMODITY': 'COMMODITY' };
        for (const id in ovMap) {
            const el = document.getElementById(id);
            if (el) el.style.display = isCategorySupportedByBroker(ovMap[id]) ? 'grid' : 'none';
        }
    } catch (e) { }
};

// Le transizioni degli orari di mercato (apertura/chiusura) devono aggiornare da sole
// le categorie disattivate e la combo (e di conseguenza il bot riprende a operare
// sugli asset tornati disponibili, perché la sua logica ricontrolla isMarketOpen a
// ogni tick). Ricontrolliamo periodicamente e riallineiamo SOLO quando la
// disponibilità cambia davvero.
(function watchCategoryAvailability() {
    let lastSig = '';
    const sigNow = () => ['CRYPTO', 'STOCK', 'FOREX', 'COMMODITY']
        .map(c => c + (window.categoryAvailability(c).available ? '1' : '0')).join(',');
    const check = () => {
        const sig = sigNow();
        if (sig !== lastSig) { lastSig = sig; window.refreshCategoryAvailability(); }
    };
    // Ogni 15s: reattivo alle transizioni di orario senza carico inutile.
    setInterval(check, 15000);
    // Su mobile i timer si fermano in background: al ritorno in foreground
    // ricontrolliamo subito (i mercati potrebbero essersi appena riaperti).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.addEventListener('focus', check);
})();

function renderCategorySelection() {
    const container = document.getElementById('categorySelectionContainer');
    if (!container) return;
    container.innerHTML = '';

    const t = translations[currentLang] || translations.IT;
    const categories = [
        { id: 'CRYPTO', label: t.cat_crypto, icon: '🔸' },
        { id: 'STOCK', label: t.cat_stock, icon: '📈' },
        { id: 'FOREX', label: t.cat_forex, icon: '💱' },
        { id: 'COMMODITY', label: t.cat_commodity, icon: '⛽' }
    ];

    categories.forEach(cat => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';
        label.style.fontSize = '0.75rem';
        label.style.color = 'var(--text-secondary)';
        label.style.cursor = 'pointer';
        label.style.padding = '1px 0';

        const isChecked = enabledTradingCategories.includes(cat.id);

        // Disponibilità = supportata dal broker attivo E mercato aperto.
        const av = window.categoryAvailability(cat.id);
        const active = av.available;
        // Motivo disattivazione: incompatibilità broker ha priorità sull'orario chiuso.
        const reason = !av.supported ? (t.cat_na || 'non disp.') : (!av.open ? (t.cat_closed || 'chiuso') : '');

        label.style.opacity = active ? '1' : '0.35';
        label.style.pointerEvents = active ? 'auto' : 'none';

        label.innerHTML = `
                    <input type="checkbox" value="${cat.id}" ${isChecked ? 'checked' : ''} ${!active ? 'disabled' : ''} style="accent-color: #3b82f6; width: 14px; height: 14px; flex-shrink: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; white-space: nowrap; overflow: hidden;">
                        <span style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis;">${cat.icon} ${cat.label}</span>
                        ${reason ? `<span style="color:#f59e0b; font-size:0.65rem; margin-left: 4px; flex-shrink: 0;">(${reason})</span>` : ''}
                    </div>
                `;

        const checkbox = label.querySelector('input');
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                if (!enabledTradingCategories.includes(cat.id)) {
                    enabledTradingCategories.push(cat.id);
                }
            } else {
                enabledTradingCategories = enabledTradingCategories.filter(id => id !== cat.id);
            }
            localStorage.setItem('bot_enabled_categories', JSON.stringify(enabledTradingCategories));
        });

        container.appendChild(label);
    });

}

function renderAssetSelector() {
    if (!assetPairSelect) return;
    const currentValue = assetPairSelect.value;
    assetPairSelect.innerHTML = '';

    for (const cat in VALID_SYMBOLS) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = cat;
        VALID_SYMBOLS[cat].forEach(sym => {
            const option = document.createElement('option');
            option.value = sym;
            option.textContent = sym.replace('USDT', '').replace('OANDA:', '').replace('_', '/');
            optGroup.appendChild(option);
        });
        assetPairSelect.appendChild(optGroup);
    }

    // Aggiunta simboli extra (rilevati da posizioni broker)
    if (extraSymbols.size > 0) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = "PORTAFOGLIO ALPACA";
        extraSymbols.forEach(sym => {
            const option = document.createElement('option');
            option.value = sym;
            option.textContent = sym.replace('USDT', '').replace('OANDA:', '').replace('_', '/');
            optGroup.appendChild(option);
        });
        assetPairSelect.appendChild(optGroup);
    }

    if (currentValue) assetPairSelect.value = currentValue;
}

const langSelector = document.getElementById('langSelector');
if (langSelector) {
    langSelector.value = currentLang;
    langSelector.onchange = async (e) => {
        currentLang = e.target.value;
        localStorage.setItem('sim_lang', currentLang);
        await loadLanguage(currentLang); // scarica il file lingua se non in cache
        updateLanguage();
        renderCategorySelection();
        // Le righe di posizioni aperte e cronologia sono generate da JS:
        // vanno rigenerate con le nuove traduzioni (esposte su window perché
        // definite dentro DOMContentLoaded, qui siamo fuori da quello scope)
        if (typeof window.renderHistory === 'function') window.renderHistory();
        if (typeof window.renderOpenPositions === 'function') window.renderOpenPositions();
    };
}

document.addEventListener('DOMContentLoaded', async () => {

    var ctxLive = {};
    let currentCandle = null;
    let lastCandleTime = 0;
    const sessionStartPrices = {};
    console.log("App: DOM pronto.");
    await loadLanguage(currentLang); // carica le traduzioni PRIMA di applicarle
    updateLanguage();
    renderCategorySelection();
    try {
        // --- UI Element References (Declared early to prevent TDZ errors) ---
        let statusAL, statusFH, sidebarAlpacaToggle, sidebarFinnhubToggle, useAlpacaSwitch;

        // ─── Bridge per tengine.js (motore di trading) ───
        // Il motore vive in tengine.js a scope globale, mentre queste funzioni
        // sono locali alla closure DOMContentLoaded: le esponiamo su window così
        // le chiamate del motore (persistData(), updateWalletUI(), ...) risolvono
        // a runtime. Le function declaration di questo blocco sono inizializzate
        // all'ingresso del blocco, quindi qui esistono già tutte.
        Object.assign(window, {
            brokerViewActive, getBrokerHttp, getAlpacaManager, getAssetType,
            persistData, updateWalletUI, updateDashboard, renderOpenPositions, renderHistory,
            updateSessionBudgetUI, getSessionBudgetLimit, getInvestUsd, formatMoney,
            playOpenSound, playCashSound, playLossSound,
            syncAlpacaPositions, syncAlpacaOrders,
            syncFinnhubSubscriptions, syncAlpacaDataSubscriptions,
            setManualTradeEnabled, requestWakeLock, releaseWakeLock, startKeepAlive, stopKeepAlive,
            execInCtx, ctxSupportsCategory, showAISignal
        });



        // Sblocco immediato se già loggato
        if (localStorage.getItem('sim_user')) {
            unlockApp();
        }

        // Mostra bypass solo su localhost (sviluppo locale)
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            const bypassDiv = document.getElementById('localDevBypass');
            if (bypassDiv) bypassDiv.style.display = 'block';
        }

        const btnLogout = document.getElementById('btnLogout');
        if (btnLogout) btnLogout.onclick = handleLogout;

        // PayPal Integration logic
        let selectedDepositAmount = 10000;
        const paypalPresets = document.querySelectorAll('.paypal-preset');
        const depositAmountInput = document.getElementById('depositAmount');

        paypalPresets.forEach(btn => {
            btn.onclick = () => {
                paypalPresets.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedDepositAmount = parseFloat(btn.dataset.amount);
                depositAmountInput.value = selectedDepositAmount;
            };
        });

        depositAmountInput.oninput = () => {
            selectedDepositAmount = parseFloat(depositAmountInput.value) || 0;
            paypalPresets.forEach(b => b.classList.remove('active'));
        };

        // Logic for PayPal SDK dynamic loading and rendering
        let lastPaypalCurrency = '';
        function initPayPalButtons() {
            const container = document.getElementById('paypal-button-container');
            if (!container) return;

            // Se l'SDK è già caricato, non ricaricare MAI lo script per evitare errori di listener globali (Bootstrap Error)
            if (window.paypal) {
                container.innerHTML = '';
                renderPaypalButtons();
                return;
            }

            container.innerHTML = '<div style="text-align:center; padding:20px; opacity:0.6;">Caricamento PayPal...</div>';

            const oldScript = document.getElementById('paypal-sdk-script');
            if (oldScript) oldScript.remove();

            const script = document.createElement('script');
            script.id = 'paypal-sdk-script';
            script.src = `https://www.paypal.com/sdk/js?client-id=test&currency=${currentCurrency}`;
            script.dataset.sdkIntegrationSource = "button-factory";

            script.onload = () => {
                lastPaypalCurrency = currentCurrency;
                renderPaypalButtons();
            };
            script.onerror = () => {
                container.innerHTML = '<div style="color:#ef4444; padding:10px; font-size:0.8rem;">Errore caricamento PayPal SDK. Riprova.</div>';
            };
            document.head.appendChild(script);
        }

        function renderPaypalButtons() {
            const container = document.getElementById('paypal-button-container');
            if (!container || !window.paypal || !paypal.Buttons) return;

            container.innerHTML = '';
            paypal.Buttons({
                createOrder: function (data, actions) {
                    const amount = document.getElementById('depositAmount') ? parseFloat(document.getElementById('depositAmount').value).toFixed(2) : "1000.00";
                    return actions.order.create({
                        purchase_units: [{
                            amount: {
                                currency_code: currentCurrency,
                                value: amount
                            }
                        }]
                    });
                },
                onApprove: function (data, actions) {
                    return actions.order.capture().then(function (details) {
                        const amount = parseFloat(details.purchase_units[0].amount.value);
                        portfolioBalance += amount;
                        updateWalletUI();

                        const hpBal = document.getElementById('walletBalance');
                        if (hpBal) {
                            hpBal.style.transition = 'color 0.1s';
                            hpBal.style.color = '#34d399';
                            setTimeout(() => { hpBal.style.color = '#10b981'; }, 800);
                        }

                        paypalModal.classList.add('hidden');
                        showNotification(`Versamento di ${formatMoney(amount)} completato con successo da ${details.payer.name.given_name}.`, 'success');
                    });
                }
            }).render('#paypal-button-container');
        }

        const btnSimulatePaypal = document.getElementById('btnSimulatePaypal');
        if (btnSimulatePaypal) {
            btnSimulatePaypal.addEventListener('click', () => {
                const amount = document.getElementById('depositAmount') ? parseFloat(document.getElementById('depositAmount').value) : 10000;
                portfolioBalance += amount;
                // Registro versamenti per-broker: il deposito entra nel "Capitale Versato Tot."
                if (typeof window.addToDepositLedger === 'function') window.addToDepositLedger(amount);
                updateWalletUI();
                const hpBal = document.getElementById('walletBalance');
                if (hpBal) {
                    hpBal.style.transition = 'color 0.1s';
                    hpBal.style.color = '#34d399';
                    setTimeout(() => { hpBal.style.color = '#10b981'; }, 800);
                }
                // paypalModal è ora globale nel DOMContentLoaded
                if (paypalModal) paypalModal.classList.add('hidden');
                showNotification(`Versamento di ${formatMoney(amount)} completato (Simulazione Locale).`, 'success');
            });
        }

        // Info Modal Elements
        const btnAppInfo = document.getElementById('btnAppInfo');
        const infoModal = document.getElementById('infoModal');
        const closeInfoBtn = document.getElementById('closeInfoBtn');

        if (btnAppInfo) {
            btnAppInfo.onclick = () => {
                console.log("App: Apertura info modal...");
                infoModal.classList.remove('hidden');
            };
        }
        if (closeInfoBtn) {
            closeInfoBtn.onclick = () => infoModal.classList.add('hidden');
        }
        if (infoModal) {
            infoModal.onclick = (e) => {
                if (e.target === infoModal) infoModal.classList.add('hidden');
            };
        }

        async function resetAllData() {
            if (!confirm("Sei sicuro di voler resettare TUTTI i dati? Storico, posizioni e bilancio verranno cancellati.")) return;

            // Salviamo le credenziali e i settaggi broker
            const essentials = {
                'sim_user': localStorage.getItem('sim_user'),
                'finnhub_api_key': localStorage.getItem('finnhub_api_key'),
                'alpaca_key_id': localStorage.getItem('alpaca_key_id'),
                'alpaca_secret_key': localStorage.getItem('alpaca_secret_key'),
                'sim_use_alpaca': localStorage.getItem('sim_use_alpaca'),
                'sim_use_finnhub': localStorage.getItem('sim_use_finnhub'),
                'sim_lang': localStorage.getItem('sim_lang'),
                'sim_currency': localStorage.getItem('sim_currency'),
                'sim_sound_enabled': localStorage.getItem('sim_sound_enabled'),
                'bot_tp': localStorage.getItem('bot_tp'),
                'bot_sl': localStorage.getItem('bot_sl')
            };

            // Reset stato globale
            localStorage.clear();
            activePositions = {};
            tradeHistory = [];
            totalPnL = 0;
            executedTrades = 0;
            winTrades = 0;
            grossProfit = 0;
            grossLoss = 0;
            sessionInitialCapital = NaN; // Forza il ricalcolo dal broker al reload

            // Ripristina credenziali
            Object.entries(essentials).forEach(([key, val]) => {
                if (val !== null) localStorage.setItem(key, val);
            });

            await syncKeysWithServer(false);
            showNotification("Reset completato. Riavvio in corso...", "info");

            setTimeout(() => {
                location.reload();
            }, 1000);
        }

        const btnResetAll = document.getElementById('btnResetAll');
        if (btnResetAll) {
            btnResetAll.onclick = resetAllData;
        }

        // --- DOM Elements ---
        const currentPriceEl = document.getElementById('currentPrice');
        const assetDisplayNameEl = document.getElementById('assetDisplayName');
        const priceChangeEl = document.getElementById('priceChange');
        const totalPnLEl = document.getElementById('totalPnL');
        const winRateEl = document.getElementById('winRate');
        const totalTradesEl = document.getElementById('totalTrades');
        const tradeListEl = document.getElementById('tradeList');
        const botStatusEl = document.getElementById('botStatus');
        const paypalModal = document.getElementById('paypalModal');

        // Manual Controls
        const autoModeToggle = document.getElementById('autoModeToggle');
        const manualControls = document.getElementById('manualControls');
        // Bottoni BUY/SELL manuali: sempre VISIBILI nella legenda del grafico, ma
        // DISABILITATI quando il Bot Automatico è attivo (in auto il trading è solo del bot).
        function setManualTradeEnabled(enabled) {
            if (manualControls) manualControls.classList.remove('hidden'); // sempre visibili
            const b = document.getElementById('btnBuy');
            const s = document.getElementById('btnSell');
            if (b) b.disabled = !enabled;
            if (s) s.disabled = !enabled;
        }
        const openActions = document.getElementById('openActions');
        const btnBuy = document.getElementById('btnBuy');
        const btnSell = document.getElementById('btnSell');

        const assetPairSelect = document.getElementById('assetPair');
        const assetIconEl = document.getElementById('assetIcon');

        // Nuovi indicatori di stato
        statusFH = document.getElementById('statusFH');
        statusAL = document.getElementById('statusAL');

        // Modal Elements
        const apiSettingsBtn = document.getElementById('apiSettingsBtn');
        const apiModal = document.getElementById('apiModal');
        const apiKeyInput = document.getElementById('apiKeyInput');
        const saveApiBtn = document.getElementById('saveApiBtn');
        const cancelApiBtn = document.getElementById('cancelApiBtn');
        const apiErrorMsg = document.getElementById('apiErrorMsg');


        // Wallet & Radar Elements
        const walletBalanceEl = document.getElementById('walletBalance');
        const walletBalanceSideEl = document.getElementById('walletBalanceSide');
        // paypalModal è già dichiarato sopra
        const confirmDepositBtn = document.getElementById('confirmDepositBtn');
        const btnCancelDepositPaypal = document.getElementById('cancelDepositBtn');
        // depositAmountInput already declared

        const radarListEl = document.getElementById('radarList');
        const openPositionsListEl = document.getElementById('openPositionsList');
        // Investment controls
        const VALID_SYMBOLS = {
            // SOLO formato interno XXXUSDT: le API Alpaca vogliono "BTC/USD" e la
            // conversione fa .replace('USDT','/USD'). I simboli in formato misto
            // (es. 'BCHUSD') restavano malformati e Alpaca rispondeva 400 all'INTERO
            // batch di quotes → niente prezzi crypto. Per i simboli-posizione senza
            // slash (ADAUSD dei sync broker) c'è già il fallback in getAssetType.
            CRYPTO: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'MATICUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT',
                'BCHUSDT', 'AAVEUSDT', 'BATUSDT', 'GRTUSDT', 'MKRUSDT'],
            STOCK: ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'GOOGL', 'META', 'NFLX', 'AMD', 'COIN', 'DIS', 'PYPL', 'BABA', 'NIO', 'INTC'],
            FOREX: ['OANDA:EUR_USD', 'OANDA:GBP_USD', 'OANDA:USD_JPY', 'OANDA:AUD_USD', 'OANDA:USD_CAD', 'OANDA:NZD_USD', 'OANDA:USD_CHF', 'OANDA:EUR_GBP', 'OANDA:EUR_JPY', 'OANDA:GBP_JPY'],
            COMMODITY: ['OANDA:XAU_USD', 'OANDA:XAG_USD', 'OANDA:BRENT_USD', 'OANDA:WTI_USD', 'OANDA:NATGAS_USD', 'OANDA:COPPER_USD', 'LIT']
        };
        const extraSymbols = new Set();

        // Filtra la combo del grafico: SOLO le categorie disponibili+attive (broker
        // compatibile + mercato aperto). Definita qui (nel closure) perché usa
        // assetPairSelect/VALID_SYMBOLS/extraSymbols, locali a questo scope.
        window.applyComboAvailabilityFilter = function () {
            if (!assetPairSelect) return;
            const avail = (typeof window.categoryAvailability === 'function')
                ? window.categoryAvailability : () => ({ supported: true, open: true, available: true });
            const currentValue = assetPairSelect.value;
            assetPairSelect.innerHTML = '';
            // La combo mostra TUTTI gli asset SUPPORTATI dal broker della scheda;
            // quelli con mercato CHIUSO restano visibili ma NON selezionabili
            // (option disabled + suffisso "· chiuso").
            const addCat = (cat, count, marketOpen) => {
                const og = document.createElement('optgroup');
                og.label = cat + (marketOpen ? '' : ' (chiuso)');
                VALID_SYMBOLS[cat].forEach(sym => {
                    const o = document.createElement('option');
                    o.value = sym;
                    o.textContent = sym.replace('USDT', '').replace('OANDA:', '').replace('_', '/') + (marketOpen ? '' : ' · chiuso');
                    if (!marketOpen) o.disabled = true;
                    og.appendChild(o);
                    if (marketOpen) count.first = count.first || sym;
                });
                assetPairSelect.appendChild(og);
            };
            const c = { first: null };
            let anySupported = false;
            for (const cat in VALID_SYMBOLS) {
                const a = avail(cat);
                if (a.supported) { anySupported = true; addCat(cat, c, !!a.open); }
            }
            // Fallback: nessuna categoria supportata → mostra tutto (combo mai vuota)
            if (!anySupported) { for (const cat in VALID_SYMBOLS) addCat(cat, c, true); }
            // Simboli extra (posizioni broker): sempre visibili
            if (extraSymbols && extraSymbols.size > 0) {
                const og = document.createElement('optgroup');
                og.label = 'PORTAFOGLIO ALPACA';
                extraSymbols.forEach(sym => {
                    const o = document.createElement('option');
                    o.value = sym;
                    o.textContent = sym.replace('USDT', '').replace('OANDA:', '').replace('_', '/');
                    og.appendChild(o);
                });
                assetPairSelect.appendChild(og);
            }
            // Ripristina la selezione se ancora presente e SELEZIONABILE; altrimenti
            // passa al primo asset con mercato aperto
            const opts = Array.from(assetPairSelect.options);
            const cur = opts.find(o => o.value === currentValue);
            if (cur && !cur.disabled) {
                assetPairSelect.value = currentValue;
            } else if (c.first) {
                assetPairSelect.value = c.first;
                if (currentValue && currentValue !== c.first) assetPairSelect.dispatchEvent(new Event('change'));
            }
            // Aggiorna anche la disponibilità dei tasti manuali (SELL/short per broker)
            if (typeof window.updateManualControlsAvailability === 'function') window.updateManualControlsAvailability();
        };

        statusAL = document.getElementById('statusAL');
        statusFH = document.getElementById('statusFH');
        sidebarAlpacaToggle = document.getElementById('sidebarAlpacaToggle');
        sidebarFinnhubToggle = document.getElementById('sidebarFinnhubToggle');
        useAlpacaSwitch = document.getElementById('useAlpacaBroker');

        let alpacaDataAuthenticated = false;
        let lastUpdateTracker = {};

        // radarTracker moved to radar.js
        let activeFinnhubSubs = new Set();
        let activeAlpacaSubs = new Set();
        // radarActiveElements moved to radar.js


        // --- State variables (Loaded from global scope) ---
        let brokerMarketValue = 0;
        let brokerUnrealizedPnL = 0;
        let alpacaReconnectDelay = 5000;

        const investAmountInput = document.getElementById('investAmount');
        const investSlider = document.getElementById('investSlider');
        const investPctLabel = document.getElementById('investPctLabel');
        const investPreviewAmtEl = document.getElementById('investPreviewAmt');
        const availableMarginEl = document.getElementById('availableMargin');
        const sessionRevenueEl = document.getElementById('sessionRevenue');
        const sessionPnLEl = document.getElementById('sessionPnL');
        const tradingCapitalEl = document.getElementById('tradingCapital');
        const initialCapitalEl = document.getElementById('initialCapital');
        const totalInvestedEl = document.getElementById('totalInvested');
        const sessionROIEl = document.getElementById('sessionROI');
        const unrealizedPnLEl = document.getElementById('unrealizedPnL');
        const btnStartBot = document.getElementById('btnStartBot');
        const sessionTimerEl = document.getElementById('sessionTimer');
        const algoTitleEl = document.getElementById('algoTitle');
        const logicEMAEl = document.getElementById('logicEMA');
        const logicAIEl = document.getElementById('logicAI');

        // --- Trading State ---
        let lastValidAsset = 'BTCUSDT';
        currentPrice = 0;
        previousPrice = 0;
        selectedPosCategory = 'ALL';
        // Ordinamento pannelli Aperte/Ordinate/Cronologia: true = dal più recente al
        // più vecchio (default richiesto), false = dal più vecchio al più recente.
        let openPositionsSortDesc = (localStorage.getItem('sort_open_desc') ?? 'true') === 'true';
        let pendingOrdersSortDesc = (localStorage.getItem('sort_pending_desc') ?? 'true') === 'true';
        let historySortDesc = (localStorage.getItem('sort_history_desc') ?? 'true') === 'true';
        function updateSortToggleUI(btnId, isDesc) {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.textContent = isDesc ? '🔽' : '🔼';
            btn.setAttribute('data-tooltip', isDesc
                ? tr('sort_newest_first', 'Ordine: dal più recente al più vecchio (clicca per invertire)')
                : tr('sort_oldest_first', 'Ordine: dal più vecchio al più recente (clicca per invertire)'));
        }
        globalPrices = {};
        overviewPrevPrices = {};

        let priceHistory = [];
        // isManualMode is now global

        // currentCurrency is now global
        const currencySymbols = { 'USD': '$', 'EUR': '€', 'GBP': '£' };

        const formatters = {};
        function formatMoney(value, minDec = 2, maxDec = 2) {
            const sym = currencySymbols[currentCurrency] || '$';
            const sign = value < 0 ? '-' : '';
            const key = `${currentCurrency}-${minDec}-${maxDec}`;
            if (!formatters[key]) {
                formatters[key] = new Intl.NumberFormat('en-US', { minimumFractionDigits: minDec, maximumFractionDigits: maxDec });
            }
            return `${sign}${sym}${formatters[key].format(Math.abs(value))}`;
        }

        const currencySelectorEl = document.getElementById('currencySelector');
        if (currencySelectorEl) {
            currencySelectorEl.value = currentCurrency;
            currencySelectorEl.addEventListener('change', (e) => {
                currentCurrency = e.target.value;
                localStorage.setItem('sim_currency', currentCurrency);
                updateWalletUI();
                if (typeof updateDashboard === 'function') updateDashboard();
                if (typeof updateOpenPositionsUI === 'function') updateOpenPositionsUI();
                if (typeof renderHistory === 'function') renderHistory();
                // NON chiamiamo initPayPalButtons qui per evitare conflitti con l'SDK globale
            });
        }

        const botTPInput = document.getElementById('botTargetProfit');
        const botSLInput = document.getElementById('botStopLoss');
        if (botTPInput) {
            botTPInput.value = localStorage.getItem('bot_tp') || '1.5';
            botTPInput.addEventListener('input', (e) => localStorage.setItem('bot_tp', e.target.value));
        }
        if (botSLInput) {
            botSLInput.value = localStorage.getItem('bot_sl') || '1';
            botSLInput.addEventListener('input', (e) => localStorage.setItem('bot_sl', e.target.value));
        }

        // FIX SICUREZZA: nessuna chiave di default hardcoded
        // --- Persistence Logic ---
        // NOTA: test mode e broker mode usano chiavi localStorage SEPARATE.
        // Le chiavi 'sim_test_*' sono isolate da Alpaca (che scrive su 'sim_*').
        const TEST_DEFAULT_CAPITAL = 1000;
        localStorage.removeItem('sim_is_resetting');
        portfolioBalance = Math.round((parseFloat(localStorage.getItem('sim_portfolio_balance')) || 0) * 100) / 100;

        // Portafogli di TEST "usa e getta" (scelta utente): a ogni AVVIO dell'app
        // i contesti locali (FH / CAP-D) ripartono SEMPRE puliti a $1000 —
        // posizioni aperte (simulate) e cronologia comprese. Il cambio scheda
        // durante la sessione NON azzera nulla: il reset avviene solo qui al boot.
        ['fh', 'capd'].forEach(ctx => {
            localStorage.removeItem('sim_ctx_' + ctx);
            localStorage.removeItem('broker_pnl_' + ctx);
            localStorage.removeItem('broker_deposited_' + ctx);
        });
        console.log(`[TEST] Portafogli FH/CAP-D azzerati all'avvio: capitale $${TEST_DEFAULT_CAPITAL}, nessuna posizione, cronologia vuota.`);

        // ─── Cambio account Alpaca: invalida i dati locali del vecchio conto ───
        // Cronologia, statistiche, cache FILL e versato vivono in localStorage
        // SENZA legame con la API key: cambiando chiave (nuovo portafoglio) l'app
        // mostrava ancora i dati del conto precedente. Memorizziamo la chiave
        // usata e, quando cambia, azzeriamo le cache locali: il nuovo conto si
        // risincronizza interamente da Alpaca (conto/posizioni/ordini/FILL).
        function purgeAlpacaLocalData(cacheKey, ctx) {
            ['sim_trade_history', 'sim_total_pnl', 'sim_executed_trades', 'sim_win_trades',
                'sim_gross_profit', 'sim_gross_loss', 'sim_active_positions', 'sim_trading_capital',
                'sim_session_initial_capital', 'sim_global_commissions',
                'broker_pnl_' + ctx, 'broker_deposited_' + ctx].forEach(k => localStorage.removeItem(k));
            try {
                const cache = JSON.parse(localStorage.getItem('alpaca_activities_cache')) || {};
                delete cache[cacheKey];
                localStorage.setItem('alpaca_activities_cache', JSON.stringify(cache));
            } catch (_) { localStorage.removeItem('alpaca_activities_cache'); }
            if (window.__alpacaActivitiesCache) delete window.__alpacaActivitiesCache[cacheKey];
            // Stato in-memory (cambio chiave a runtime dal modale): riparte pulito
            if (useAlpacaBroker) {
                tradeHistory = []; activePositions = {}; brokerEntryBasis = {};
                totalPnL = 0; executedTrades = 0; winTrades = 0; grossProfit = 0; grossLoss = 0;
                globalCommissions = 0;
                _lastRenderedHistoryJSON = null;
                try { if (typeof renderHistory === 'function') renderHistory(); } catch (_) { }
            }
            console.log(`[ACCOUNT] Chiave Alpaca (${cacheKey}) cambiata: dati locali del vecchio account azzerati, risincronizzo dal broker.`);
        }
        function checkAlpacaKeyChange() {
            const pairs = [
                { cur: alpacaKeyId || '', memo: 'alpaca_key_memo_paper', cacheKey: 'paper', ctx: 'alp' },
                { cur: alpacaLiveKeyId || '', memo: 'alpaca_key_memo_live', cacheKey: 'live', ctx: 'alrt' }
            ];
            pairs.forEach(p => {
                if (!p.cur) return; // nessuna chiave configurata: niente da confrontare
                if (localStorage.getItem(p.memo) !== p.cur) {
                    // memo assente = primo avvio con questa logica: pulizia una tantum
                    // (i dati veri tornano comunque dalla sync del broker).
                    purgeAlpacaLocalData(p.cacheKey, p.ctx);
                    localStorage.setItem(p.memo, p.cur);
                }
            });
        }
        window.checkAlpacaKeyChange = checkAlpacaKeyChange;
        checkAlpacaKeyChange();

        if (!useAlpacaBroker) {
            // ===== MODALITÀ TEST: recupera contesto se esiste =====
            loadLocalCtxState('fh');
        } else {
            // ===== MODALITÀ BROKER: chiavi Alpaca (ri-sincronizzate live all'avvio) =====
            activePositions = JSON.parse(localStorage.getItem('sim_active_positions')) || {};
            tradingCapital = Math.round((parseFloat(localStorage.getItem('sim_trading_capital')) || 0) * 100) / 100;
            const sessionInitialCapitalStr = localStorage.getItem('sim_session_initial_capital');
            sessionInitialCapital = sessionInitialCapitalStr !== null ? parseFloat(sessionInitialCapitalStr) : (tradingCapital > 0 ? tradingCapital : 0);
            totalPnL = parseFloat(localStorage.getItem('sim_total_pnl')) || 0;
            executedTrades = parseInt(localStorage.getItem('sim_executed_trades')) || 0;
            winTrades = parseInt(localStorage.getItem('sim_win_trades')) || 0;
            grossProfit = parseFloat(localStorage.getItem('sim_gross_profit')) || 0;
            grossLoss = parseFloat(localStorage.getItem('sim_gross_loss')) || 0;
            tradeHistory = JSON.parse(localStorage.getItem('sim_trade_history')) || [];
        }

        // Reset completo dello stato test a $1000 (azzera posizioni, storia, statistiche)
        // Lo storico prezzi NON viene azzerato: permette warm-up istantaneo alla prossima sessione.
        function resetTestState() {
            localStorage.removeItem('sim_ctx_fh');
            localStorage.removeItem('sim_ctx_capd');
            localStorage.removeItem('broker_pnl_fh');
            localStorage.removeItem('broker_pnl_capd');
            localStorage.removeItem('broker_deposited_fh');
            localStorage.removeItem('broker_deposited_capd');
            if (typeof ctxLive !== 'undefined' && ctxLive) {
                delete ctxLive['fh'];
                delete ctxLive['capd'];
            }
            sessionInitialCapital = TEST_DEFAULT_CAPITAL;
            tradingCapital = TEST_DEFAULT_CAPITAL;
            totalPnL = 0;
            activePositions = {};
            tradeHistory = [];
            executedTrades = 0;
            winTrades = 0;
            grossProfit = 0;
            grossLoss = 0;
            sessionBudgetUsed = 0;
            isCapitalExhausted = false;
            // Ripristina lo storico prezzi dal local db (warm-up istantaneo, nessuna dipendenza esterna)
            try {
                const snap = JSON.parse(localStorage.getItem('sim_test_price_history') || 'null');
                if (snap && typeof snap === 'object') {
                    for (const sym in snap) {
                        if (Array.isArray(snap[sym]) && snap[sym].length >= 10) {
                            bgPriceHistories[sym] = snap[sym];
                            if (!globalPrices[sym]) globalPrices[sym] = snap[sym][snap[sym].length - 1];
                        }
                    }
                    console.log('[TEST] Storico prezzi ripristinato dal local db:', Object.keys(snap).length, 'asset');
                }
            } catch (_) { }
            persistTestData();
        }

        // Salva lo stato test sulle chiavi dedicate 'sim_test_*'
        function persistTestData() {
            localStorage.setItem('sim_test_initial', sessionInitialCapital.toString());
            localStorage.setItem('sim_test_capital', tradingCapital.toString());
            localStorage.setItem('sim_test_pnl', totalPnL.toString());
            localStorage.setItem('sim_test_positions', JSON.stringify(activePositions));
            localStorage.setItem('sim_test_history', JSON.stringify(tradeHistory));
            localStorage.setItem('sim_test_executed', executedTrades.toString());
            localStorage.setItem('sim_test_wins', winTrades.toString());
            localStorage.setItem('sim_test_gross_profit', grossProfit.toString());
            localStorage.setItem('sim_test_gross_loss', grossLoss.toString());
            // Persisti lo storico prezzi per il warm-up istantaneo alla prossima sessione
            const snap = {};
            for (const sym in bgPriceHistories) {
                const h = bgPriceHistories[sym];
                if (h && h.length >= 10) snap[sym] = h.slice(-100); // ultimi 100 punti
            }
            if (Object.keys(snap).length > 0) {
                try { localStorage.setItem('sim_test_price_history', JSON.stringify(snap)); } catch (_) { }
            }
        }
        window.resetTestState = resetTestState;
        window.persistTestData = persistTestData; // esposto per diagnostica/test
        window.getSessionBudgetLimit = getSessionBudgetLimit; // esposto per diagnostica/test

        // ═══ FASE B — Stato per-broker (multi-dashboard) ═══
        // Ogni contesto LOCALE (fh = Test Finnhub, capd/capl = Capital.com con ordini
        // simulati) ha il SUO portafoglio: posizioni, capitale, cronologia e
        // statistiche sono salvati/ripristinati per contesto quando si cambia scheda.
        // I contesti alp/alrt restano sincronizzati live da Alpaca (fonte autorevole).
        function saveLocalCtxState(ctx) {
            if (!LOCAL_CTXS.includes(ctx)) return;
            const s = {
                sessionInitialCapital, tradingCapital, totalPnL, activePositions,
                tradeHistory, executedTrades, winTrades, grossProfit, grossLoss, sessionBudgetUsed, skippedCounters,
                globalCommissions
            };
            ctxLive[ctx] = s; // FASE D2: tiene fresco anche lo stato in-memory
            try { localStorage.setItem('sim_ctx_' + ctx, JSON.stringify(s)); } catch (_) { }
        }
        function loadLocalCtxState(ctx) {
            if (!LOCAL_CTXS.includes(ctx)) return;
            // FASE D2: se il contesto ha uno stato in-memory (motore in background),
            // quello è il più aggiornato — la localStorage è solo persistenza.
            if (ctxLive[ctx]) { loadGlobalsFrom(ctx); isCapitalExhausted = false; return; }
            let s = null;
            try { s = JSON.parse(localStorage.getItem('sim_ctx_' + ctx) || 'null'); } catch (_) { }
            if (!s) {
                // Primo uso del contesto: portafoglio pulito a $1000
                sessionInitialCapital = TEST_DEFAULT_CAPITAL;
                tradingCapital = TEST_DEFAULT_CAPITAL;
                totalPnL = 0; activePositions = {}; tradeHistory = [];
                executedTrades = 0; winTrades = 0; grossProfit = 0; grossLoss = 0;
                sessionBudgetUsed = 0; globalCommissions = 0;
            } else {
                sessionInitialCapital = !isNaN(parseFloat(s.sessionInitialCapital)) ? parseFloat(s.sessionInitialCapital) : TEST_DEFAULT_CAPITAL;
                tradingCapital = !isNaN(parseFloat(s.tradingCapital)) ? parseFloat(s.tradingCapital) : TEST_DEFAULT_CAPITAL;
                totalPnL = parseFloat(s.totalPnL) || 0;
                activePositions = s.activePositions || {};
                tradeHistory = Array.isArray(s.tradeHistory) ? s.tradeHistory : [];
                executedTrades = parseInt(s.executedTrades) || 0;
                winTrades = parseInt(s.winTrades) || 0;
                grossProfit = parseFloat(s.grossProfit) || 0;
                grossLoss = parseFloat(s.grossLoss) || 0;
                sessionBudgetUsed = parseFloat(s.sessionBudgetUsed) || 0;
                globalCommissions = parseFloat(s.globalCommissions) || 0;
                skippedCounters = s.skippedCounters || { shortcrypto: 0, nocash: 0, reject: 0, qty: 0, maxpos: 0, spread: 0 };
            }
            isCapitalExhausted = false;
        }
        // Transizione di contesto al cambio scheda/selettore: carica lo stato del
        // nuovo contesto e riallinea la UI. Il SALVATAGGIO del contesto lasciato
        // avviene all'INGRESSO di applyBrokerSwitch (prima dei reset di setTradingMode).
        function handleCtxTransition(prevCtx) {
            const newCtx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
            if (newCtx === prevCtx) return;
            // FASE D1: memorizza lo stato bot della scheda lasciata e ripristina
            // quello della scheda di arrivo (ogni scheda ha il SUO interruttore).
            botActiveByCtx[prevCtx] = isBotActive;
            if (LOCAL_CTXS.includes(newCtx)) loadLocalCtxState(newCtx);
            console.log(`[CTX] Cambio contesto broker: ${prevCtx} → ${newCtx}`);
            const wantBot = !!botActiveByCtx[newCtx];
            if (wantBot !== isBotActive) {
                try {
                    applyBotState(wantBot, { silent: true });
                    if (wantBot) showNotification('▶ Bot ATTIVO su questa scheda (stato ricordato).', 'info');
                } catch (_) { }
            }
            try { if (typeof window.updateTabBotDots === 'function') window.updateTabBotDots(); } catch (_) { }
            try { if (typeof window.syncConnToggles === 'function') window.syncConnToggles(); } catch (_) { }
            // Riallinea categorie/combo/legenda/serie del grafico alla scheda (punti 3-6)
            try { if (typeof window.refreshCategoryAvailability === 'function') window.refreshCategoryAvailability(); } catch (_) { }
            try { updateWalletUI(); } catch (_) { }
            try { updateDashboard(); } catch (_) { }
            try { if (typeof window.renderOpenPositions === 'function') window.renderOpenPositions(); } catch (_) { }
            try { if (typeof window.renderHistory === 'function') window.renderHistory(); } catch (_) { }
        }
        window.saveLocalCtxState = saveLocalCtxState;

        // ═══ FASE D2 — Motori di trading PARALLELI sui contesti locali ═══
        // I contesti locali (fh/capd/capl) col bot armato tradano anche in
        // BACKGROUND, ciascuno sul proprio portafoglio, tramite "context swap"
        // SINCRONO: i globals vengono scambiati con lo stato del contesto target,
        // strategia e gestione rischio girano, poi si ripristina il contesto attivo.
        // SICUREZZA: sui contesti locali openTrade/closeTrade completano in modo
        // sincrono (nessun await sul percorso simulato, verificato) e durante lo
        // swap useAlpacaBroker/liveMonitorActive sono FORZATI a false: impossibile
        // instradare per errore ordini reali dal background. I contesti alp/alrt
        // (ordini reali, percorsi async) NON girano in background per progetto.
        // stato in-memory dei contesti locali non attivi
        function hydrateCtxLive(ctx) {
            if (ctxLive[ctx]) return;
            let s = null;
            try { s = JSON.parse(localStorage.getItem('sim_ctx_' + ctx) || 'null'); } catch (_) { }
            ctxLive[ctx] = s ? {
                sessionInitialCapital: !isNaN(parseFloat(s.sessionInitialCapital)) ? parseFloat(s.sessionInitialCapital) : TEST_DEFAULT_CAPITAL,
                tradingCapital: !isNaN(parseFloat(s.tradingCapital)) ? parseFloat(s.tradingCapital) : TEST_DEFAULT_CAPITAL,
                totalPnL: parseFloat(s.totalPnL) || 0,
                activePositions: s.activePositions || {},
                tradeHistory: Array.isArray(s.tradeHistory) ? s.tradeHistory : [],
                executedTrades: parseInt(s.executedTrades) || 0,
                winTrades: parseInt(s.winTrades) || 0,
                grossProfit: parseFloat(s.grossProfit) || 0,
                grossLoss: parseFloat(s.grossLoss) || 0,
                sessionBudgetUsed: parseFloat(s.sessionBudgetUsed) || 0
            } : {
                sessionInitialCapital: TEST_DEFAULT_CAPITAL, tradingCapital: TEST_DEFAULT_CAPITAL,
                totalPnL: 0, activePositions: {}, tradeHistory: [], executedTrades: 0,
                winTrades: 0, grossProfit: 0, grossLoss: 0, sessionBudgetUsed: 0, skippedCounters: { shortcrypto: 0, nocash: 0, reject: 0, qty: 0, maxpos: 0 }
            };
        }
        function snapshotGlobalsTo(ctx) {
            ctxLive[ctx] = {
                sessionInitialCapital, tradingCapital, totalPnL, activePositions,
                tradeHistory, executedTrades, winTrades, grossProfit, grossLoss, sessionBudgetUsed, skippedCounters
            };
        }
        function loadGlobalsFrom(ctx) {
            const s = ctxLive[ctx];
            if (!s) return false;
            sessionInitialCapital = s.sessionInitialCapital;
            tradingCapital = s.tradingCapital;
            totalPnL = s.totalPnL;
            activePositions = s.activePositions;
            tradeHistory = s.tradeHistory;
            executedTrades = s.executedTrades;
            winTrades = s.winTrades;
            grossProfit = s.grossProfit;
            grossLoss = s.grossLoss;
            sessionBudgetUsed = s.sessionBudgetUsed;
            return true;
        }
        // Esegue fn nel contesto LOCALE indicato. fn DEVE essere sincrona.
        function execInCtx(ctx, fn) {
            if (!LOCAL_CTXS.includes(ctx)) return;
            const activeCtx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
            if (ctx === activeCtx) { try { fn(); } catch (e) { console.warn('[D2]', ctx, e); } return; }
            // 1) salva i globals del contesto ATTIVO (qualunque esso sia)
            const tmp = {
                sessionInitialCapital, tradingCapital, totalPnL, activePositions,
                tradeHistory, executedTrades, winTrades, grossProfit, grossLoss, sessionBudgetUsed, skippedCounters, isCapitalExhausted
            };
            const saveAlpaca = useAlpacaBroker, saveLive = window.liveMonitorActive, saveCap = window.capitalMode;
            const saveBot = isBotActive, saveManual = isManualMode;
            if (LOCAL_CTXS.includes(activeCtx)) snapshotGlobalsTo(activeCtx);
            // 2) carica il contesto target e forza la modalità SIMULAZIONE LOCALE
            hydrateCtxLive(ctx);
            loadGlobalsFrom(ctx);
            isCapitalExhausted = false;
            useAlpacaBroker = false;
            window.liveMonitorActive = false;
            window.capitalMode = (ctx === 'capd') ? 'demo' : (ctx === 'capl') ? 'live' : 'off';
            // Nel contesto in background il bot è armato per definizione (gate a monte)
            isBotActive = true;
            isManualMode = false;
            window.__ctxOverride = ctx;
            try { fn(); } catch (e) { console.warn('[D2] errore motore background', ctx, e); }
            window.__ctxOverride = null;
            // 3) salva il target e ripristina il contesto attivo
            snapshotGlobalsTo(ctx);
            useAlpacaBroker = saveAlpaca;
            window.liveMonitorActive = saveLive;
            window.capitalMode = saveCap;
            isBotActive = saveBot;
            isManualMode = saveManual;
            sessionInitialCapital = tmp.sessionInitialCapital;
            tradingCapital = tmp.tradingCapital;
            totalPnL = tmp.totalPnL;
            activePositions = tmp.activePositions;
            tradeHistory = tmp.tradeHistory;
            executedTrades = tmp.executedTrades;
            winTrades = tmp.winTrades;
            grossProfit = tmp.grossProfit;
            grossLoss = tmp.grossLoss;
            sessionBudgetUsed = tmp.sessionBudgetUsed;
            skippedCounters = tmp.skippedCounters;
            isCapitalExhausted = tmp.isCapitalExhausted;
            // Anti-bleed UI: durante fn le funzioni di rendering possono aver scritto
            // nel DOM i valori del contesto in background; ri-renderizza subito i
            // valori del contesto ATTIVO appena ripristinato.
            try {
                updateWalletUI();
                if (typeof updateDashboard === 'function') updateDashboard();
                if (typeof renderHistory === 'function') renderHistory();
                if (typeof renderOpenPositions === 'function') renderOpenPositions();
            } catch (_) { }
        }
        // ─── Totale portafoglio multi-broker (header) ───
        // Il valore nella barra di stato è la SOMMA degli equity di tutti i broker:
        // contesti locali (fh/capd/capl) calcolati mark-to-market dal loro stato
        // (globals se attivi, ctxLive altrimenti); alp/alrt dall'ultima equity
        // sincronizzata dal broker (conteggiati solo se nota).
        function ctxEquityLocal(ctx) {
            const activeCtx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
            let st;
            if (ctx === activeCtx && LOCAL_CTXS.includes(ctx)) {
                st = { tradingCapital, activePositions };
            } else {
                hydrateCtxLive(ctx);
                st = ctxLive[ctx];
            }
            if (!st) return 0;
            let eq = parseFloat(st.tradingCapital) || 0;
            for (const sym in (st.activePositions || {})) {
                const p = st.activePositions[sym];
                const lp = getLivePriceFor(sym) || p.entryPrice;
                const unreal = p.type === 'LONG' ? (lp - p.entryPrice) * p.amount : (p.entryPrice - lp) * p.amount;
                eq += (parseFloat(p.invested) || 0) + unreal;
            }
            return eq;
        }
        function updateGlobalPortfolioHeader() {
            const el = document.getElementById('walletBalance');
            if (!el) return;
            const parts = [];
            let total = 0;

            // SOMMA SOLO PORTAFOGLI REALI (ALRT e CAPL)
            const known = window.__equityByCtx || {};
            for (const b of ['alrt', 'capl']) {
                if (typeof known[b] === 'number' && known[b] > 0) {
                    total += known[b];
                    parts.push(`${b.toUpperCase()}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(known[b])}`);
                }
            }

            // Lettura valuta scelta dalla barra (default USD)
            const currencySel = document.getElementById('topBarCurrencySelector');
            const targetCurrency = currencySel ? currencySel.value : 'USD';

            // Calcolo tasso di conversione dai prezzi in tempo reale (Finnhub/Capital Forex)
            let rate = 1;
            if (targetCurrency === 'EUR') rate = globalPrices['EURUSD'] ? (1 / globalPrices['EURUSD']) : (1 / 1.08);
            else if (targetCurrency === 'GBP') rate = globalPrices['GBPUSD'] ? (1 / globalPrices['GBPUSD']) : (1 / 1.25);
            else if (targetCurrency === 'CHF') rate = globalPrices['USDCHF'] || 0.88;
            else if (targetCurrency === 'JPY') rate = globalPrices['USDJPY'] || 150.0;

            const convertedTotal = total * rate;

            // Formatta SOLO come numero (il simbolo è nella combo box)
            const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(convertedTotal);
            el.textContent = formatted;

            const wrap = el.closest('.header-portfolio');
            if (wrap) wrap.setAttribute('data-tooltip', 'Totale Portafogli Reali — ' + (parts.length > 0 ? parts.join(' · ') : 'Nessun conto reale collegato'));
        }
        window.updateGlobalPortfolioHeader = updateGlobalPortfolioHeader;

        // Aggiungi listener per ricalcolare subito al cambio di valuta
        document.addEventListener('DOMContentLoaded', () => {
            const topBarSel = document.getElementById('topBarCurrencySelector');
            if (topBarSel) {
                topBarSel.addEventListener('change', updateGlobalPortfolioHeader);
            }
        });

        // Categorie tradabili per contesto (matrice broker, indipendente dal ctx attivo)
        function ctxSupportsCategory(ctx, type) {
            if (ctx === 'capd' || ctx === 'capl') return type === 'FOREX' || type === 'COMMODITY';
            if (ctx === 'alp' || ctx === 'alrt') return type === 'CRYPTO' || type === 'STOCK';
            return true; // fh: tutte le categorie
        }
        // Superficie diagnostica D2 (test/debug): stato motori e seed storico prezzi
        window.__d2 = {
            ctxLive, botActiveByCtx, execInCtx,
            seedHistory: (sym, arr) => { bgPriceHistories[sym] = arr.slice(); globalPrices[sym] = arr[arr.length - 1]; },
            // Apre un trade SIMULATO nel contesto locale indicato (diagnostica del
            // percorso swap → openTrade → portafoglio del contesto)
            openTradeInCtx: (ctx, type, price, sym) => execInCtx(ctx, () => { openTrade(type, price, sym); })
        };
        // Ciclo di rischio dei motori in background (1s, come il ritmo del principale)
        setInterval(() => {
            const activeCtx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
            for (const ctx of LOCAL_CTXS) {
                if (ctx === activeCtx || !botActiveByCtx[ctx]) continue;
                execInCtx(ctx, manageBgRiskCurrentCtx);
            }
        }, 1000);

        // --- Wake Lock API (Keep App Running) ---
        let wakeLock = null;
        async function requestWakeLock() {
            if (!isBotActive) return;
            if ('wakeLock' in navigator) {
                if (document.visibilityState !== 'visible') {
                    console.log('Wake Lock: Pagina non visibile, attendo visibilità.');
                    return;
                }
                try {
                    if (wakeLock) await wakeLock.release();
                    wakeLock = await navigator.wakeLock.request('screen');
                    console.log('Wake Lock: Schermo bloccato (attivo)');

                    wakeLock.addEventListener('release', () => {
                        console.log('Wake Lock: Rilasciato dal sistema');
                    });
                } catch (err) {
                    console.error('Wake Lock Error:', err);
                }
            }
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && isBotActive) {
                requestWakeLock();
            }
        });

        function releaseWakeLock() {
            if (wakeLock) {
                wakeLock.release().then(() => {
                    wakeLock = null;
                    console.log('Wake Lock: Schermo rilasciato');
                });
            }
        }

        // --- Silent Audio Keep-Alive (Prevents Browser Sleep) ---
        let keepAliveAudioCtx = null;
        function startKeepAlive() {
            try {
                if (!window.userHasInteracted) return;
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext || (keepAliveAudioCtx && keepAliveAudioCtx.state === 'running')) return;

                if (!keepAliveAudioCtx) {
                    keepAliveAudioCtx = new AudioContext();
                }

                if (keepAliveAudioCtx.state === 'suspended') {
                    // Non tentiamo di forzare il resume qui, lo farà il listener del click
                    return;
                }

                const oscillator = keepAliveAudioCtx.createOscillator();
                const gainNode = keepAliveAudioCtx.createGain();
                gainNode.gain.value = 0.001;
                oscillator.connect(gainNode);
                gainNode.connect(keepAliveAudioCtx.destination);
                oscillator.start();
                console.log("Audio: Keep-alive attivo per protezione background.");
            } catch (e) {
                // Silenzioso
            }
        }

        function stopKeepAlive() {
            if (keepAliveAudioCtx) {
                keepAliveAudioCtx.close();
                keepAliveAudioCtx = null;
                console.log("Audio: Keep-alive fermato.");
            }
        }

        // Sblocca Audio Context al primo click dell'utente (requisito browser)
        // NOTA: non usiamo { once: true } — il context può restare 'suspended' per più interazioni
        document.addEventListener('click', () => {
            if (!keepAliveAudioCtx) {
                startKeepAlive();
            } else if (keepAliveAudioCtx.state === 'suspended') {
                keepAliveAudioCtx.resume().then(() => {
                    console.log("Audio: Context sbloccato dopo interazione utente.");
                }).catch(() => { });
            }
        });

        // Riacquisisci Wake Lock e Keep-Alive quando la pagina torna visibile
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible' && isBotActive) {
                console.log('Visibility: App tornata visibile, ripristino sistemi stay-alive...');
                await requestWakeLock();
                startKeepAlive();
            }
            // Grafico pulito al ritorno in foreground: se l'app è rimasta in background
            // a lungo (device sospeso) i tick si fermano e nel grafico resta un "buco".
            // Se il gap dall'ultima candela è grande, ricolleghiamo l'asset corrente così
            // il grafico riparte pulito (senza il salto temporale).
            if (document.visibilityState === 'visible') {
                try {
                    const gapSec = Math.floor(Date.now() / 1000) - (lastCandleTime || 0);
                    if (lastCandleTime && gapSec > 120 && assetPairSelect && assetPairSelect.value) {
                        console.log(`[CHART] Gap di ${gapSec}s dopo il background: ricollego ${assetPairSelect.value} per un grafico pulito.`);
                        connectToMarket(assetPairSelect.value);
                    }
                } catch (e) { /* non bloccare l'app */ }
            }
        });

        // --- DOM Elements Initialization (Must be before any function calls) ---
        sidebarAlpacaToggle = document.getElementById('sidebarAlpacaToggle');
        sidebarFinnhubToggle = document.getElementById('sidebarFinnhubToggle');
        useAlpacaSwitch = document.getElementById('useAlpacaBroker');
        statusAL = document.getElementById('statusAL');
        statusFH = document.getElementById('statusFH');

        // Caricamento Chiavi dal Server all'avvio
        await syncKeysWithServer(false);

        // L'app parte SEMPRE in modalità TEST (capitale $1000), a ogni avvio.
        // Il broker Alpaca Paper si attiva solo manualmente dal toggle durante la sessione
        // e NON viene ricordato come stato di avvio.
        useAlpacaBroker = false;
        localStorage.setItem('sim_use_alpaca', 'false');
        // Forza Finnhub attivo come unica sorgente dati in test mode
        useFinnhubData = true;
        localStorage.setItem('sim_use_finnhub', 'true');
        console.log('%c[INIT] MODALITÀ TEST attiva — sorgente dati: SOLO Finnhub — capitale $1000 — nessuna connessione Alpaca.', 'color:#f59e0b; font-weight:bold;');

        // Ripristina lo stato corretto del bot per la modalità Finnhub all'avvio
        isBotActive = botActiveByCtx['fh'];
        isManualMode = !isBotActive;
        localStorage.setItem('sim_trading_mode', isManualMode ? 'manual' : 'auto');

        setManualTradeEnabled(!isBotActive); // bot attivo → BUY/SELL disabilitati

        // Aggiorna il sottotitolo del toggle test con il capitale corrente
        function updateTestLabel() {
            const lbl = document.getElementById('testModeSubLabel');
            if (!lbl) return;
            const t = translations[currentLang] || translations.IT || {};
            const amount = '$' + (tradingCapital || sessionInitialCapital || 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            lbl.textContent = useAlpacaBroker
                ? (t.test_mode_off || 'OFF = Broker Reale (Alpaca Paper)')
                : (t.test_mode_on || 'ON — Capitale: {amount}').replace('{amount}', amount);
        }
        window.updateTestLabel = updateTestLabel; // per il refresh al cambio lingua
        // Re-render dei pannelli dinamici (colonna destra) al cambio lingua
        window.__i18nRefresh = function () {
            try {
                renderOpenPositions();
                renderHistory();
                renderPendingOrders(_lastPendingOrders);
                updateSessionBudgetUI();
            } catch (e) { /* pannelli non ancora inizializzati */ }
        };

        // Chiusura "gentile" di un WebSocket: se è ancora in CONNECTING,
        // chiuderlo subito genera il warning "WebSocket is closed before the
        // connection is established" — in quel caso lo si chiude appena apre.
        function closeWsGracefully(ws) {
            if (!ws) return;
            try {
                if (ws.readyState === 0) { // CONNECTING
                    ws.onmessage = null;
                    ws.onopen = function () { try { this.close(); } catch (e) { /* già chiuso */ } };
                } else if (ws.readyState === 1) { // OPEN
                    ws.close();
                }
            } catch (e) { /* già chiuso */ }
        }

        // --- Funzione UNIFICATA per cambiare modalità (usata da tutti i toggle) ---
        // opts.skipFinnhub: non riattivare Finnhub in modalità test (usato dallo
        // stadio ALPrt, che vuole TUTTE le altre sorgenti spente)
        function setTradingMode(useBroker, opts = {}) {
            useAlpacaBroker = useBroker;
            // opts.live = true → stadio ALrt: broker Alpaca sul conto REALE. Impostato qui
            // (prima del setup) così getBrokerHttp() punta subito a live. Ogni altro cambio
            // modalità spegne il monitor del conto reale.
            window.liveMonitorActive = !!opts.live;
            localStorage.setItem('sim_use_alpaca', useBroker ? 'true' : 'false');
            // Sincronizza TUTTI i controlli UI
            const tm = document.getElementById('testModeToggle');
            if (tm) tm.checked = !useBroker;

            if (!useBroker) {
                // FASE C: le connessioni dati NON si spengono più al cambio modalità.
                // Alpaca/Finnhub/Capital restano feed CONCORRENTI (multi-dashboard):
                // qui cambia solo il contesto operativo, non le sorgenti dati.
                syncAlpacaOrders(); // svuota la UI ordini in attesa (vista non-broker)
                // In Fase C, le connessioni dati sono indipendenti dai tab.
                // Il cambio tab NON forza l'attivazione della connessione.
                if (sidebarFinnhubToggle) {
                    sidebarFinnhubToggle.disabled = false;
                }
                if (bgFinnhubWs) syncFinnhubSubscriptions(); // riallinea se già connesso
                if (sidebarAlpacaToggle) {
                    sidebarAlpacaToggle.disabled = true;
                }
                loadLocalCtxState((typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh');
            } else {
                // BROKER MODE (Alpaca Paper o ALrt): Alpaca è la fonte AUTOREVOLE per
                // conto/posizioni/ordini. FASE C: Finnhub resta connesso come feed per
                // le categorie non coperte da Alpaca (Forex/Materie) — non si spegne.
                if (sidebarFinnhubToggle) sidebarFinnhubToggle.disabled = false;
                if (sidebarAlpacaToggle) sidebarAlpacaToggle.disabled = false;
                // Riallinea le sottoscrizioni FH (stock/crypto passano ad Alpaca)
                syncFinnhubSubscriptions();
                // Azzera lo stato locale di test: posizioni e cronologia saranno ripopolate da Alpaca
                activePositions = {};
                tradeHistory = [];
                tradingCapital = 0;
                sessionInitialCapital = 0;
                portfolioBalance = 0;
                totalPnL = 0;
                executedTrades = 0;
                winTrades = 0;
                grossProfit = 0;
                grossLoss = 0;

                // In Fase C, le connessioni dati sono indipendenti dai tab.
                // Il cambio tab NON forza l'attivazione della connessione.
                if (window.__connAllowed.alp) {
                    if (opts.live) checkAlpacaLiveConnection(); else checkAlpacaConnection();
                    initAlpacaDataWs();
                    initAlpacaCryptoWs();
                    startAlpacaPolling();
                } else {
                    const elStatusALP = document.getElementById('statusALP');
                    const dot = elStatusALP && elStatusALP.querySelector('.status-dot');
                    if (dot) dot.className = 'status-dot';
                }
                // Sincronizza Combo Box / Radar / Bot con gli asset crypto realmente
                // tradabili sul broker attivo (Paper o Reale).
                syncAlpacaCryptoAssets();
                // Sincronizza posizioni e cronologia reali dal broker
                setTimeout(() => {
                    if (useAlpacaBroker) {
                        syncAlpacaPositions();
                        syncAlpacaHistory();
                    }
                }, 1200);
            }
            // Box "Sync.": al cambio scheda broker riparte da 0%; nelle modalità
            // senza sync broker (Finnhub/Capital) il box viene nascosto.
            setSyncProgress(useBroker ? 0 : null);
            updateStatusDots();
            updateTestLabel();
            updateWalletUI();
            updateDashboard();
            renderHistory();
            updateSessionBudgetVisibility();
            if (typeof updateBrokerAssetsUI === 'function') updateBrokerAssetsUI();
            if (typeof window.syncTriSwitchUI === 'function') window.syncTriSwitchUI();
        }
        window.setTradingMode = setTradingMode;

        // --- Interruttore a 3 stadi (header Connessioni Broker) ---
        // 0 = solo Finnhub (Test, denaro virtuale)  → Alpaca Paper e ALrt spenti
        // 1 = solo Alpaca Paper (denaro virtuale)   → Finnhub e ALrt spenti
        // 2 = solo Alpaca Trading reale (ALrt)      → Finnhub e Paper spenti.
        //     Il conto REALE viene sincronizzato (conto/posizioni/ordini/storico,
        //     stessa logica Paper) ma in SOLA LETTURA: NESSUN ordine reale,
        //     il bot automatico viene messo in pausa.
        const brokerTriSwitch = document.getElementById('brokerTriSwitch');

        function updateTriSwitchLabel(stage) {
            const lbl = document.getElementById('testModeLabel');
            if (!lbl) return;
            const cfg = {
                0: { text: '🧪 FH', color: '#f59e0b' },
                1: { text: '📄 ALP', color: '#60a5fa' },
                2: { text: '🔴 ALrt', color: '#f87171' },
                3: { text: '🟢 CAP-D', color: '#34d399' },
                4: { text: '🔴 CAP-L', color: '#f87171' }
            }[stage] || { text: '🧪 FH', color: '#f59e0b' };
            lbl.textContent = cfg.text;
            lbl.style.color = cfg.color;
            // Tiene allineata la scheda broker attiva (dashboard per-broker)
            if (typeof window.syncBrokerTabsUI === 'function') window.syncBrokerTabsUI(stage);
        }

        // ─── Schede Broker (una dashboard per broker service) ───
        // Le schede sopra la dashboard sono un secondo modo di cambiare broker:
        // stessa logica del selettore a 5 stadi (applyBrokerSwitch), UI sincronizzata.
        (function initBrokerTabs() {
            const tabs = document.querySelectorAll('#brokerTabs .broker-tab');
            if (!tabs.length) return;
            tabs.forEach(t => t.addEventListener('click', () => applyBrokerSwitch(t.dataset.stage)));
            window.syncBrokerTabsUI = function (stage) {
                tabs.forEach(t => t.classList.toggle('active', String(stage) === String(t.dataset.stage)));
                // Mostra il pulsante Flush solo se siamo su Finnhub (stage 0)
                const btnFlush = document.getElementById('btnFlushCapital');
                if (btnFlush) {
                    btnFlush.style.display = (String(stage) === '0') ? 'inline-block' : 'none';
                }
            };
            // FASE D1: puntino verde sulle schede con bot ATTIVO (memoria per scheda)
            const STAGE_CTX = { 0: 'fh', 1: 'alp', 2: 'alrt', 3: 'capd', 4: 'capl' };
            window.updateTabBotDots = function () {
                const curCtx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
                tabs.forEach(t => {
                    const ctx = STAGE_CTX[t.dataset.stage];
                    const on = (ctx === curCtx) ? isBotActive : !!botActiveByCtx[ctx];
                    let dot = t.querySelector('.bot-dot');
                    if (on && !dot) {
                        dot = document.createElement('span');
                        dot.className = 'bot-dot';
                        dot.title = 'Bot attivo su questa scheda';
                        t.appendChild(dot);
                    } else if (!on && dot) {
                        dot.remove();
                    }
                });
            };
        })();

        // ─── Interruttori di CONNESSIONE per broker (leva sotto il LED) ───
        // Ogni leva attiva/disattiva il COLLEGAMENTO/SYNC dati col suo broker (feed
        // prezzi + sync conto), NON il bot: il trading automatico si avvia col
        // pulsante ON/OFF del bot sulla scheda del broker.
        (function initConnToggles() {
            const CTX_INPUT = { fh: 'armFH', alp: 'armALP', alrt: 'armALrt', capd: 'armCAPD', capl: 'armCAPL' };
            const inputs = {};
            for (const ctx in CTX_INPUT) {
                const el = document.getElementById(CTX_INPUT[ctx]);
                if (el) inputs[ctx] = el;
            }
            if (!Object.keys(inputs).length) return;
            // Stato "voluto" per i collegamenti senza indicatore diretto
            window.__connWanted = { alrt: false, capl: false };
            window.syncConnToggles = function () {
                try {
                    if (inputs.fh) inputs.fh.checked = !!bgFinnhubWs;
                    if (inputs.alp) inputs.alp.checked = !!(bgAlpacaWs || bgAlpacaCryptoWs || alpacaPollingInterval);
                    if (inputs.alrt) inputs.alrt.checked = !!window.__connWanted.alrt;
                    if (inputs.capd) inputs.capd.checked = !!capitalPollingInterval;
                    if (inputs.capl) inputs.capl.checked = !!window.__connWanted.capl;
                } catch (e) { /* variabili feed non ancora inizializzate (startup) */ }
            };
            const revert = (ctx) => { setTimeout(window.syncConnToggles, 150); };
            // All'avvio di una connessione broker mostra SUBITO la sua scheda
            // (dashboard): chi collega un broker si aspetta di vederne i dati.
            // Per i conti REALI (ALrt/CAPrt) resta la conferma di applyBrokerSwitch.
            const CTX_STAGE = { fh: 0, alp: 1, alrt: 2, capd: 3, capl: 4 };
            const showBrokerTab = (ctx) => {
                const cur = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
                if (cur === ctx) return; // già sulla scheda di questo broker
                applyBrokerSwitch(CTX_STAGE[ctx]);
            };
            const handlers = {
                fh: (on) => {
                    window.__connAllowed.fh = on;
                    if (on) {
                        if (!finnhubApiKey) { window.__connAllowed.fh = false; showNotification('Configura la chiave Finnhub per collegare il feed.', 'error'); const m = document.getElementById('apiModal'); if (m) m.classList.remove('hidden'); return revert('fh'); }
                        useFinnhubData = true;
                        localStorage.setItem('sim_use_finnhub', 'true');
                        initBackgroundConnections();
                        showNotification('Feed Finnhub collegato.', 'success');
                        showBrokerTab('fh');
                    } else {
                        useFinnhubData = false;
                        localStorage.setItem('sim_use_finnhub', 'false');
                        closeWsGracefully(bgFinnhubWs);
                        bgFinnhubWs = null;
                        activeFinnhubSubs.clear();
                        const dot = statusFH && statusFH.querySelector('.status-dot');
                        if (dot) dot.className = 'status-dot';
                        showNotification('Feed Finnhub scollegato.', 'info');
                    }
                },
                alp: (on) => {
                    window.__connAllowed.alp = on;
                    if (on) {
                        if (!alpacaKeyId || !alpacaSecretKey) { window.__connAllowed.alp = false; showNotification('Configura le API Key di Alpaca Paper per collegare il feed.', 'error'); const m = document.getElementById('alpacaModal'); if (m) m.classList.remove('hidden'); return revert('alp'); }
                        initAlpacaDataWs();
                        initAlpacaCryptoWs();
                        startAlpacaPolling();
                        checkAlpacaConnection();
                        showNotification('Collegamento Alpaca attivo (dati + sync conto).', 'success');
                        showBrokerTab('alp');
                    } else {
                        if (bgAlpacaWs) { try { bgAlpacaWs.close(); } catch (_) { } bgAlpacaWs = null; }
                        if (bgAlpacaCryptoWs) { try { bgAlpacaCryptoWs.close(); } catch (_) { } bgAlpacaCryptoWs = null; }
                        if (alpacaPollingInterval) { clearInterval(alpacaPollingInterval); alpacaPollingInterval = null; }
                        alpacaDataAuthenticated = false;
                        showNotification('Collegamento Alpaca scollegato.', 'info');
                    }
                    // Le sottoscrizioni FH si riallineano alla nuova copertura
                    try { syncFinnhubSubscriptions(); } catch (_) { }
                },
                alrt: (on) => {
                    if (on && (!alpacaLiveKeyId || !alpacaLiveSecretKey)) { showNotification('Configura le chiavi Alpaca REALI per collegare il monitor ALrt.', 'error'); const m = document.getElementById('alpacaLiveModal'); if (m) m.classList.remove('hidden'); return revert('alrt'); }
                    window.__connWanted.alrt = on;
                    if (on) { checkAlpacaLiveConnection(); showNotification('Monitor conto Alpaca REALE collegato.', 'success'); showBrokerTab('alrt'); }
                    else showNotification('Monitor conto Alpaca REALE scollegato.', 'info');
                },
                capd: (on) => {
                    window.__connAllowed.capd = on;
                    if (on) {
                        if (!capDemoKey || !capDemoIdent || !capDemoPass) { window.__connAllowed.capd = false; showNotification('Configura le chiavi Capital.com Demo per collegare il feed.', 'error'); const m = document.getElementById('capitalModal'); if (m) m.classList.remove('hidden'); return revert('capd'); }
                        startCapitalPolling();
                        showNotification('Feed Capital.com Demo collegato.', 'success');
                        showBrokerTab('capd');
                    } else {
                        stopCapitalPolling();
                        showNotification('Feed Capital.com Demo scollegato.', 'info');
                    }
                },
                capl: (on) => {
                    if (on && (!capLiveKey || !capLiveIdent || !capLivePass)) { showNotification('Configura le chiavi Capital.com (reale) per collegare il conto.', 'error'); const m = document.getElementById('capitalLiveModal'); if (m) m.classList.remove('hidden'); return revert('capl'); }
                    window.__connWanted.capl = on;
                    showNotification(on ? 'Conto Capital.com REALE collegato (monitoraggio).' : 'Conto Capital.com REALE scollegato.', on ? 'success' : 'info');
                    if (on) showBrokerTab('capl');
                }
            };
            for (const ctx in inputs) {
                inputs[ctx].addEventListener('change', (e) => {
                    try { handlers[ctx](e.target.checked); } catch (err) { console.warn('[CONN]', ctx, err); }
                    setTimeout(window.syncConnToggles, 300);
                });
            }
            // Primo allineamento DIFFERITO: le variabili dei feed (bgAlpacaWs,
            // capitalPollingInterval, ...) sono dichiarate più avanti nel closure
            // (TDZ); al timeout l'init è completo (il try/catch resta come rete).
            setTimeout(window.syncConnToggles, 0);
            // Riallinea periodicamente lo stato delle leve alle connessioni reali
            setInterval(window.syncConnToggles, 3000);
        })();

        function applyBrokerSwitch(stage) {
            stage = Math.max(0, Math.min(4, parseInt(stage, 10) || 0));

            // FASE B: contesto di partenza. Lo snapshot va salvato SUBITO, prima di
            // qualunque side-effect: setTradingMode(false) resetta il wallet locale a
            // $1000 e salvare dopo distruggerebbe lo stato del contesto lasciato.
            const prevCtx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
            saveLocalCtxState(prevCtx);

            const prevStage = prevCtx === 'capl' ? 4 : prevCtx === 'capd' ? 3 : prevCtx === 'alrt' ? 2 : prevCtx === 'alp' ? 1 : 0;

            if (stage === 3) {
                // Capital.com Demo: servono email + API Key + password della API Key
                if (!capDemoKey || !capDemoIdent || !capDemoPass) {
                    showNotification('Configura email, API Key e password della API Key di Capital.com Demo per attivare questo broker.', 'error');
                    const mdl = document.getElementById('capitalModal');
                    if (mdl) mdl.classList.remove('hidden');
                    stage = prevStage;
                } else {
                    window.capitalMode = 'demo';
                    setTradingMode(false, { skipFinnhub: true });
                    const el = document.getElementById('armCAPD');
                    if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change')); }
                    if (typeof window.refreshCategoryAvailability === 'function') window.refreshCategoryAvailability();
                    showNotification('🟢 Capital.com Demo attivo: dati reali Forex/Materie Prime dal tuo conto demo. In questa versione gli ordini del bot sono simulati localmente (routing ordini su Capital.com in arrivo).', 'info');
                }
            } else if (stage === 4) {
                // Capital.com Trading REALE
                if (!capLiveKey || !capLiveIdent || !capLivePass) {
                    showNotification('Configura email, API Key e password della API Key di Capital.com (reale) per attivare questo broker.', 'error');
                    const mdl = document.getElementById('capitalLiveModal');
                    if (mdl) mdl.classList.remove('hidden');
                    stage = prevStage;
                } else {
                    updateTriSwitchLabel(4);
                    setTimeout(() => {
                        if (!confirm('⚠️ CONTO REALE CAPITAL.COM\n\nStai per collegare il conto Capital.com REALE.\nIn questa versione il conto è in MONITORAGGIO (dati e saldo): gli ordini del bot restano simulati localmente e NON vengono inviati a Capital.com.\n\nVuoi continuare?')) {
                            showNotification('Collegamento conto reale Capital.com annullato: mantengo la selezione precedente.', 'info');
                            if (brokerTriSwitch) brokerTriSwitch.value = String(prevStage);
                            updateTriSwitchLabel(prevStage);
                            return;
                        }
                        window.capitalMode = 'live';
                        setTradingMode(false, { skipFinnhub: true });
                        const el = document.getElementById('armCAPL');
                        if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change')); }
                        if (typeof window.refreshCategoryAvailability === 'function') window.refreshCategoryAvailability();
                        if (brokerTriSwitch) brokerTriSwitch.value = '4';
                        updateTriSwitchLabel(4);
                        showNotification('🔴 Capital.com REALE collegato in monitoraggio: dati e saldo dal conto reale. Ordini del bot simulati localmente in questa versione.', 'warning');
                        handleCtxTransition(prevCtx); // FASE B: carica il portafoglio capl
                    }, 0);
                    return; // esce subito dal gestore 'change'
                }
            } else if (stage === 0) {
                if (window.capitalMode !== 'off') window.capitalMode = 'off';
                setTradingMode(false);
                const el = document.getElementById('armFH');
                if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change')); }
                if (typeof window.refreshCategoryAvailability === 'function') window.refreshCategoryAvailability();
                // Senza chiave Finnhub in FH non arrivano dati: avvisa e apri il modale.
                if (!finnhubApiKey) {
                    showNotification(tr('finnhub_key_required',
                        'Configura la chiave Finnhub per ricevere i dati in modalità Test (FH).'), 'error');
                    const mdl = document.getElementById('apiModal');
                    if (mdl) mdl.classList.remove('hidden');
                }
            } else if (stage === 1) {
                // Solo Alpaca Paper: servono le chiavi paper
                if (!alpacaKeyId || !alpacaSecretKey) {
                    showNotification(tr('paper_keys_required',
                        'Configura le API Key di Alpaca Paper per attivare questo broker.'), 'error');
                    const mdl = document.getElementById('alpacaModal');
                    if (mdl) mdl.classList.remove('hidden');
                    stage = prevStage;
                } else {
                    if (window.capitalMode !== 'off') window.capitalMode = 'off';
                    setTradingMode(true); // spegne Finnhub, accende Paper
                    const el = document.getElementById('armALP');
                    if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change')); }
                    if (typeof window.refreshCategoryAvailability === 'function') window.refreshCategoryAvailability();
                }
            } else if (stage === 2) {
                // ALrt: conto Alpaca REALE — trading OPERATIVO (denaro reale).
                // Stessa logica di Alpaca Paper, ma su api.alpaca.markets con chiavi live.
                if (!alpacaLiveKeyId || !alpacaLiveSecretKey) {
                    // Servono le chiavi REALI: senza, si torna a FH e si apre il modale chiavi live.
                    showNotification(tr('alrt_keys_required',
                        'Inserisci le chiavi Alpaca REALI (Live) per operare in modalità conto reale.'), 'error');
                    const mdl = document.getElementById('alpacaLiveModal');
                    if (mdl) mdl.classList.remove('hidden');
                    stage = prevStage;
                } else {
                    // Conferma + attivazione DEFERITE fuori dal gestore 'change': il confirm()
                    // è bloccante e dentro l'handler causa "[Violation] 'change' handler took Xms".
                    // Il setTimeout esce subito dal gestore; dialog e setup girano dopo.
                    updateTriSwitchLabel(2); // mostra subito ALrt sull'interruttore
                    setTimeout(() => {
                        if (!confirm('⚠️ TRADING REALE\n\nStai per attivare la modalità conto REALE Alpaca (ALrt).\nDa questo momento gli ordini del bot e quelli manuali useranno DENARO REALE sul tuo conto Alpaca Live.\n\nVuoi continuare?')) {
                            // Annullato: torna alla modalità precedente.
                            showNotification(tr('alrt_cancelled',
                                'Attivazione conto reale annullata: mantengo la selezione precedente.'), 'info');
                            if (brokerTriSwitch) brokerTriSwitch.value = String(prevStage);
                            updateTriSwitchLabel(prevStage);
                            return;
                        }
                        if (window.capitalMode !== 'off') window.capitalMode = 'off';
                        // Attiva il conto REALE operativo riusando lo STESSO percorso di Alpaca
                        // Paper; getBrokerHttp() instrada su api.alpaca.markets con le chiavi live.
                        // liveMonitorActive va impostato PRIMA del setup.
                        window.liveMonitorActive = true;
                        setTradingMode(true, { live: true });
                        const el = document.getElementById('armALrt');
                        if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change')); }
                        if (typeof window.refreshCategoryAvailability === 'function') window.refreshCategoryAvailability();
                        if (brokerTriSwitch) brokerTriSwitch.value = '2';
                        updateTriSwitchLabel(2);
                        showNotification(tr('alrt_live_trading',
                            '🔴 Modalità ALrt attiva: conto REALE. Gli ordini useranno denaro reale.'), 'warning');
                        updateStatusDots();
                        checkAlpacaLiveConnection();
                        handleCtxTransition(prevCtx); // FASE B: salva il contesto locale lasciato
                    }, 0);
                    return; // esce subito dal gestore 'change' (niente [Violation])
                }
            }
            // Riallinea slider + etichetta allo stadio finale (setTradingMode può
            // aver richiamato syncTriSwitchUI prima che liveMonitorActive fosse attivo)
            if (brokerTriSwitch) brokerTriSwitch.value = String(stage);
            updateTriSwitchLabel(stage);
            checkAlpacaLiveConnection();
            // FASE B: salva lo stato del contesto precedente e carica quello nuovo
            handleCtxTransition(prevCtx);
        }

        if (brokerTriSwitch) {
            brokerTriSwitch.value = '0'; // l'app parte SEMPRE in modalità Test (FH)
            updateTriSwitchLabel(0);
            brokerTriSwitch.addEventListener('change', () => applyBrokerSwitch(brokerTriSwitch.value));
            brokerTriSwitch.addEventListener('input', () => updateTriSwitchLabel(parseInt(brokerTriSwitch.value, 10)));
        }

        // Sincronizza l'interruttore quando la modalità cambia da altri percorsi
        // (es. toggle nascosti di compatibilità, attivazione da modale chiavi)
        window.syncTriSwitchUI = function () {
            if (!brokerTriSwitch) return;
            const stage = window.capitalMode === 'demo' ? 3
                : window.capitalMode === 'live' ? 4
                    : window.liveMonitorActive ? 2 : (useAlpacaBroker ? 1 : 0);
            brokerTriSwitch.value = String(stage);
            updateTriSwitchLabel(stage);
        };

        // --- Toggle Modalità Test nascosto (compatibilità con logica esistente) ---
        const testModeToggle = document.getElementById('testModeToggle');
        if (testModeToggle) {
            testModeToggle.checked = !useAlpacaBroker;
            updateTestLabel();
        }

        // Sincronizzazione UI iniziale
        if (typeof updateAllTogglesUI === 'function') updateAllTogglesUI();
        updateStatusDots();
        updateDashboard();
        updateWalletUI();
        renderHistory();
        updateBotStatusLabel();

        // Se un broker è attivo, forziamo activePositions a vuoto all'avvio 
        // finché il primo sync non le popola, per evitare dati locali obsoleti.
        if (useAlpacaBroker) {
            console.log("[INIT] Broker attivo rilevato. Ignoro posizioni locali per sincronizzazione pulita.");
            activePositions = {};
        }

        // Pulizia Dust all'avvio
        for (let sym in activePositions) {
            const pos = activePositions[sym];
            const currentPrice = getLivePriceFor(sym) || pos.entryPrice;
            if (pos.amount * currentPrice < 1.0) {
                console.warn(`[STARTUP] Rimosso dust asset: ${sym}`);
                delete activePositions[sym];
            }
        }

        // --- Session Timer persistence ---
        // Il timer di sessione parte sempre da 0 all'apertura/refresh dell'app
        let sessionElapsedSeconds = 0;

        const maxPosSlider = document.getElementById('maxPosSlider');
        const maxPosValue = document.getElementById('maxPosValue');

        // Session Budget Logic (sessionBudgetUsed è globale, vedi dichiarazione in cima)
        const sessionBudgetInput = document.getElementById('sessionBudgetInput');
        const sessionBudgetStatus = document.getElementById('sessionBudgetStatus');
        const sessionBudgetBar = document.getElementById('sessionBudgetBar');
        const sessionBudgetBarFill = document.getElementById('sessionBudgetBarFill');
        const btnResetBudget = document.getElementById('btnResetBudget');

        function getSessionBudgetLimit() {
            // Il budget sessione è attivo SOLO in modalità test
            if (useAlpacaBroker || window.liveMonitorActive) return 0;
            return sessionBudgetInput ? parseFloat(sessionBudgetInput.value) || 0 : 0;
        }

        function updateSessionBudgetVisibility() {
            const container = document.getElementById('sessionBudgetContainer');
            if (!container) return;
            container.style.display = (useAlpacaBroker || window.liveMonitorActive) ? 'none' : '';
        }

        function updateSessionBudgetUI() {
            const limit = getSessionBudgetLimit();
            if (!sessionBudgetStatus) return;
            if (limit <= 0) {
                sessionBudgetStatus.textContent = tr('unlimited', 'Illimitato');
                if (sessionBudgetBar) sessionBudgetBar.style.display = 'none';
                return;
            }
            const remaining = Math.max(0, limit - sessionBudgetUsed);
            const pct = Math.min(100, (sessionBudgetUsed / limit) * 100);
            sessionBudgetStatus.textContent = `$${sessionBudgetUsed.toFixed(0)} / $${limit.toFixed(0)}`;
            if (sessionBudgetBar) sessionBudgetBar.style.display = 'block';
            if (sessionBudgetBarFill) {
                sessionBudgetBarFill.style.width = pct + '%';
                sessionBudgetBarFill.style.background = pct < 60 ? '#10b981' : pct < 85 ? '#f59e0b' : '#ef4444';
            }
            if (remaining <= 0) {
                sessionBudgetStatus.style.color = '#ef4444';
            } else {
                sessionBudgetStatus.style.color = '#f59e0b';
            }
        }

        if (btnResetBudget) {
            btnResetBudget.addEventListener('click', () => {
                sessionBudgetUsed = 0;
                updateSessionBudgetUI();
                showNotification('Budget sessione azzerato.', 'info');
            });
        }
        if (sessionBudgetInput) {
            // Ripristina il budget scelto nella sessione precedente (altrimenti resta il default HTML)
            const savedBudget = localStorage.getItem('sim_session_budget');
            if (savedBudget !== null) sessionBudgetInput.value = savedBudget;
            sessionBudgetInput.addEventListener('input', () => {
                localStorage.setItem('sim_session_budget', sessionBudgetInput.value);
                updateSessionBudgetUI();
                updateWalletUI(); // ricalcola subito la stima ordine sul nuovo budget
            });
        }
        // Stima ordine e barra budget coerenti col valore ripristinato fin dall'avvio
        updateSessionBudgetUI();
        updateWalletUI();

        // Audio Management

        // Volume applicazione (0–100, pannello Impostazioni). Tutti i suoni
        // passano da un master gain per contesto; il keep-alive silenzioso
        // resta collegato direttamente (non deve dipendere dal volume).
        let appVolume = parseInt(localStorage.getItem('sim_app_volume'), 10);
        if (!isFinite(appVolume) || appVolume < 0 || appVolume > 100) appVolume = 100;

        const masterGains = new Map(); // AudioContext → GainNode master
        function getAudioOut(ctx) {
            if (!ctx) return null;
            let g = masterGains.get(ctx);
            if (!g) {
                try {
                    g = ctx.createGain();
                    g.gain.value = appVolume / 100;
                    g.connect(ctx.destination);
                    masterGains.set(ctx, g);
                } catch (e) { return ctx.destination; }
            }
            return g;
        }
        function setAppVolume(v) {
            appVolume = Math.max(0, Math.min(100, Math.round(v) || 0));
            localStorage.setItem('sim_app_volume', String(appVolume));
            masterGains.forEach(g => { try { g.gain.value = appVolume / 100; } catch (e) { } });
        }

        // Pannello Impostazioni (ingranaggio nella barra superiore)
        const btnAppSettings = document.getElementById('btnAppSettings');
        const appSettingsPanel = document.getElementById('appSettingsPanel');
        const appVolumeSlider = document.getElementById('appVolumeSlider');
        const appVolumeValue = document.getElementById('appVolumeValue');

        if (appVolumeSlider) {
            appVolumeSlider.value = String(appVolume);
            if (appVolumeValue) appVolumeValue.textContent = appVolume + '%';
            appVolumeSlider.addEventListener('input', () => {
                setAppVolume(parseInt(appVolumeSlider.value, 10));
                if (appVolumeValue) appVolumeValue.textContent = appVolume + '%';
            });
            // Feedback sonoro al rilascio dello slider
            appVolumeSlider.addEventListener('change', () => { if (isSoundEnabled) playCashSound(); });
        }

        if (btnAppSettings && appSettingsPanel) {
            btnAppSettings.addEventListener('click', (e) => {
                e.stopPropagation();
                appSettingsPanel.classList.toggle('hidden');
            });
            // Click fuori dal pannello: chiudi
            document.addEventListener('click', (e) => {
                if (!appSettingsPanel.classList.contains('hidden') &&
                    !appSettingsPanel.contains(e.target) && e.target !== btnAppSettings) {
                    appSettingsPanel.classList.add('hidden');
                }
            });
        }

        const btnToggleSound = document.getElementById('btnToggleSound');
        const soundIcon = document.getElementById('soundIcon');

        function updateSoundUI() {
            if (soundIcon) soundIcon.textContent = isSoundEnabled ? '🔊' : '🔇';
            localStorage.setItem('sim_sound_enabled', isSoundEnabled);
            console.log("Audio: Stato audio cambiato in", isSoundEnabled ? "ATTIVO" : "DISATTIVATO");
        }

        if (btnToggleSound) {
            btnToggleSound.addEventListener('click', () => {
                isSoundEnabled = !isSoundEnabled;
                updateSoundUI();
                if (isSoundEnabled) {
                    playCashSound(); // Test immediato del suono sintetico
                }
            });
            updateSoundUI();
        }

        // --- Silenzia Notifiche ---
        const chkMuteNotif = document.getElementById('chkMuteNotifications');
        window.__muteNotifications = localStorage.getItem('sim_mute_notifications') === 'true';
        if (chkMuteNotif) {
            chkMuteNotif.checked = window.__muteNotifications;
            chkMuteNotif.addEventListener('change', () => {
                window.__muteNotifications = chkMuteNotif.checked;
                localStorage.setItem('sim_mute_notifications', chkMuteNotif.checked);
            });
        }

        function playCashSound() {
            if (!isSoundEnabled || !keepAliveAudioCtx) return;
            const doPlay = () => {
                try {
                    const ctx = keepAliveAudioCtx;
                    if (ctx.state !== 'running') return;

                    // Suono di Guadagno (Arpeggio Maggiore ascendente felice)
                    const notes = [523.25, 659.25, 783.99, 1046.50];
                    notes.forEach((freq, i) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
                        gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.1);
                        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.1 + 0.2);
                        osc.connect(gain);
                        gain.connect(getAudioOut(ctx));
                        osc.start(ctx.currentTime + i * 0.1);
                        osc.stop(ctx.currentTime + i * 0.1 + 0.2);
                    });
                } catch (e) { /* Silenzioso */ }
            };
            if (keepAliveAudioCtx.state === 'suspended') {
                keepAliveAudioCtx.resume().then(doPlay).catch(() => { });
            } else {
                doPlay();
            }
        }

        function playLossSound() {
            if (!isSoundEnabled || !keepAliveAudioCtx) return;
            const doPlay = () => {
                try {
                    const ctx = keepAliveAudioCtx;
                    if (ctx.state !== 'running') return;

                    // Suono di Perdita (Dissonante discendente)
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(300, ctx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.6);
                    gain.gain.setValueAtTime(0.15, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
                    osc.connect(gain);
                    gain.connect(getAudioOut(ctx));
                    osc.start();
                    osc.stop(ctx.currentTime + 0.6);

                    const osc2 = ctx.createOscillator();
                    const gain2 = ctx.createGain();
                    osc2.type = 'sawtooth';
                    osc2.frequency.setValueAtTime(280, ctx.currentTime);
                    osc2.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.6);
                    gain2.gain.setValueAtTime(0.1, ctx.currentTime);
                    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
                    osc2.connect(gain2);
                    gain2.connect(getAudioOut(ctx));
                    osc2.start();
                    osc2.stop(ctx.currentTime + 0.6);
                } catch (e) { /* Silenzioso */ }
            };
            if (keepAliveAudioCtx.state === 'suspended') {
                keepAliveAudioCtx.resume().then(doPlay).catch(() => { });
            } else {
                doPlay();
            }
        }

        function playOpenSound() {
            if (!isSoundEnabled || !keepAliveAudioCtx) return;
            const doPlay = () => {
                try {
                    const ctx = keepAliveAudioCtx;
                    if (ctx.state !== 'running') return;
                    // Suono di Apertura Posizione (Accordo di Quinta)
                    const osc1 = ctx.createOscillator();
                    const gain1 = ctx.createGain();
                    osc1.type = 'sine';
                    osc1.frequency.setValueAtTime(523.25, ctx.currentTime);
                    gain1.gain.setValueAtTime(0.1, ctx.currentTime);
                    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
                    osc1.connect(gain1);
                    gain1.connect(getAudioOut(ctx));
                    osc1.start();
                    osc1.stop(ctx.currentTime + 0.2);

                    const osc2 = ctx.createOscillator();
                    const gain2 = ctx.createGain();
                    osc2.type = 'sine';
                    osc2.frequency.setValueAtTime(783.99, ctx.currentTime + 0.05);
                    gain2.gain.setValueAtTime(0.1, ctx.currentTime + 0.05);
                    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
                    osc2.connect(gain2);
                    gain2.connect(getAudioOut(ctx));
                    osc2.start(ctx.currentTime + 0.05);
                    osc2.stop(ctx.currentTime + 0.3);
                } catch (e) { }
            };
            if (keepAliveAudioCtx.state === 'suspended') {
                keepAliveAudioCtx.resume().then(doPlay).catch(() => { });
            } else {
                doPlay();
            }
        }

        function updateMaxPositions(val) {
            maxPositionsLimit = parseInt(val);
            localStorage.setItem('sim_max_positions', maxPositionsLimit);
            if (maxPosValue) maxPosValue.textContent = maxPositionsLimit;
            if (maxPosSlider) maxPosSlider.value = maxPositionsLimit;
            console.log("Config: Nuovo limite posizioni =", maxPositionsLimit);
        }

        if (maxPosSlider) {
            maxPosSlider.addEventListener('input', (e) => updateMaxPositions(e.target.value));
            // Sync initial UI
            updateMaxPositions(maxPositionsLimit);
        }

        function getInvestUsd() {
            const val = investAmountInput ? parseFloat(investAmountInput.value) : 1;
            const pct = Math.min(Math.max(val || 1, 0.1), 100);

            let base = 0;
            if (useAlpacaBroker && availableMargin > 0) {
                base = availableMargin;
            } else {
                // Modalità Test: usa il capitale locale corrente (anche se è 0)
                base = tradingCapital;
                // Se è impostato un budget di sessione, la stima ordine si calcola su quello
                const budgetEl = document.getElementById('sessionBudgetInput');
                const budgetLimit = budgetEl ? parseFloat(budgetEl.value) || 0 : 0;
                if (budgetLimit > 0) base = Math.min(budgetLimit, base);
            }

            let invest = base * (pct / 100);
            // Alpaca (Broker) e crypto/fractional richiedono tipicamente un ordine minimo di 10$ di controvalore
            // Alziamo il limite minimo hardcoded da 5 a 10 se ci sono almeno 10$ disponibili.
            if (invest < 10 && base >= 10) invest = 10;

            return invest;
        }

        // Sync slider -> hidden input -> UI
        function setInvestPct(pct) {
            pct = Math.min(Math.max(Math.round(pct), 1), 100);
            if (investAmountInput) investAmountInput.value = pct;
            if (investSlider) investSlider.value = pct;
            if (investPctLabel) investPctLabel.textContent = pct + '%';
            // Update chip active state
            document.querySelectorAll('.invest-chip').forEach(c => {
                c.classList.toggle('active', parseInt(c.dataset.pct) === pct);
            });
            updateWalletUI();
        }

        // Slider events
        if (investSlider) {
            investSlider.addEventListener('input', () => setInvestPct(parseInt(investSlider.value)));
        }

        // Chip preset buttons
        document.querySelectorAll('.invest-chip').forEach(btn => {
            btn.addEventListener('click', () => setInvestPct(parseInt(btn.dataset.pct)));
        });

        // Forza inizializzazione a 1% come richiesto
        setInvestPct(10); // default consigliato: 10% del capitale per trade


        function getBrokerCtx() {
            // FASE D2: durante l'esecuzione di un motore in background il contesto
            // "corrente" è quello del motore (ledger/persistenza instradati giusti)
            if (window.__ctxOverride) return window.__ctxOverride;
            if (window.capitalMode === 'demo') return 'capd';
            if (window.capitalMode === 'live') return 'capl';
            if (window.liveMonitorActive) return 'alrt';
            if (useAlpacaBroker) return 'alp';
            return 'fh';
        }
        window.getBrokerCtx = getBrokerCtx;
        function getDepositedTotal(ctx, currentEquity) {
            const key = 'broker_deposited_' + ctx;
            let v = parseFloat(localStorage.getItem(key));
            if (!v || isNaN(v) || v <= 0) {
                // Prima osservazione per questo broker: baseline dei versamenti.
                // Contesti locali (fh/capd/capl, wallet simulato): 1000 di default.
                // Broker reali (alp/alrt): equity al primo collegamento = capitale
                // "caricato" all'apertura del portafoglio.
                const isLocalCtx = (ctx === 'fh' || ctx === 'capd' || ctx === 'capl');
                v = isLocalCtx ? 1000 : (currentEquity > 0 ? currentEquity : 0);
                if (v > 0) localStorage.setItem(key, String(v));
            }
            return v;
        }
        window.addToDepositLedger = function (amount) {
            const key = 'broker_deposited_' + getBrokerCtx();
            const cur = parseFloat(localStorage.getItem(key)) || 0;
            const amt = parseFloat(amount) || 0;
            if (amt > 0) localStorage.setItem(key, String(cur + amt));
        };
        // Registro del P&L REALIZZATO lifetime per contesto: sopravvive ai reset del
        // capitale operativo ($1000 a ogni avvio in test), così "Capitale Attuale"
        // riflette davvero versato + profitti − perdite di TUTTO lo storico.
        window.addToPnlLedger = function (pnl) {
            const key = 'broker_pnl_' + getBrokerCtx();
            const cur = parseFloat(localStorage.getItem(key)) || 0;
            localStorage.setItem(key, String(cur + (parseFloat(pnl) || 0)));
        };
        function getPnlLedger(ctx) { return parseFloat(localStorage.getItem('broker_pnl_' + ctx)) || 0; }
        function updateCapitalHistoryBoxes(currentEquity, unrealizedNow) {
            const ctx = getBrokerCtx();
            const dep = getDepositedTotal(ctx, currentEquity);
            const attuale = currentEquity;
            const depEl = document.getElementById('depositedTotal');
            const valEl = document.getElementById('currentCapitalVal');
            const dltEl = document.getElementById('currentCapitalDelta');
            if (depEl) depEl.textContent = formatMoney(dep);
            if (valEl) valEl.textContent = formatMoney(attuale);
            if (dltEl) {
                if (dep > 0) {
                    const diff = typeof globalTotalRealizedPnL !== 'undefined' ? globalTotalRealizedPnL : (attuale - dep);
                    dltEl.textContent = `${diff >= 0 ? '▲ +' : '▼ '}${formatMoney(diff)}`;
                    dltEl.style.color = diff >= 0 ? '#10b981' : '#ef4444';
                    if (valEl) valEl.style.color = diff >= 0 ? '#10b981' : '#ef4444';
                } else {
                    dltEl.textContent = '';
                }
            }
        }
        window.updateCapitalHistoryBoxes = updateCapitalHistoryBoxes;

        var lastWalletUITime = 0;
        function updateWalletUI(force = false) {
            if (window.__ctxOverride) return;
            const now = Date.now();
            if (!force && now - lastWalletUITime < 500) return; // Throttle a max 2 update al sec
            lastWalletUITime = now;
            // Calcola valore corrente posizioni aperte (mark-to-market)
            let investedTotal = 0;
            let unrealizedTotal = 0;
            for (let s in activePositions) {
                const p = activePositions[s];
                investedTotal += p.invested;
                const livePrice = getLivePriceFor(s) || p.entryPrice;
                const unreal = p.type === 'LONG'
                    ? (livePrice - p.entryPrice) * p.amount
                    : (p.entryPrice - livePrice) * p.amount;
                unrealizedTotal += unreal;
            }

            // Aggiornamento anteprima investimento per la UI (per entrambe le modalità)
            const investUsdPreview = getInvestUsd();
            if (investPreviewAmtEl) investPreviewAmtEl.textContent = formatMoney(investUsdPreview);
            if (investPctLabel && investAmountInput) investPctLabel.textContent = (investAmountInput.value || 25) + '%';

            // Aggiorna badge modalità (sempre, in entrambe le modalità)
            const _syncBroker = document.getElementById('syncBadgeBroker');
            const _syncTest = document.getElementById('syncBadgeTest');
            const _syncContainer = document.getElementById('syncBadgeContainer');
            const _testBadge = document.getElementById('testModeBadge');
            if (_testBadge) {
                if (window.liveMonitorActive) {
                    // Modalità ALrt: badge rosso "Real Trading" (niente label TEST)
                    _testBadge.textContent = 'Real Trading';
                    _testBadge.style.display = 'inline';
                    _testBadge.style.background = '#ef444422';
                    _testBadge.style.color = '#f87171';
                    _testBadge.style.borderColor = '#ef444466';
                } else {
                    // Modalità Finnhub e Alpaca Paper: label Virtual (denaro virtuale)
                    _testBadge.textContent = 'Virtual';
                    _testBadge.style.display = 'inline';
                    _testBadge.style.background = '#f59e0b22';
                    _testBadge.style.color = '#f59e0b';
                    _testBadge.style.borderColor = '#f59e0b66';
                }
            }
            if (_syncBroker && _syncTest && _syncContainer) {
                const _brokerish = brokerViewActive();
                _syncContainer.style.background = window.liveMonitorActive ? 'rgba(239,68,68,0.08)'
                    : (useAlpacaBroker ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)');
                _syncContainer.style.border = window.liveMonitorActive ? '1px solid rgba(239,68,68,0.2)'
                    : (useAlpacaBroker ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(245,158,11,0.2)');
                _syncBroker.style.display = _brokerish ? 'inline' : 'none';
                _syncBroker.style.color = window.liveMonitorActive ? '#f87171' : '#3b82f6';
                _syncTest.style.display = _brokerish ? 'none' : 'inline';
            }

            // --- MODALITÀ TEST (locale, solo Finnhub) ---
            if (!brokerViewActive()) {
                // Equity = cash disponibile + posizioni aperte + PnL non realizzato
                const testEquity = tradingCapital + investedTotal + unrealizedTotal;
                const $ = id => document.getElementById(id);
                if (document.getElementById('tradingCapital')) document.getElementById('tradingCapital').textContent = formatMoney(testEquity);
                if (document.getElementById('initialCapital')) document.getElementById('initialCapital').textContent = formatMoney(sessionInitialCapital);
                if (document.getElementById('walletBalanceSide')) document.getElementById('walletBalanceSide').textContent = formatMoney(tradingCapital);
                // Header: SOMMA degli equity di tutti i broker (multi-dashboard)
                if (typeof updateGlobalPortfolioHeader === 'function') updateGlobalPortfolioHeader();
                if (document.getElementById('availableMargin')) document.getElementById('availableMargin').textContent = formatMoney(tradingCapital);
                if (document.getElementById('totalInvested')) document.getElementById('totalInvested').textContent = formatMoney(investedTotal + unrealizedTotal);

                const realizedPnl = globalTotalRealizedPnL;
                if (document.getElementById('sessionRevenue')) {
                    document.getElementById('sessionRevenue').textContent = `${realizedPnl >= 0 ? '+' : ''}${formatMoney(realizedPnl)}`;
                    document.getElementById('sessionRevenue').style.color = realizedPnl >= 0 ? '#10b981' : '#ef4444';
                }
                if (document.getElementById('sessionROI')) {
                    // Stessa formula di updateDashboard (PnL Netto / Capitale Iniziale) per
                    // evitare che il valore dipenda da quale delle due funzioni gira per ultima.
                    const netPnl = (typeof window.__trueRealizedPnL === 'number') ? window.__trueRealizedPnL : realizedPnl;
                    const pct = sessionInitialCapital > 0 ? (netPnl / sessionInitialCapital) * 100 : 0;
                    document.getElementById('sessionROI').textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                    document.getElementById('sessionROI').style.color = pct >= 0 ? '#10b981' : '#ef4444';
                }
                if (document.getElementById('unrealizedPnL')) {
                    document.getElementById('unrealizedPnL').textContent = `${unrealizedTotal >= 0 ? '+' : ''}${formatMoney(unrealizedTotal)}`;
                    document.getElementById('unrealizedPnL').style.color = unrealizedTotal >= 0 ? '#60a5fa' : '#ef4444';
                }
                if (document.getElementById('openDailyNet')) {
                    const oSign = unrealizedTotal >= 0 ? '+' : '';
                    document.getElementById('openDailyNet').textContent = `${oSign}${formatMoney(unrealizedTotal)}`;
                    document.getElementById('openDailyNet').style.color = unrealizedTotal > 0 ? '#10b981' : unrealizedTotal < 0 ? '#ef4444' : '#fff';
                }
                // Box storiche Versato/Attuale: formula lifetime (versato + P&L
                // realizzato storico + non realizzato corrente) per i contesti locali
                updateCapitalHistoryBoxes(testEquity);
                return;
            }

            // Sincronizzazione Broker Real-Time (Dati certificati dal server)
            // Usiamo tradingCapital (Equity) per il valore totale principale
            if (tradingCapitalEl) tradingCapitalEl.textContent = formatMoney(tradingCapital);

            // Capitale Iniziale (Equity alla chiusura precedente)
            if (initialCapitalEl) initialCapitalEl.textContent = formatMoney(sessionInitialCapital);

            // Saldo Cash (Liquidità immediata) - Aggiorna entrambi i punti della UI
            if (walletBalanceEl) walletBalanceEl.textContent = formatMoney(portfolioBalance);
            if (walletBalanceSideEl) walletBalanceSideEl.textContent = formatMoney(portfolioBalance);

            // Header: SOMMA degli equity di tutti i broker (multi-dashboard)
            if (typeof updateGlobalPortfolioHeader === 'function') updateGlobalPortfolioHeader();

            // Box storiche Versato/Attuale (contesto broker Alpaca Paper o ALrt)
            updateCapitalHistoryBoxes(tradingCapital);

            // Potere Acquisto (Buying Power)
            if (availableMarginEl) availableMarginEl.textContent = formatMoney(availableMargin);

            // Valore Mercato (Long + Short Market Value)
            if (totalInvestedEl) totalInvestedEl.textContent = formatMoney(brokerMarketValue || 0);

            // Calcolo preliminare Unrealized per separare PnL Realizzato. Preferisce il
            // PnL non realizzato certificato dal broker per posizione (stessa logica di
            // updateDashboard), per non divergere quando le due funzioni girano in ordine diverso.
            let localUnreal = 0;
            let hasLocal = false;
            for (let s in activePositions) {
                const p = activePositions[s];
                if (p.brokerUnrealizedPnL !== undefined) {
                    localUnreal += p.brokerUnrealizedPnL;
                } else {
                    const lp = getLivePriceFor(s) || p.entryPrice;
                    localUnreal += p.type === 'LONG' ? (lp - p.entryPrice) * p.amount : (p.entryPrice - lp) * p.amount;
                }
                hasLocal = true;
            }
            const displayUnreal = hasLocal ? localUnreal : brokerUnrealizedPnL;

            // PnL Realizzato (Lifetime)
            if (sessionRevenueEl) {
                const realizedPnl = globalTotalRealizedPnL;
                const sign = realizedPnl >= 0 ? '+' : '';
                sessionRevenueEl.textContent = `${sign}${formatMoney(realizedPnl)}`;
                sessionRevenueEl.style.color = realizedPnl >= 0 ? '#10b981' : '#ef4444';
            }

            // ROI Totale (stessa formula di updateDashboard: PnL Netto / Capitale Iniziale,
            // per evitare che il valore dipenda dall'ordine di chiamata tra le due funzioni)
            if (sessionROIEl) {
                const netPnl = (typeof window.__trueRealizedPnL === 'number') ? window.__trueRealizedPnL : globalTotalRealizedPnL;
                const pct = (sessionInitialCapital > 0) ? (netPnl / sessionInitialCapital) * 100 : 0;
                sessionROIEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                sessionROIEl.style.color = pct >= 0 ? '#10b981' : '#ef4444';
            }

            // PnL Non Realizzato
            if (unrealizedPnLEl) {
                const sign = displayUnreal >= 0 ? '+' : '';
                unrealizedPnLEl.textContent = `${sign}${formatMoney(displayUnreal)}`;
                unrealizedPnLEl.style.color = displayUnreal >= 0 ? '#60a5fa' : '#ef4444';
            }
            if (document.getElementById('openDailyNet')) {
                const oSign = displayUnreal >= 0 ? '+' : '';
                document.getElementById('openDailyNet').textContent = `${oSign}${formatMoney(displayUnreal)}`;
                document.getElementById('openDailyNet').style.color = displayUnreal > 0 ? '#10b981' : displayUnreal < 0 ? '#ef4444' : '#fff';
            }

            // Update invest preview (Alpaca Mode)
            const investUsd = getInvestUsd();
            if (investPreviewAmtEl) investPreviewAmtEl.textContent = formatMoney(investUsd);
            if (investPctLabel && investAmountInput) investPctLabel.textContent = (investAmountInput.value || 25) + '%';

            return;
        }

        function persistData() {
            if (localStorage.getItem('sim_is_resetting') === 'true') return;
            localStorage.setItem('sim_bot_active', isBotActive.toString());

            if (!brokerViewActive()) {
                // Test mode: salva SOLO sulle chiavi dedicate (mai contaminate da Alpaca)
                persistTestData();
                // FASE B: snapshot del contesto locale corrente (fh/capd/capl)
                if (typeof window.getBrokerCtx === 'function') saveLocalCtxState(window.getBrokerCtx());
                return;
            }

            // Broker mode: chiavi Alpaca (le posizioni locali non vengono persistite)
            localStorage.setItem('sim_active_positions', '{}');
            localStorage.setItem('sim_trading_capital', tradingCapital.toString());
            localStorage.setItem('sim_session_initial_capital', sessionInitialCapital.toString());
            localStorage.setItem('sim_total_pnl', totalPnL.toString());
            localStorage.setItem('sim_executed_trades', executedTrades.toString());
            localStorage.setItem('sim_win_trades', winTrades.toString());
            localStorage.setItem('sim_gross_profit', grossProfit.toString());
            localStorage.setItem('sim_gross_loss', grossLoss.toString());
            localStorage.setItem('sim_trade_history', JSON.stringify(tradeHistory));
        }

        // Ascolta il reset da altri tab
        window.addEventListener('storage', (e) => {
            if (e.key === 'sim_is_resetting' && e.newValue === 'true') {
                window.location.reload();
            }
        });

        updateWalletUI();
        updateDashboard();
        renderHistory();

        function updateSessionTimer() {
            if (isBotActive) {
                sessionElapsedSeconds++;
            }

            const hours = Math.floor(sessionElapsedSeconds / 3600);
            const mins = Math.floor((sessionElapsedSeconds % 3600) / 60);
            const secs = sessionElapsedSeconds % 60;

            const pad = (n) => n.toString().padStart(2, '0');
            if (sessionTimerEl) {
                sessionTimerEl.textContent = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
            }
        }
        setInterval(updateSessionTimer, 1000);
        updateSessionTimer();

        function transferFunds() {
            const input = document.getElementById('transferAmount');
            const amount = parseFloat(input.value);
            if (isNaN(amount) || amount <= 0) {
                showNotification("Inserisci un importo valido", 'error');
                return;
            }
            if (portfolioBalance >= amount) {
                portfolioBalance -= amount;
                tradingCapital += amount;
                sessionInitialCapital += amount;
                updateWalletUI();
                showNotification(`💰 Investiti ${formatMoney(amount)} nel Capitale Disponibile`, 'success');
            } else {
                showNotification("❌ Fondi insufficienti nel Portafoglio", 'error');
            }
        }

        function withdrawFunds() {
            const input = document.getElementById('transferAmount');
            const amount = parseFloat(input.value);
            if (isNaN(amount) || amount <= 0) {
                showNotification("Inserisci un importo valido", 'error');
                return;
            }
            if (tradingCapital >= amount) {
                tradingCapital -= amount;
                portfolioBalance += amount;
                sessionInitialCapital = Math.max(0, sessionInitialCapital - amount);
                updateWalletUI();
                showNotification(`↩️ Ritirati ${formatMoney(amount)} nel Portafoglio`, 'success');
            } else {
                showNotification("❌ Fondi insufficienti nel Capitale di Trading", 'error');
            }
        }

        function withdrawAllFunds() {
            if (tradingCapital <= 0) {
                showNotification("❌ Nessun capitale disponibile da ritirare", 'warning');
                return;
            }
            const amount = tradingCapital;
            tradingCapital = 0;
            portfolioBalance += amount;
            sessionInitialCapital = Math.max(0, sessionInitialCapital - amount);
            updateWalletUI();
            showNotification(`↩️ Ritirati tutti i fondi (${formatMoney(amount)}) nel Portafoglio`, 'success');
        }

        const btnTransfer = document.getElementById('btnTransferFundsCustom');
        if (btnTransfer) btnTransfer.addEventListener('click', transferFunds);

        // Nuovi pulsanti Gestione Capitale (Spostamento fondi interno)
        const btnDepositToTrading = document.getElementById('btnDepositToTrading');
        if (btnDepositToTrading) btnDepositToTrading.addEventListener('click', transferFunds);

        const btnWithdrawToWallet = document.getElementById('btnWithdrawToWallet');
        if (btnWithdrawToWallet) btnWithdrawToWallet.addEventListener('click', withdrawFunds);

        const btnWithdrawAll = document.getElementById('btnWithdrawAll');
        if (btnWithdrawAll) btnWithdrawAll.addEventListener('click', withdrawAllFunds);

        // Fallback difensivo: se la libreria del grafico (CDN) non è raggiungibile,
        ChartManager.init('tvchart');

        // Global Escape key listener to close all modals
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modals = [
                    'apiModal', 'alpacaModal', 'alpacaLiveModal',
                    'paypalModal', 'paypalWithdrawModal', 'infoModal'
                ];
                modals.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                });
            }
        });

        // --- UI Logic ---
        if (apiSettingsBtn) {
            apiSettingsBtn.addEventListener('click', () => {
                apiKeyInput.value = finnhubApiKey;
                apiModal.classList.remove('hidden');
            });
        }

        if (cancelApiBtn) {
            cancelApiBtn.addEventListener('click', () => {
                apiModal.classList.add('hidden');
                apiErrorMsg.textContent = '';
                assetPairSelect.value = lastValidAsset;
                checkApiRequirement(lastValidAsset);
            });
        }

        // Test connessione Finnhub: verifica la chiave con una quote reale (nessun salvataggio)
        // Stato colore del bottone TEST circolare dei modali broker:
        // base = ROSSO (connessione non attiva/fallita), 'busy' = GIALLO
        // (test in corso), 'ok' = VERDE (connessione riuscita).
        function setTestBtnState(btn, state) {
            if (!btn) return;
            btn.classList.remove('busy', 'ok');
            if (state === 'busy' || state === 'ok') btn.classList.add(state);
            btn.disabled = (state === 'busy');
        }

        const testFinnhubBtn = document.getElementById('testFinnhubBtn');
        if (testFinnhubBtn) {
            testFinnhubBtn.addEventListener('click', async () => {
                const k = apiKeyInput ? apiKeyInput.value.trim() : '';
                if (!k) {
                    showNotification(tr('keys_required_test', 'Inserisci la API Key per il test'), 'error');
                    return;
                }
                setTestBtnState(testFinnhubBtn, 'busy');
                let connOk = false;
                try {
                    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(k)}`);
                    const data = res.ok ? await res.json().catch(() => null) : null;
                    // Finnhub restituisce {c: prezzo, ...}; con chiave non valida risponde 401/403 o payload vuoto
                    connOk = !!(data && typeof data.c === 'number' && data.c > 0);
                    showNotification(connOk ? tr('conn_ok', 'Connessione riuscita: chiave valida.')
                        : tr('conn_fail', 'Connessione fallita: chiave non valida o servizio non raggiungibile.'), connOk ? 'success' : 'error');
                } catch (e) {
                    showNotification(tr('conn_fail', 'Connessione fallita: chiave non valida o servizio non raggiungibile.'), 'error');
                }
                setTestBtnState(testFinnhubBtn, connOk ? 'ok' : 'fail');
            });
        }

        // Persistent Keys Sync Logic
        async function syncKeysWithServer(save = false) {
            // Su Vercel (o host diversi da localhost) non usiamo /api/save-keys
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

            try {
                if (save) {
                    // Le chiavi sono già salvate in localStorage dai rispettivi listener
                    if (isLocal) {
                        const keys = {
                            finnhub_api_key: finnhubApiKey,
                            alpaca_key_id: alpacaKeyId,
                            alpaca_secret_key: alpacaSecretKey,
                            alpaca_live_key_id: alpacaLiveKeyId,
                            alpaca_live_secret_key: alpacaLiveSecretKey
                        };
                        await fetch('/api/save-keys', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(keys)
                        });
                        console.log("Keys: Sincronizzate con il server locale.");
                    } else {
                        console.log("Keys: Salvate localmente (ambiente di produzione).");
                    }
                } else {
                    if (isLocal) {
                        const res = await fetch('/keys.json');
                        if (res.ok) {
                            const keys = await res.json();
                            if (keys.finnhub_api_key) {
                                finnhubApiKey = keys.finnhub_api_key;
                                localStorage.setItem('finnhub_api_key', finnhubApiKey);
                            }
                            if (keys.alpaca_key_id) {
                                alpacaKeyId = keys.alpaca_key_id;
                                localStorage.setItem('alpaca_key_id', alpacaKeyId);
                            }
                            if (keys.alpaca_secret_key) {
                                alpacaSecretKey = keys.alpaca_secret_key;
                                localStorage.setItem('alpaca_secret_key', alpacaSecretKey);
                            }
                            if (keys.alpaca_live_key_id) {
                                alpacaLiveKeyId = keys.alpaca_live_key_id;
                                localStorage.setItem('alpaca_live_key_id', alpacaLiveKeyId);
                            }
                            if (keys.alpaca_live_secret_key) {
                                alpacaLiveSecretKey = keys.alpaca_live_secret_key;
                                localStorage.setItem('alpaca_live_secret_key', alpacaLiveSecretKey);
                            }
                            console.log("Keys: Recuperate dal server locale.");
                            // Se dal server arriva una chiave DIVERSA (nuovo account),
                            // azzera i dati locali del vecchio account
                            checkAlpacaKeyChange();

                            // NON forzare il broker: l'app parte sempre in test mode.
                            // Le chiavi restano disponibili per l'attivazione manuale dal toggle.
                            if (typeof updateAllTogglesUI === 'function') updateAllTogglesUI();
                        }
                    } else {
                        // In produzione le leggiamo solo dal localStorage all'avvio (già fatto in cima al file)
                        console.log("Keys: Usate chiavi da localStorage (ambiente di produzione).");
                        if (typeof updateAllTogglesUI === 'function') updateAllTogglesUI();
                    }
                }
            } catch (e) {
                console.warn("Keys: Errore sincronizzazione:", e);
            }
        }

        async function syncPositionsWithBroker() {
            if (!useAlpacaBroker || !alpacaKeyId || !alpacaSecretKey) return;
            console.log("[SYNC] Sincronizzazione posizioni con Alpaca...");
            try {
                const res = await fetch(`${ALPACA_BASE}/v2/positions`, {
                    headers: {
                        'apca-api-key-id': alpacaKeyId,
                        'apca-api-secret-key': alpacaSecretKey
                    }
                });
                if (res.ok) {
                    const alpacaPositions = await res.json();
                    let addedNew = false;
                    alpacaPositions.forEach(p => {
                        let botSym = p.symbol;
                        const isCrypto = p.asset_class === 'crypto';
                        if (isCrypto) botSym = p.symbol.replace('/USD', 'USDT');

                        // Controlla se il simbolo è nuovo
                        const exists = Object.values(VALID_SYMBOLS).some(cat => cat.includes(botSym));
                        if (!exists && !extraSymbols.has(botSym)) {
                            extraSymbols.add(botSym);
                            addedNew = true;
                        }

                        if (!activePositions[botSym]) {
                            activePositions[botSym] = {
                                type: p.side.toUpperCase() === 'LONG' ? 'LONG' : 'SHORT',
                                entryPrice: parseFloat(p.avg_entry_price),
                                amount: parseFloat(p.qty),
                                invested: parseFloat(p.cost_basis),
                                // /v2/positions non ha created_at: usa l'ora annotata da openTrade
                                // se l'apertura è appena partita da qui, altrimenti i FILL (syncAlpacaHistory)
                                openTime: p.created_at ? new Date(p.created_at).getTime() : takePendingOpenTime(botSym),
                                fromBroker: true
                            };
                            console.log(`[SYNC] Posizione recuperata da Alpaca: ${botSym}`);
                        }
                    });

                    if (addedNew) {
                        console.log("[SYNC] Nuovi asset rilevati nel portafoglio. Aggiorno selettore.");
                        renderAssetSelector();
                    }

                    updateDashboard();
                    updateWalletUI();
                }
            } catch (e) {
                console.error("[SYNC] Errore sincronizzazione posizioni:", e);
            }
        }

        // Startup connections
        initBackgroundConnections();
        updateBrokerAssetsUI();
        updateSessionBudgetVisibility();
        // Allinea subito combo/legenda/serie/checkbox alla scheda iniziale (FH)
        if (typeof window.refreshCategoryAvailability === 'function') window.refreshCategoryAvailability();

        if (saveApiBtn) {
            saveApiBtn.addEventListener('click', () => {
                const key = apiKeyInput.value.trim();
                if (key.length < 10) {
                    apiErrorMsg.textContent = 'Chiave API non valida. Troppo corta.';
                    return;
                }
                finnhubApiKey = key;
                localStorage.setItem('finnhub_api_key', finnhubApiKey);
                // Nuova chiave: azzera il blocco candles (potrebbe essere un piano a pagamento)
                window.finnhubForbidden = false;
                localStorage.removeItem('finnhub_candles_forbidden');
                syncKeysWithServer(true); // Save to server
                apiModal.classList.add('hidden');
                apiErrorMsg.textContent = '';
                applyBrokerSwitch(0);
            });
        }

        // Alpaca Modal Logic
        const alpacaSettingsBtn = document.getElementById('alpacaSettingsBtn');
        const alpacaModal = document.getElementById('alpacaModal');
        const saveAlpacaBtn = document.getElementById('saveAlpacaBtn');
        const alpacaKeyInput = document.getElementById('alpacaKeyId');
        const alpacaSecretInput = document.getElementById('alpacaSecretKey');


        function updateAllTogglesUI() {
            if (sidebarFinnhubToggle) sidebarFinnhubToggle.checked = useFinnhubData;
            updateStatusDots();
        }

        updateAllTogglesUI();

        if (sidebarFinnhubToggle) {
            sidebarFinnhubToggle.onchange = (e) => {
                useFinnhubData = e.target.checked;
                localStorage.setItem('sim_use_finnhub', useFinnhubData);
                console.log(`[SETTINGS] Finnhub Data: ${useFinnhubData}`);
                if (!useFinnhubData && bgFinnhubWs) {
                    closeWsGracefully(bgFinnhubWs);
                    bgFinnhubWs = null;
                    activeFinnhubSubs.clear();
                } else if (useFinnhubData && !bgFinnhubWs) {
                    initBackgroundConnections();
                }
                updateStatusDots();
                updateBrokerAssetsUI(); // Aggiorna UI asset disponibili
            };
        }

        if (sidebarAlpacaToggle) {
            sidebarAlpacaToggle.onchange = (e) => {
                if (e.target.checked && (!alpacaKeyId || !alpacaSecretKey)) {
                    // Vuole attivare il broker ma mancano le chiavi: apri il modal e annulla
                    const alpacaModal = document.getElementById('alpacaModal');
                    if (alpacaModal) alpacaModal.classList.remove('hidden');
                    e.target.checked = false;
                    setTradingMode(false);
                    return;
                }
                setTradingMode(e.target.checked);
            };
        }

        if (alpacaSettingsBtn) {
            alpacaSettingsBtn.addEventListener('click', () => {
                // Popola i campi con le chiavi attuali prima di mostrare il modal
                if (alpacaKeyInput) alpacaKeyInput.value = alpacaKeyId;
                if (alpacaSecretInput) alpacaSecretInput.value = alpacaSecretKey;
                alpacaModal.classList.remove('hidden');
            });
        }

        if (saveAlpacaBtn) {
            saveAlpacaBtn.addEventListener('click', () => {
                alpacaKeyId = alpacaKeyInput.value.trim();
                alpacaSecretKey = alpacaSecretInput.value.trim();

                localStorage.setItem('alpaca_key_id', alpacaKeyId);
                localStorage.setItem('alpaca_secret_key', alpacaSecretKey);
                // Nuova chiave = nuovo account: azzera i dati locali del vecchio
                checkAlpacaKeyChange();

                syncKeysWithServer(true); // Salva persistentemente nel keys.json

                alpacaModal.classList.add('hidden');
                showNotification("Chiavi Alpaca salvate.", "success");
                applyBrokerSwitch(1);
            });
        }

        // ─── Alpaca Trading API REALE: configurazione + monitoraggio ───
        // Il modale salva/testa le chiavi del conto live e il LED ALPrt ne
        // mostra lo stato. IMPORTANTE: da qui non parte MAI alcun ordine —
        // il conto reale viene solo letto (GET /v2/account).
        const alpacaLiveSettingsBtn = document.getElementById('alpacaLiveSettingsBtn');
        const alpacaLiveModal = document.getElementById('alpacaLiveModal');
        const saveAlpacaLiveBtn = document.getElementById('saveAlpacaLiveBtn');
        const testAlpacaLiveBtn = document.getElementById('testAlpacaLiveBtn');
        const alpacaLiveKeyInput = document.getElementById('alpacaLiveKeyId');
        const alpacaLiveSecretInput = document.getElementById('alpacaLiveSecretKey');

        if (alpacaLiveSettingsBtn) {
            alpacaLiveSettingsBtn.addEventListener('click', () => {
                if (alpacaLiveKeyInput) alpacaLiveKeyInput.value = alpacaLiveKeyId;
                if (alpacaLiveSecretInput) alpacaLiveSecretInput.value = alpacaLiveSecretKey;
                if (alpacaLiveModal) alpacaLiveModal.classList.remove('hidden');
            });
        }

        if (saveAlpacaLiveBtn) {
            saveAlpacaLiveBtn.addEventListener('click', () => {
                alpacaLiveKeyId = alpacaLiveKeyInput.value.trim();
                alpacaLiveSecretKey = alpacaLiveSecretInput.value.trim();
                localStorage.setItem('alpaca_live_key_id', alpacaLiveKeyId);
                localStorage.setItem('alpaca_live_secret_key', alpacaLiveSecretKey);
                // Nuova chiave = nuovo account: azzera i dati locali del vecchio
                checkAlpacaKeyChange();
                syncKeysWithServer(true);
                if (alpacaLiveModal) alpacaLiveModal.classList.add('hidden');
                showNotification(tr('live_keys_saved', 'Chiavi Alpaca Trading (reale) salvate.'), 'success');
                applyBrokerSwitch(2);
            });
        }

        if (testAlpacaLiveBtn) {
            testAlpacaLiveBtn.addEventListener('click', async () => {
                const k = alpacaLiveKeyInput ? alpacaLiveKeyInput.value.trim() : '';
                const s = alpacaLiveSecretInput ? alpacaLiveSecretInput.value.trim() : '';
                if (!k || !s) {
                    showNotification(tr('keys_required_test', 'Inserisci API Key e Secret Key per il test'), 'error');
                    return;
                }
                setTestBtnState(testAlpacaLiveBtn, 'busy');
                let connOk = false;
                try {
                    // Test REALE: legge il conto live (nessuna operazione)
                    const res = await fetch(`${ALPACA_LIVE_BASE}/v2/account`, {
                        headers: { 'apca-api-key-id': k, 'apca-api-secret-key': s }
                    });
                    connOk = res.ok;
                    showNotification(connOk ? tr('conn_ok', 'Connessione riuscita: chiavi valide.')
                        : tr('conn_fail', 'Connessione fallita: chiavi non valide o servizio non raggiungibile.'), connOk ? 'success' : 'error');
                } catch (e) {
                    showNotification(tr('conn_fail', 'Connessione fallita: chiavi non valide o servizio non raggiungibile.'), 'error');
                }
                setTestBtnState(testAlpacaLiveBtn, connOk ? 'ok' : 'fail');
            });
        }

        // ══════════════════════════════════════════════════════════════════
        // Capital.com — service layer (Demo e Reale)
        // Documentazione: https://open-api.capital.com/
        // Auth: POST /api/v1/session con header X-CAP-API-KEY e body
        // {identifier: email, password: password della API Key}. I token di
        // sessione CST e X-SECURITY-TOKEN arrivano negli HEADER di risposta e
        // vanno rimandati a ogni richiesta. Sessione ~10 min di inattività:
        // il polling la tiene viva; su 401 si rifà il login (max 1/s).
        // CORS: Access-Control-Allow-Origin:* (verificato) → funziona in WebView
        // e browser; su Android si preferisce comunque CapacitorHttp (nativo).
        // ══════════════════════════════════════════════════════════════════
        const CAPITAL_BASES = {
            demo: 'https://demo-api-capital.backend-capital.com',
            live: 'https://api-capital.backend-capital.com'
        };
        // Mappa simboli interni → epic Capital.com (Forex + Materie Prime).
        // I simboli interni restano invariati (chiave "OANDA:*" storica dell'app).
        const CAPITAL_EPIC_MAP = {
            'OANDA:EUR_USD': 'EURUSD', 'OANDA:GBP_USD': 'GBPUSD', 'OANDA:USD_JPY': 'USDJPY',
            'OANDA:AUD_USD': 'AUDUSD', 'OANDA:USD_CAD': 'USDCAD', 'OANDA:NZD_USD': 'NZDUSD',
            'OANDA:USD_CHF': 'USDCHF', 'OANDA:EUR_GBP': 'EURGBP', 'OANDA:EUR_JPY': 'EURJPY',
            'OANDA:GBP_JPY': 'GBPJPY',
            'OANDA:XAU_USD': 'GOLD', 'OANDA:XAG_USD': 'SILVER',
            'OANDA:BRENT_USD': 'OIL_BRENT', 'OANDA:WTI_USD': 'OIL_CRUDE',
            'OANDA:NATGAS_USD': 'NATURALGAS', 'OANDA:COPPER_USD': 'COPPER'
        };
        const CAPITAL_EPIC_TO_SYM = Object.fromEntries(Object.entries(CAPITAL_EPIC_MAP).map(([s, e]) => [e, s]));
        // Epic risultati non validi dal server: esclusi dai poll successivi
        const capitalBadEpics = new Set();
        // Sessione corrente { cst, sec, t } per modalità
        const capSession = { demo: null, live: null };
        let capLastLoginAt = 0;

        function getCapitalCfg(mode) {
            const m = mode || window.capitalMode;
            if (m === 'live') return { mode: 'live', base: CAPITAL_BASES.live, key: capLiveKey, ident: capLiveIdent, pass: capLivePass };
            return { mode: 'demo', base: CAPITAL_BASES.demo, key: capDemoKey, ident: capDemoIdent, pass: capDemoPass };
        }

        // Manager Capital.com per la modalità richiesta (demo di default).
        // BUGFIX: questa funzione era CHIAMATA (capitalAuthed/capitalLogin) ma mai
        // definita → ogni richiesta Capital moriva con ReferenceError silenziato,
        // incluso lo storico del grafico per Forex/Materie Prime.
        function getCapitalManager(mode) {
            const m = mode || window.capitalMode;
            const mgr = (m === 'live') ? window.CapitalTradingManager : window.CapitalDemoManager;
            if (!mgr) return null;
            const cfg = getCapitalCfg(m === 'live' ? 'live' : 'demo');
            if (!cfg.key || !cfg.ident || !cfg.pass) return null; // credenziali mancanti
            if (typeof mgr.setCredentials === 'function') mgr.setCredentials(cfg.key, cfg.ident, cfg.pass);
            return mgr;
        }

        // HTTP unificato: CapacitorHttp (nativo) su Android, fetch nel browser.
        // Ritorna { ok, status, json(), headers(nomi in minuscolo) }.
        async function appFetch(base, path, opts = {}) {
            const url = base + path;
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

        // Login: crea la sessione e memorizza CST + X-SECURITY-TOKEN
        async function capitalLogin(mode) {
            const mgr = getCapitalManager(mode);
            if (!mgr) return false;
            const ok = await mgr.login();
            if (!ok) setCapitalLed('error');
            return ok;
        }

        // Richiesta autenticata con retry automatico su 401 (sessione scaduta)
        async function capitalAuthed(path, opts = {}) {
            const mgr = getCapitalManager();
            if (!mgr) return null;
            return await mgr.authedReq(path, opts);
        }

        function setCapitalLed(state) { // 'active' | 'error' | ''
            // CAP = feed Demo (sempre attivo se configurato); CAPrt = conto REALE
            // (si accende solo quando la modalità Capital live è collegata).
            const id = (window.capitalMode === 'live') ? 'statusCAPL' : 'statusCAP';
            const led = document.getElementById(id);
            if (!led) return;
            const dot = led.querySelector('.status-dot');
            if (dot) dot.className = 'status-dot' + (state ? ' ' + state : '');
        }

        // Riepilogo conto — GET /api/v1/accounts (saldo/available del conto preferito)
        async function syncCapitalAccount() {
            if (window.capitalMode === 'off') return;
            try {
                const res = await capitalAuthed('/api/v1/accounts');
                if (res && res.ok) {
                    const data = await res.json();
                    const accs = (data && data.accounts) || [];
                    const acc = accs.find(a => a.preferred) || accs[0];
                    if (acc) {
                        setCapitalLed('active');
                        const bal = acc.balance ? (acc.balance.balance ?? 0) : 0;
                        const avail = acc.balance ? (acc.balance.available ?? 0) : 0;
                        console.log(`[CAPITAL] Account Sync (${window.capitalMode}): saldo=${bal} ${acc.currency || ''}, disponibile=${avail}`);
                        // Header multi-broker: niente override diretto col NAV — il totale
                        // è la somma di tutti i broker (updateGlobalPortfolioHeader).
                        if (typeof window.updateGlobalPortfolioHeader === 'function') window.updateGlobalPortfolioHeader();
                        // Nota: le box Versato/Attuale NON usano il NAV del conto demo
                        // Capital (gli ordini sono ancora simulati localmente): restano
                        // sulla formula lifetime del contesto capd/capl. Con il routing
                        // ordini reale su Capital passeranno all'equity del conto.
                    }
                } else if (res && (res.status === 401 || res.status === 403)) {
                    setCapitalLed('error');
                }
            } catch (e) {
                setCapitalLed('error');
                console.warn('[CAPITAL] Errore sync account:', e && e.message ? e.message : e);
            }
        }

        // Prezzi in tempo reale (polling 3s) — GET /api/v1/markets?epics=...
        // Alimenta radar/grafico/strategia con il mid bid/offer, come gli altri feed.
        let capitalPollingInterval = null;
        function capitalEpics() {
            return Object.entries(CAPITAL_EPIC_MAP)
                .filter(([sym, epic]) => !capitalBadEpics.has(epic))
                .map(([sym, epic]) => epic);
        }
        function startCapitalPolling() {
            if (capitalPollingInterval) return;
            const cfg = getCapitalCfg();
            if (!cfg.key || !cfg.ident || !cfg.pass) return;
            console.log(`[CAPITAL] Polling prezzi attivo (${cfg.mode}). Intervallo: 3s.`);
            capitalPollingInterval = setInterval(async () => {
                // FASE C: il polling resta attivo anche fuori dalla modalità Capital
                // (feed concorrente); si ferma senza chiavi o se l'utente lo scollega.
                if (!capDemoKey || !capDemoIdent || !capDemoPass || !window.__connAllowed.capd) { stopCapitalPolling(); return; }
                try {
                    const epics = capitalEpics();
                    if (epics.length === 0) return;
                    const res = await capitalAuthed(`/api/v1/markets?epics=${encodeURIComponent(epics.join(','))}`);
                    if (!res || !res.ok) {
                        // Feed NON sano: Finnhub torna a coprire Forex/Materie
                        if (window.__capitalFeedOk) {
                            window.__capitalFeedOk = false;
                            console.warn('[CAPITAL] Feed prezzi in errore: Finnhub riprende la copertura Forex/Materie.');
                            try { syncFinnhubSubscriptions(); } catch (_) { }
                        }
                        // Un epic non valido può far fallire il batch: individua i validi una volta sola
                        if (res && (res.status === 400 || res.status === 404)) await probeCapitalEpics();
                        return;
                    }
                    // Feed SANO: Capital diventa la fonte per Forex/Materie
                    if (!window.__capitalFeedOk) {
                        window.__capitalFeedOk = true;
                        console.log('[CAPITAL] Feed prezzi attivo: Capital copre Forex/Materie (Finnhub si ritira su queste categorie).');
                        try { syncFinnhubSubscriptions(); } catch (_) { }
                    }
                    const data = await res.json();
                    const now = Date.now();
                    (data.marketDetails || []).forEach(md => {
                        const epic = md.instrument && md.instrument.epic;
                        const snap = md.snapshot || {};
                        const bid = parseFloat(snap.bid || 0);
                        const offer = parseFloat(snap.offer ?? snap.ofr ?? 0);
                        const mid = (bid > 0 && offer > 0) ? (bid + offer) / 2 : (offer || bid);
                        const sym = CAPITAL_EPIC_TO_SYM[epic];
                        if (!sym || !mid || mid <= 0) return;
                        const type = getAssetType(sym);
                        globalPrices[sym] = mid;
                        recordSpread(sym, bid, offer);
                        updateBackgroundHistoryAndStrategy(sym, mid, now, type, 'cap');
                        processRadarTick(sym, mid, now, type);
                    });
                    setCapitalLed('active');
                } catch (e) { /* errore di rete: riprova al prossimo giro */ }
            }, 3000);
            syncCapitalAccount(); // primo sync immediato del conto
        }
        function stopCapitalPolling() {
            if (capitalPollingInterval) { clearInterval(capitalPollingInterval); capitalPollingInterval = null; }
            setCapitalLed('');
            if (window.__capitalFeedOk) {
                window.__capitalFeedOk = false;
                try { syncFinnhubSubscriptions(); } catch (_) { } // FH riprende Forex/Materie
            }
        }
        // Verifica una tantum degli epic: quelli sconosciuti al server vengono esclusi
        let capitalProbeDone = false;
        async function probeCapitalEpics() {
            if (capitalProbeDone) return;
            capitalProbeDone = true;
            console.warn('[CAPITAL] Batch epics rifiutato: verifico gli epic uno a uno...');
            for (const [sym, epic] of Object.entries(CAPITAL_EPIC_MAP)) {
                try {
                    const res = await capitalAuthed(`/api/v1/markets/${encodeURIComponent(epic)}`);
                    if (res && (res.status === 404 || res.status === 400)) {
                        capitalBadEpics.add(epic);
                        console.warn(`[CAPITAL] Epic non valido, escluso: ${epic}`);
                    }
                } catch (e) { /* rete: lascialo nel set */ }
                await new Promise(r => setTimeout(r, 150)); // rispetta il rate limit
            }
        }
        // Sync periodico del conto Capital.com (allineato al ritmo degli altri broker)
        setInterval(() => { if (window.capitalMode !== 'off') syncCapitalAccount(); }, 30000);
        // Niente auto-avvio del feed Capital al load: la connessione parte SOLO su
        // scelta dell'utente (leva CAP o attivazione della scheda Capital).

        // ─── Modali Capital.com: apertura, salvataggio, test connessione ───
        (function initCapitalModals() {
            const dModal = document.getElementById('capitalModal');
            const lModal = document.getElementById('capitalLiveModal');
            const dBtn = document.getElementById('capitalSettingsBtn');
            const lBtn = document.getElementById('capitalLiveSettingsBtn');
            const dIdent = document.getElementById('capitalDemoIdent');
            const dKey = document.getElementById('capitalDemoKey');
            const dPass = document.getElementById('capitalDemoPass');
            const lIdent = document.getElementById('capitalLiveIdent');
            const lKey = document.getElementById('capitalLiveKey');
            const lPass = document.getElementById('capitalLivePass');

            if (dBtn && dModal) dBtn.addEventListener('click', () => {
                if (dIdent) dIdent.value = capDemoIdent;
                if (dKey) dKey.value = capDemoKey;
                if (dPass) dPass.value = capDemoPass;
                dModal.classList.remove('hidden');
            });
            if (lBtn && lModal) lBtn.addEventListener('click', () => {
                if (lIdent) lIdent.value = capLiveIdent;
                if (lKey) lKey.value = capLiveKey;
                if (lPass) lPass.value = capLivePass;
                lModal.classList.remove('hidden');
            });

            const saveD = document.getElementById('saveCapitalBtn');
            if (saveD) saveD.addEventListener('click', () => {
                const i = dIdent ? dIdent.value.trim() : '', k = dKey ? dKey.value.trim() : '', p = dPass ? dPass.value.trim() : '';
                if (!i || !k || !p) { showNotification('Inserisci email, API Key e password della API Key (Demo).', 'error'); return; }
                capDemoIdent = i; capDemoKey = k; capDemoPass = p;
                localStorage.setItem('capital_demo_ident', i);
                localStorage.setItem('capital_demo_key', k);
                localStorage.setItem('capital_demo_pass', p);
                capSession.demo = null; // nuove credenziali → nuova sessione
                dModal.classList.add('hidden');
                showNotification('Chiavi Capital.com Demo salvate.', 'success');
                applyBrokerSwitch(3);
            });
            const saveL = document.getElementById('saveCapitalLiveBtn');
            if (saveL) saveL.addEventListener('click', () => {
                const i = lIdent ? lIdent.value.trim() : '', k = lKey ? lKey.value.trim() : '', p = lPass ? lPass.value.trim() : '';
                if (!i || !k || !p) { showNotification('Inserisci email, API Key e password della API Key (Reale).', 'error'); return; }
                capLiveIdent = i; capLiveKey = k; capLivePass = p;
                localStorage.setItem('capital_live_ident', i);
                localStorage.setItem('capital_live_key', k);
                localStorage.setItem('capital_live_pass', p);
                capSession.live = null;
                lModal.classList.add('hidden');
                showNotification('Chiavi Capital.com (reale) salvate.', 'success');
                applyBrokerSwitch(4);
            });

            // Test connessione: crea una sessione con i valori inseriti (non salvati)
            async function testCapital(btn, mode, identEl, keyEl, passEl) {
                const i = identEl ? identEl.value.trim() : '', k = keyEl ? keyEl.value.trim() : '', p = passEl ? passEl.value.trim() : '';
                if (!i || !k || !p) { showNotification(tr('keys_required_test', 'Inserisci email, API Key e password per il test'), 'error'); return; }
                setTestBtnState(btn, 'busy');
                let connOk = false;
                try {
                    const base = mode === 'live' ? CAPITAL_BASES.live : CAPITAL_BASES.demo;
                    const res = await capitalHttp(base, '/api/v1/session', {
                        method: 'POST',
                        headers: { 'X-CAP-API-KEY': k, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ identifier: i, password: p })
                    });
                    connOk = res.ok;
                    showNotification(connOk ? tr('conn_ok', 'Connessione riuscita: chiavi valide.')
                        : tr('conn_fail', 'Connessione fallita: email/API Key/password non validi o servizio non raggiungibile.'), connOk ? 'success' : 'error');
                } catch (e) {
                    showNotification(tr('conn_fail', 'Connessione fallita: email/API Key/password non validi o servizio non raggiungibile.'), 'error');
                }
                setTestBtnState(btn, connOk ? 'ok' : 'fail');
            }
            const testD = document.getElementById('testCapitalBtn');
            if (testD) testD.addEventListener('click', () => testCapital(testD, 'demo', dIdent, dKey, dPass));
            const testL = document.getElementById('testCapitalLiveBtn');
            if (testL) testL.addEventListener('click', () => testCapital(testL, 'live', lIdent, lKey, lPass));
        })();

        // ─── Sorgente broker attiva (Paper o REALE) per le funzioni di sync ───
        // In modalità ALrt le stesse rotte /v2 e la stessa logica di sync
        // puntano al conto reale, ma in SOLA LETTURA: nessun percorso di
        // ordine usa mai queste credenziali.
        function getBrokerHttp() {
            if (window.liveMonitorActive) {
                return { base: ALPACA_LIVE_BASE, key: alpacaLiveKeyId, secret: alpacaLiveSecretKey, live: true };
            }
            return { base: ALPACA_BASE, key: alpacaKeyId, secret: alpacaSecretKey, live: false };
        }
        function getAlpacaManager() {
            const _bk = getBrokerHttp();
            if (!_bk.key) return null;
            const mgr = _bk.live ? window.AlpacaRealManager : window.AlpacaPaperManager;
            if (mgr) mgr.setKeys(_bk.key, _bk.secret);
            return mgr;
        }

        // true se una sorgente broker (Paper o Reale) va sincronizzata/mostrata
        function brokerViewActive() {
            return useAlpacaBroker || !!window.liveMonitorActive;
        }

        // Sincronizza la lista CRYPTO (Combo Box / Radar / Bot) con gli asset realmente
        // tradabili sul broker Alpaca ATTIVO (Paper o Reale, via getBrokerHttp). Le altre
        // categorie (Azioni/Forex/Materie Prime) restano curate e vengono filtrate per broker
        // (Alpaca non offre Forex/Materie Prime → già marcate N/A). Dopo l'update adegua
        // Combo, Categorie Trading Bot, sottoscrizioni WS (feed+radar) e selezione del Grafico.
        let alpacaCryptoAssetsSynced = false;
        async function syncAlpacaCryptoAssets(force = false) {
            if (!brokerViewActive()) return;
            if (alpacaCryptoAssetsSynced && !force) return;
            const src = getBrokerHttp();
            if (!src.key || !src.secret) return;
            try {
                const res = await fetch(`${src.base}/v2/assets?status=active&asset_class=crypto`, {
                    headers: { 'apca-api-key-id': src.key, 'apca-api-secret-key': src.secret }
                });
                if (!res.ok) { console.warn('[ASSETS] Sync crypto Alpaca fallito:', res.status); return; }
                const assets = await res.json();
                // Solo pair USD tradabili, con base valida (scarta stablecoin USD/USD e
                // simboli malformati) → formato bot (es. BTC/USD -> BTCUSDT)
                const botSyms = assets
                    .filter(a => {
                        if (!a || !a.tradable || typeof a.symbol !== 'string' || !a.symbol.endsWith('/USD')) return false;
                        const base = a.symbol.slice(0, -4); // rimuove esattamente "/USD"
                        return base.length >= 2 && base !== 'USD' && /^[A-Z0-9]+$/.test(base);
                    })
                    .map(a => a.symbol.slice(0, -4) + 'USDT')
                    .filter((s, i, arr) => arr.indexOf(s) === i)
                    .sort();
                if (botSyms.length === 0) return;
                // Il piano dati crypto Alpaca limita i simboli sottoscrivibili sul WS
                // ("symbol limit exceeded"): teniamo le major + riempiamo fino a un tetto
                // sicuro. La whitelist ordini (ALPACA_SUPPORTED_CRYPTO) resta invece completa,
                // così un ordine su un asset non monitorato non viene bloccato a priori.
                const CRYPTO_WS_CAP = 25;
                const majors = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT', 'AAVEUSDT', 'SHIBUSDT', 'PEPEUSDT'];
                const ordered = [...majors.filter(m => botSyms.includes(m)), ...botSyms.filter(s => !majors.includes(s))];
                alpacaCryptoAssetsSynced = true;
                VALID_SYMBOLS.CRYPTO = ordered.slice(0, CRYPTO_WS_CAP);
                // Whitelist routing ordini: lista COMPLETA dei tradabili (mutazione in-place)
                ALPACA_SUPPORTED_CRYPTO.length = 0;
                botSyms.forEach(s => ALPACA_SUPPORTED_CRYPTO.push(s));
                console.log(`[ASSETS] Crypto Alpaca: ${botSyms.length} tradabili, ${VALID_SYMBOLS.CRYPTO.length} monitorati (tetto WS ${CRYPTO_WS_CAP}).`);
                // Ricostruisce la Combo Box direttamente da VALID_SYMBOLS (self-contained:
                // evita dipendenze di scope su assetPairSelect/renderAssetSelector).
                const combo = document.getElementById('assetPair');
                if (combo) {
                    const cur = combo.value;
                    const catLabels = { CRYPTO: '₿ Criptovalute (Alpaca)', STOCK: '📈 Azioni USA', FOREX: '💱 Forex', COMMODITY: '⛽ Materie Prime' };
                    combo.innerHTML = '';
                    for (const cat in VALID_SYMBOLS) {
                        const og = document.createElement('optgroup');
                        og.label = catLabels[cat] || cat;
                        VALID_SYMBOLS[cat].forEach(sym => {
                            const o = document.createElement('option');
                            o.value = sym;
                            o.textContent = sym.replace('USDT', '').replace('OANDA:', '').replace('_', '/');
                            og.appendChild(o);
                        });
                        combo.appendChild(og);
                    }
                    // Ripristina la selezione se ancora valida, altrimenti BTC (adegua il Grafico)
                    const allSyms = Object.values(VALID_SYMBOLS).flat();
                    combo.value = allSyms.includes(cur) ? cur : 'BTCUSDT';
                    if (!allSyms.includes(cur) && typeof checkApiRequirement === 'function') checkApiRequirement('BTCUSDT');
                }
                // Adegua Categorie Asset (disponibilità broker/orari) + combo grafico + sottoscrizioni
                if (typeof window.refreshCategoryAvailability === 'function') window.refreshCategoryAvailability();
                if (typeof syncAlpacaDataSubscriptions === 'function') syncAlpacaDataSubscriptions();
                // Preload radar DEFERITO: è la parte più pesante (storico di molti asset +
                // DOM) e, eseguito subito dopo la ricostruzione della combo, causa il
                // "Forced reflow". Lo spostiamo fuori dal frame di attivazione broker
                // (il radar si popola comunque dai tick nel frattempo).
                if (typeof initialRadarPreload === 'function') setTimeout(initialRadarPreload, 400);
            } catch (e) { console.warn('[ASSETS] Errore sync crypto Alpaca:', e); }
        }
        window.syncAlpacaCryptoAssets = syncAlpacaCryptoAssets;

        // --- Box "Sync." (pannello Connessioni Broker) ---
        // Mostra la % di avanzamento della sincronizzazione col broker:
        // 0% avvio → 25% conto → 50% posizioni → 75% ordini → 100% storico.
        // pct = null nasconde il box (modalità senza broker da sincronizzare).
        function setSyncProgress(pct) {
            const box = document.getElementById('syncProgressBox');
            const val = document.getElementById('syncProgressPct');
            if (!box || !val) return;
            if (pct === null) { box.style.display = 'none'; return; }
            box.style.display = 'flex';
            val.textContent = `${Math.round(pct)}%`;
        }

        // LED ALrt + sincronizzazione del conto REALE (stadio 2 del tri-switch).
        // Stessa logica della modalità Paper: conto, posizioni, ordini e storico
        // vengono sincronizzati — ma in SOLA LETTURA (nessun ordine, mai).
        async function checkAlpacaLiveConnection() {
            const box = document.getElementById('statusALrt');
            const dot = box ? box.querySelector('.status-dot') : null;
            if (!dot) return;
            dot.style.backgroundColor = '';
            const wantedAlrt = window.__connWanted ? window.__connWanted.alrt : false;
            if (!wantedAlrt && !window.liveMonitorActive) {
                dot.className = 'status-dot error'; // rosso: monitor spento
                return;
            }
            if (!alpacaLiveKeyId || !alpacaLiveSecretKey) {
                dot.className = 'status-dot error'; // rosso se mancano chiavi
                return;
            }
            dot.className = 'status-dot warning'; // giallo durante la verifica
            setSyncProgress(0);
            try {
                const res = await fetch(`${ALPACA_LIVE_BASE}/v2/account`, {
                    headers: {
                        'apca-api-key-id': alpacaLiveKeyId,
                        'apca-api-secret-key': alpacaLiveSecretKey
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    dot.className = 'status-dot active';
                    dot.style.backgroundColor = '#10b981'; // verde: connesso
                    // Cambio modalità mentre la richiesta era in volo: non toccare nulla
                    if (!window.liveMonitorActive) return;
                    // Sincronizzazione del portafoglio reale (stessa logica Paper)
                    applyBrokerAccountSnapshot(data);
                    setSyncProgress(25);
                    await syncAlpacaPositions();
                    setSyncProgress(50);
                    await syncAlpacaOrders();
                    setSyncProgress(75);
                    await syncAlpacaHistory();
                    setSyncProgress(100);
                    // Vedi commento gemello in checkAlpacaConnection(): ricalcola le
                    // statistiche aggregate con i dati appena sincronizzati in questo giro.
                    updateDashboard();
                    updateWalletUI();
                } else {
                    dot.className = 'status-dot error';
                    dot.style.backgroundColor = '#ef4444';
                }
            } catch (e) {
                dot.className = 'status-dot error';
                dot.style.backgroundColor = '#ef4444';
            }
        }
        window.checkAlpacaLiveConnection = checkAlpacaLiveConnection;

        // Mappa la risposta /v2/account (Paper o Reale) sullo stato del
        // portafoglio mostrato nella Gestione Capitale. Condivisa dai due LED.
        function applyBrokerAccountSnapshot(data) {
            portfolioBalance = parseFloat(data.cash || 0);
            // Alpaca usa spesso 'portfolio_value' per la dashboard principale, fallback su 'equity'
            tradingCapital = parseFloat(data.portfolio_value || data.equity || 0);
            const lastEquity = parseFloat(data.last_equity || tradingCapital);
            window.brokerLastEquity = lastEquity; // baseline PnL giornaliero (chiusura precedente)
            brokerMarketValue = (parseFloat(data.long_market_value) || 0) + Math.abs(parseFloat(data.short_market_value) || 0);
            brokerUnrealizedPnL = parseFloat(data.unrealized_intraday_pl != null ? data.unrealized_intraday_pl : (data.unrealized_pl || 0));
            window.alpacaShortingEnabled = data.shorting_enabled === true;
            // Sincronizza il flag anti-short col conto REALE: se il conto non abilita lo
            // scoperto, il bot NON deve nemmeno tentare ordini SHORT (Alpaca li rifiuta con
            // 403 "account is not allowed to short"). Prima il flag si attivava solo DOPO il
            // primo 403 → raffica di rifiuti all'avvio; ora è proattivo dal /v2/account.
            window.__alpacaShortNotAllowed = !window.alpacaShortingEnabled;
            try { localStorage.setItem('alpacaShortNotAllowed', String(window.__alpacaShortNotAllowed)); } catch (_) { }

            // Valuta
            if (data.currency) {
                currentCurrency = data.currency;
                localStorage.setItem('sim_currency', currentCurrency);
                if (currencySelectorEl) currencySelectorEl.value = currentCurrency;
            }

            // Margine Libero (Buying Power)
            availableMargin = parseFloat(data.buying_power);
            let cVal = parseFloat(data.cash);
            let nbpVal = parseFloat(data.non_marginable_buying_power);
            if (isFinite(nbpVal) && nbpVal < cVal) cVal = nbpVal;
            if (!isFinite(cVal)) cVal = 0;
            if (cVal < 0) cVal = 0;

            const marginVal = parseFloat(data.buying_power);

            window.__lastAlpacaDeduction = window.__lastAlpacaDeduction || 0;
            if (Date.now() - window.__lastAlpacaDeduction < 10000) {
                // Previene sovrascritture con dati vecchi dal polling subito dopo un ordine
                availableCash = Math.min(typeof availableCash !== 'undefined' ? availableCash : Infinity, cVal);
                availableMargin = Math.min(typeof availableMargin !== 'undefined' ? availableMargin : Infinity, marginVal);
            } else {
                availableCash = cVal;
                availableMargin = marginVal;
            }

            localStorage.setItem('sim_portfolio_balance', portfolioBalance);
            localStorage.setItem('sim_trading_capital', tradingCapital);

            // Il capitale iniziale per il calcolo PnL è il totale versato storicamente (baseline fissa)
            sessionInitialCapital = getDepositedTotal(getBrokerCtx(), tradingCapital);
            localStorage.setItem('sim_session_initial_capital', sessionInitialCapital.toString());

            totalPnL = tradingCapital - sessionInitialCapital;
            // Calcolo ROI con precisione elevata prima del troncamento UI
            window.alpacaDailyROI = (sessionInitialCapital > 0) ? (totalPnL / sessionInitialCapital) * 100 : 0;

            updateWalletUI();
            updateDashboard();
            persistData();
        }

        async function checkAlpacaConnection() {
            const dot = statusAL.querySelector('.status-dot');
            const now = Date.now();

            // Log di stato ridotto (ogni 60s o se cambia qualcosa di critico)
            const shouldLogStatus = (now - lastAlpacaStatusLogTime > 60000);
            if (shouldLogStatus) {
                console.log(`[ALPACA] Status Check: Active=${useAlpacaBroker}, Key=${alpacaKeyId ? 'OK' : 'MISSING'}`);
                lastAlpacaStatusLogTime = now;
            }

            dot.style.backgroundColor = ''; // Reset colori inline precedenti

            const allowedAlp = window.__connAllowed ? window.__connAllowed.alp : false;
            if (!allowedAlp && !useAlpacaBroker) {
                dot.className = 'status-dot error'; // rosso: broker non attivo in modalità test
                return;
            }

            if (!alpacaKeyId || !alpacaSecretKey) {
                dot.className = 'status-dot error'; // rosso se mancano chiavi
                return;
            }

            dot.className = 'status-dot warning'; // Giallo durante il check
            setSyncProgress(0);
            try {
                // 1. Verifica Account e Saldo
                const url = `${ALPACA_BASE}/v2/account`;
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'apca-api-key-id': alpacaKeyId,
                        'apca-api-secret-key': alpacaSecretKey
                    }
                });

                if (response.ok) {
                    const data = await response.json();

                    const dot = statusAL.querySelector('.status-dot');
                    dot.className = 'status-dot active';
                    dot.style.backgroundColor = '#10b981'; // Forza il verde

                    // L'utente può essere passato in TEST mode mentre la richiesta era in volo o
                    // sta collegando il feed in background: non sovrascrivere il capitale/stato 
                    // test con i dati broker
                    if (!useAlpacaBroker) return;

                    // Sincronizzazione Capitale Avanzata (Mirroring Alpaca Dashboard)
                    applyBrokerAccountSnapshot(data);
                    setSyncProgress(25);

                    // Ultima equity nota per contesto Alpaca (per il totale portafoglio header)
                    window.__equityByCtx = window.__equityByCtx || {};
                    window.__equityByCtx[window.liveMonitorActive ? 'alrt' : 'alp'] = tradingCapital;

                    // Log del capitale solo se cambia significativamente (> 1.00) o ogni 60s
                    if (Math.abs(tradingCapital - lastAlpacaEquityLog) > 1.00 || shouldLogStatus) {
                        console.log(`[ALPACA] Capital Sync: Equity=${tradingCapital.toFixed(2)}, Cash=${portfolioBalance.toFixed(2)}, PnL=${totalPnL.toFixed(2)}`);
                        lastAlpacaEquityLog = tradingCapital;
                    }


                    // Sincronizza posizioni e cronologia
                    await syncAlpacaPositions();
                    setSyncProgress(50);
                    await syncAlpacaOrders();
                    setSyncProgress(75);
                    await syncAlpacaHistory();
                    setSyncProgress(100);
                    // Ricalcola Tasso di successo/PnL Netto/ROI/Commissioni con i dati
                    // appena sincronizzati (altrimenti restano indietro di un ciclo,
                    // perché applyBrokerAccountSnapshot li aveva già calcolati PRIMA
                    // che posizioni/cronologia venissero aggiornate in questo giro).
                    updateDashboard();
                    updateWalletUI();
                } else {
                    const errData = await response.json();
                    console.error("[ALPACA] Dettaglio Errore:", errData);

                    // Se l'errore non è un 401, le chiavi sono VALIDE ma c'è un altro problema
                    if (response.status !== 401) {
                        const dot = statusAL.querySelector('.status-dot');
                        dot.className = 'status-dot active';
                        dot.style.backgroundColor = '#10b981';
                        console.log("[ALPACA] Chiavi valide (risposta ricevuta dal server).");
                    } else {
                        throw new Error(errData.message || "Errore server Alpaca");
                    }
                }
            } catch (err) {
                console.error("Alpaca Connection Error:", err);
                const dot = statusAL.querySelector('.status-dot');
                dot.className = 'status-dot error';
                dot.style.backgroundColor = '#ef4444';

                // Se l'errore è un fallimento di fetch verso localhost, è probabile un problema di SSL/Proxy
                if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
                    showNotification("Problema SSL Proxy: Apri https://localhost:8444 e clicca su 'Avanzate -> Procedi' per autorizzare la connessione.", "warning");
                    console.warn("[ALPACA] Possibile errore ERR_CERT_AUTHORITY_INVALID sul proxy locale.");
                }
            }
        }

        function updateStatusDots() {
            checkAlpacaConnection();
            checkFinnhubStatus(); // SEMPRE: anche da spento il LED deve aggiornarsi (colore "off")
            checkAlpacaLiveConnection(); // LED ALPrt (conto reale, solo monitor)
            updateWalletUI(); // aggiorna badge + valori in un unico passaggio
        }

        function checkFinnhubStatus() {
            // Lo stato Finnhub riflette la connessione WebSocket (i prezzi live arrivano da lì).
            // NON usiamo la REST /market/status: causa errori CORS e 429 (rate limit) dal browser.
            const dot = statusFH ? statusFH.querySelector('.status-dot') : null;
            if (!dot) return;
            if (!useFinnhubData) {
                dot.className = 'status-dot error'; // rosso: sorgente non attiva in modalità Alpaca Paper
                return;
            }
            if (!finnhubApiKey) {
                dot.className = 'status-dot error'; // rosso: nessuna chiave configurata
                return;
            }
            const ws = bgFinnhubWs;
            if (ws && ws.readyState === WebSocket.OPEN) {
                dot.className = 'status-dot active'; // verde: connesso
            } else if (ws && ws.readyState === WebSocket.CONNECTING) {
                dot.className = 'status-dot warning'; // giallo: in connessione
            } else {
                dot.className = 'status-dot error'; // rosso: disconnesso
            }
        }

        async function syncAlpacaPositions() {
            const mgr = getAlpacaManager();
            if (!mgr) return;
            try {
                const positions = await mgr.getPositions();
                if (!brokerViewActive()) return;

                let anyChanges = false;
                const currentSymbols = new Set(positions.map(p => p.symbol));

                for (const pos of positions) {
                    const sym = pos.symbol;
                    const isLong = pos.side === 'long';
                    const qty = Math.abs(parseFloat(pos.qty || 0)) || 0;
                    const entryPrice = parseFloat(pos.avg_entry_price || 0) || 0;

                    activePositions[sym] = activePositions[sym] || {};
                    if (!activePositions[sym].type) {
                        activePositions[sym] = {
                            type: isLong ? 'LONG' : 'SHORT',
                            entryPrice: entryPrice,
                            amount: qty,
                            invested: qty * entryPrice,
                            dynTP: null,
                            dynSL: null,
                            highestPrice: entryPrice,
                            lowestPrice: entryPrice,
                            isBot: false,
                            confidence: 50,
                            // /v2/positions NON fornisce l'ora di apertura (created_at non esiste):
                            // usa l'ora annotata da openTrade se l'ordine è partito da qui,
                            // altrimenti null e la ricaviamo dal primo FILL in syncAlpacaHistory.
                            // Mai Date.now(): mostrerebbe l'ora del sync, non quella di apertura.
                            openTime: pos.created_at ? new Date(pos.created_at).getTime() : takePendingOpenTime(sym)
                        };
                        anyChanges = true;
                    }
                    // Sincronizza SEMPRE il PnL non realizzato e il valore di mercato direttamente dal broker Alpaca
                    if (pos.unrealized_pl !== undefined) {
                        activePositions[sym].brokerUnrealizedPnL = parseFloat(pos.unrealized_pl || 0);
                    }
                    if (pos.market_value !== undefined) {
                        activePositions[sym].brokerMarketValue = parseFloat(pos.market_value || 0);
                    }
                }

                // Rimuovi le posizioni fantasma chiuse sul broker
                for (const sym in activePositions) {
                    if (!currentSymbols.has(sym) && !closingAssets.has(sym)) {
                        delete activePositions[sym];
                        anyChanges = true;
                    }
                }

                if (anyChanges) {
                    persistData();
                    renderOpenPositions();
                }
            } catch (e) { console.error("[ALPACA] Errore sync posizioni:", e); }
        }

        let _historySyncInFlight = false;
        let _historySyncQueued = false;
        async function syncAlpacaHistory() {
            const src = getBrokerHttp(); // Paper o conto REALE (ALrt, sola lettura)
            if (!brokerViewActive() || !src.key || !src.secret) return;
            // Collassa le chiamate ravvicinate: se una sync è già in corso non ne
            // avviamo un'altra in parallelo (stesso endpoint). Segniamo solo che
            // ne serve una finale, eseguita UNA sola volta al termine. Evita la
            // raffica di richieste identiche /v2/account/activities/FILL viste nel
            // log (spreco di chiamate + rischio rate-limit di Alpaca).
            if (_historySyncInFlight) { _historySyncQueued = true; return; }
            _historySyncInFlight = true;
            try {
                // Recupera fino a 1000 FILL storici per popolare tutta la cronologia (10 pagine da 100)
                // Cache per evitare rate limit (429) facendo 10 chiamate ogni 3 secondi
                let activities = [];
                let pageToken = '';
                const cacheKey = src.live ? 'live' : 'paper';
                let savedCache = {};
                try { savedCache = JSON.parse(localStorage.getItem('alpaca_activities_cache')) || {}; } catch (e) { }
                window.__alpacaActivitiesCache = window.__alpacaActivitiesCache || savedCache;
                const cached = window.__alpacaActivitiesCache[cacheKey] || [];
                const latestCachedId = cached.length > 0 ? cached[0].id : null;

                for (let i = 0; i < 10; i++) {
                    const url = `${src.base}/v2/account/activities/FILL?direction=desc&page_size=100${pageToken ? '&page_token=' + pageToken : ''}`;
                    const response = await fetch(url, {
                        headers: { 'apca-api-key-id': src.key, 'apca-api-secret-key': src.secret }
                    });
                    if (!response.ok) {
                        if (response.status === 429) console.warn('[ALPACA] Rate limit exceeded on activities fetch. Using cache.');
                        break;
                    }
                    const chunk = await response.json();
                    if (!chunk || chunk.length === 0) break;

                    let hitCache = false;
                    for (const act of chunk) {
                        if (act.id === latestCachedId || cached.some(c => c.id === act.id)) {
                            hitCache = true;
                            break;
                        }
                        activities.push(act);
                    }
                    if (hitCache) break;

                    if (chunk.length < 100) break; // Ultima pagina
                    pageToken = chunk[chunk.length - 1].id;
                }

                activities = activities.concat(cached);
                if (activities.length > 1000) activities = activities.slice(0, 1000);
                window.__alpacaActivitiesCache[cacheKey] = activities;
                try { localStorage.setItem('alpaca_activities_cache', JSON.stringify(window.__alpacaActivitiesCache)); } catch (e) { }

                if (activities.length > 0) {
                    // Cambio modalità durante la richiesta: non contaminare la modalità test
                    // né mescolare i dati Paper/Reale
                    if (!brokerViewActive() || getBrokerHttp().live !== src.live) return;
                    if (!activities || activities.length === 0) return;

                    let addedNew = false;
                    // Ricostruzione posizione per simbolo (normalizzato): basis separati per
                    // direzione. Un LONG apre con BUY e chiude con SELL; uno SHORT su azioni
                    // apre con SELL e chiude con BUY — il vecchio modello "ogni SELL è una
                    // chiusura" rendeva invisibili gli short e sporcava il costo medio dei long.
                    const longBasis = {};  // ns → { qty, price, time }
                    const shortBasis = {}; // ns → { qty, price, time }
                    const EPS = 0.000001;

                    // Elaboriamo dalla più vecchia alla più recente per costruire il costo medio.
                    // Ordiniamo ESPLICITAMENTE per timestamp: non assumiamo l'ordine di Alpaca
                    // (se una vendita venisse processata prima del suo acquisto, il costo medio
                    // mancherebbe e il PnL risulterebbe 0, sparendo dalle statistiche).
                    const sortedActivities = [...activities].sort((a, b) =>
                        new Date(a.transaction_time || a.filled_at || 0) - new Date(b.transaction_time || b.filled_at || 0));

                    const addToBasis = (store, ns, addQty, addPrice, time) => {
                        if (!store[ns] || store[ns].qty <= EPS) store[ns] = { qty: 0, price: 0, time: time };
                        const b = store[ns];
                        b.price = ((b.price * b.qty) + (addPrice * addQty)) / (b.qty + addQty);
                        b.qty += addQty;
                    };

                    sortedActivities.forEach(act => {
                        const side = act.side.toUpperCase();
                        const price = parseFloat(act.price);
                        const qty = parseFloat(act.qty);
                        const sym = act.symbol;
                        const ns = normFillSym(sym);
                        const rawTime = act.transaction_time || act.filled_at || new Date().toISOString();
                        const timestamp = new Date(rawTime).getTime() || Date.now();
                        const actId = act.id || act.transaction_id || `alpaca_${timestamp}_${sym}`;

                        // Una sola voce per fill di chiusura (dedup per id attività Alpaca)
                        // closeReason: il motivo annotato da closeTrade (SL/TP/HEDGE/...);
                        // assente per chiusure avvenute fuori dall'app → BROKER_SYNC
                        const pushRow = (type, entryPrice, closedQty, pnl, entryTime, closeReason) => {
                            if (tradeHistory.some(t => t.id === actId)) return;

                            // Aggiorna le statistiche globali (LIFETIME)
                            if (pnl !== 0 || entryPrice !== price) {
                                executedTrades++;
                                if (pnl > 0) {
                                    grossProfit += pnl;
                                    winTrades++;
                                } else if (pnl < 0) {
                                    grossLoss += Math.abs(pnl);
                                }
                            }

                            tradeHistory.push({
                                id: actId,
                                sym: sym,
                                type: type,                 // direzione della POSIZIONE chiusa
                                entryPrice: entryPrice,     // prezzo medio di apertura reale
                                exitPrice: price,           // prezzo di esecuzione effettivo
                                amount: closedQty,
                                pnl: pnl,
                                time: timestamp,
                                timestamp: timestamp,
                                entryTime: entryTime || (timestamp - 60000),
                                exitTime: timestamp,
                                fromBroker: true,
                                reason: closeReason || 'BROKER_SYNC',
                                status: 'COMPLETATO (BROKER)'
                            });
                            addedNew = true;
                        };

                        // L'entry annotato alla chiusura locale (closeTrade / chiusura esterna):
                        // copre il caso in cui il fill di apertura è fuori dalla finestra di 50.
                        const known = brokerEntryBasis[ns];

                        if (side === 'BUY') {
                            const sb = shortBasis[ns];
                            if (sb && sb.qty > EPS) {
                                // Copertura di uno short aperto nella finestra: PnL realizzato
                                const coverQty = Math.min(qty, sb.qty);
                                pushRow('SHORT', sb.price, coverQty, (sb.price - price) * coverQty, sb.time, (known && known.type === 'SHORT') ? known.reason : null);
                                sb.qty -= coverQty;
                                const rest = qty - coverQty;
                                if (rest > EPS) addToBasis(longBasis, ns, rest, price, timestamp);
                                // La nota di chiusura si riferisce a questo trade: consumala
                                // SOLO quando il lotto è davvero esaurito (sb.qty <= EPS). Un
                                // ordine di copertura che fila in più fill parziali (comune su
                                // crypto illiquide) altrimenti perdeva il motivo reale (SL/TP/
                                // BREAKEVEN) dal secondo fill in poi, ricadendo sul generico
                                // BROKER_SYNC per la maggior parte delle righe di cronologia.
                                if (known && known.type === 'SHORT' && sb.qty <= EPS) delete brokerEntryBasis[ns];
                            } else if (known && known.type === 'SHORT') {
                                // Copertura di uno short aperto PRIMA della finestra: usa l'entry annotato
                                pushRow('SHORT', known.price, qty, (known.price - price) * qty, known.time, known.reason);
                                delete brokerEntryBasis[ns];
                            } else {
                                // Acquisto normale: apre/incrementa il long. Nessuna voce in cronologia.
                                addToBasis(longBasis, ns, qty, price, timestamp);
                            }
                            return;
                        }

                        // SELL
                        const lb = longBasis[ns];
                        if (lb && lb.qty > EPS) {
                            // Chiusura (anche parziale) di un long: PnL rispetto al costo medio
                            const closeQty = Math.min(qty, lb.qty);
                            pushRow('LONG', lb.price, closeQty, (price - lb.price) * closeQty, lb.time, (known && known.type === 'LONG') ? known.reason : null);
                            lb.qty -= closeQty;
                            const rest = qty - closeQty;
                            if (rest > EPS) addToBasis(shortBasis, ns, rest, price, timestamp);
                            // La nota di chiusura si riferisce a questo trade: consumala SOLO
                            // quando il lotto è davvero esaurito (lb.qty <= EPS). Un ordine di
                            // chiusura che fila in più fill parziali (comune su crypto
                            // illiquide) altrimenti perdeva il motivo reale (SL/TP/BREAKEVEN)
                            // dal secondo fill in poi, ricadendo sul generico BROKER_SYNC per
                            // la maggior parte delle righe di cronologia (osservato 12/07/2026:
                            // 45/58 chiusure senza motivo reale).
                            if (known && known.type === 'LONG' && lb.qty <= EPS) delete brokerEntryBasis[ns];
                            return;
                        }
                        if (known && known.type === 'LONG') {
                            // Chiusura di un long aperto PRIMA della finestra: usa l'entry annotato
                            pushRow('LONG', known.price, qty, (price - known.price) * qty, known.time, known.reason);
                            delete brokerEntryBasis[ns];
                            return;
                        }
                        // SELL senza basis: se localmente risulta uno SHORT aperto su questo
                        // simbolo, è l'apertura dello short → niente voce (il PnL arriva col BUY)
                        const isOpenShort = Object.keys(activePositions).some(k =>
                            normFillSym(k) === ns && activePositions[k].type === 'SHORT');
                        if (isOpenShort) {
                            addToBasis(shortBasis, ns, qty, price, timestamp);
                            return;
                        }
                        // Fallback: PnL non calcolabile senza costo base. Voce neutra
                        // (entry=exit, pnl=0) filtrata da vista e statistiche.
                        pushRow('SHORT', price, qty, 0, null);
                    });

                    // ORA DI APERTURA REALE: il basis ricostruito dai FILL conserva il
                    // timestamp del PRIMO fill della posizione ancora aperta (b.time).
                    // Le posizioni recuperate dal sync broker non hanno created_at e
                    // resterebbero senza ora (o con l'ora del sync, se persistita da
                    // versioni precedenti): qui le correggiamo. Regola: vince il
                    // timestamp più VECCHIO, così non posticipiamo mai un'ora già
                    // corretta impostata all'invio dell'ordine locale.
                    let openTimeFixed = false;
                    for (const sym in activePositions) {
                        const posOpen = activePositions[sym];
                        const nsOpen = normFillSym(sym);
                        const basis = posOpen.type === 'SHORT' ? shortBasis[nsOpen] : longBasis[nsOpen];
                        if (basis && basis.qty > EPS && basis.time && (!posOpen.openTime || basis.time < posOpen.openTime)) {
                            posOpen.openTime = basis.time;
                            openTimeFixed = true;
                        }
                    }
                    if (openTimeFixed) {
                        persistData();
                        renderOpenPositions();
                    }


                    // Eliminato ricalcolo iterativo che distruggeva lo storico lifetime.
                    // I totali vengono ora incrementati correttamente in pushRow().

                    // Salvataggio per persistenza
                    localStorage.setItem('sim_gross_profit', grossProfit);
                    localStorage.setItem('sim_gross_loss', grossLoss);
                    localStorage.setItem('sim_executed_trades', executedTrades);
                    localStorage.setItem('sim_win_trades', winTrades);

                    if (addedNew) {
                        tradeHistory.sort((a, b) => b.time - a.time);

                        const todayStr = new Date().toLocaleDateString();
                        while (tradeHistory.length > 100) {
                            const oldestTrade = tradeHistory[tradeHistory.length - 1];
                            if (new Date(oldestTrade.time).toLocaleDateString() !== todayStr) {
                                tradeHistory.pop();
                            } else {
                                break;
                            }
                        }

                        localStorage.setItem('sim_trade_history', JSON.stringify(tradeHistory));
                        renderHistory();
                        // Logga SOLO quando la cronologia cambia davvero: evita le
                        // decine di righe identiche "43 operazioni" viste nel log.
                        console.log(`[SYNC] Cronologia broker aggiornata: ${activities.length} operazioni.`);
                    }
                }
            } catch (e) {
                console.warn("[SYNC ERROR] Storico broker non disponibile:", e);
            } finally {
                _historySyncInFlight = false;
                // Se sono arrivate altre richieste mentre eravamo in volo, ne
                // eseguiamo UNA finale per avere lo stato più aggiornato.
                if (_historySyncQueued) { _historySyncQueued = false; syncAlpacaHistory(); }
            }
        }

        if (testAlpacaBtn) {
            testAlpacaBtn.addEventListener('click', async () => {
                const key = alpacaKeyInput.value.trim();
                const secret = alpacaSecretInput ? alpacaSecretInput.value.trim() : '';
                if (!key || !secret) {
                    showNotification(tr('keys_required_test', 'Inserisci API Key e Secret Key per il test'), 'error');
                    return;
                }
                setTestBtnState(testAlpacaBtn, 'busy');
                let connOk = false;
                try {
                    // Test REALE contro l'endpoint Paper: legge solo il conto
                    const res = await fetch(`${ALPACA_BASE}/v2/account`, {
                        headers: { 'apca-api-key-id': key, 'apca-api-secret-key': secret }
                    });
                    connOk = res.ok;
                    showNotification(connOk ? tr('conn_ok', 'Connessione riuscita: chiavi valide.')
                        : tr('conn_fail', 'Connessione fallita: chiavi non valide o servizio non raggiungibile.'), connOk ? 'success' : 'error');
                } catch (e) {
                    showNotification(tr('conn_fail', 'Connessione fallita: chiavi non valide o servizio non raggiungibile.'), 'error');
                }
                setTestBtnState(testAlpacaBtn, connOk ? 'ok' : 'fail');
            });
        }

        // PayPal Modal Logic
        // (Listener consolidato in fondo al file)

        if (btnCancelDepositPaypal) {
            btnCancelDepositPaypal.addEventListener('click', () => {
                paypalModal.classList.add('hidden');
            });
        }

        // Preset amount buttons
        document.querySelectorAll('.paypal-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.paypal-preset').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                depositAmountInput.value = btn.dataset.amount;
            });
        });

        // Sync custom input with presets
        if (depositAmountInput) {
            depositAmountInput.addEventListener('input', () => {
                const val = parseFloat(depositAmountInput.value);
                document.querySelectorAll('.paypal-preset').forEach(btn => {
                    btn.classList.toggle('active', parseFloat(btn.dataset.amount) === val);
                });
            });
        }

        if (confirmDepositBtn) {
            confirmDepositBtn.addEventListener('click', () => {
                const amount = parseFloat(depositAmountInput.value);
                if (amount > 0) {
                    portfolioBalance += amount;
                    updateWalletUI();
                    // Flash the header portfolio green
                    const hpBal = document.getElementById('walletBalance');
                    if (hpBal) {
                        hpBal.style.transition = 'color 0.1s';
                        hpBal.style.color = '#34d399';
                        setTimeout(() => { hpBal.style.color = '#10b981'; }, 800);
                    }
                }
                paypalModal.classList.add('hidden');
            });
        }

        // PayPal Withdraw Modal Logic
        const btnWithdrawFunds = document.getElementById('btnWithdrawFunds');
        const paypalWithdrawModal = document.getElementById('paypalWithdrawModal');
        const cancelWithdrawBtn = document.getElementById('cancelWithdrawBtn');
        const btnSimulateWithdraw = document.getElementById('btnSimulateWithdraw');
        const withdrawAmount = document.getElementById('withdrawAmount');
        const withdrawMaxLabel = document.getElementById('withdrawMaxLabel');

        if (btnWithdrawFunds) {
            btnWithdrawFunds.addEventListener('click', () => {
                if (withdrawMaxLabel) withdrawMaxLabel.textContent = formatMoney(portfolioBalance);
                if (withdrawAmount) withdrawAmount.value = Math.min(1000, portfolioBalance).toFixed(2);
                if (paypalWithdrawModal) paypalWithdrawModal.classList.remove('hidden');
            });
        }

        if (cancelWithdrawBtn) {
            cancelWithdrawBtn.addEventListener('click', () => {
                if (paypalWithdrawModal) paypalWithdrawModal.classList.add('hidden');
            });
        }

        if (btnSimulateWithdraw) {
            btnSimulateWithdraw.addEventListener('click', () => {
                const amount = parseFloat(withdrawAmount.value);
                if (isNaN(amount) || amount <= 0) {
                    showNotification("Inserisci un importo valido.", "error");
                    return;
                }
                if (amount > portfolioBalance) {
                    showNotification("Fondi insufficienti nel portafoglio.", "error");
                    return;
                }

                portfolioBalance -= amount;
                updateWalletUI();
                showNotification(`Prelievo di ${formatMoney(amount)} simulato con successo verso PayPal.`, "success");

                // Flash the header portfolio red
                const hpBal = document.getElementById('walletBalance');
                if (hpBal) {
                    hpBal.style.transition = 'color 0.1s';
                    hpBal.style.color = '#ef4444';
                    setTimeout(() => { hpBal.style.color = '#e2e8f0'; }, 800);
                }

                if (paypalWithdrawModal) paypalWithdrawModal.classList.add('hidden');
            });
        }

        if (assetPairSelect) {
            assetPairSelect.addEventListener('change', (e) => {
                checkApiRequirement(e.target.value);
                // Il permesso di SHORT dipende da broker+asset selezionato
                if (typeof window.updateManualControlsAvailability === 'function') window.updateManualControlsAvailability();
            });
        }

        const btnClearHistory = document.getElementById('btnClearHistory');
        if (btnClearHistory) {
            btnClearHistory.addEventListener('click', () => {
                if (!confirm("Sei sicuro di voler resettare tutte le statistiche della sessione e la cronologia?")) return;

                tradeHistory = [];
                grossProfit = 0;
                grossLoss = 0;
                executedTrades = 0;
                winTrades = 0;
                totalPnL = 0;

                persistData(); // instrada su chiavi test o broker secondo la modalità
                updateWalletUI();
                updateDashboard();

                tradeListEl.innerHTML = `<div class="empty-state">${tr('history_cleared', 'Cronologia cancellata. In attesa di nuovi segnali...')}</div>`;
                showNotification("Statistiche e cronologia resettate.", "info");
            });
        }

        // Toggle ordinamento Cronologia (recente↔vecchio)
        const btnSortHistory = document.getElementById('btnSortHistory');
        if (btnSortHistory) {
            btnSortHistory.addEventListener('click', () => {
                historySortDesc = !historySortDesc;
                localStorage.setItem('sort_history_desc', String(historySortDesc));
                updateSortToggleUI('btnSortHistory', historySortDesc);
                renderHistory();
            });
            updateSortToggleUI('btnSortHistory', historySortDesc);
        }

        // ─── Esporta cronologia in CSV (separatore ';' + BOM: apre bene in Excel) ───
        const btnExportHistory = document.getElementById('btnExportHistory');
        if (btnExportHistory) {
            btnExportHistory.addEventListener('click', () => {
                if (!tradeHistory || tradeHistory.length === 0) {
                    showNotification(tr('export_nothing', 'Nessun dato da esportare.'), 'info');
                    return;
                }
                const esc = v => {
                    v = (v === null || v === undefined) ? '' : String(v);
                    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
                };
                const fmtTs = t => t ? new Date(t).toLocaleString('it-IT') : '';
                const header = ['IdTransazione', 'Simbolo', 'Tipo', 'Apertura', 'Chiusura', 'DurataSec',
                    'PrezzoEntrata', 'PrezzoUscita', 'Quantita', 'Investito', 'PnL', 'PnLPct',
                    'CommissioneStimataUsd', 'CommissioneStimataPct', 'Motivo', 'Stato'];
                const rows = [...tradeHistory]
                    .sort((a, b) => (b.time || 0) - (a.time || 0))
                    .map(t => {
                        const invested = t.invested || (t.entryPrice * t.amount) || 0;
                        const pnlPct = invested > 0 ? (t.pnl / invested) * 100 : 0;
                        const durSec = (t.exitTime && t.entryTime) ? Math.round((t.exitTime - t.entryTime) / 1000) : '';
                        // Invariante: in modalità broker (Alpaca Paper/Reale) OGNI voce
                        // arriva dal sync Alpaca con id reale (t.id) — il fallback NON scatta
                        // mai qui. L'id sintetico serve SOLO all'export in modalità TEST, dove
                        // i trade sono locali e privi di id (in broker mode non esistono).
                        const txId = t.id || `local_${t.time || 0}_${t.sym || ''}`;
                        // Stessa stima mostrata nella riga della cronologia in UI (getNetBreakevenPct)
                        const estFeePct = (typeof getNetBreakevenPct === 'function') ? getNetBreakevenPct(t.sym) : 0;
                        const estFeeUsd = invested * (estFeePct / 100);
                        return [
                            txId, displaySymbol(t.sym), t.type, fmtTs(t.entryTime || t.time), fmtTs(t.exitTime || t.time),
                            durSec, t.entryPrice, t.exitPrice, t.amount, invested.toFixed(2),
                            (t.pnl || 0).toFixed(4), pnlPct.toFixed(2),
                            estFeeUsd.toFixed(4), estFeePct.toFixed(2), t.reason || 'MANUAL', t.status || ''
                        ].map(esc).join(';');
                    });
                downloadCsv(rows, header, 'cronologia');
            });
        }

        // Helper condiviso dai 3 export (Aperte / Ordini / Cronologia):
        // separatore ';' + BOM per Excel, nome file con timestamp, notifica tradotta.
        function downloadCsv(rows, header, baseName) {
            const csv = '﻿' + [header.join(';')].concat(rows).join('\r\n'); // BOM per Excel
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${baseName}_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            showNotification(tr('export_done', 'Esportazione completata: {n} righe.', { n: rows.length }), 'success');
        }
        const csvEsc = v => {
            v = (v === null || v === undefined) ? '' : String(v);
            return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        };

        // ─── Esporta POSIZIONI APERTE in CSV (pannello Aperte) ───
        const btnExportOpenPositions = document.getElementById('btnExportOpenPositions');
        if (btnExportOpenPositions) {
            btnExportOpenPositions.addEventListener('click', () => {
                const syms = Object.keys(activePositions);
                if (syms.length === 0) {
                    showNotification(tr('export_nothing', 'Nessun dato da esportare.'), 'info');
                    return;
                }
                const header = ['Simbolo', 'Tipo', 'Apertura', 'PrezzoEntrata', 'PrezzoLive', 'Quantita',
                    'Investito', 'ValoreAttuale', 'PnL', 'PnLPct', 'CommissioneStimataUsd', 'CommissioneStimataPct',
                    'TP', 'SL', 'Stato'];
                const rows = syms
                    .map(sym => ({ sym, pos: activePositions[sym] }))
                    .sort((a, b) => ((b.pos.openTime || b.pos.firstSeenTime || 0) - (a.pos.openTime || a.pos.firstSeenTime || 0)))
                    .map(({ sym, pos }) => {
                        const livePrice = getLivePriceFor(sym) || pos.entryPrice;
                        // Stessa contabilità del pannello: PnL del broker se disponibile,
                        // altrimenti calcolato dal prezzo live
                        const unrealized = (pos.brokerUnrealizedPnL !== undefined && brokerViewActive())
                            ? pos.brokerUnrealizedPnL
                            : (pos.type === 'LONG' ? (livePrice - pos.entryPrice) : (pos.entryPrice - livePrice)) * pos.amount;
                        const invested = pos.invested || pos.entryPrice * pos.amount;
                        const pnlPct = invested > 0 ? (unrealized / invested) * 100 : 0;
                        // Stessa stima mostrata sotto TP/SL nella card della posizione in UI
                        const estFeePct = (typeof getNetBreakevenPct === 'function') ? getNetBreakevenPct(sym) : 0;
                        const estFeeUsd = invested * (estFeePct / 100);
                        return [
                            displaySymbol(sym), pos.type,
                            pos.openTime ? new Date(pos.openTime).toLocaleString('it-IT') : '',
                            pos.entryPrice, livePrice, pos.amount, invested.toFixed(2),
                            (invested + unrealized).toFixed(2), unrealized.toFixed(4), pnlPct.toFixed(2),
                            estFeeUsd.toFixed(4), estFeePct.toFixed(2),
                            pos.dynamicTP ? pos.dynamicTP.toFixed(2) + '%' : '',
                            pos.dynamicSL ? pos.dynamicSL.toFixed(2) + '%' : '',
                            pos.simulated ? 'SIMULATA' : 'APERTA (BROKER)'
                        ].map(csvEsc).join(';');
                    });
                downloadCsv(rows, header, 'posizioni_aperte');
            });
        }

        // ─── Esporta ORDINI in attesa in CSV (pannello Ordini) ───
        const btnExportPendingOrders = document.getElementById('btnExportPendingOrders');
        if (btnExportPendingOrders) {
            btnExportPendingOrders.addEventListener('click', () => {
                const orders = _lastPendingOrders || [];
                if (orders.length === 0) {
                    showNotification(tr('export_nothing', 'Nessun dato da esportare.'), 'info');
                    return;
                }
                const header = ['IdOrdine', 'Simbolo', 'Lato', 'TipoOrdine', 'Quantita', 'Notional',
                    'PrezzoLimite', 'PrezzoStop', 'Stato', 'DataInvio'];
                const rows = [...orders]
                    .sort((a, b) => (new Date(b.submitted_at || b.created_at || 0)) - (new Date(a.submitted_at || a.created_at || 0)))
                    .map(o => [
                        o.id || '', displaySymbol(o.symbol), (o.side || '').toUpperCase(), (o.type || '').toUpperCase(),
                        o.qty || '', o.notional || '', o.limit_price || '', o.stop_price || '',
                        (o.status || '').toUpperCase(),
                        (o.submitted_at || o.created_at) ? new Date(o.submitted_at || o.created_at).toLocaleString('it-IT') : ''
                    ].map(csvEsc).join(';'));
                downloadCsv(rows, header, 'ordini');
            });
        }

        function checkApiRequirement(symbol) {
            const isFinnhub = !symbol.endsWith('USDT');
            if (isFinnhub && !finnhubApiKey) {
                // Non apriamo più il modal automaticamente all'avvio per non disturbare l'utente
                console.warn(`[SYSTEM] Chiave Finnhub mancante per ${symbol}. I dati potrebbero non essere aggiornati.`);
                return;
            }

            // Log per debug utente: conferma che il bot non si ferma
            if (isBotActive) {
                console.log(`[SYSTEM] Cambio asset in corso (${symbol}). Il bot rimane ATTIVO in background.`);
            }

            connectToMarket(symbol);
            updateMarketRadarTarget(symbol);
        }

        function resetState(symbol) {
            // Non chiudiamo più i WebSocket qui per evitare interruzioni al trading di background.
            // La gestione delle connessioni è ora centralizzata in initBackgroundConnections.

            currentPrice = globalPrices[symbol] || 0;
            previousPrice = 0;

            // Recupera lo storico dal background engine per rendere il bot istantaneo
            if (bgPriceHistories && bgPriceHistories[symbol]) {
                priceHistory = [...bgPriceHistories[symbol]];
                console.log(`[SYSTEM] Sincronizzazione background: recuperati ${priceHistory.length} campioni per ${symbol}`);
            } else {
                priceHistory = [];
            }

            currentCandle = null;
            lastCandleTime = 0;

            ChartManager.setSymbol(symbol);

            // Lazy load della cronologia OHLC per il grafico quando si cambia asset
            const assetType = getAssetType(symbol);
            // Alpaca copre crypto + tutto ciò che è un'azione USA (incluso l'ETF LIT
            // in categoria COMMODITY); restano fuori solo i CFD OANDA:* (Capital.com)
            const isAlpacaCompatible = !symbol.includes('OANDA:');

            const doPreload = async () => {
                let data = null;
                if (isAlpacaCompatible && typeof tryAlpacaPreload === 'function' && !restrictedAssets.has(symbol)) {
                    data = await tryAlpacaPreload(symbol);
                }
                if (!data && typeof tryFinnhubPreload === 'function' && !restrictedAssets.has(symbol)) {
                    data = await tryFinnhubPreload(symbol);
                }
                // Forex/Materie OANDA: storico dal conto Capital.com (se configurato)
                if (!data && typeof tryCapitalPreload === 'function') {
                    data = await tryCapitalPreload(symbol);
                }
                if (data && assetPairSelect && assetPairSelect.value === symbol) {
                    ChartManager.setHistoricalData(data);
                    const lastPrice = data[data.length - 1].close;
                    currentPrice = lastPrice;
                    lastCandleTime = data[data.length - 1].time;
                    // Estende SUBITO il grafico all'ora corrente con l'ultimo prezzo
                    // live: senza, l'ultima candela restava a quella delle barre API.
                    const lpNow = getLivePriceFor(symbol);
                    if (lpNow > 0) {
                        currentPrice = lpNow;
                        ChartManager.pushPrice(lpNow, Math.floor(Date.now() / 1000));
                    }
                    if (typeof updatePriceUI === 'function') updatePriceUI();
                    console.log(`[CHART] Main series popolata (lazy switch) per ${symbol}`);
                } else if (!data && assetPairSelect && assetPairSelect.value === symbol) {
                    // Se entrambi i preload falliscono (es. storico non disponibile su free tier o no keys),
                    // recuperiamo almeno l'ultimo prezzo per resettare la Y-axis del grafico ed evitare $0.0000
                    const aType = getAssetType(symbol);
                    // Finnhub quote endpoint supports ONLY US stocks
                    if (finnhubApiKey && aType === 'STOCK') {
                        try {
                            const qRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubApiKey}`);
                            if (qRes.ok) {
                                const qData = await qRes.json();
                                if (qData && qData.c) {
                                    const now = Math.floor(Date.now() / 1000);
                                    const singleData = [{ time: now, open: qData.c, high: qData.c, low: qData.c, close: qData.c }];
                                    ChartManager.setHistoricalData(singleData);
                                    currentPrice = qData.c;
                                    if (typeof updatePriceUI === 'function') updatePriceUI();
                                    console.log(`[CHART] Main series fallback quote per ${symbol}: ${qData.c}`);
                                }
                            }
                        } catch (e) {
                            console.warn('Fallback quote err:', e);
                        }
                    }

                    // Se qRes ha fallito (es. 403 su Forex) e il grafico è ancora vuoto,
                    // usiamo i tick live accumulati in background come piano C (Extreme Fallback)
                    if (currentPrice === 0 || currentPrice === undefined) {
                        if (window.bgPriceHistories && window.bgPriceHistories[symbol] && window.bgPriceHistories[symbol].length > 0) {
                            const ticks = window.bgPriceHistories[symbol];
                            let now = Math.floor(Date.now() / 1000);
                            const fallbackData = [];
                            for (let i = ticks.length - 1; i >= 0; i--) {
                                const p = ticks[i];
                                fallbackData.unshift({ time: now, open: p, high: p, low: p, close: p });
                                now -= 60; // arretriamo di 1 minuto per ogni tick
                            }
                            ChartManager.setHistoricalData(fallbackData);
                            currentPrice = ticks[ticks.length - 1];
                            if (typeof updatePriceUI === 'function') updatePriceUI();
                            console.log(`[CHART] Main series fallback estremo (bg ticks) per ${symbol}`);
                        }
                    }
                }
            };
            doPreload().catch(e => console.error('[PRELOAD] Errore lazy load:', e));

            if (currentPriceEl) {
                currentPriceEl.style.color = '#94a3b8';
            }
            lastPriceUITime = 0;
            updatePriceUI();
            if (priceChangeEl) priceChangeEl.textContent = '--';

            // Aggiorna il nome visualizzato dell'asset (Stock Name / Pair Name)
            if (assetDisplayNameEl && assetPairSelect) {
                const selectedOption = assetPairSelect.options[assetPairSelect.selectedIndex];
                assetDisplayNameEl.textContent = selectedOption ? selectedOption.text : symbol;
            }

            // Riafferma lo stato del bot nella UI
            updateBotStatusLabel();

            // Update Icons
            const iconMap = {
                'BTCUSDT': '₿', 'ETHUSDT': '⟠', 'SOLUSDT': '◎', 'BNBUSDT': '🅱', 'XRPUSDT': '✕',
                'DOGEUSDT': '🐕', 'ADAUSDT': '🔷',
                'AAPL': '🍎', 'TSLA': '🚗', 'NVDA': '🟢', 'MSFT': '🪟', 'AMZN': '📦', 'GOOGL': '🔍', 'META': '👤',
                'OANDA:EUR_USD': '💱', 'OANDA:GBP_USD': '🇬🇧', 'OANDA:USD_JPY': '🇯🇵', 'OANDA:AUD_USD': '🇦🇺', 'OANDA:USD_CAD': '🇨🇦',
                'OANDA:XAU_USD': '🥇', 'OANDA:XAG_USD': '🥈', 'OANDA:BRENT_USD': '🛢️', 'OANDA:NATGAS_USD': '🔥'
            };
            assetIconEl.textContent = iconMap[symbol] || (symbol.includes('USDT') ? '₿' : symbol.includes('OANDA') ? '💱' : '📈');

            // Update Category Label
            const categoryLabelEl = document.getElementById('assetCategoryLabel');
            if (categoryLabelEl) {
                let category = 'Crypto';
                if (symbol.includes('OANDA:XAU') || symbol.includes('OANDA:XAG') || symbol.includes('OANDA:BRENT') || symbol.includes('OANDA:NATGAS') || symbol.includes('OANDA:WTI') || symbol.includes('OANDA:COPPER') || symbol === 'LIT') {
                    category = 'Commodity';
                } else if (symbol.includes('OANDA:')) {
                    category = 'Forex';
                } else if (!symbol.endsWith('USDT')) {
                    category = 'Stocks';
                }
                categoryLabelEl.textContent = category;
                categoryLabelEl.className = `category-badge category-${category.toLowerCase()}`;
            }

            // Reset della serie di confronto per evitare glitch visivi


            updateDashboard();

            // Lo stato della connessione è ora gestito individualmente dai pallini FH, AL
            syncFinnhubSubscriptions();
            syncAlpacaDataSubscriptions();
            preloadHistory(symbol);
        }

        // --- Manual Trading Logic ---
        // --- Bot Engine Control ---
        if (btnStartBot) {
            btnStartBot.addEventListener('click', () => {
                // Se stiamo per AVVIARE il bot, controlliamo che la connessione del contesto attuale sia attiva
                if (!isBotActive) {
                    const ctx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
                    let isArmed = false;
                    if (ctx === 'fh') isArmed = window.__connAllowed && window.__connAllowed.fh;
                    else if (ctx === 'alp') isArmed = window.__connAllowed && window.__connAllowed.alp;
                    else if (ctx === 'capd') isArmed = window.__connAllowed && window.__connAllowed.capd;
                    else if (ctx === 'capl') isArmed = window.__connWanted && window.__connWanted.capl;
                    else if (ctx === 'alrt') isArmed = window.__connWanted && window.__connWanted.alrt;

                    if (!isArmed) {
                        showNotification("Attiva l'interruttore di connessione per questo broker prima di avviare il trading automatico.", 'warning');
                        return;
                    }
                }

                // FASE D1: il tasto agisce sulla SCHEDA corrente; ogni contesto broker
                // ricorda il suo stato bot (ripristinato al ritorno sulla scheda).
                applyBotState(!isBotActive);
                botActiveByCtx[(typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh'] = isBotActive;
                if (typeof window.updateTabBotDots === 'function') window.updateTabBotDots();
            });
        }

        const aiModeToggle = document.getElementById('aiModeToggle');
        if (aiModeToggle) {
            // Ripristina stato salvato
            const savedAiMode = localStorage.getItem('sim_ai_mode');
            if (savedAiMode !== null) {
                aiModeToggle.checked = (savedAiMode === 'true');
            }

            aiModeToggle.addEventListener('change', (e) => {
                localStorage.setItem('sim_ai_mode', e.target.checked);
                updateBotStatusLabel();
                console.log(`[SYSTEM] Logica Algoritmo: ${e.target.checked ? 'AI Avanzata' : 'Standard EMA'}`);
            });
        }

        // Persistenza dei 5 moduli AI (Sentiment, LSTM, Risk, RL, Hedging)
        ['aiModeSentiment', 'aiModeLSTM', 'aiModeRisk', 'aiModeRL', 'aiModeHedging'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const saved = localStorage.getItem('sim_' + id);
            if (saved !== null) el.checked = (saved === 'true');
            el.addEventListener('change', (e) => {
                localStorage.setItem('sim_' + id, e.target.checked);
            });
        });

        // Ripristina la memoria del Reinforcement Learning
        try {
            const savedRl = localStorage.getItem('sim_rl_memory');
            if (savedRl) window.rlMemory = JSON.parse(savedRl);
        } catch (err) {
            localStorage.removeItem('sim_rl_memory');
        }

        // Initial label state — bot riprende se era attivo
        if (btnStartBot) {
            const t = translations[currentLang] || translations.IT;
            if (isBotActive) {
                btnStartBot.innerHTML = `<span class="bot-icon">⏸</span> ${t.stop_bot}`;
                btnStartBot.classList.add('running');
                requestWakeLock();
                startKeepAlive();
            } else {
                btnStartBot.innerHTML = `<span class="bot-icon">▶</span> ${t.start_bot}`;
                btnStartBot.classList.remove('running');
            }
        }
        updateBotStatusLabel();

        // Quantità manuale dal box accanto ai tasti (vuoto = importo automatico)
        function readManualQty(sym) {
            const el = document.getElementById('manualQty');
            const q = el ? parseFloat(el.value) : 0;
            if (q > 0) window.__manualQtyOverride = { sym, qty: q };
        }

        // Disponibilità dei tasti manuali per broker/asset: lo SHORT è disattivato
        // dove il broker non lo consente (Alpaca: mai sulle crypto). Rispetta anche
        // lo stato del bot (a bot attivo i tasti restano disabilitati).
        window.updateManualControlsAvailability = function () {
            if (!btnSell) return;
            const sym = assetPairSelect ? assetPairSelect.value : '';
            const type = getAssetType(sym);
            const ctx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
            const shortAllowed = !((ctx === 'alp' || ctx === 'alrt') && type === 'CRYPTO');
            const disabled = isBotActive || !shortAllowed;
            btnSell.disabled = disabled;
            btnSell.style.opacity = disabled ? '0.4' : '';
            btnSell.style.cursor = disabled ? 'not-allowed' : '';
            btnSell.setAttribute('data-tooltip', shortAllowed
                ? 'Apre la posizione selezionata nella box SHORT (guadagni se il prezzo scende).'
                : 'SHORT non disponibile: Alpaca non consente la vendita allo scoperto sulle criptovalute.');
        };

        if (btnBuy) {
            btnBuy.addEventListener('click', () => {
                const sym = assetPairSelect.value;
                const price = globalPrices[sym] || currentPrice;
                console.log(`[MANUAL] Richiesta BUY su ${sym} a ${price}`);
                if (!activePositions[sym] && price > 0) {
                    readManualQty(sym);
                    openTrade('LONG', price, sym);
                } else {
                    showNotification("Impossibile aprire la posizione: prezzo non valido o posizione già aperta.", "warning");
                }
            });
        }

        if (btnSell) {
            btnSell.addEventListener('click', () => {
                const sym = assetPairSelect.value;
                const price = globalPrices[sym] || currentPrice;
                console.log(`[MANUAL] Richiesta SELL su ${sym} a ${price}`);

                if (useAlpacaBroker && getAssetType(sym) === 'CRYPTO') {
                    showNotification("Alpaca non supporta lo SHORT (vendita allo scoperto) sulle Criptovalute.", "warning");
                    return;
                }
                readManualQty(sym);

                if (!activePositions[sym] && price > 0) {
                    openTrade('SHORT', price, sym);
                } else {
                    showNotification("Impossibile aprire la posizione: prezzo non valido o posizione già aperta.", "warning");
                }
            });
        }



        // Scopo globale per chiudere dalla lista posizioni aperte
        window.closeTradeGlobal = async function (sym) {
            if (activePositions[sym]) {
                const price = globalPrices[sym] || activePositions[sym].entryPrice;
                closingAssets.add(sym);
                renderOpenPositions(); // Feedback immediato
                await closeTrade(sym, price, 'MANUAL');
                closingAssets.delete(sym);
                renderOpenPositions(); // Forza aggiornamento finale
                if (useAlpacaBroker) syncAlpacaHistory(); // Sincronizza subito con Alpaca
            }
        };

        // Forza la chiusura solo locale (per casi come restrizioni PDT o broker offline)
        window.forceCloseLocal = function (sym) {
            if (!activePositions[sym]) return;
            if (!confirm(`Vuoi davvero rimuovere ${sym} SOLO dal simulatore? La posizione reale sul broker RESTERÀ APERTA. Usa questo solo se hai già gestito l'ordine manualmente.`)) return;

            const pos = activePositions[sym];
            const price = getLivePriceFor(sym) || pos.entryPrice;
            const pnl = pos.type === 'LONG' ? (price - pos.entryPrice) * pos.amount : (pos.entryPrice - price) * pos.amount;

            addTradeToHistory(pos.type, pos.entryPrice, price, pnl, pos.amount, sym, pos.openTime, Date.now(), false, 'FORCE_LOCAL');
            delete activePositions[sym];
            persistData();
            updateDashboard();
            renderOpenPositions();
            showNotification(`Posizione ${sym} rimossa localmente.`, "info");
        };



        // AI Signal UI overlay
        let lastRadarUpdate = {};
        let currentRadarFilter = 'ALL';
        let lastEngineSignal = null; // ultimo segnale BUY/SELL emesso dal motore (per pannello stato)

        function showAISignal(sym, decision) {
            const now = Date.now();
            if (decision.signal === 'BUY' || decision.signal === 'SELL') {
                lastEngineSignal = { sym, signal: decision.signal, confidence: decision.confidence, time: now };
            }
            // Throttling: non aggiornare la UI del radar per lo stesso simbolo più di una volta al secondo (abbassato a 500ms per evitare race conditions con STRAT_COOLDOWN)
            if (lastRadarUpdate[sym] && now - lastRadarUpdate[sym] < 500) return;
            lastRadarUpdate[sym] = now;

            const type = getAssetType(sym);
            if (currentRadarFilter !== 'ALL' && currentRadarFilter !== type) return;

            const signalColors = {
                'BUY': '#10b981', 'SELL': '#ef4444', 'HOLD': '#94a3b8',
                'EXIT_LONG': '#f59e0b', 'EXIT_SHORT': '#f59e0b'
            };
            const color = signalColors[decision.signal] || '#94a3b8';
            const assetIcons = { 'CRYPTO': '🔸', 'STOCK': '📈', 'FOREX': '💱', 'COMMODITY': '⛽' };
            const assetIcon = assetIcons[type] || '💰';
            // HH:MM senza secondi: lascia spazio al simbolo (leggibilità prima di tutto)
            const timeStr = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false });
            const dispSym = displaySymbol(sym);

            // Add to radar panel as AI signal
            const radarEl = document.getElementById('radarList');
            if (radarEl) {
                const el = document.createElement('div');
                el.className = 'radar-signal';
                el.dataset.type = type;
                el.style.borderLeft = `3px solid ${color}`;
                el.innerHTML = `
                    <span style="font-weight:bold;font-size:0.72rem;"><span style="color:#fff;">${assetIcon} ${dispSym}</span> <span style="color:${color}">${decision.signal}</span></span>
                    <span style="font-size:0.62rem;color:var(--text-secondary);">${decision.confidence}% • ${timeStr}</span>
                `;
                el.title = decision.reasoning;
                radarEl.prepend(el);
                if (radarEl.children.length > 40) radarEl.removeChild(radarEl.lastChild);
            }
        }







        var _lastRenderedHistoryJSON = null;
        function renderHistory() {
            if (window.__ctxOverride) return;
            const historyCountBadge = document.getElementById('historyCountBadge');
            // Il tasto Cancella è stato rimosso dalla UI (i portafogli test si
            // azzerano a ogni avvio; in modalità broker la cronologia è del conto).

            let validHistoryCount = 0;
            tradeHistory.forEach(trade => {
                if (!trade || !trade.sym || trade.sym === 'undefined') return;
                if (!brokerViewActive() && (trade.fromBroker || trade.reason === 'BROKER_SYNC')) return;
                if (trade.reason === 'BROKER_SYNC' && trade.pnl === 0 && trade.entryPrice === trade.exitPrice) return;
                validHistoryCount++;
            });

            if (historyCountBadge) {
                const count = validHistoryCount;
                historyCountBadge.textContent = count;
                historyCountBadge.style.display = count > 0 ? 'inline-block' : 'none';
            }
            if (!tradeListEl) return;

            // La lingua fa parte della cache key: senza, il cambio lingua non
            // rigenerava le righe (stesso JSON) e le etichette restavano vecchie
            const currentJSON = JSON.stringify(tradeHistory) + '|' + historySortDesc + '|' + currentLang;
            if (_lastRenderedHistoryJSON === currentJSON) return;
            _lastRenderedHistoryJSON = currentJSON;

            tradeListEl.innerHTML = '';
            if (tradeHistory.length === 0) {
                tradeListEl.innerHTML = `<div class="empty-state">${tr('waiting_trades', 'In attesa di operazioni...')}</div>`;
                return;
            }

            const fragment = document.createDocumentFragment();
            // Ordina esplicitamente per data di chiusura secondo il toggle utente
            // (non assume che tradeHistory sia già ordinato): default = più recenti prima.
            // Ottimizzazione performance: mostra solo le prime 100 dopo l'ordinamento.
            const visibleHistory = [...tradeHistory]
                .sort((a, b) => historySortDesc ? ((b.time || 0) - (a.time || 0)) : ((a.time || 0) - (b.time || 0)))
                .slice(0, 100);
            visibleHistory.forEach(trade => {
                // Ulteriore sicurezza: salta se malformato
                if (!trade || !trade.sym || trade.sym === 'undefined') return;

                // In modalità TEST la cronologia del broker non deve MAI apparire
                if (!brokerViewActive() && (trade.fromBroker || trade.reason === 'BROKER_SYNC')) return;

                // Salta le operazioni BROKER_SYNC con PnL zero e senza prezzo di uscita valido
                // (sono i vecchi BUY inseriti erroneamente dalla versione precedente del codice)
                if (trade.reason === 'BROKER_SYNC' && trade.pnl === 0 && trade.entryPrice === trade.exitPrice) return;

                const row = document.createElement('div');
                row.className = `trade-row ${trade.type}`;

                // Parser robusto per le date (gestisce sia timestamp che stringhe legacy)
                const parseDate = (d) => {
                    if (!d) return new Date();
                    // Se è già un numero (timestamp), usalo direttamente
                    if (typeof d === 'number') return new Date(d);
                    // Se è una stringa oraria (es. "12:19:08"), aggiungi la data odierna
                    if (typeof d === 'string' && d.includes(':') && !d.includes('-') && !d.includes('T')) {
                        const now = new Date();
                        const parts = d.split(':');
                        now.setHours(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2] || 0));
                        return now;
                    }
                    const parsed = new Date(d);
                    return isNaN(parsed.getTime()) ? new Date() : parsed;
                };

                const entryTimeStr = parseDate(trade.entryTime || trade.time).toLocaleString(uiLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const exitTimeStr = parseDate(trade.exitTime || trade.time).toLocaleString(uiLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

                const tradeSym = trade.sym || trade.symbol || '???';
                const decimals = tradeSym.includes('OANDA') ? 4 : (trade.entryPrice < 1 ? 6 : (trade.entryPrice < 10 ? 4 : 2));
                const invested = trade.invested || trade.entryPrice * trade.amount;
                const pnlPct = invested > 0 ? (trade.pnl / invested) * 100 : 0;
                const isPositive = trade.pnl > 0;
                const pnlClass = trade.pnl === 0 ? 'neutral' : (isPositive ? 'positive' : 'negative');
                const pnlSign = isPositive ? '+' : '';

                const type = getAssetType(tradeSym);
                const icons = { 'CRYPTO': '🔸', 'STOCK': '📈', 'FOREX': '💱', 'COMMODITY': '⛽' };
                const icon = icons[type] || '💰';
                const catLabels = {
                    'CRYPTO': tr('asset_cat_crypto', 'Crypto'), 'STOCK': tr('asset_cat_stock', 'Azione'),
                    'FOREX': tr('asset_cat_forex', 'Forex'), 'COMMODITY': tr('asset_cat_commodity', 'Commodity')
                };
                const catLabel = catLabels[type] || 'Asset';

                const durationMs = trade.exitTime && trade.entryTime ? trade.exitTime - trade.entryTime : 0;
                const durationStr = formatDuration(durationMs);

                const reasonColors = { 'TP': '#10b981', 'SL': '#ef4444', 'TRAILING_SL': '#f59e0b', 'BREAKEVEN': '#38bdf8', 'HEDGE_PROTECTION': '#f97316', 'SIGNAL': '#8b5cf6', 'MANUAL': '#94a3b8', 'BROKER_SYNC': '#60a5fa' };
                const reasonLabels = {
                    'TP': tr('tip_tp', 'Take Profit: Operazione chiusa in guadagno automatico'),
                    'SL': tr('tip_sl', 'Stop Loss: Operazione chiusa per limitare le perdite'),
                    'TRAILING_SL': tr('tip_trailing_sl', 'Trailing Stop: chiusa in profitto dopo un\'inversione del prezzo'),
                    'BREAKEVEN': tr('tip_breakeven', 'Break-even: chiusa a pari dopo un ritracciamento dal profitto'),
                    'HEDGE_PROTECTION': tr('tip_hedge', 'Protezione: chiusura d\'emergenza per crollo oltre la soglia di sicurezza'),
                    'SIGNAL': tr('tip_signal', 'Signal: Operazione aperta/chiusa in base ai segnali del bot'),
                    'MANUAL': tr('tip_manual', 'Manuale: Operazione gestita direttamente dall\'utente'),
                    'BROKER_SYNC': tr('tip_broker_sync', 'Broker Sync: Operazione sincronizzata direttamente dal conto Alpaca')
                };
                const typeLabels = {
                    'LONG': tr('tip_long', 'Long: posizione di acquisto (guadagna se il prezzo sale)'),
                    'SHORT': tr('tip_short', 'Short: vendita allo scoperto (guadagna se il prezzo scende)')
                };

                const reasonColor = reasonColors[trade.reason] || '#94a3b8';
                const reasonTip = reasonLabels[trade.reason] || reasonLabels['MANUAL'];
                const typeTip = typeLabels[trade.type] || '';

                // Stima fee+spread di andata/ritorno (stessa metrica delle posizioni
                // aperte, vedi getNetBreakevenPct): non è un valore confermato dal
                // broker, la cronologia non registra la commissione fill-per-fill.
                const estFeePct = (typeof getNetBreakevenPct === 'function') ? getNetBreakevenPct(tradeSym) : 0;
                const estFeeUsd = invested * (estFeePct / 100);

                // Layout impilato: sta nella larghezza della colonna senza scrollbar orizzontale.
                // Header uniforme agli altri pannelli: icona + simbolo bianco 0.85rem,
                // etichetta categoria maiuscola piccola, badge direzione a pillola.
                const typeBadgeColor = trade.type === 'LONG' ? '#10b981' : '#ef4444';
                row.innerHTML = `
                    <div class="trade-row-top">
                        <span class="trade-side" title="${typeTip}">${icon} <strong style="color:#fff; margin-right:4px; font-size:0.85rem;">${escHtml(displaySymbol(trade.sym))}</strong> <span style="font-size: 0.6rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; font-weight: normal; margin-right: 4px;">${catLabel}</span> <span style="font-size: 0.6rem; font-weight: bold; padding: 2px 6px; border-radius: 4px; background: ${typeBadgeColor}26; color: ${typeBadgeColor};">${trade.type}</span></span>
                        <span class="trade-pnl ${pnlClass}">${pnlSign}${formatMoney(trade.pnl, 2, 4)} <small>${pnlSign}${pnlPct.toFixed(2)}%</small></span>
                    </div>
                    <div class="trade-leg">
                        <span class="trade-leg-badge in">IN</span> ${entryTimeStr}
                        <span class="trade-leg-price">@ ${formatMoney(trade.entryPrice, decimals, decimals)}</span>
                    </div>
                    <div class="trade-leg">
                        <span class="trade-leg-badge out">OUT</span> ${exitTimeStr}
                        <span class="trade-leg-price">@ ${formatMoney(trade.exitPrice, decimals, decimals)}</span>
                    </div>
                    <div class="trade-row-mid">
                        <span class="trade-reason" style="background: ${reasonColor}22; color: ${reasonColor}; border: 1px solid ${reasonColor}55;" title="${reasonTip}">${trade.reason || 'MANUAL'}</span>
                        <span class="trade-duration">${tr('lbl_duration', 'Durata')}: <strong>${durationStr}</strong></span>
                    </div>
                    <div class="trade-row-mid" style="margin-top: 2px;">
                        <span class="trade-duration" title="${tr('tip_fee_est', 'Stima fee + spread di andata/ritorno (non è un valore confermato dal broker)')}">💸 ${tr('lbl_fee_est', 'Comm.')} <strong style="color:#f59e0b;">${formatMoney(estFeeUsd)} (${estFeePct.toFixed(2)}%)</strong></span>
                    </div>
                `;
                fragment.appendChild(row);
            });
            tradeListEl.appendChild(fragment);
        }


        function updateDashboard() {
            if (window.__ctxOverride) return;
            // Ricalcolo Dinamico Statistiche
            let totalTrades = 0;
            let totalWins = 0;
            let totalWinningTrades = 0;
            let totalLosingTrades = 0;
            let totalBreakevenTrades = 0;
            let totalGrossProfit = 0;
            let totalGrossLoss = 0;
            let totalRealizedPnL = 0;
            // Somma delle stime BASE (non calibrate) sui trade visibili: il
            // rapporto con le commissioni REALI dedotte dall'equity alimenta la
            // calibrazione automatica del modello fee (updateFeeCalibration).
            let rawFeeEstTotal = 0;

            tradeHistory.forEach(trade => {
                // Ulteriore sicurezza: salta se malformato
                if (!trade || !trade.sym || trade.sym === 'undefined') return;

                // In modalità TEST la cronologia del broker non deve MAI apparire
                if (!brokerViewActive() && (trade.fromBroker || trade.reason === 'BROKER_SYNC')) return;

                // Filtro identico alla cronologia visiva per escludere trade fantasma
                if (trade.reason === 'BROKER_SYNC' && trade.pnl === 0 && trade.entryPrice === trade.exitPrice) return;

                totalTrades++;
                totalRealizedPnL += trade.pnl;
                if (trade.pnl > 0) {
                    totalWins++;
                    totalWinningTrades++;
                    totalGrossProfit += trade.pnl;
                } else if (trade.pnl < 0) {
                    totalGrossLoss += Math.abs(trade.pnl);
                    totalLosingTrades++;
                } else {
                    totalBreakevenTrades++;
                }
                if (typeof getRawBreakevenPct === 'function') {
                    const tInvested = trade.invested || (trade.entryPrice * trade.amount) || 0;
                    rawFeeEstTotal += tInvested * (getRawBreakevenPct(trade.sym) / 100);
                }
            });

            const totalTradesEl = document.getElementById('totalTrades');
            let openUnrealizedTotal = 0;
            let openMarketValueTotal = 0;
            let openFeeTotal = 0;
            for (let sym in activePositions) {
                const p = activePositions[sym];
                const livePrice = getLivePriceFor(sym) || p.entryPrice;
                let pnl = 0;
                if (p.brokerUnrealizedPnL !== undefined && brokerViewActive()) {
                    pnl = p.brokerUnrealizedPnL;
                } else if (livePrice > 0) {
                    pnl = p.type === 'LONG' ? (livePrice - p.entryPrice) * p.amount : (p.entryPrice - livePrice) * p.amount;
                }
                openUnrealizedTotal += pnl;
                if (p.brokerMarketValue !== undefined && brokerViewActive()) {
                    openMarketValueTotal += p.brokerMarketValue;
                } else if (livePrice > 0) {
                    openMarketValueTotal += p.amount * livePrice;
                }
                // Somma delle commissioni stimate (stessa metrica di ogni card, vedi
                // getNetBreakevenPct): totale per l'header del pannello Aperte.
                const pInvested = p.invested || p.entryPrice * p.amount;
                const pFeePct = (typeof getNetBreakevenPct === 'function') ? getNetBreakevenPct(sym) : 0;
                openFeeTotal += pInvested * (pFeePct / 100);
            }

            let currentCommissions = 0;
            if (brokerViewActive()) {
                // Sostituiamo il PnL Realizzato calcolato matematicamente per far quadrare i conti
                const trueRealizedPnL = totalPnL - openUnrealizedTotal;
                const gap = trueRealizedPnL - totalRealizedPnL;

                if (gap < -0.01) {
                    // Se abbiamo perso più di quanto dicono i trade, la differenza sono le commissioni
                    currentCommissions = Math.abs(gap);
                }
            } else {
                currentCommissions = globalCommissions;
            }

            // Per avere una matematica PERFETTA a schermo:
            // PNL TOTALE (Lordo) = totalRealizedPnL (la somma dei trade in cronologia)
            // COMMISSIONI = currentCommissions
            // PNL NETTO = PNL TOTALE - COMMISSIONI
            const calculatedNetPnL = totalRealizedPnL - currentCommissions;

            // Allineiamo il Capitale Iniziale per garantire che:
            // Equity Attuale (tradingCapital) = Capitale Iniziale + PNL Netto + Unrealized
            const adjustedInitialCapital = tradingCapital - calculatedNetPnL - openUnrealizedTotal;
            if (adjustedInitialCapital > 0) {
                sessionInitialCapital = adjustedInitialCapital;
                const initialCapitalEl = document.getElementById('initialCapital');
                // formatMoney include già il simbolo valuta (il '$' extra mostrava "$$1,009.30")
                if (initialCapitalEl) initialCapitalEl.textContent = formatMoney(sessionInitialCapital);
            }

            // Per far combaciare l'Equity Attuale, modifichiamo solo visivamente il PNL NETTO
            // in modo che corrisponda al calcolo esatto della UI
            window.__trueRealizedPnL = calculatedNetPnL;
            window.__globalCommissions = currentCommissions;

            // Calibrazione fee: solo in modalità broker, dove currentCommissions
            // è un dato REALE dedotto dall'equity (in test è un ledger locale).
            // Le guardie anti-rumore (campione minimo) sono dentro la funzione.
            if (brokerViewActive() && typeof updateFeeCalibration === 'function') {
                updateFeeCalibration(getBrokerCtx(), currentCommissions, rawFeeEstTotal, totalTrades);
            }

            globalTotalRealizedPnL = totalRealizedPnL;
            const totalPnLEl = document.getElementById('totalPnL');
            const winRateEl = document.getElementById('winRate');
            const grossProfitEl = document.getElementById('grossProfit');
            const grossLossEl = document.getElementById('grossLoss');
            const winningTradesCountEl = document.getElementById('winningTradesCount');
            const losingTradesCountEl = document.getElementById('losingTradesCount');
            const breakevenTradesCountEl = document.getElementById('breakevenTradesCount');
            const unrealizedPnLEl = document.getElementById('unrealizedPnL');

            const sessionRevenueEl = document.getElementById('sessionRevenue');
            const commissionsDisplayEl = document.getElementById('commissionsDisplay');
            const capitalCommissionsDisplayEl = document.getElementById('capitalCommissionsDisplay');
            const totalNetPnLEl = document.getElementById('totalNetPnL');

            if (commissionsDisplayEl) {
                commissionsDisplayEl.textContent = `-${formatMoney(window.__globalCommissions || 0)}`;
            }
            if (capitalCommissionsDisplayEl) {
                capitalCommissionsDisplayEl.textContent = `-${formatMoney(window.__globalCommissions || 0)}`;
            }
            if (totalNetPnLEl) {
                const net = window.__trueRealizedPnL || 0;
                const sign = net >= 0 ? '+' : '';
                totalNetPnLEl.textContent = `${sign}${formatMoney(net)}`;
                totalNetPnLEl.style.color = net > 0 ? '#10b981' : net < 0 ? '#ef4444' : '#fff';
            }
            const sessionROIEl = document.getElementById('sessionROI');

            if (totalTradesEl) totalTradesEl.textContent = totalTrades;

            const perfOpenCountBadge = document.getElementById('perfOpenCountBadge');
            if (perfOpenCountBadge) {
                const count = Object.keys(activePositions).length;
                perfOpenCountBadge.textContent = count;
                perfOpenCountBadge.style.display = count > 0 ? 'inline-block' : 'none';
            }

            // PnL Realizzato (Mostrato nel box PnL Realizzato Totale in Pannello Prestazioni)
            if (totalPnLEl) {
                const sign = totalRealizedPnL >= 0 ? '+' : '';
                totalPnLEl.textContent = `${sign}${formatMoney(totalRealizedPnL)}`;
                totalPnLEl.style.color = totalRealizedPnL > 0 ? '#10b981' : totalRealizedPnL < 0 ? '#ef4444' : '#fff';
            }

            // PnL Non Realizzato
            if (unrealizedPnLEl) {
                const sign = openUnrealizedTotal >= 0 ? '+' : '';
                unrealizedPnLEl.textContent = `${sign}${formatMoney(openUnrealizedTotal)}`;
                unrealizedPnLEl.style.color = openUnrealizedTotal >= 0 ? '#10b981' : '#ef4444';
            }

            if (grossProfitEl) grossProfitEl.textContent = `${totalGrossProfit > 0 ? '+' : ''}${formatMoney(totalGrossProfit)}`;
            if (grossLossEl) grossLossEl.textContent = `${totalGrossLoss > 0 ? '-' : ''}${formatMoney(totalGrossLoss)}`;
            if (winningTradesCountEl) winningTradesCountEl.textContent = totalWinningTrades;
            if (losingTradesCountEl) losingTradesCountEl.textContent = totalLosingTrades;
            if (breakevenTradesCountEl) breakevenTradesCountEl.textContent = totalBreakevenTrades;



            // Riepilogo Netto Cronologia
            const historyDailyNetEl = document.getElementById('historyDailyNet');
            if (historyDailyNetEl) {
                const hSign = totalRealizedPnL >= 0 ? '+' : '';
                historyDailyNetEl.textContent = `${hSign}${formatMoney(totalRealizedPnL)}`;
                historyDailyNetEl.style.color = totalRealizedPnL > 0 ? '#10b981' : totalRealizedPnL < 0 ? '#ef4444' : '#fff';
            }
            // Totale commissioni REALI lifetime (stessa fonte del box "Commissioni" in
            // Gestione Capitale/Prestazioni), così i due valori coincidono sempre.
            const historyFeeTotalEl = document.getElementById('historyFeeTotal');
            if (historyFeeTotalEl) {
                const realCommissions = window.__globalCommissions || 0;
                historyFeeTotalEl.textContent = `💸 ${formatMoney(realCommissions)}`;
                historyFeeTotalEl.style.display = realCommissions > 0 ? 'inline-block' : 'none';
            }

            // Riepilogo Netto Latente (Posizioni Aperte)
            const openDailyNetEl = document.getElementById('openDailyNet');
            const openTotalValueEl = document.getElementById('openTotalValue');
            if (openTotalValueEl) {
                openTotalValueEl.textContent = `Valore: ${formatMoney(openMarketValueTotal)}`;
            }
            // Totale commissioni stimate, tra il valore e il conteggio nell'header
            const openFeeTotalEl = document.getElementById('openFeeTotal');
            if (openFeeTotalEl) {
                openFeeTotalEl.textContent = `💸 ${formatMoney(openFeeTotal)}`;
                openFeeTotalEl.style.display = openFeeTotal > 0 ? 'inline-block' : 'none';
            }
            if (openDailyNetEl) {
                const oSign = openUnrealizedTotal >= 0 ? '+' : '';
                openDailyNetEl.textContent = `${oSign}${formatMoney(openUnrealizedTotal)}`;
                openDailyNetEl.style.color = openUnrealizedTotal > 0 ? '#10b981' : openUnrealizedTotal < 0 ? '#ef4444' : '#fff';
            }

            if (sessionROIEl) {
                // PnL Netto (al netto delle commissioni reali) / Capitale Iniziale, per
                // coerenza col box "PnL Netto" mostrato nello stesso pannello.
                const roi = (sessionInitialCapital > 0) ? (calculatedNetPnL / sessionInitialCapital) * 100 : 0;
                sessionROIEl.textContent = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
                sessionROIEl.style.color = roi >= 0 ? '#10b981' : '#ef4444';
            }

            if (winRateEl) {
                const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : 0;
                winRateEl.textContent = `${winRate}%`;
            }

            // Forza l'aggiornamento dell'etichetta bot ad ogni refresh della dashboard
            updateBotStatusLabel();

            // Visibilità pulsanti trading manuale
            if (activePositions[assetPairSelect.value]) {
                // Se c'è una posizione aperta, mostriamo i bottoni di apertura (per incrementare) 
                openActions.classList.remove('hidden');
            } else {
                openActions.classList.remove('hidden');
            }

            renderOpenPositions();
        }




        // Toggle ordinamento Posizioni Aperte (recente↔vecchio)
        const btnSortOpenPositions = document.getElementById('btnSortOpenPositions');
        if (btnSortOpenPositions) {
            btnSortOpenPositions.addEventListener('click', () => {
                openPositionsSortDesc = !openPositionsSortDesc;
                localStorage.setItem('sort_open_desc', String(openPositionsSortDesc));
                updateSortToggleUI('btnSortOpenPositions', openPositionsSortDesc);
                renderOpenPositions();
            });
            updateSortToggleUI('btnSortOpenPositions', openPositionsSortDesc);
        }

        // Tab filter setup
        const posTabs = document.getElementById('posTabs');
        if (posTabs) {
            posTabs.addEventListener('click', (e) => {
                const btn = e.target.closest('.pos-tab');
                if (!btn) return;
                document.querySelectorAll('.pos-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedPosCategory = btn.dataset.cat;
                renderOpenPositions(); // Immediate refresh!
            });
        }

        // manageRisk=false → SOLO rendering, nessuna chiusura automatica (TP/SL/
        // trailing/hedging). Usato quando la funzione è invocata dalla
        // sincronizzazione col broker (connessione / cambio modalità): in quel
        // contesto stiamo solo CARICANDO e mostrando le posizioni del conto, non
        // dobbiamo liquidarle. La gestione del rischio resta attiva tramite il
        // ciclo dedicato setInterval(renderOpenPositions, 500).
        function renderOpenPositions(manageRisk = true) {
            if (window.__ctxOverride) return;
            const now = Date.now();
            let htmlBuffer = '';
            let hasPositions = false;
            // Count by category
            const catCount = { ALL: 0, CRYPTO: 0, STOCK: 0, FOREX: 0, COMMODITY: 0 };

            // Cache DOM lookups outside the loop for performance
            const userTP = parseFloat(document.getElementById('botTargetProfit')?.value) || 1.5;
            const userSL = parseFloat(document.getElementById('botStopLoss')?.value) || 0;
            const aiDynamicOn = document.getElementById('aiModeToggle')?.checked;
            const useRisk = document.getElementById('aiModeRisk')?.checked;
            const useHedging = document.getElementById('aiModeHedging')?.checked;

            // Ordina per data apertura (openTime, o firstSeenTime come fallback per le
            // posizioni sincronizzate dal broker senza created_at) secondo il toggle utente.
            const sortedPosSyms = Object.keys(activePositions).sort((symA, symB) => {
                const pa = activePositions[symA], pb = activePositions[symB];
                if (!pa.openTime && !pa.firstSeenTime) pa.firstSeenTime = now;
                if (!pb.openTime && !pb.firstSeenTime) pb.firstSeenTime = now;
                const ta = pa.openTime || pa.firstSeenTime;
                const tb = pb.openTime || pb.firstSeenTime;
                return openPositionsSortDesc ? (tb - ta) : (ta - tb);
            });

            for (let sym of sortedPosSyms) {
                const pos = activePositions[sym];
                const livePrice = getLivePriceFor(sym) || pos.entryPrice;
                const cat = getAssetType(sym);

                let unrealized;
                if (pos.brokerUnrealizedPnL !== undefined && brokerViewActive()) {
                    unrealized = pos.brokerUnrealizedPnL;
                } else {
                    unrealized = pos.type === 'LONG'
                        ? (livePrice - pos.entryPrice) * pos.amount
                        : (pos.entryPrice - livePrice) * pos.amount;
                }

                // Calcolo percentuale non realizzata
                const invested = pos.invested || pos.entryPrice * pos.amount;
                const unrealizedPct = (unrealized / invested) * 100;

                // TP/SL dinamici e gestione rischio: delegati al motore (tengine.js).
                const _risk = manageOpenPositionRisk(sym, pos, livePrice, unrealizedPct, {
                    now, userTP, userSL, aiDynamicOn, useRisk, useHedging,
                    manageRisk: isBotActive && manageRisk
                });
                if (_risk.closed) continue;
                const effTP = _risk.effTP, effSL = _risk.effSL;

                catCount.ALL++;
                catCount[cat] = (catCount[cat] || 0) + 1;
                hasPositions = true;

                if (selectedPosCategory !== 'ALL' && cat !== selectedPosCategory) {
                    const safeSym = sym.replace(/[^a-zA-Z0-9]/g, '');
                    const el = document.getElementById(`pos-el-${safeSym}`);
                    if (el) el.style.display = 'none';
                    continue;
                }

                const decimals = sym.includes('OANDA') ? 4 : (pos.entryPrice < 10 ? 4 : 2);
                const ROI = unrealizedPct;
                const marketValue = invested + unrealized;
                const pnlString = (unrealized >= 0 ? '+' : '-') + formatMoney(Math.abs(unrealized));
                const catIcon = { 'CRYPTO': '🔸', 'STOCK': '📈', 'FOREX': '💱', 'COMMODITY': '⛽' }[cat] || '💰';
                const timeStr = pos.openTime ? new Date(pos.openTime).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' }) : '--:--';
                const durationMs = pos.openTime ? now - pos.openTime : 0;
                const durationStr = formatDuration(durationMs);
                const isClosing = closingAssets.has(sym);
                const btnActionStr = isClosing ? `<span class="loading-spinner"></span> ${tr('closing', 'Chiudendo...')}` : tr('btn_close', 'Chiudi');

                const safeSym = sym.replace(/[^a-zA-Z0-9]/g, '');
                let el = document.getElementById(`pos-el-${safeSym}`);

                if (!el) {
                    el = document.createElement('div');
                    el.id = `pos-el-${safeSym}`;
                    el.className = `open-position ${pos.type}`;
                    el.innerHTML = `
                    <div class="open-position-header">
                        <span style="font-weight: bold; font-size: 0.85rem; color: #fff; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <span class="pos-cat-icon"></span> <span class="pos-sym"></span>
                            <span style="font-size: 0.6rem; font-weight: bold; padding: 2px 6px; border-radius: 4px; margin-left: 4px;" class="pos-type-badge"></span>
                            <span style="font-size: 0.62rem; color: var(--text-secondary); margin-left: 6px; font-weight: normal;" class="pos-time"></span>
                        </span>
                        <div class="pos-actions" style="display: flex; gap: 8px;">
                            <button class="btn-close-pos" onclick="window.closeTradeGlobal('${sym}')"></button>
                            <button class="btn-force-close" onclick="window.forceCloseLocal('${sym}')" style="display:none;"></button>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <!-- Entrata/Live e Valore/(Inv) su TUTTA la larghezza della card
                             (nowrap = mai su due righe). Etichette maiuscole piccole +
                             valori bianchi: stessi token grafici di Ordinate/Cronologia. -->
                        <div style="font-size: 0.75rem; display: flex; justify-content: space-between; gap: 6px; white-space: nowrap;">
                            <span><span class="trade-leg-badge in">IN</span> <strong style="color:#fff;" class="pos-entry"></strong></span>
                            <span><span style="font-size: 0.6rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em;">${tr('lbl_live', 'Live')}</span> <strong style="color:#60a5fa;" class="pos-live"></strong></span>
                        </div>
                        <!-- IN Inv.@investito a sinistra, Valore @attuale (dinamico) a destra -->
                        <div style="font-size: 0.75rem; display: flex; justify-content: space-between; gap: 6px; white-space: nowrap;">
                            <span><span class="trade-leg-badge in">IN</span> <span style="font-size: 0.6rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em;">${tr('lbl_invested_short', 'Inv.')}</span> <strong style="color:#fff;" class="pos-inv"></strong></span>
                            <span><span style="font-size: 0.6rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em;">${tr('value_label', 'Valore')}</span> <strong style="color:#fff;" class="pos-val"></strong></span>
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-secondary); display: flex; gap: 12px; white-space: nowrap; margin-top: 2px;">
                            <span>🎯 TP <strong style="color:#10b981;" class="pos-tp"></strong></span>
                            <span>🛡️ SL <strong style="color:#ef4444;" class="pos-sl"></strong></span>
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-secondary); display: flex; gap: 12px; white-space: nowrap; margin-top: 2px;">
                            <span title="${tr('tip_fee_est', 'Stima fee + spread di andata/ritorno (non è un valore confermato dal broker)')}">💸 ${tr('lbl_fee_est', 'Comm.')} <strong style="color:#f59e0b;" class="pos-fee"></strong></span>
                        </div>
                        <!-- PnL dinamico ($ e %) sotto la riga TP/SL -->
                        <div style="display: flex; align-items: baseline; gap: 8px; white-space: nowrap;">
                            <span style="font-weight: bold; font-size: 1rem;" class="pos-pnl-val"></span>
                            <span style="font-size: 0.7rem; opacity: 0.9;" class="pos-roi-val"></span>
                        </div>
                        <div style="font-size: 0.62rem; color: var(--text-secondary); opacity: 0.7;" class="pos-open-datetime"></div>
                    </div>`;
                    el._v = {};
                    el._q = (sel) => el.querySelector(sel);
                }
                // appendChild su un nodo già presente lo SPOSTA in coda: usato qui per
                // mantenere l'ordine del DOM allineato a sortedPosSyms a ogni render,
                // senza ricreare gli elementi (preserva l'update incrementale sotto).
                openPositionsListEl.appendChild(el);

                if (el.style.display === 'none') el.style.display = 'flex';

                const updateT = (sel, val) => { if (el._v[sel] !== val) { el._q(sel).textContent = val; el._v[sel] = val; } };
                const updateH = (sel, val) => { if (el._v[sel] !== val) { el._q(sel).innerHTML = val; el._v[sel] = val; } };
                const updateC = (sel, color) => { if (el._v[sel + '_c'] !== color) { el._q(sel).style.color = color; el._v[sel + '_c'] = color; } };

                updateT('.pos-cat-icon', catIcon);
                updateT('.pos-sym', displaySymbol(sym));
                updateT('.pos-type-badge', pos.type);
                updateT('.pos-time', `${timeStr} (${durationStr})`);

                const btnClose = el._q('.btn-close-pos');
                if (el._v.btnClose !== isClosing) {
                    btnClose.disabled = isClosing;
                    updateH('.btn-close-pos', btnActionStr);
                    el._v.btnClose = isClosing;
                }

                const btnForce = el._q('.btn-force-close');
                const showForce = pos.lastError ? 'inline-block' : 'none';
                if (el._v.force !== showForce) {
                    btnForce.style.display = showForce;
                    updateT('.btn-force-close', tr('btn_force_local', 'Forza Locale'));
                    btnForce.title = tr('tip_force_local', 'Rimuovi solo localmente');
                    el._v.force = showForce;
                }

                updateT('.pos-entry', `@ ${formatMoney(pos.entryPrice, decimals, decimals)}`);
                updateT('.pos-live', formatMoney(livePrice, decimals, decimals));
                updateT('.pos-val', `@ ${formatMoney(marketValue)}`);
                updateT('.pos-inv', `@ ${formatMoney(invested)}`);
                updateT('.pos-tp', `${effTP.toFixed(2)}%`);
                updateT('.pos-sl', effSL > 0 ? `${effSL.toFixed(2)}%` : 'OFF');
                // Stima fee+spread di andata/ritorno (stessa metrica usata per il
                // breakeven netto e per il filtro anti-churn del TP in tengine.js):
                // NON è un valore confermato dal broker, solo una stima coerente col
                // resto dell'app (vedi getNetBreakevenPct).
                const estFeePct = (typeof getNetBreakevenPct === 'function') ? getNetBreakevenPct(sym) : 0;
                const estFeeUsd = invested * (estFeePct / 100);
                updateT('.pos-fee', `${formatMoney(estFeeUsd)} (${estFeePct.toFixed(2)}%)`);
                // Data e ora apertura posizione
                const openDateStr = pos.openTime
                    ? new Date(pos.openTime).toLocaleString(uiLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : '--';
                updateT('.pos-open-datetime', `📅 ${openDateStr}`);

                const pnlColor = unrealized >= 0 ? '#10b981' : '#ef4444';
                updateT('.pos-pnl-val', pnlString); updateC('.pos-pnl-val', pnlColor);
                updateT('.pos-roi-val', `${unrealized >= 0 ? '+' : ''}${ROI.toFixed(2)}%`); updateC('.pos-roi-val', pnlColor);
            }

            // --- AI Avanzata: i campi TP/SL del pannello seguono in tempo reale ---
            // l'indicazione corrente dell'AI per l'asset selezionato sul grafico,
            // in OGNI modalità (test inclusa). Non tocchiamo i campi mentre
            // l'utente li sta modificando, e SL a 0 (no-loss) non viene sovrascritto.
            const aiFieldsOn = document.getElementById('aiModeToggle')?.checked;
            if (aiFieldsOn) {
                const tpField = document.getElementById('botTargetProfit');
                const slField = document.getElementById('botStopLoss');
                const chartSym = document.getElementById('assetPair')?.value;
                const chartHist = chartSym ? bgPriceHistories[chartSym] : null;
                if (tpField && slField && document.activeElement !== tpField && document.activeElement !== slField
                    && chartHist && chartHist.length >= 20) {
                    const bbSel = calculateBollingerBands(chartHist, Math.min(20, chartHist.length));
                    if (bbSel && bbSel.middle) {
                        const volSel = ((bbSel.upper - bbSel.lower) / bbSel.middle) * 100;
                        const slSel = Math.min(5.0, Math.max(0.5, volSel / 2));
                        const tpSel = Math.min(15.0, Math.max(1.0, slSel * 1.5));
                        if (tpField.value !== tpSel.toFixed(2)) tpField.value = tpSel.toFixed(2);
                        if (parseFloat(slField.value) !== 0 && slField.value !== slSel.toFixed(2)) slField.value = slSel.toFixed(2);
                    }
                }
            }

            requestAnimationFrame(() => {
                Array.from(openPositionsListEl.children).forEach(child => {
                    if (child.classList.contains('empty')) {
                        if (hasPositions) child.remove();
                        return;
                    }
                    const match = child.id.match(/^pos-el-(.+)$/);
                    if (match) {
                        let found = false;
                        for (let s in activePositions) {
                            if (s.replace(/[^a-zA-Z0-9]/g, '') === match[1]) { found = true; break; }
                        }
                        if (!found) child.remove();
                    }
                });

                if (!hasPositions && !openPositionsListEl.querySelector('.empty')) {
                    openPositionsListEl.innerHTML = `<div class="open-position empty">${tr('no_positions', 'Nessuna posizione aperta')}${selectedPosCategory !== 'ALL' ? ' (' + selectedPosCategory + ')' : ''}</div>`;
                }

                for (const cat in catCount) {
                    const el = document.getElementById(`cnt-${cat}`);
                    if (el && el.textContent != catCount[cat]) el.textContent = catCount[cat];
                }
            });
        }


        // LOOP IN BACKGROUND PER AGGIORNARE LE POSIZIONI APERTE
        // Ciclo dedicato di gestione rischio (TP/SL/trailing/hedging): qui manageRisk
        // resta true, così le posizioni sotto soglia vengono comunque gestite.
        setInterval(() => renderOpenPositions(true), 1500);

        var lastPriceUITime = 0;
        function updatePriceUI() {
            if (!currentPriceEl) return;
            const now = Date.now();
            if (now - lastPriceUITime < 150) return; // Throttle a ~6 FPS per ridurre il carico DOM
            lastPriceUITime = now;

            const isOanda = assetPairSelect.value.includes('OANDA');
            const decimals = isOanda ? 4 : (currentPrice < 10 ? 4 : 2);

            currentPriceEl.textContent = `${formatMoney(currentPrice, decimals, decimals)}`;

            if (previousPrice > 0 && priceChangeEl) {
                const diff = currentPrice - previousPrice;
                const diffPercent = (diff / previousPrice) * 100;
                priceChangeEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(decimals)} (${diffPercent.toFixed(3)}%)`;
                currentPriceEl.className = `price ${diff >= 0 ? 'up' : 'down'}`;
                priceChangeEl.className = `change ${diff >= 0 ? 'up' : 'down'}`;
            }
            previousPrice = currentPrice;
            updateWalletUI(); // Real-time capital update on price tick
        }

        // Persisti lo storico prezzi nel local db ogni 30s (test mode) → warm-up istantaneo alla prossima sessione
        setInterval(() => { if (!useAlpacaBroker) persistTestData(); }, 30000);

        let chartUpdatePending = false;


        // --- Market Connections ---
        function connectToMarket(symbol) {
            lastValidAsset = symbol;
            resetState(symbol);
            connectFinnhubChart(symbol);

            // Forza sincronizzazione sottoscrizioni per il nuovo asset
            syncFinnhubSubscriptions();
            syncAlpacaDataSubscriptions();
        }

        function connectFinnhubChart(symbol) {
            // FASE C: i dati possono arrivare da Finnhub, Alpaca o Capital a seconda
            // della categoria; il testo di attesa deve essere accurato (prima
            // "Aggancio ai dati Finnhub..." restava anche quando la fonte era altra
            // o il mercato era chiuso).
            const type = getAssetType(symbol);
            if (typeof isMarketOpen === 'function' && !isMarketOpen(type)) {
                currentPriceEl.textContent = 'Mercato chiuso — riapre a orario di borsa';
                return;
            }

        }

        // --- BACKGROUND ENGINE (RADAR & MULTI-ASSET TRACKING) ---
        function getAssetType(symbol) {
            if (!symbol) return 'CRYPTO';
            // Verifica manuale basata su VALID_SYMBOLS per precisione totale
            if (VALID_SYMBOLS.CRYPTO.includes(symbol)) return 'CRYPTO';
            if (VALID_SYMBOLS.STOCK.includes(symbol)) return 'STOCK';
            if (VALID_SYMBOLS.FOREX.includes(symbol)) return 'FOREX';
            if (VALID_SYMBOLS.COMMODITY.includes(symbol)) return 'COMMODITY';

            // Fallback euristico
            if (symbol.includes('OANDA')) {
                return symbol.includes('XAU') || symbol.includes('XAG') ? 'COMMODITY' : 'FOREX';
            } else if (symbol.includes('USDT') || symbol.includes('/USD')) {
                return 'CRYPTO';
            } else if (symbol.endsWith('USD') && symbol.length >= 6) {
                // Simboli crypto dei FILL Alpaca senza slash (es. BTCUSD); i ticker azionari hanno max 5 caratteri
                return 'CRYPTO';
            }
            return 'STOCK';
        }

        function isSymbolEnabled(sym) {
            const type = getAssetType(sym);
            if (activePositions[sym]) return true;
            // FASE C: con i feed concorrenti arrivano dati di TUTTE le categorie in ogni
            // modalità; il BOT però opera solo sulle categorie disponibili per il broker
            // attivo E a mercato aperto (stessa matrice delle checkbox/combo).
            if (typeof window.categoryAvailability === 'function' && !window.categoryAvailability(type).available) return false;
            return enabledTradingCategories.includes(type) && !restrictedAssets.has(sym);
        }

        // Pannello stato motore: mostra warm-up storico e ultimo segnale, così è
        // visibile PERCHÉ il bot non sta (ancora) aprendo posizioni.
        // engineStatus is now managed by StatusBarManager
        let lastPingForUI = 0;
        let currentFpsForUI = 0;
        setInterval(() => {
            if (window.StatusBarManager) window.StatusBarManager.updateEngineStatus(lastPingForUI, currentFpsForUI);
        }, 3000);


        function updateCategoryPulse() {
            for (let cat in VALID_SYMBOLS) {
                const symbols = VALID_SYMBOLS[cat];
                let totalPct = 0;
                let count = 0;

                symbols.forEach(sym => {
                    const price = globalPrices[sym];
                    if (price && sessionStartPrices[sym]) {
                        const pct = ((price / sessionStartPrices[sym]) - 1) * 100;
                        totalPct += pct;
                        count++;
                    }
                });

                if (count > 0) {
                    const avg = totalPct / count;
                    const el = document.getElementById(`ov-${cat}`);
                    if (el) {
                        const changeEl = el.querySelector('.ov-change');
                        const priceEl = el.querySelector('.ov-price');
                        if (priceEl) priceEl.textContent = count > 1 ? `${count} asset attivi` : '1 asset attivo';
                        if (changeEl) {
                            changeEl.textContent = `${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`;
                            changeEl.style.color = avg >= 0 ? '#10b981' : '#ef4444';
                        }
                    }
                }
            }
        }

        // Periodically update the category dashboard (High Frequency for Live feel)
        setInterval(updateCategoryPulse, 500);


        function initBackgroundConnections() {
            console.log("[RADAR] Inizializzazione connessioni background...");

            if (!bgFinnhubWs && finnhubApiKey && useFinnhubData && window.__connAllowed.fh) {
                console.log("[RADAR] Avvio Finnhub Stream (Stocks/Forex)...");
                bgFinnhubWs = new WebSocket(`wss://ws.finnhub.io?token=${finnhubApiKey}`);
                const fhWs = bgFinnhubWs; // riferimento a QUESTO socket (per ignorare eventi di socket obsoleti)
                bgFinnhubWs.onopen = () => {
                    if (bgFinnhubWs !== fhWs) return;
                    const dot = statusFH.querySelector('.status-dot');
                    dot.className = 'status-dot active';
                    // Nuovo socket: le sottoscrizioni precedenti non esistono più, vanno reinviate
                    activeFinnhubSubs.clear();
                    syncFinnhubSubscriptions();
                };
                bgFinnhubWs.onclose = () => {
                    if (bgFinnhubWs !== fhWs) return;
                    const dot = statusFH.querySelector('.status-dot');
                    dot.className = 'status-dot';
                    activeFinnhubSubs.clear();
                    bgFinnhubWs = null;
                    // Riconnessione automatica (Finnhub free chiude spesso la connessione).
                    // Se Finnhub è stato spento volontariamente (broker mode / toggle), useFinnhubData è false e non riconnettiamo.
                    if (useFinnhubData && finnhubApiKey && window.__connAllowed.fh) {
                        console.warn("[RADAR] Finnhub WS chiuso. Riconnessione tra 5s...");
                        setTimeout(() => {
                            if (useFinnhubData && finnhubApiKey && !bgFinnhubWs && window.__connAllowed.fh) initBackgroundConnections();
                        }, 5000);
                    }
                };
                bgFinnhubWs.onerror = () => {
                    if (bgFinnhubWs !== fhWs) return;
                    const dot = statusFH.querySelector('.status-dot');
                    dot.className = 'status-dot error';
                };
                bgFinnhubWs.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'trade') {
                        const now = Date.now();
                        data.data.forEach(trade => {
                            let sym = trade.s;
                            if (sym.startsWith('BINANCE:')) sym = sym.replace('BINANCE:', '');
                            const price = trade.p;
                            globalPrices[sym] = price;

                            if (now - (wsThrottleMap[sym] || 0) < 500) return;
                            wsThrottleMap[sym] = now;

                            updateBackgroundHistoryAndStrategy(sym, price, now, getAssetType(sym), 'fh');
                            processRadarTick(sym, price, now, getAssetType(sym));
                        });
                    }
                };
            }

            // --- WebSocket Alpaca Data (SOLO in broker mode) ---
            // FASE C: i feed Alpaca partono se ci sono le CHIAVI e l'utente ha
            // CONSENTITO la connessione (leva ALP o scheda Alpaca attivata)
            const shouldStartAlpacaData = !!getBrokerHttp().key && window.__connAllowed.alp;

            if (shouldStartAlpacaData) {
                // Se abbiamo Finnhub, usiamo Alpaca SOLO per le Crypto per non saturare il limite di 1 connessione (Free Plan)
                const needAlpacaStocks = !useFinnhubData;

                if (needAlpacaStocks && !bgAlpacaWs) {
                    initAlpacaDataWs();
                }

                if (!bgAlpacaCryptoWs) {
                    // Ritardiamo leggermente la connessione crypto se abbiamo appena avviato quella stocks
                    const delay = (needAlpacaStocks && !bgAlpacaWs) ? 2000 : 0;
                    setTimeout(initAlpacaCryptoWs, delay);
                }
            }

            // FASE C: feed Capital.com (Forex/Materie) attivo se configurato, in
            // qualunque modalità — terza sorgente concorrente accanto a FH e Alpaca.
            // try/catch: alla PRIMA chiamata (startup, riga ~3320) le dichiarazioni del
            // layer Capital (~3500) non sono ancora eseguite (TDZ) — in quel caso il
            // feed parte dall'auto-avvio del layer stesso, subito dopo.
            try {
                if (capDemoKey && capDemoIdent && capDemoPass && !capitalPollingInterval && window.__connAllowed.capd) {
                    startCapitalPolling();
                }
            } catch (e) { /* TDZ allo startup: avvio delegato al layer Capital */ }

            // Trigger universal subscription for all categories
            syncFinnhubSubscriptions();
            syncAlpacaDataSubscriptions();
            updateStatusDots();

            // Heartbeat diagnostico per il Radar (ogni 60 secondi invece di 10)
            if (!window.radarDiagnosticInterval) {
                window.radarDiagnosticInterval = setInterval(() => {
                    const cryptoCount = Object.keys(globalPrices).filter(s => s.endsWith('USDT')).length;
                    const stockCount = Object.keys(globalPrices).filter(s => !s.endsWith('USDT')).length;
                    if (cryptoCount > 0 || stockCount > 0) {
                        console.log(`[RADAR HEARTBEAT] Asset tracciati: Crypto=${cryptoCount}, Stocks/Forex=${stockCount}`);
                    }

                    // Se non ci sono dati, forziamo una riconnessione
                }, 60000);
            }
        }

        function initAlpacaDataWs() {
            // FASE C: feed dati puro — parte se ci sono le chiavi, in qualunque modalità
            // Chiavi del broker attivo (paper o live): il feed dati (data.alpaca.markets)
            // è condiviso e accetta entrambe le coppie di chiavi.
            const _bk = getBrokerHttp();
            const alpacaKeyId = _bk.key, alpacaSecretKey = _bk.secret;
            if (!alpacaKeyId || !alpacaSecretKey) return;
            // Alpaca consente 1 SOLA connessione dati per account: mai duplicare
            if (bgAlpacaWs && bgAlpacaWs.readyState <= 1) return; // CONNECTING o OPEN
            // Feed IEX per account Paper/Free
            bgAlpacaWs = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');
            const aWs = bgAlpacaWs; // riferimento a QUESTO socket (ignora eventi di socket obsoleti)

            bgAlpacaWs.onopen = () => {
                if (bgAlpacaWs !== aWs) return;
                console.log("[ALPACA WS] Connessione... Invio Auth.");
                bgAlpacaWs.send(JSON.stringify({
                    action: 'auth',
                    key: alpacaKeyId,
                    secret: alpacaSecretKey
                }));
            };

            bgAlpacaWs.onmessage = (event) => {
                const data = JSON.parse(event.data);
                data.forEach(msg => {
                    if (msg.T === 'success' && msg.msg === 'authenticated') {
                        console.log("[ALPACA WS] Autenticato con successo.");
                        alpacaDataAuthenticated = true;
                        syncAlpacaDataSubscriptions();
                    } else if (msg.T === 't' || msg.T === 'q') { // Trade o Quote (bid/ask)
                        let sym = msg.S;
                        // Trade: prezzo eseguito. Quote: mid bid/ask (piu' frequente, ottimo per grafico/radar)
                        const price = msg.T === 't' ? msg.p
                            : (msg.bp > 0 && msg.ap > 0 ? (msg.bp + msg.ap) / 2 : (msg.ap || msg.bp));
                        if (!price || price <= 0) return;
                        const now = Date.now();

                        // Mappa i simboli Alpaca (es. EUR/USD) nei nomi bot (es. OANDA:EUR_USD)
                        if (sym.includes('/')) {
                            sym = `OANDA:${sym.replace('/', '_')}`;
                        }

                        globalPrices[sym] = price;
                        if (msg.T === 'q') recordSpread(sym, msg.bp, msg.ap);
                        const cat = getAssetType(sym);
                        updateBackgroundHistoryAndStrategy(sym, price, now, cat, 'alp');
                        processRadarTick(sym, price, now, cat);
                    } else if (msg.T === 'error') {
                        console.error("[ALPACA WS] Errore:", msg.msg);
                        if (msg.msg.includes('limit exceeded')) {
                            console.warn("[ALPACA WS] Limite connessioni superato. Prossimo tentativo tra 15s.");
                            alpacaReconnectDelay = 15000;
                        }
                    }
                });
            };

            bgAlpacaWs.onclose = () => {
                if (bgAlpacaWs !== aWs) return; // socket obsoleto o chiusura intenzionale (test mode)
                bgAlpacaWs = null;
                alpacaDataAuthenticated = false;
                // Le sottoscrizioni azioni muoiono col socket: reinviale alla riconnessione
                activeAlpacaSubs.forEach(s => { if (!s.endsWith('_CRY')) activeAlpacaSubs.delete(s); });
                // Riconnetti SOLO se siamo ancora in broker mode (mai in test mode)
                if (useAlpacaBroker) {
                    console.warn(`[ALPACA WS] Chiuso. Riconnessione tra ${alpacaReconnectDelay / 1000}s...`);
                    setTimeout(initAlpacaDataWs, alpacaReconnectDelay);
                    // Reset delay dopo averlo usato (per tornare ai 5s normali se il problema sparisce)
                    alpacaReconnectDelay = 5000;
                }
            };
        }

        function initAlpacaCryptoWs() {
            // FASE C: feed dati puro — parte se ci sono le chiavi, in qualunque modalità
            // Chiavi del broker attivo (paper o live): feed condiviso data.alpaca.markets
            const _bk = getBrokerHttp();
            const alpacaKeyId = _bk.key, alpacaSecretKey = _bk.secret;
            // Evita connessioni duplicate o se il WS è già stabilito
            if (!alpacaKeyId || !alpacaSecretKey) return;
            if (bgAlpacaCryptoWs && bgAlpacaCryptoWs.readyState <= 1) return; // CONNECTING o OPEN

            // Se è già noto che il WS non è supportato dall'account, usa solo il polling
            if (window.alpacaCryptoWsFailed) {
                startAlpacaPolling();
                return;
            }

            // Endpoint corrente Alpaca per il crypto stream (il vecchio /v2/crypto non esiste più)
            console.log("[ALPACA CRYPTO] Avvio connessione (v1beta3)...");
            try {
                bgAlpacaCryptoWs = new WebSocket('wss://stream.data.alpaca.markets/v1beta3/crypto/us');
            } catch (e) {
                console.warn("[ALPACA CRYPTO] Errore creazione WebSocket, uso polling.");
                bgAlpacaCryptoWs = null;
                window.alpacaCryptoWsFailed = true;
                startAlpacaPolling();
                return;
            }
            const cWs = bgAlpacaCryptoWs; // riferimento a QUESTO socket

            bgAlpacaCryptoWs.onopen = () => {
                if (bgAlpacaCryptoWs !== cWs) return;
                console.log("[ALPACA CRYPTO WS] Aperto. Invio Auth...");
                bgAlpacaCryptoWs.send(JSON.stringify({
                    action: 'auth',
                    key: alpacaKeyId,
                    secret: alpacaSecretKey
                }));
            };

            bgAlpacaCryptoWs.onerror = () => {
                if (bgAlpacaCryptoWs !== cWs) return; // socket obsoleto
                // Non marcare "fallito" al primo errore (può essere transitorio):
                // solo dopo 2 errori consecutivi senza mai autenticarsi passiamo al polling fisso.
                window.__cryptoWsErrCount = (window.__cryptoWsErrCount || 0) + 1;
                if (window.__cryptoWsErrCount >= 2) {
                    console.warn("[ALPACA CRYPTO] WebSocket non raggiungibile (2 tentativi falliti). Uso Polling.");
                    window.alpacaCryptoWsFailed = true;
                } else {
                    console.warn("[ALPACA CRYPTO] Errore WebSocket (tentativo 1). Riprovo, intanto Polling.");
                }
                // Pulisci le sottoscrizioni crypto: andranno reinviate sul prossimo socket
                activeAlpacaSubs.forEach(s => { if (s.endsWith('_CRY')) activeAlpacaSubs.delete(s); });
                bgAlpacaCryptoWs = null; // Azzera per permettere riconnessioni future
                alpacaCryptoAuthenticated = false;
                startAlpacaPolling();
            };

            bgAlpacaCryptoWs.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    data.forEach(msg => {
                        if (msg.T === 'success' && msg.msg === 'authenticated') {
                            console.log("[ALPACA CRYPTO WS] Autenticato.");
                            alpacaCryptoAuthenticated = true;
                            window.alpacaCryptoWsFailed = false; // Reset: il WS funziona!
                            window.__cryptoWsErrCount = 0; // azzera il conteggio errori
                            // Se c'era un polling attivo, NON lo stoppiamo (il WS gratuito Alpaca Crypto è spesso muto)
                            if (!alpacaPollingInterval) {
                                startAlpacaPolling();
                            }
                            syncAlpacaDataSubscriptions();
                        } else if (msg.T === 't' || msg.T === 'q') { // Trade o Quote (bid/ask)
                            let sym = msg.S;
                            const price = msg.T === 't' ? msg.p
                                : (msg.bp > 0 && msg.ap > 0 ? (msg.bp + msg.ap) / 2 : (msg.ap || msg.bp));
                            if (!price || price <= 0) return;
                            const now = Date.now();
                            if (sym.endsWith('/USD')) sym = sym.replace('/USD', 'USDT');
                            globalPrices[sym] = price;
                            if (msg.T === 'q') recordSpread(sym, msg.bp, msg.ap);
                            updateBackgroundHistoryAndStrategy(sym, price, now, 'CRYPTO', 'binance');
                            processRadarTick(sym, price, now, 'CRYPTO');
                        } else if (msg.T === 'error') {
                            // "invalid syntax" è un errore benigno di Alpaca quando il payload di
                            // sottoscrizione era vuoto o malformato (es. array vuoto di simboli).
                            // Lo logghiamo solo in modo silenzioso per non allarmare la console.
                            const isAuth = msg.msg && (msg.msg.includes('auth') || msg.msg.includes('unauthorized'));
                            if (isAuth) {
                                console.warn('[ALPACA CRYPTO WS] Autenticazione fallita:', msg.msg);
                                window.alpacaCryptoWsFailed = true;
                                bgAlpacaCryptoWs = null;
                                alpacaCryptoAuthenticated = false;
                                startAlpacaPolling();
                            } else {
                                console.debug('[ALPACA CRYPTO WS] Messaggio server non critico:', msg.msg);
                            }
                        }
                    });
                } catch (e) {
                    console.warn("[ALPACA CRYPTO WS] Errore parsing messaggio:", e);
                }
            };

            bgAlpacaCryptoWs.onclose = () => {
                if (bgAlpacaCryptoWs !== cWs) return; // socket obsoleto o chiusura intenzionale
                bgAlpacaCryptoWs = null;
                alpacaCryptoAuthenticated = false;
                // Le sottoscrizioni crypto muoiono col socket: reinviale alla riconnessione
                activeAlpacaSubs.forEach(s => { if (s.endsWith('_CRY')) activeAlpacaSubs.delete(s); });

                // Riconnetti solo se il WS era funzionante (non se è stato marcato come non
                // supportato), con chiavi presenti e connessione CONSENTITA dall'utente.
                if (!window.alpacaCryptoWsFailed && getBrokerHttp().key && window.__connAllowed.alp) {
                    console.log("[ALPACA CRYPTO WS] Chiuso. Riconnessione tra 30s...");
                    setTimeout(initAlpacaCryptoWs, 30000);
                } else {
                    // WS non supportato: usa polling come fallback permanente
                    startAlpacaPolling();
                }
            };
        }

        function startAlpacaPolling() {
            // FASE C: fallback dati puro — parte se ci sono le chiavi, in qualunque modalità
            if (alpacaPollingInterval) return; // Evita intervalli duplicati
            // Chiavi del broker attivo (paper o live); il feed dati usa data.alpaca.markets (condiviso)
            const _bk = getBrokerHttp();
            const alpacaKeyId = _bk.key, alpacaSecretKey = _bk.secret;
            if (!alpacaKeyId || !alpacaSecretKey) return;

            console.log("[ALPACA] Polling attivo (WebSocket non disponibile). Intervallo: 3s.");
            alpacaPollingInterval = setInterval(async () => {
                // Se il WS si è ristabilito, ferma il polling
                // FASE C: rimosso il blocco che fermava il polling, serve come fallback per i WebSocket muti.
                // FASE C: il polling si ferma solo se mancano le chiavi (feed dati puro)
                if (!getBrokerHttp().key) {
                    clearInterval(alpacaPollingInterval);
                    alpacaPollingInterval = null;
                    return;
                }

                // Batch poll dei prezzi crypto via REST usando QUOTES (più frequenti dei trades)
                const cryptoSyms = VALID_SYMBOLS.CRYPTO;
                const alpacaSyms = cryptoSyms.map(toAlpacaCryptoSym).join(',');
                // latest/quotes: restituisce bid/ask. Molto più reattivo su Alpaca Paper rispetto ai trades
                const url = `${ALPACA_DATA_BASE}/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(alpacaSyms)}`;

                try {
                    const res = await fetch(url, {
                        headers: { 'apca-api-key-id': alpacaKeyId, 'apca-api-secret-key': alpacaSecretKey }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const now = Date.now();
                        if (data.quotes) {
                            for (const aSym in data.quotes) {
                                const botSym = aSym.replace('/USD', 'USDT');
                                const q = data.quotes[aSym];
                                const price = (q.bp > 0 && q.ap > 0) ? (q.bp + q.ap) / 2 : (q.ap || q.bp);
                                if (!price || price <= 0) continue;

                                globalPrices[botSym] = price;
                                recordSpread(botSym, q.bp, q.ap);
                                updateBackgroundHistoryAndStrategy(botSym, price, now, 'CRYPTO', 'sim');
                                processRadarTick(botSym, price, now, 'CRYPTO'); // Aggiorna anche il Radar
                            }
                        }
                    } else if (res.status === 403 || res.status === 401) {
                        console.error("[POLLING] Accesso negato (403/401). Fermo il polling.");
                        clearInterval(alpacaPollingInterval);
                        alpacaPollingInterval = null;
                    }
                } catch (e) {
                    // Errori di rete: silenzioso, riproveremo al prossimo tick
                }
            }, 1000); // 1 secondo: grafico più reattivo; 60 req/min, ben sotto il rate limit Alpaca (200 req/min)
        }

        function isMarketOpen(type) {
            if (type === 'CRYPTO') return true;

            const now = new Date();
            const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
            const day = estTime.getDay();
            const hours = estTime.getHours();
            const minutes = estTime.getMinutes();

            if (type === 'FOREX' || type === 'COMMODITY') {
                if (day === 5 && hours >= 17) return false;
                if (day === 6) return false;
                if (day === 0 && hours < 17) return false;
                if (day >= 1 && day <= 4 && hours === 17) return false; // Pausa giornaliera (17:00-18:00 EST)
                return true;
            }

            if (type === 'STOCK') {
                if (day === 0 || day === 6) return false;
                const timeVal = hours * 60 + minutes;
                if (timeVal >= 4 * 60 && timeVal < 20 * 60) return true; // Extended Hours: 04:00-20:00 EST
                return false;
            }

            return true;
        }

        function updateBackgroundHistoryAndStrategy(sym, price, now, type, sourceCtx = 'fh') {
            if (!isMarketOpen(type)) return;
            // FASE C: i DATI fluiscono per tutte le categorie in ogni modalità (feed
            // concorrenti, multi-dashboard). A vincolare il BOT alle categorie del
            // broker attivo ci pensa isSymbolEnabled (via categoryAvailability).

            // --- SYNC GRAFICO + PREZZO (tempo reale, NON limitato a 1 Hz) ---
            // Il grafico e il prezzo dell'asset selezionato seguono OGNI tick, così
            // l'aggiornamento è fluido invece che a scatti di 1 secondo. Il carico è
            // già contenuto da updatePriceUI (~6 FPS) e da pushCandleToChart
            // (requestAnimationFrame). Storico indicatori e strategia restano invece
            // a 1 aggiornamento/sec (throttle più sotto): così non si accorcia la
            // finestra di lookback degli indicatori né cambia la cadenza del bot.

            const activeCtx = (typeof window.getBrokerCtx === 'function') ? window.getBrokerCtx() : 'fh';
            let isAuthoritative = false;

            if (sourceCtx === activeCtx || (sourceCtx === 'cap' && activeCtx.startsWith('cap'))) {
                isAuthoritative = true;
            } else if (activeCtx === 'alp' || activeCtx === 'alrt') {
                if (type === 'CRYPTO' && (sourceCtx === 'fh' || sourceCtx === 'binance')) isAuthoritative = true;
                if ((type === 'FOREX' || type === 'COMMODITY') && sourceCtx === 'cap') isAuthoritative = true;
                // Fallback a Finnhub per Forex/Commodity se Capital non è attivo
                if ((type === 'FOREX' || type === 'COMMODITY') && sourceCtx === 'fh' && !window.__capitalFeedOk) isAuthoritative = true;
            } else if (activeCtx.startsWith('cap')) {
                if (type === 'CRYPTO' && (sourceCtx === 'fh' || sourceCtx === 'binance')) isAuthoritative = true;
                if (type === 'STOCK' && sourceCtx === 'alp') isAuthoritative = true;
                if (type === 'STOCK' && sourceCtx === 'fh' && (!window.__connAllowed || !window.__connAllowed.alp)) isAuthoritative = true;
            } else if (sourceCtx === 'sim') {
                isAuthoritative = true;
            }

            if (isAuthoritative && assetPairSelect && sym === assetPairSelect.value) {
                currentPrice = price;
                const time = Math.floor(now / 1000);

                if (time > lastCandleTime) {
                    currentCandle = { time, open: price, high: price, low: price, close: price };
                    lastCandleTime = time;
                    priceHistory.push(price);
                    if (priceHistory.length > 50) priceHistory.shift();
                } else if (currentCandle) {
                    currentCandle.close = price;
                    if (price > currentCandle.high) currentCandle.high = price;
                    if (price < currentCandle.low) currentCandle.low = price;
                }

                updatePriceUI();
                ChartManager.pushPrice(price, time);

                // Gestione ordini pendenti dalla UI
                if (autoBuyPending && autoBuyPending.symbol === sym) {
                    openTrade(autoBuyPending.type, currentPrice, sym);
                    autoBuyPending = null;
                }
            }

            // Throttling: storico indicatori + strategia una volta al secondo per simbolo
            if (lastUpdateTracker[sym] && now - lastUpdateTracker[sym] < 1000) return;
            lastUpdateTracker[sym] = now;

            if (!bgPriceHistories[sym]) bgPriceHistories[sym] = [];
            bgPriceHistories[sym].push(price);
            if (bgPriceHistories[sym].length > 100) bgPriceHistories[sym].shift();

            // --- AGGIORNAMENTO INDICATORI CATEGORIE (RADAR MULTI-ASSET) ---
            const nowTime = Math.floor(now / 1000);

            // 1. Aggiorna la linea di confronto solo se è l'asset visualizzato
            if (!sessionStartPrices[sym]) sessionStartPrices[sym] = price;
            let pctChange = ((price / sessionStartPrices[sym]) - 1) * 100;
            if (isNaN(pctChange) || !isFinite(pctChange)) pctChange = 0;
            const isCurrent = (assetPairSelect && sym === assetPairSelect.value);



            // Run strategy for this asset ONLY if category enabled (Universal Engine)
            if (!isManualMode && isBotActive && isSymbolEnabled(sym)) {
                evaluateStrategy(sym, bgPriceHistories[sym], price);
            }

            // FASE D2: motori PARALLELI — valuta lo stesso tick anche per i contesti
            // locali armati in background (ciascuno sul proprio portafoglio)
            if (typeof runBackgroundEngines === 'function') runBackgroundEngines(sym, price, type);
        }

        function syncFinnhubSubscriptions() {
            if (!useFinnhubData || !bgFinnhubWs || bgFinnhubWs.readyState !== WebSocket.OPEN) return;

            let requiredSubs = new Set();
            // FASE C — priorità dei feed per categoria (evita tick doppi con i feed
            // concorrenti): STOCK/CRYPTO → Alpaca se ci sono le chiavi, altrimenti
            // Finnhub; FOREX/COMMODITY → Capital.com se configurato, altrimenti Finnhub.
            const alpacaFeeds = !!getBrokerHttp().key && window.__connAllowed && window.__connAllowed.alp;
            // Capital copre Forex/Materie solo se il suo feed è SANO (primo poll ok):
            // con chiavi salvate ma login fallito, Finnhub resta la fonte — prima il
            // grafico Forex restava "in attesa" per sempre.
            const capitalFeeds = !!window.__capitalFeedOk;
            const fhCovers = (t) => {
                if (t === 'CRYPTO' && alpacaFeeds) return false;
                if (t === 'STOCK' && alpacaFeeds && !useFinnhubData) return false;
                if ((t === 'FOREX' || t === 'COMMODITY') && capitalFeeds) return false;
                return true;
            };
            for (const cat in VALID_SYMBOLS) {
                if (fhCovers(cat)) VALID_SYMBOLS[cat].forEach(s => requiredSubs.add(s));
            }

            // Asset corrente e posizioni aperte: solo se la loro categoria è coperta da FH
            if (assetPairSelect && fhCovers(getAssetType(assetPairSelect.value))) requiredSubs.add(assetPairSelect.value);
            for (let sym in activePositions) {
                if (fhCovers(getAssetType(sym))) requiredSubs.add(sym);
            }

            // Sottoscrivi i nuovi
            requiredSubs.forEach(s => {
                if (!activeFinnhubSubs.has(s)) {
                    let fhSym = s;
                    if (getAssetType(s) === 'CRYPTO' && !s.includes(':')) fhSym = 'BINANCE:' + s;
                    console.log(`[FH WS] Subscribe: ${fhSym}`);
                    bgFinnhubWs.send(JSON.stringify({ 'type': 'subscribe', 'symbol': fhSym }));
                    activeFinnhubSubs.add(s);
                }
            });

            // Assicuriamoci che l'asset corrente sia caricato prioritariamente e subito
            preloadHistory(assetPairSelect.value);

            // Precarica i dati storici in background per popolare il radar.
            // Usiamo un semaforo per evitare loop sovrapposti (che causavano lag) e 
            // misuriamo il tempo per applicare il delay solo se c'è stata chiamata di rete.
            if (window.isFinnhubSyncingLoop) return;
            window.isFinnhubSyncingLoop = true;

            (async () => {
                for (const sym of requiredSubs) {
                    if (sym !== assetPairSelect.value) {
                        const before = Date.now();
                        await preloadHistory(sym);
                        const elapsed = Date.now() - before;
                        // Applica il delay di 200ms solo se ci ha messo più di 50ms (segno di chiamata di rete reale)
                        if (elapsed > 50) await new Promise(r => setTimeout(r, 200));
                    }
                }
                window.isFinnhubSyncingLoop = false;
            })();
        }

        function syncAlpacaDataSubscriptions() {
            // --- Stocks Subscriptions ---
            if (bgAlpacaWs && alpacaDataAuthenticated && bgAlpacaWs.readyState === WebSocket.OPEN) {
                let symbols = new Set();
                VALID_SYMBOLS.STOCK.forEach(s => symbols.add(s));
                for (let sym in activePositions) {
                    const cat = getAssetType(sym);
                    if (cat === 'STOCK') symbols.add(sym);
                }

                const toSubscribe = Array.from(symbols).filter(s => !activeAlpacaSubs.has(s));
                if (toSubscribe.length > 0) {
                    console.log(`[ALPACA WS] Subscribe (Stocks): ${toSubscribe.join(', ')}`);
                    bgAlpacaWs.send(JSON.stringify({
                        action: 'subscribe',
                        trades: toSubscribe,
                        quotes: toSubscribe // bid/ask: piu' frequenti dei trade, grafico/radar reattivi
                    }));
                    toSubscribe.forEach(s => activeAlpacaSubs.add(s));
                }
            }

            // --- Crypto Subscriptions ---
            if (bgAlpacaCryptoWs && alpacaCryptoAuthenticated && bgAlpacaCryptoWs.readyState === WebSocket.OPEN) {
                let cryptoSymbols = [];
                VALID_SYMBOLS.CRYPTO.forEach(s => {
                    if (!activeAlpacaSubs.has(s + "_CRY")) {
                        cryptoSymbols.push(toAlpacaCryptoSym(s));
                    }
                });

                if (cryptoSymbols.length > 0) {
                    console.log(`[ALPACA CRYPTO WS] Subscribe (${cryptoSymbols.length} trades): ${cryptoSymbols.join(', ')}`);
                    // SOLO trades: il piano dati crypto limita i simboli sottoscrivibili
                    // ("symbol limit exceeded"); trades+quotes raddoppierebbe il conteggio.
                    // Il trade è il prezzo di riferimento per bot/radar; i gap li copre il polling.
                    bgAlpacaCryptoWs.send(JSON.stringify({
                        action: 'subscribe',
                        trades: cryptoSymbols
                    }));
                    cryptoSymbols.forEach(s => activeAlpacaSubs.add(s.replace('/USD', 'USDT') + "_CRY"));
                }
            }
        }

        // Funzione per il precaricamento iniziale del radar (da chiamare una volta sola)
        async function initialRadarPreload() {
            // Test mode: lo storico è già ripristinato dal local db (loadTestState).
            // Non ci sono sorgenti di candele gratuite disponibili (Finnhub candle = 403 sul piano free).
            // Il resto si costruisce dai tick live Finnhub WS.
            if (!useAlpacaBroker) return;

            // Alpaca mode: precarica via Alpaca API
            console.log("[RADAR] Avvio precaricamento iniziale multi-asset (Alpaca)...");
            for (const cat in VALID_SYMBOLS) {
                for (const sym of VALID_SYMBOLS[cat]) {
                    await preloadHistory(sym);
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }

        async function preloadHistory(symbol) {
            if (!symbol || restrictedAssets.has(symbol)) return;
            if (bgPriceHistories[symbol] && bgPriceHistories[symbol].length > 10) return;

            const cat = getAssetType(symbol);



            // NOTA: niente skip globale su finnhubForbidden — Alpaca è la fonte
            // primaria per stock/ETF e Capital per Forex/Materie; il 403 di
            // Finnhub blocca solo il SUO tentativo (guard dentro tryFinnhubPreload).
            // Il vecchio skip lasciava il grafico azioni VUOTO all'avvio.

            console.log(`[RADAR] Avvio precaricamento per ${symbol}...`);
            try {
                let historicalData = [];
                if (cat === 'CRYPTO') {
                    // Preload history via Alpaca Crypto API (solo in broker mode, Paper o REALE)
                    const _dk = getBrokerHttp();
                    if (_dk.key && _dk.secret) { // Allow preload even on Finnhub tab
                        const alpacaSym = toAlpacaCryptoSym(symbol);
                        const _nowIso = new Date().toISOString();
                        // Per l'asset VISUALIZZATO nel grafico: 7 giorni di barre 15Min.
                        // Per gli altri (solo warm-up radar/indicatori): 100 barre 1Min.
                        const _isChartSym = assetPairSelect && assetPairSelect.value === symbol;
                        const _weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                        const url = _isChartSym
                            ? `${ALPACA_DATA_BASE}/v1beta3/crypto/us/bars?symbols=${alpacaSym}&timeframe=15Min&start=${_weekAgoIso}&end=${_nowIso}&limit=1000`
                            : `${ALPACA_DATA_BASE}/v1beta3/crypto/us/bars?symbols=${alpacaSym}&timeframe=1Min&limit=100&end=${_nowIso}`;
                        const res = await fetch(url, {
                            headers: { 'apca-api-key-id': _dk.key, 'apca-api-secret-key': _dk.secret }
                        });
                        if (res.ok) {
                            const data = await res.json();
                            const bars = data.bars[alpacaSym];
                            if (bars && bars.length > 0) {
                                historicalData = bars.map(b => ({
                                    time: Math.floor(new Date(b.t).getTime() / 1000),
                                    open: b.o, high: b.h, low: b.l, close: b.c
                                }));
                                bgPriceHistories[symbol] = bars.map(b => b.c);
                                if (!sessionStartPrices[symbol]) sessionStartPrices[symbol] = bars[0].c;
                                console.log(`[SYSTEM] Preload History OK (Alpaca Crypto) per ${symbol}`);
                            }
                        }
                    }
                } else {
                    if (!restrictedAssets.has(symbol)) {
                        let data = null;
                        if (typeof tryAlpacaPreload === 'function') data = await tryAlpacaPreload(symbol);
                        if (!data && typeof tryFinnhubPreload === 'function') data = await tryFinnhubPreload(symbol);
                        // Capital.com SOLO per l'asset del grafico: 16 richieste
                        // storiche OANDA all'avvio sarebbero un carico inutile.
                        if (!data && typeof tryCapitalPreload === 'function' && assetPairSelect && assetPairSelect.value === symbol) {
                            data = await tryCapitalPreload(symbol);
                        }
                        if (data) historicalData = data;
                        else restrictedAssets.add(symbol);
                    }
                }

                if (historicalData.length > 0) {
                    // 1. Aggiorna candele se è l'asset corrente
                    if (assetPairSelect && assetPairSelect.value === symbol) {
                        ChartManager.setHistoricalData(historicalData);
                        const lastPrice = historicalData[historicalData.length - 1].close;
                        currentPrice = lastPrice;
                        lastCandleTime = historicalData[historicalData.length - 1].time;
                        // Anche all'AVVIO il grafico arriva all'ora corrente: estende
                        // subito l'ultima candela con il prezzo live se disponibile.
                        const lpBoot = getLivePriceFor(symbol);
                        if (lpBoot > 0) {
                            currentPrice = lpBoot;
                            ChartManager.pushPrice(lpBoot, Math.floor(Date.now() / 1000));
                        }
                        updatePriceUI();
                        console.log(`[CHART] Main series popolata per ${symbol}`);
                    }

                    // 2. Aggiorna la linea di confronto per l'asset principale
                    if (!sessionStartPrices[symbol]) sessionStartPrices[symbol] = historicalData[0].close;
                    const base = sessionStartPrices[symbol];
                    const lineData = historicalData.map(d => ({
                        time: d.time,
                        value: ((d.close / base) - 1) * 100
                    }));

                    const isCurrent = (assetPairSelect && symbol === assetPairSelect.value);

                }

            } catch (err) {
                console.warn(`[PRELOAD] Errore per ${symbol}:`, err);
            }
        }

        async function tryFinnhubPreload(symbol) {
            const assetType = getAssetType(symbol);
            // forex/candle e commodity/candle sono endpoint Premium Finnhub (403 garantito su piano gratuito).
            // Saltiamo silenziosamente senza fare la chiamata HTTP per evitare spam di errori 403.
            if (assetType === 'FOREX' || assetType === 'COMMODITY') return null;
            if (window.finnhubForbidden && assetType !== 'CRYPTO') return null;
            if (!finnhubApiKey) return null;
            const key = finnhubApiKey;
            try {
                let endpoint = 'stock/candle';
                if (assetType === 'CRYPTO') endpoint = 'crypto/candle';

                const to = Math.floor(Date.now() / 1000);
                // Ultimi 7 giorni di barre da 15 minuti: storico grafico esteso e
                // abbastanza ampio da scavalcare weekend/festività.
                const from = to - (7 * 24 * 60 * 60);

                const url = `https://finnhub.io/api/v1/${endpoint}?symbol=${encodeURIComponent(symbol)}&resolution=15&from=${from}&to=${to}&token=${key}`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (data.s === 'ok' && data.t && data.t.length > 0) {
                        const historicalData = [];
                        for (let i = 0; i < data.t.length; i++) {
                            historicalData.push({
                                time: data.t[i],
                                open: data.o[i], high: data.h[i], low: data.l[i], close: data.c[i]
                            });
                        }
                        // Fino a ~7 giorni di barre 15Min (tetto di sicurezza a 1000 candele)
                        const slicedData = historicalData.slice(-1000);
                        bgPriceHistories[symbol] = data.c.slice(-100);
                        console.log(`[PRELOAD] ${symbol}: caricati ${slicedData.length} punti utili via Finnhub.`);
                        return slicedData;
                    }
                } else if (res.status === 403) {
                    window.finnhubForbidden = true;
                    localStorage.setItem('finnhub_candles_forbidden', 'true');
                    console.warn(`[FINNHUB] Endpoint Premium (403) raggiunto per ${symbol}. Fallback su stream attivati per gli asset restanti.`);
                }
            } catch (e) {
                console.warn(`[FINNHUB PRELOAD] Fallito per ${symbol}`);
            }
            return null;
        }

        async function tryAlpacaPreload(symbol) {
            let key = alpacaKeyId;
            let sec = alpacaSecretKey;
            if (!key || !sec) {
                const keys = JSON.parse(localStorage.getItem('bot_keys') || '{}');
                // Usa la paper key come default per prelevare lo storico
                key = keys.al_key;
                sec = keys.al_secret;
                if (!key || !sec) return null;
            }
            try {
                // Alpaca offre bars per Stocks e Crypto. I simboli OANDA:* (forex e
                // materie CFD) non esistono su Alpaca; un ETF come LIT (categoria
                // COMMODITY) è invece un'azione a tutti gli effetti → endpoint stocks.
                const assetType = getAssetType(symbol);
                if (symbol.includes('OANDA:')) return null;

                // Storico grafico: ultimi 7 GIORNI in barre da 15 minuti (~670 barre).
                // 1Min su 7 giorni sarebbero ~10.000 barre: pesanti e illeggibili.
                let alpacaUrl, responseKey;
                const nowIso = new Date().toISOString();
                const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                if (assetType === 'CRYPTO') {
                    responseKey = toAlpacaCryptoSym(symbol);
                    alpacaUrl = `${ALPACA_DATA_BASE}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(responseKey)}&timeframe=15Min&start=${weekAgoIso}&end=${nowIso}&limit=1000`;
                } else {
                    responseKey = symbol;
                    alpacaUrl = `${ALPACA_DATA_BASE}/v2/stocks/bars?symbols=${encodeURIComponent(symbol)}&timeframe=15Min&start=${weekAgoIso}&end=${nowIso}&limit=1000&feed=iex`;
                }

                const aRes = await fetch(alpacaUrl, {
                    headers: { 'apca-api-key-id': key, 'apca-api-secret-key': sec }
                });

                if (aRes.ok) {
                    const aData = await aRes.json();
                    const bars = aData.bars ? aData.bars[responseKey] : null;
                    if (bars && bars.length > 0) {
                        const historicalData = bars.map(b => ({
                            time: Math.floor(new Date(b.t).getTime() / 1000),
                            open: b.o, high: b.h, low: b.l, close: b.c
                        }));
                        bgPriceHistories[symbol] = bars.map(b => b.c);
                        console.log(`[PRELOAD] ${symbol}: caricati ${bars.length} punti via Alpaca.`);
                        return historicalData;
                    }
                } else if (aRes.status === 404 || aRes.status === 403) {
                    console.warn(`[ALPACA] Asset ${symbol} non supportato o non disponibile (Status: ${aRes.status})`);
                    restrictedAssets.add(symbol);
                }
            } catch (e) {
                console.warn(`[ALPACA PRELOAD] Fallito per ${symbol}`);
            }
            return null;
        }


        // --- Watchdog grafico: andamento sempre fino all'ora corrente ---
        // Se i tick live si fermano (WS muto, feed lento) l'ultima candela resta
        // indietro. Ogni 30s: se il grafico è fermo da oltre 2 minuti a mercato
        // aperto, ricarichiamo le barre recenti (end=now) dell'asset selezionato.
        setInterval(async () => {
            try {
                const sym = assetPairSelect ? assetPairSelect.value : null;
                if (!sym) return;
                const nowSec = Math.floor(Date.now() / 1000);
                if (lastCandleTime && nowSec - lastCandleTime < 120) return; // già aggiornato
                const aType = getAssetType(sym);
                if (typeof isMarketOpen === 'function' && !isMarketOpen(aType)) return;
                let data = null;
                if (!sym.includes('OANDA:')) {
                    if (restrictedAssets.has(sym)) return;
                    data = await tryAlpacaPreload(sym);
                } else if (typeof tryCapitalPreload === 'function') {
                    // Forex/Materie OANDA: barre recenti dal conto Capital.com
                    data = await tryCapitalPreload(sym);
                }
                if (data && data.length > 0 && assetPairSelect && assetPairSelect.value === sym) {
                    ChartManager.setHistoricalData(data);
                    lastCandleTime = data[data.length - 1].time;
                    currentPrice = data[data.length - 1].close;
                    if (typeof updatePriceUI === 'function') updatePriceUI();
                    console.log(`[CHART] Top-up barre recenti per ${sym} (feed live fermo).`);
                }
            } catch (e) { /* silenzioso: ritenta al prossimo giro */ }
        }, 30000);

        // Storico per Forex/Materie Prime via Capital.com: ultimi 7 giorni in
        // barre 15Min. Finnhub candle è premium (403) e Alpaca non ha questi
        // asset — senza credenziali Capital il grafico OANDA:* parte dai tick live.
        async function tryCapitalPreload(symbol) {
            const epic = CAPITAL_EPIC_MAP[symbol];
            if (!epic || capitalBadEpics.has(epic)) return null;
            if (!capDemoKey && !capLiveKey) return null; // nessuna credenziale Capital
            try {
                const res = await capitalAuthed(`/api/v1/prices/${encodeURIComponent(epic)}?resolution=MINUTE_15&max=672`);
                if (res && res.ok) {
                    const data = await res.json();
                    if (data && Array.isArray(data.prices) && data.prices.length > 0) {
                        const mid = f => {
                            if (!f) return 0;
                            const b = parseFloat(f.bid), a = parseFloat(f.ask);
                            return (b > 0 && a > 0) ? (b + a) / 2 : (a || b || 0);
                        };
                        const historicalData = data.prices.map(p => {
                            let ts = p.snapshotTimeUTC || p.snapshotTime || '';
                            if (ts && !/Z$|[+-]\d\d:?\d\d$/.test(ts)) ts += 'Z'; // orario UTC senza suffisso
                            return {
                                time: Math.floor(new Date(ts).getTime() / 1000),
                                open: mid(p.openPrice), high: mid(p.highPrice),
                                low: mid(p.lowPrice), close: mid(p.closePrice)
                            };
                        }).filter(b => b.time > 0 && b.close > 0);
                        if (historicalData.length > 0) {
                            bgPriceHistories[symbol] = historicalData.slice(-100).map(b => b.close);
                            console.log(`[PRELOAD] ${symbol}: caricati ${historicalData.length} punti via Capital.com (${epic}).`);
                            return historicalData;
                        }
                    }
                }
            } catch (e) { console.warn(`[CAPITAL PRELOAD] Fallito per ${symbol}:`, e.message); }
            return null;
        }

        // IL RADAR MULTI-ASSET È ORA ESTERNO IN radar.js
        if (window.RadarManager) {
            window.RadarManager.init({
                isMarketOpen,
                getAssetType,
                VALID_SYMBOLS,
                radarListEl,
                playSignalSound,
                onRadarClick: (symbol) => {
                    const option = Array.from(assetPairSelect.options).find(o => o.value === symbol);
                    if (option) {
                        assetPairSelect.value = symbol;
                    }
                    checkApiRequirement(symbol);
                },
                getIsManualMode: () => isManualMode,
                getIsBotActive: () => isBotActive,
                isSymbolEnabled,
                hasActivePosition: (sym) => !!activePositions[sym],
                getGlobalPrice: (sym) => globalPrices[sym],
                getBgPriceHistory: (sym) => bgPriceHistories[sym],
                evaluateStrategy
            });
        }

        function updateMarketRadarTarget(symbol) { return; }
        function processRadarTick(sym, price, now, type) {
            if (window.RadarManager && typeof window.RadarManager.processRadarTick === 'function') {
                window.RadarManager.processRadarTick(sym, price, now, type);
            }
        }
        // triggerRadarSignal is encapsulated inside radar.js

        let sharedAudioCtx = null;

        function initAudio() {
            if (!window.userHasInteracted) return;
            // Non tentiamo di creare l'AudioContext se non c'è stata interazione
            if (!sharedAudioCtx) {
                try {
                    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                } catch (e) { return; }
            }
            if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
                sharedAudioCtx.resume().catch(() => { }); // Silenzia fallimento se non c'è gesture
            }
        }
        window.addEventListener('click', initAudio, { once: true });
        window.addEventListener('touchstart', initAudio, { once: true });
        window.addEventListener('keydown', initAudio, { once: true });

        function playSignalSound() {
            if (!isSoundEnabled) return;
            try {
                initAudio();
                if (!sharedAudioCtx || sharedAudioCtx.state === 'suspended') return;
                const osc = sharedAudioCtx.createOscillator();
                const gain = sharedAudioCtx.createGain();
                osc.connect(gain);
                gain.connect(getAudioOut(sharedAudioCtx));
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1000, sharedAudioCtx.currentTime);
                gain.gain.setValueAtTime(0.05, sharedAudioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, sharedAudioCtx.currentTime + 0.1);
                osc.start();
                osc.stop(sharedAudioCtx.currentTime + 0.1);
            } catch (e) { }
        }




        // Diagnostica Asset Alpaca
        window.listAlpacaAssets = async function () {
            console.log("[ALPACA] Recupero lista asset disponibili...");
            try {
                const res = await fetch(`${ALPACA_BASE}/v2/assets?status=active&asset_class=crypto`, {
                    headers: { 'apca-api-key-id': alpacaKeyId, 'apca-api-secret-key': alpacaSecretKey }
                });
                const assets = await res.json();
                console.log("[ALPACA] Asset Disponibili (Crypto/Forex):", assets.slice(0, 20));
                return assets;
            } catch (e) { console.error(e); }
        };

        // --- Start Services ---

        // Avvio dei servizi di sincronizzazione periodica
        setInterval(() => {
            // Sync conto Paper: SOLO in ALP (non in ALrt, dove si sincronizza il conto REALE,
            // altrimenti i dati paper sovrascriverebbero il portafoglio live).
            if (useAlpacaBroker && !window.liveMonitorActive) checkAlpacaConnection();
        }, 10000);

        // Sync del conto Alpaca REALE (stadio ALrt): conto, posizioni, ordini e
        // storico — stessa logica Paper, ora OPERATIVA (trading con denaro reale).
        setInterval(() => {
            if (window.liveMonitorActive) checkAlpacaLiveConnection();
        }, 10000);

        // Chiamata immediata singola allo startup
        if (useAlpacaBroker && !window.liveMonitorActive) {
            checkAlpacaConnection();
        }
        renderHistory();
        initialRadarPreload(); // Carica i dati storici del radar una volta sola
        updateBrokerAssetsUI();
        // Start with default chart
        checkApiRequirement(assetPairSelect.value);

        // --- Chiusura Pulita WebSocket ---
        window.addEventListener('beforeunload', () => {
            if (bgFinnhubWs) bgFinnhubWs.close();
            if (bgAlpacaWs) bgAlpacaWs.close();
            if (bgAlpacaCryptoWs) bgAlpacaCryptoWs.close();
        });

        function updateBrokerAssetsUI() {
            const assetPairSelect = document.getElementById('assetPair');
            if (!assetPairSelect) return;

            const hasFinnhub = (finnhubApiKey && finnhubApiKey.length > 5);

            // Regole di supporto per categoria:
            // - Entrambi OFF   => tutto OFFLINE
            // - Solo Alpaca ON => CRYPTO + STOCK attivi
            // - Solo Finnhub ON=> tutto attivo (sim)
            // - Entrambi ON    => tutto attivo
            const alpacaOn = useAlpacaBroker;
            const finnhubOn = useFinnhubData && hasFinnhub;
            const anyOn = alpacaOn || finnhubOn;

            const catSupported = {
                CRYPTO: anyOn,
                STOCK: anyOn,
                FOREX: finnhubOn,
                COMMODITY: finnhubOn
            };

            // 1. Aggiornamento Dropdown Selezione Asset
            Array.from(assetPairSelect.options).forEach(opt => {
                const sym = opt.value;
                if (!sym) return;
                const type = getAssetType(sym);
                let supported = catSupported[type] ?? false;
                let reason = '';

                // Raffinamento Crypto solo-Alpaca: solo simboli nel listino Alpaca
                if (type === 'CRYPTO' && alpacaOn && !finnhubOn) {
                    supported = ALPACA_SUPPORTED_CRYPTO.includes(sym);
                }

                if (!supported) reason = ' (N/A)';

                if (supported && !isMarketOpen(type)) {
                    supported = false;
                    reason = ' (Chiuso)';
                }

                opt.disabled = !supported;
                opt.text = opt.text.replace(' (N/A)', '').replace(' (Chiuso)', '');
                if (!supported) {
                    opt.style.opacity = '0.4';
                    opt.text += reason;
                } else {
                    opt.style.opacity = '1';
                }
            });

            // 2. Aggiornamento Overview Mini-Cards (Live Prezzi)
            const categories = ['CRYPTO', 'STOCK', 'FOREX', 'COMMODITY'];
            categories.forEach(cat => {
                const el = document.getElementById(`ov-${cat}`);
                if (!el) return;

                const supported = catSupported[cat];

                if (!supported) {
                    el.style.opacity = '0.2';
                    el.style.filter = 'grayscale(1)';
                    el.style.pointerEvents = 'none';
                    el.style.background = 'rgba(0,0,0,0.5)';
                    const changeEl = el.querySelector('.ov-change');
                    if (changeEl) {
                        changeEl.textContent = 'OFFLINE';
                        changeEl.style.color = '#475569';
                        changeEl.style.fontSize = '';
                    }
                } else {
                    el.style.opacity = '1';
                    el.style.filter = 'none';
                    el.style.pointerEvents = 'auto';
                    el.style.background = '';
                    // Nota: il testo della percentuale verrà ripristinato dal loop updateCategoryPulse
                }
            });

            // 3. Se l'asset attualmente selezionato non è supportato, seleziona il primo disponibile
            if (assetPairSelect.selectedOptions[0]?.disabled) {
                const firstValid = Array.from(assetPairSelect.options).find(o => !o.disabled);
                if (firstValid) {
                    assetPairSelect.value = firstValid.value;
                    assetPairSelect.dispatchEvent(new Event('change'));
                }
            }

            // 4. Aggiorna anche i selettori di categoria del bot
            renderCategorySelection();
        }

        // Mantieni sincronizzato il dropdown ogni minuto (aperture/chiusure orarie)
        setInterval(updateBrokerAssetsUI, 60000);

        // --- Pending Orders Sync & Management ---
        async function syncAlpacaOrders() {
            if (!brokerViewActive()) {
                if (typeof renderPendingOrders === 'function') renderPendingOrders([]);
                return;
            }
            const mgr = getAlpacaManager();
            if (!mgr) {
                if (typeof renderPendingOrders === 'function') renderPendingOrders([]);
                return;
            }
            try {
                const orders = await mgr.getOpenOrders();
                renderPendingOrders(orders);
            } catch (e) { console.error("[ALPACA] Errore sync ordini:", e); }
        }

        async function cancelAlpacaOrder(orderId) {
            const mgr = getAlpacaManager();
            if (!mgr) return;
            if (!confirm("Sei sicuro di voler annullare questo ordine?")) return;
            try {
                await mgr.cancelOrder(orderId);
                showNotification("Ordine annullato con successo", "success");
                syncAlpacaOrders();
            } catch (e) {
                showNotification(`Errore: ${e.message}`, "error");
            }
        }
        window.cancelAlpacaOrder = cancelAlpacaOrder;

        let _lastPendingOrders = [];
        // Toggle ordinamento Ordini in Attesa (recente↔vecchio)
        const btnSortPendingOrders = document.getElementById('btnSortPendingOrders');
        if (btnSortPendingOrders) {
            btnSortPendingOrders.addEventListener('click', () => {
                pendingOrdersSortDesc = !pendingOrdersSortDesc;
                localStorage.setItem('sort_pending_desc', String(pendingOrdersSortDesc));
                updateSortToggleUI('btnSortPendingOrders', pendingOrdersSortDesc);
                renderPendingOrders(_lastPendingOrders);
            });
            updateSortToggleUI('btnSortPendingOrders', pendingOrdersSortDesc);
        }

        function renderPendingOrders(orders) {
            _lastPendingOrders = orders || [];
            const pendingOrdersCountBadge = document.getElementById('pendingOrdersCountBadge');
            if (pendingOrdersCountBadge) {
                const count = orders ? orders.length : 0;
                pendingOrdersCountBadge.textContent = count;
                pendingOrdersCountBadge.style.display = count > 0 ? 'inline-block' : 'none';
            }
            const container = document.getElementById('pendingOrdersContainer');
            const list = document.getElementById('pendingOrdersList');
            const countEl = document.getElementById('cnt-PENDING');

            if (!container || !list) return;

            // Mostra o nascondi l'intera colonna in base alla modalità:
            // la griglia passa da 6 a 7 colonne uniformi (classe has-pending)
            const dashGrid = document.querySelector('.dashboard-grid');
            if (!brokerViewActive()) {
                container.style.display = 'none';
                if (dashGrid) dashGrid.classList.remove('has-pending');
                return;
            } else {
                container.style.display = 'flex';
                if (dashGrid) dashGrid.classList.add('has-pending');
            }

            if (orders.length === 0) {
                list.innerHTML = `<div class="open-position empty">${tr('no_pending_orders', 'Nessun ordine in attesa')}</div>`;
                if (countEl) countEl.textContent = '0';
                return;
            }

            if (countEl) countEl.textContent = orders.length;

            // Ordina per data creazione ordine secondo il toggle utente (default: recenti prima)
            const sortedOrders = [...orders].sort((a, b) => {
                const ta = new Date(a.submitted_at || a.created_at || 0).getTime();
                const tb = new Date(b.submitted_at || b.created_at || 0).getTime();
                return pendingOrdersSortDesc ? (tb - ta) : (ta - tb);
            });

            list.innerHTML = sortedOrders.map(order => {
                const side = escHtml(order.side.toUpperCase());
                const isBuy = side === 'BUY';
                const assetName = escHtml(displaySymbol(order.symbol));
                // Icona categoria come negli altri pannelli (simbolo Alpaca → simbolo bot)
                const ordCat = getAssetType((order.symbol || '').replace('/USD', 'USDT'));
                const ordIcon = { 'CRYPTO': '🔸', 'STOCK': '📈', 'FOREX': '💱', 'COMMODITY': '⛽' }[ordCat] || '💰';
                const rawDate = order.submitted_at || order.created_at;
                const dateStr = rawDate ? new Date(rawDate).toLocaleString(uiLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';
                // L'id ordine finisce in un onclick inline: si accettano solo
                // caratteri da UUID Alpaca (difesa contro injection nel handler)
                const safeOrderId = String(order.id).replace(/[^a-zA-Z0-9-]/g, '');
                // Quantità e prezzo formattati: i raw Alpaca ("0.276451288", null per
                // i market order) rendevano la riga illeggibile nella colonna stretta
                const rawQty = parseFloat(order.qty);
                const qtyStr = isFinite(rawQty)
                    ? escHtml(String(parseFloat(rawQty.toFixed(4))))
                    : (order.notional ? '$' + escHtml(parseFloat(order.notional).toFixed(2)) : '--');
                const rawLimit = parseFloat(order.limit_price || order.stop_price);
                const priceStr = isFinite(rawLimit)
                    ? '$' + escHtml(rawLimit.toFixed(rawLimit < 10 ? 4 : 2))
                    : 'MARKET';
                // Righe etichetta-valore: nella colonna stretta le 3 colonne affiancate
                // troncavano tutto ("0... MA... ACCE..."). Una riga per dato = leggibile.
                const rowStyle = 'display: flex; justify-content: space-between; align-items: baseline; gap: 8px;';
                const metricLabel = 'font-size: 0.6rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0;';
                const metricVal = 'color: #fff; font-size: 0.75rem; font-weight: 600; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

                return `
                    <div class="open-position pending-order" style="border-left: 4px solid #f59e0b; background: rgba(245, 158, 11, 0.05); margin-bottom: 8px; padding: 10px; border-radius: 8px; display: flex; flex-direction: column; align-items: stretch; gap: 5px;">
                        <div class="pos-asset" style="color: #fff; font-weight: bold; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ordIcon} ${assetName}</div>
                        <div>
                            <span class="pos-type ${isBuy ? 'buy' : 'sell'}" style="display: inline-block; font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; background: ${isBuy ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color: ${isBuy ? '#10b981' : '#ef4444'}; font-weight: bold; white-space: nowrap;">${side} · ${escHtml(order.type.toUpperCase())}</span>
                        </div>
                        <div class="pos-metric" style="${rowStyle}">
                            <span class="m-label" style="${metricLabel}">${tr('lbl_date', 'Data')}</span>
                            <span class="m-val" style="${metricVal}">${escHtml(dateStr)}</span>
                        </div>
                        <div class="pos-metric" style="${rowStyle}">
                            <span class="m-label" style="${metricLabel}">${tr('lbl_qty', 'Qty')}</span>
                            <span class="m-val" style="${metricVal}">${qtyStr}</span>
                        </div>
                        <div class="pos-metric" style="${rowStyle}">
                            <span class="m-label" style="${metricLabel}">${tr('lbl_price', 'Prezzo')}</span>
                            <span class="m-val" style="${metricVal}">${priceStr}</span>
                        </div>
                        <div class="pos-metric" style="${rowStyle}">
                            <span class="m-label" style="${metricLabel}">${tr('lbl_status', 'Stato')}</span>
                            <span class="m-val" style="${metricVal} color: #f59e0b;">${escHtml(order.status.toUpperCase())}</span>
                        </div>
                        <div class="pos-actions" style="margin-top: 3px; ${window.liveMonitorActive ? 'display:none;' : ''}">
                            <button class="btn btn-secondary" onclick="cancelAlpacaOrder('${safeOrderId}')"
                                style="width: 100%; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); font-size: 0.65rem; padding: 6px 12px; cursor: pointer; border-radius: 4px; font-weight: bold; transition: all 0.2s;"
                                onmouseover="this.style.background='rgba(239,68,68,0.2)'"
                                onmouseout="this.style.background='rgba(239,68,68,0.1)'">
                                ${tr('btn_cancel', 'ANNULLA').toUpperCase()}
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Chiamata iniziale differita
        setTimeout(updateBrokerAssetsUI, 2500);

    } catch (err) {
        document.getElementById('currentPrice').textContent = 'APP ERRORE: ' + err.message;
    }
});

function showNotification(message, type = 'success') {
    if (window.__muteNotifications) return;
    const container = document.getElementById('notificationContainer') || createNotificationContainer();
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    container.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// --- Orologio di Sistema (Top Bar) ---
function updateTopClock() {
    const clockEl = document.getElementById('topClockText');
    if (!clockEl) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString(uiLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    clockEl.textContent = `${dateStr}  ${timeStr}`;
}
setInterval(updateTopClock, 1000);
updateTopClock();

function createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notificationContainer';
    container.style.cssText = `
                position: fixed;
                bottom: calc(16px + env(safe-area-inset-bottom, 0px));
                right: 16px;
                left: 16px;
                align-items: flex-end;
                display: flex;
                flex-direction: column;
                gap: 10px;
                z-index: 100050;
            `;
    document.body.appendChild(container);
    return container;
}

// FLUSH EVENT LISTENER

const btnFlush = document.getElementById('btnFlushCapital');
if (btnFlush) {
    btnFlush.addEventListener('click', () => {
        if (getBrokerCtx() !== 'fh') return;
        if (confirm('Sei sicuro di voler azzerare il portafoglio Finnhub? Verranno ripristinati il capitale iniziale (1000) e cancellati tutti i trade e la cronologia locale.')) {
            // Rimuovi contesto locale Finnhub (stesse chiavi del reset all'avvio:
            // capitale a 1000, posizioni aperte e cronologia azzerate)
            localStorage.removeItem('sim_ctx_fh');
            localStorage.removeItem('broker_pnl_fh');
            localStorage.removeItem('broker_deposited_fh');

            // Rimuovi variabili globali che potrebbero fare da fallback
            localStorage.removeItem('sim_trading_capital');
            localStorage.removeItem('sim_session_initial_capital');
            localStorage.removeItem('sim_total_pnl');
            localStorage.removeItem('sim_executed_trades');
            localStorage.removeItem('sim_win_trades');
            localStorage.removeItem('sim_gross_profit');
            localStorage.removeItem('sim_gross_loss');
            localStorage.removeItem('sim_trade_history');
            localStorage.removeItem('sim_active_positions');
            localStorage.removeItem('sim_global_commissions');

            // Ricarica la pagina per azzerare completamente la memoria e riavviare l'app pulita
            window.location.reload();
        }
    });
}

