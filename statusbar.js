// Status Bar Manager
// Gestisce esclusivamente la logica visiva (UI) della barra di stato superiore.
// I check di connessione reale ai broker restano nel motore principale, 
// che invierà a questo manager solo l'esito visivo (es. setLedState).

window.StatusBarManager = (function() {
    let deps = {};
    let leds = {};
    let botStatusEl = null;
    let algoTitleEl = null;
    let logicEMAEl = null;
    let logicAIEl = null;
    let engineStatusEl = null;

    function init(dependencies) {
        deps = dependencies;
        
        botStatusEl = document.getElementById('botStatus');
        algoTitleEl = document.getElementById('algoTitle');
        logicEMAEl = document.getElementById('logicEMA');
        logicAIEl = document.getElementById('logicAI');
        engineStatusEl = document.getElementById('engineStatus');

        leds = {
            'FH': document.getElementById('statusFH'),
            'ALP': document.getElementById('statusAL'),
            'CAP': document.getElementById('statusCAP'), // DEMO Capital.com
            'CAPL': document.getElementById('statusCAPL'), // LIVE Capital.com
            'ALPRT': document.getElementById('statusALrt') // LIVE Alpaca
        };
    }

    function setLedState(ledId, stateClass) {
        const led = leds[ledId];
        if (!led) return;
        
        const dot = led.querySelector('.status-dot');
        if (!dot) return;

        // stateClass can be: 'active', 'warning', 'error', or empty '' for off
        dot.className = 'status-dot' + (stateClass ? ' ' + stateClass : '');
    }

    function updateBotLabel(isManualMode, isBotActive, isCapitalExhausted, isAiMode, translations, currentLang) {
        if (!botStatusEl || (!translations[currentLang] && !translations.IT)) return;

        const t = translations[currentLang] || translations.IT;

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

    function updateEngineStatus(lastPing, currentFPS) {
        if (!engineStatusEl) return;
        
        // Esempio logica visiva per le prestazioni
        const pingColor = lastPing < 200 ? '#10b981' : (lastPing < 500 ? '#f59e0b' : '#ef4444');
        const pingText = lastPing === 9999 ? '---' : lastPing + 'ms';
        
        const fpsColor = currentFPS >= 30 ? '#10b981' : (currentFPS >= 15 ? '#f59e0b' : '#ef4444');
        
        // Simulazione CPU
        const cpuSim = Math.floor(Math.random() * 5) + (currentFPS < 30 ? 10 : 2);

        engineStatusEl.innerHTML = \`
            API: <span style="color: \${pingColor}; font-family: monospace;">\${pingText}</span> |
            UI: <span style="color: \${fpsColor}; font-family: monospace;">\${currentFPS}fps</span> |
            SYS: <span style="color: var(--text-secondary); font-family: monospace;">\${cpuSim}%</span>
        \`;
    }

    return {
        init,
        setLedState,
        updateBotLabel,
        updateEngineStatus
    };
})();
