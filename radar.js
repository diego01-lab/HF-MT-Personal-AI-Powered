// Radar Multi-Asset
// Scansiona in background tutti gli asset supportati per rilevare anomalie o esplosioni
// di volatilità nel brevissimo periodo (es. 30 secondi).

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
            if (elapsed > 15000) {
                radarTracker[symbol] = { startPrice: price, startTime: now };
            } else {
                const growth = (price / radarTracker[symbol].startPrice) - 1;

                let threshold = 0.001; // 0.1% for crypto (was 0.2%)
                if (type === 'STOCK') threshold = 0.0005; // 0.05% (was 0.1%)
                if (type === 'FOREX') threshold = 0.00005; // 0.005% (was 0.01%)
                if (type === 'COMMODITY') threshold = 0.0002; // 0.02% (was 0.05%)

                if (Math.abs(growth) > threshold) {
                    triggerRadarSignal(symbol, growth * 100);
                    radarTracker[symbol] = { startPrice: price, startTime: now };
                }
            }
        }
    }

    function triggerRadarSignal(symbol, percentage) {
        const cat = deps.getAssetType(symbol);
        const whitelist = deps.VALID_SYMBOLS[cat] || [];
        if (!whitelist.includes(symbol)) return;

        const catIcon = { 'CRYPTO': '🔥', 'STOCK': '📈', 'FOREX': '💱', 'COMMODITY': '🥇' }[cat] || '🔥';

        if (radarActiveElements[symbol]) {
            const el = radarActiveElements[symbol];
            const pctSpan = el.querySelector('.radar-pct');
            if (pctSpan) {
                pctSpan.textContent = `${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%`;
                pctSpan.style.color = percentage >= 0 ? '#10b981' : '#ef4444';
            }
            clearTimeout(el.removeTimeout);
            el.removeTimeout = setTimeout(() => {
                el.classList.add('fade-out');
                setTimeout(() => { el.remove(); delete radarActiveElements[symbol]; }, 500);
            }, 15000);
            return;
        }

        const el = document.createElement('div');
        el.className = 'radar-signal';
        el.innerHTML = `
        <span style="font-weight: bold; font-size: 0.9rem;">${catIcon} ${symbol}</span>
        <span style="font-weight: bold; color: ${percentage >= 0 ? '#10b981' : '#ef4444'};">
            <span class="radar-pct">${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%</span>
            <span style="font-size: 0.68rem; font-weight: normal; color: var(--text-secondary);">(15s)</span>
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
