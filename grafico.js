/**
 * Gestore del Grafico Principale (LightweightCharts)
 * Isola la logica di rendering, indicatori e aggiornamento candele.
 */
window.ChartManager = (function() {
    let chart = null;
    let candleSeries = null;
    let rsiSeries = null;
    let maSeries = null;
    let emaShortSeries = null;
    let emaLongSeries = null;
    let emaTrendSeries = null;
    let currentCandle = null;
    let lastCandleTime = 0;
    let chartUpdatePending = false;
    
    // Riferimenti DOM
    let legendPriceEl = null;
    let legendChangeEl = null;
    let legendTimeEl = null;
    let currentPriceEl = null; // Il testo mostrato sotto al simbolo

    function init(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return false;

        // Recupero nodi per la leggenda
        legendPriceEl = document.getElementById('legendPrice');
        legendChangeEl = document.getElementById('legendChange');
        legendTimeEl = document.getElementById('legendTime');
        currentPriceEl = document.getElementById('currentPrice');

        // Fallback robusto se LightweightCharts manca (offline/CDN failed)
        if (typeof LightweightCharts === 'undefined') {
            console.warn('[CHART] LightweightCharts non disponibile (CDN non raggiungibile). Grafico disabilitato, app operativa.');
            const _noop = function () { };
            const _seriesStub = new Proxy({}, { get: () => _noop });
            const _chartStub = new Proxy({}, {
                get: (t, prop) => {
                    if (prop.includes('Series')) return () => _seriesStub;
                    if (prop === 'subscribeCrosshairMove') return _noop;
                    if (prop === 'timeScale') return () => _seriesStub;
                    return _noop;
                }
            });
            window.LightweightCharts = {
                createChart: () => _chartStub,
                CrosshairMode: { Normal: 1, Magnet: 2, Hidden: 0 },
                LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
                PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 },
            };
        }

        chart = LightweightCharts.createChart(container, {
            autoSize: true,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: '#94a3b8',
                fontSize: 11,
                fontFamily: "'Inter', sans-serif",
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: 'rgba(148, 163, 184, 0.3)', width: 1, style: 2, labelBackgroundColor: '#1e293b' },
                horzLine: { color: 'rgba(148, 163, 184, 0.3)', width: 1, style: 2, labelBackgroundColor: '#1e293b' },
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.12)',
                scaleMargins: { top: 0.1, bottom: 0.15 },
                autoScale: true,
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.12)',
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 5,
                barSpacing: 8,
                minBarSpacing: 1,
            },
            handleScroll: { mouseWheel: true, pressedMouseMove: true },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
        });

        candleSeries = chart.addCandlestickSeries({
            upColor: '#10b981', downColor: '#ef4444',
            borderUpColor: '#10b981', borderDownColor: '#ef4444',
            wickUpColor: '#10b981', wickDownColor: '#ef4444',
            priceFormat: { type: 'price', precision: 5, minMove: 0.00001 }
        });

        maSeries = chart.addLineSeries({ color: 'rgba(59, 130, 246, 0.6)', lineWidth: 1, title: 'MA(14)' });
        emaShortSeries = chart.addLineSeries({ color: 'rgba(168, 85, 247, 0.7)', lineWidth: 1, title: 'EMA(12)' });
        emaLongSeries = chart.addLineSeries({ color: 'rgba(236, 72, 153, 0.7)', lineWidth: 1, title: 'EMA(26)' });
        emaTrendSeries = chart.addLineSeries({ color: 'rgba(234, 179, 8, 0.8)', lineWidth: 2, title: 'EMA(200)' });
        
        rsiSeries = chart.addLineSeries({
            color: 'rgba(14, 165, 233, 0.6)', lineWidth: 1, title: 'RSI(14)',
            priceScaleId: 'rsi',
            priceFormat: { type: 'price', precision: 1, minMove: 0.1 }
        });

        chart.priceScale('rsi').applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
            autoScale: true,
            visible: true
        });

        // Crosshair handler for legend
        chart.subscribeCrosshairMove(param => {
            if (!legendPriceEl) return;
            if (param.time && param.seriesData.size > 0) {
                const data = param.seriesData.get(candleSeries);
                if (data) {
                    legendPriceEl.textContent = data.close.toFixed(5);
                    const change = data.close - data.open;
                    const pct = (change / data.open) * 100;
                    legendChangeEl.textContent = `${change > 0 ? '+' : ''}${pct.toFixed(2)}%`;
                    legendChangeEl.className = change >= 0 ? 'text-green-500' : 'text-red-500';
                    const date = new Date(param.time * 1000);
                    legendTimeEl.textContent = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                }
            } else {
                legendPriceEl.textContent = '---';
                legendChangeEl.textContent = '---';
                legendChangeEl.className = 'text-slate-400';
                legendTimeEl.textContent = '--:--';
            }
        });

        console.log("[CHART] Inizializzato.");
        return true;
    }

    function setSymbol(symbol) {
        currentCandle = null;
        lastCandleTime = 0;
        if (candleSeries) candleSeries.setData([]);
        if (maSeries) maSeries.setData([]);
        if (emaShortSeries) emaShortSeries.setData([]);
        if (emaLongSeries) emaLongSeries.setData([]);
        if (emaTrendSeries) emaTrendSeries.setData([]);
        if (rsiSeries) rsiSeries.setData([]);
        
        if (currentPriceEl) currentPriceEl.textContent = 'In attesa del primo dato...';
    }

    function pushPrice(price, time, isInitialHistory = false) {
        if (!candleSeries) return;
        
        // Rimuove il messaggio "In attesa..."
        if (currentPriceEl) {
            currentPriceEl.textContent = price.toFixed(5);
        }

        // Se è un caricamento storico di massa (isInitialHistory = true)
        // time è già l'inizio del minuto e price è l'intero oggetto OHLCV
        if (isInitialHistory) {
            currentCandle = { ...price, time: time };
            lastCandleTime = time;
            candleSeries.update(currentCandle);
            return;
        }

        const minuteTime = Math.floor(time / 60) * 60;
        
        if (!currentCandle || minuteTime !== lastCandleTime) {
            currentCandle = {
                time: minuteTime,
                open: price,
                high: price,
                low: price,
                close: price
            };
            lastCandleTime = minuteTime;
        } else {
            currentCandle.high = Math.max(currentCandle.high, price);
            currentCandle.low = Math.min(currentCandle.low, price);
            currentCandle.close = price;
        }
        
        if (!chartUpdatePending) {
            chartUpdatePending = true;
            // Throttle rendering at 250ms (4 FPS) to prevent requestAnimationFrame violations
            setTimeout(() => {
                requestAnimationFrame(() => {
                    chartUpdatePending = false;
                    if (!candleSeries || !currentCandle) return;
                    try {
                        candleSeries.update(currentCandle);
                    } catch(e) {}
                });
            }, 250);
        }
    }

    function setHistoricalData(data) {
        if (!candleSeries) return;
        candleSeries.setData(data);
        if (data.length > 0) {
            const last = data[data.length - 1];
            lastCandleTime = last.time;
            currentCandle = { ...last };
            if (currentPriceEl) {
                currentPriceEl.textContent = last.close.toFixed(5);
            }
        }
    }

    function updateIndicators(maData, emaShortData, emaLongData, emaTrendData, rsiData) {
        if (!chart) return;
        if (maSeries) maSeries.setData(maData);
        if (emaShortSeries) emaShortSeries.setData(emaShortData);
        if (emaLongSeries) emaLongSeries.setData(emaLongData);
        if (emaTrendSeries) emaTrendSeries.setData(emaTrendData);
        if (rsiSeries) rsiSeries.setData(rsiData);
    }

    function setSeriesVisibility(config) {
        if (!chart) return;
        if (config.ma !== undefined && maSeries) maSeries.applyOptions({ visible: config.ma });
        if (config.ema !== undefined) {
            if (emaShortSeries) emaShortSeries.applyOptions({ visible: config.ema });
            if (emaLongSeries) emaLongSeries.applyOptions({ visible: config.ema });
            if (emaTrendSeries) emaTrendSeries.applyOptions({ visible: config.ema });
        }
        if (config.rsi !== undefined) {
            if (rsiSeries) rsiSeries.applyOptions({ visible: config.rsi });
            chart.priceScale('rsi').applyOptions({ visible: config.rsi });
        }
    }

    return {
        init,
        setSymbol,
        pushPrice,
        setHistoricalData,
        updateIndicators,
        setSeriesVisibility
    };
})();
