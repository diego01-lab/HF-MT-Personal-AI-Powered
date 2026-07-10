// Radar Multi-Asset
// Scansiona in background tutti gli asset supportati per rilevare anomalie o esplosioni
// di volatilità nel brevissimo periodo (es. 3 secondi).

window.RadarManager = (function() {
    let deps = {};
    let radarTracker = {};
    let radarActiveElements = {};

    function init(dependencies) {
        deps = dependencies;
    }

    function processRadarTick(symbol, price, now, type) {
        if (!deps || typeof deps.isMarketOpen !== "function" || !deps.isMarketOpen(type)) return;

        if (!radarTracker[symbol]) {
            radarTracker[symbol] = { startPrice: price, startTime: now };
        } else {
            const elapsed = now - radarTracker[symbol].startTime;
            const growth = (price / radarTracker[symbol].startPrice) - 1;

            let threshold = 0.0001; // 0.01% for crypto
            if (type === 'STOCK') threshold = 0.00005; 
            if (type === 'FOREX') threshold = 0.000005;
            if (type === 'COMMODITY') threshold = 0.00002;

            if (Math.abs(growth) > threshold) {
                triggerRadarSignal(symbol, growth * 100);
                radarTracker[symbol] = { startPrice: price, startTime: now };
            } else if (elapsed > 15000) {
                radarTracker[symbol] = { startPrice: price, startTime: now };
            }
        }
    }

    function triggerRadarSignal(symbol, percentage) {
        const cat = deps.getAssetType(symbol);
        const whitelist = deps.VALID_SYMBOLS[cat] || [];
        if (!whitelist.includes(symbol)) return;

        // Stessa grafica dei segnali del bot (showAISignal in app.js): icona
        // categoria + simbolo bianco a sinistra, dettaglio piccolo a destra,
        // bordo colorato per direzione. Il radar resta uniforme con bot ON/OFF.
        const catIcon = { 'CRYPTO': '🔸', 'STOCK': '📈', 'FOREX': '💱', 'COMMODITY': '⛽' }[cat] || '💰';
        const dirColor = percentage >= 0 ? '#10b981' : '#ef4444';
        const timeStr = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false });

        if (radarActiveElements[symbol]) {
            const el = radarActiveElements[symbol];
            const pctSpan = el.querySelector('.radar-pct');
            if (pctSpan) {
                pctSpan.textContent = `${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%`;
                pctSpan.style.color = dirColor;
            }
            const timeSpan = el.querySelector('.radar-time');
            if (timeSpan) timeSpan.textContent = ` • ${timeStr}`;
            el.style.borderLeft = `3px solid ${dirColor}`;
            clearTimeout(el.removeTimeout);
            el.removeTimeout = setTimeout(() => {
                el.classList.add('fade-out');
                setTimeout(() => { el.remove(); delete radarActiveElements[symbol]; }, 500);
            }, 15000);
            return;
        }

        const el = document.createElement('div');
        el.className = 'radar-signal';
        el.style.borderLeft = `3px solid ${dirColor}`;
        const dispSym = window.displaySymbol ? window.displaySymbol(symbol) : symbol;
        el.innerHTML = `
        <span style="font-weight: bold; font-size: 0.72rem; color: #fff;">${catIcon} ${dispSym}</span>
        <span style="font-size: 0.62rem; color: var(--text-secondary);">
            <span class="radar-pct" style="font-weight: bold; color: ${dirColor};">${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%</span><span class="radar-time"> • ${timeStr}</span>
        </span>
        `;

        el.addEventListener('click', () => {
            deps.onRadarClick(symbol);
        });

        deps.radarListEl.prepend(el);
        radarActiveElements[symbol] = el;

        deps.playSignalSound();

        el.removeTimeout = setTimeout(() => {
            el.classList.add('fade-out');
            setTimeout(() => { el.remove(); delete radarActiveElements[symbol]; }, 500);
        }, 15000);

        if (!deps.getIsManualMode() && deps.getIsBotActive() && deps.isSymbolEnabled(symbol) && !deps.hasActivePosition(symbol)) {
            const radarPrice = deps.getGlobalPrice(symbol);
            if (radarPrice && radarPrice > 0) {
                const history = deps.getBgPriceHistory(symbol) || [];
                if (history.length > 5) {
                    deps.evaluateStrategy(symbol, history, radarPrice);
                }
            }
        }
    }

    return {
        init,
        processRadarTick
    };
})();
