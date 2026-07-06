// === Stock Portfolio Dashboard - Main App Logic ===

// ========== State ==========
let portfolio = JSON.parse(localStorage.getItem('stockPortfolio') || '[]');
let myHoldings = []; // From portfolio.json
let priceCache = {};
let chartInstances = {};
let autoRefreshInterval = null;
let usdTwdRate = 32.0;

// ========== Price cache TTL (ms) ==========
const PRICE_CACHE_TTL_MS = 90 * 1000;
const RATE_CACHE_TTL_MS = 5 * 60 * 1000;
let usdTwdFetchedAt = 0;

function getCachedPrice(stock) {
    const key = `${stock.market}:${stock.symbol}`;
    const entry = priceCache[key];
    if (!entry || !entry.ts) return null;
    if (Date.now() - entry.ts > PRICE_CACHE_TTL_MS) return null;
    return entry.data;
}
function setCachedPrice(stock, data) {
    const key = `${stock.market}:${stock.symbol}`;
    priceCache[key] = { data, ts: Date.now() };
}

// ========== Helpers: CORS proxies, escaping, currency ==========
const CORS_PROXIES = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];
let preferredProxyIdx = 0;

async function fetchViaProxy(url) {
    let lastErr;
    const n = CORS_PROXIES.length;
    for (let attempt = 0; attempt < n; attempt++) {
        const idx = (preferredProxyIdx + attempt) % n;
        try {
            const response = await fetch(CORS_PROXIES[idx](url));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            preferredProxyIdx = idx;
            return response;
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error('All proxies failed');
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch (e) {}
    return '#';
}

function marketRate(market) {
    return market === 'US' ? usdTwdRate : 1;
}

async function fetchUsdTwdRate() {
    if (Date.now() - usdTwdFetchedAt < RATE_CACHE_TTL_MS) return usdTwdRate;
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=1d`;
        const response = await fetchViaProxy(url);
        const data = await response.json();
        const rate = data.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (typeof rate === 'number' && rate > 0) {
            usdTwdRate = rate;
            usdTwdFetchedAt = Date.now();
        }
    } catch (err) {
        console.warn('Failed to fetch USD/TWD rate, using fallback:', err.message);
    }
    return usdTwdRate;
}

// ========== Navigation ==========
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(`page-${page}`).classList.add('active');

        if (page === 'charts') updateChartStockSelect();
        if (page === 'news') fetchNews();
    });
});

// ========== Market selector for form ==========
document.getElementById('stock-market').addEventListener('change', function() {
    const label = document.getElementById('shares-label');
    label.textContent = this.value === 'TW' ? '持股（張）' : '持股（股）';
});

// ========== Add Stock ==========
function addStock(event) {
    event.preventDefault();
    const market = document.getElementById('stock-market').value;
    const symbol = document.getElementById('stock-symbol').value.trim().toUpperCase();
    const name = document.getElementById('stock-name').value.trim();
    const shares = parseFloat(document.getElementById('stock-shares').value);
    const cost = parseFloat(document.getElementById('stock-cost').value);
    const targetPriceRaw = document.getElementById('stock-target')?.value;
    const stopLossRaw    = document.getElementById('stock-stoploss')?.value;
    const targetPrice = targetPriceRaw ? parseFloat(targetPriceRaw) : null;
    const stopLoss    = stopLossRaw    ? parseFloat(stopLossRaw)    : null;

    if (!symbol || !shares || !cost) {
        showToast('請填寫完整資料', 'error');
        return;
    }

    // Check duplicate
    if (portfolio.find(s => s.symbol === symbol && s.market === market)) {
        showToast('已有相同持股，請先刪除再重新新增', 'error');
        return;
    }

    portfolio.push({
        market, symbol, name: name || symbol, shares, cost,
        targetPrice: (targetPrice && targetPrice > 0) ? targetPrice : null,
        stopLoss:    (stopLoss    && stopLoss    > 0) ? stopLoss    : null,
    });
    savePortfolio();
    document.getElementById('add-stock-form').reset();
    showToast(`已新增 ${name || symbol}`, 'success');
    refreshAll();
}

// ========== Delete Stock ==========
function deleteStock(index) {
    const stock = portfolio[index];
    portfolio.splice(index, 1);
    savePortfolio();
    showToast(`已刪除 ${stock.name}`, 'info');
    refreshAll();
}

// ========== Save/Load ==========
function savePortfolio() {
    localStorage.setItem('stockPortfolio', JSON.stringify(portfolio));
}

// ========== Fetch Stock Prices ==========
async function fetchPrice(stock) {
    const cached = getCachedPrice(stock);
    if (cached) return cached;
    const symbol = stock.market === 'TW' ? `${stock.symbol}.TW` : stock.symbol;
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
        const response = await fetchViaProxy(url);
        const data = await response.json();
        const result = data.chart?.result?.[0];
        if (!result) throw new Error('No data');

        const meta = result.meta;
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        const change = price - prevClose;
        const changePct = prevClose ? (change / prevClose) * 100 : 0;

        return {
            price,
            prevClose,
            change,
            changePct,
            currency: meta.currency
        };
    } catch (err) {
        console.warn(`Failed to fetch ${stock.symbol}:`, err.message);
        return await fetchPriceFallback(stock);
    }
}

async function fetchPriceFallback(stock) {
    const symbol = stock.market === 'TW' ? `${stock.symbol}.TW` : stock.symbol;
    try {
        const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price`;
        const response = await fetchViaProxy(url);
        const data = await response.json();
        const priceData = data.quoteSummary?.result?.[0]?.price;

        if (!priceData) throw new Error('No data');

        return {
            price: priceData.regularMarketPrice?.raw || 0,
            prevClose: priceData.regularMarketPreviousClose?.raw || 0,
            change: priceData.regularMarketChange?.raw || 0,
            changePct: (priceData.regularMarketChangePercent?.raw || 0) * 100,
            currency: priceData.currency
        };
    } catch (err) {
        console.warn(`Fallback also failed for ${stock.symbol}:`, err.message);
        return { price: 0, prevClose: 0, change: 0, changePct: 0, currency: stock.market === 'TW' ? 'TWD' : 'USD' };
    }
}

// ========== Fetch Historical Data ==========
async function fetchHistory(stock, period = '3mo') {
    const symbol = stock.market === 'TW' ? `${stock.symbol}.TW` : stock.symbol;
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${period}`;
        const response = await fetchViaProxy(url);
        const data = await response.json();
        const result = data.chart?.result?.[0];

        if (!result) return null;

        const timestamps = result.timestamp || [];
        const closes = result.indicators.quote[0].close || [];

        return timestamps.map((t, i) => ({
            date: new Date(t * 1000),
            close: closes[i]
        })).filter(d => d.close != null);
    } catch (err) {
        console.warn(`Failed to fetch history for ${stock.symbol}:`, err.message);
        return null;
    }
}

// ========== Refresh All Data ==========
async function refreshAll() {
    renderManageTable();

    if (portfolio.length === 0) {
        renderEmptyDashboard();
        return;
    }

    showLoadingSkeletons();
    showToast('正在更新數據...', 'info');

    // Fetch USD/TWD rate first if portfolio has US stocks (needed for correct aggregation)
    const hasUS = portfolio.some(s => s.market === 'US');
    const ratePromise = hasUS ? fetchUsdTwdRate() : Promise.resolve(usdTwdRate);

    // Fetch all prices in parallel (fetchPrice already uses TTL cache internally)
    const pricePromises = portfolio.map(async (stock) => {
        const priceData = await fetchPrice(stock);
        setCachedPrice(stock, priceData);
        return { stock, priceData };
    });

    const [results] = await Promise.all([Promise.all(pricePromises), ratePromise]);

    // Calculate totals — convert all values to TWD base before summing
    let totalValue = 0;
    let totalCost = 0;

    results.forEach(({ stock, priceData }) => {
        const multiplier = stock.market === 'TW' ? 1000 : 1; // 台股1張=1000股
        const rate = marketRate(stock.market);
        const value = priceData.price * stock.shares * multiplier * rate;
        const cost = stock.cost * stock.shares * multiplier * rate;
        totalValue += value;
        totalCost += cost;
    });

    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // Update summary cards
    document.getElementById('total-value').textContent = formatCurrency(totalValue);
    document.getElementById('total-cost').textContent = formatCurrency(totalCost);
    document.getElementById('total-pnl').textContent = formatCurrency(totalPnl);
    document.getElementById('total-pnl-pct').textContent = totalPnlPct.toFixed(2) + '%';

    // Color coding
    const pnlIcon = document.getElementById('pnl-icon');
    const pnlPctIcon = document.getElementById('pnl-pct-icon');
    document.getElementById('total-pnl').className = `card-value ${totalPnl >= 0 ? 'profit-text' : 'loss-text'}`;
    document.getElementById('total-pnl-pct').className = `card-value ${totalPnl >= 0 ? 'profit-text' : 'loss-text'}`;
    pnlIcon.className = `card-icon ${totalPnl >= 0 ? 'profit' : 'loss'}`;
    pnlPctIcon.className = `card-icon ${totalPnl >= 0 ? 'profit' : 'loss'}`;

    // Render table
    renderHoldingsTable(results);

    // Render charts
    renderAllocationChart(results);
    renderPnlChart(results);

    // Update timestamp
    const now = new Date();
    document.getElementById('last-update').textContent =
        `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')} 更新`;

    // Record NAV snapshot for history sparkline
    recordNavSnapshot(totalValue, totalCost);

    // P3-2: Check target price / stop loss triggers → browser Notification
    checkPriceAlerts(results);

    hideLoadingSkeletons();
    showToast('數據已更新', 'success');
}

// ========== Render Holdings Table ==========
function renderHoldingsTable(results) {
    const tbody = document.getElementById('holdings-tbody');

    if (results.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="10">尚無持股，請到「持股管理」新增</td></tr>';
        return;
    }

    tbody.innerHTML = results.map(({ stock, priceData }) => {
        const multiplier = stock.market === 'TW' ? 1000 : 1;
        const rate = marketRate(stock.market);
        const value = priceData.price * stock.shares * multiplier * rate;
        const cost = stock.cost * stock.shares * multiplier * rate;
        const pnl = value - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
        const pnlClass = pnl >= 0 ? 'profit-text' : 'loss-text';
        const sharesUnit = stock.market === 'TW' ? '張' : '股';
        const alert = evaluatePriceAlert(stock, priceData.price);

        return `<tr>
            <td><strong>${escapeHtml(stock.symbol)}</strong></td>
            <td>${escapeHtml(stock.name)}</td>
            <td>${stock.market === 'TW' ? '🇹🇼 台股' : '🇺🇸 美股'}</td>
            <td>${escapeHtml(stock.shares)} ${sharesUnit}</td>
            <td>${formatNum(stock.cost)}</td>
            <td>${formatNum(priceData.price)}</td>
            <td>${formatCurrency(value)}</td>
            <td class="${pnlClass}">${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}</td>
            <td class="${pnlClass}">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td>
            <td>${alert.badge}</td>
        </tr>`;
    }).join('');
}

// Returns { kind: 'target' | 'stopLoss' | 'none', badge: HTML string }
function evaluatePriceAlert(stock, currentPrice) {
    const t = stock.targetPrice;
    const s = stock.stopLoss;
    if (t && currentPrice >= t) {
        return { kind: 'target', badge: `<span class="alert-badge alert-target" title="現價已達目標 ${formatNum(t)}">🎯 達目標</span>` };
    }
    if (s && currentPrice <= s) {
        return { kind: 'stopLoss', badge: `<span class="alert-badge alert-stoploss" title="現價已跌破停損 ${formatNum(s)}">⚠️ 觸停損</span>` };
    }
    if (t || s) {
        const parts = [];
        if (t) parts.push(`🎯 ${formatNum(t)}`);
        if (s) parts.push(`⚠️ ${formatNum(s)}`);
        return { kind: 'none', badge: `<span class="alert-badge alert-armed">${parts.join(' · ')}</span>` };
    }
    return { kind: 'none', badge: '<span class="text-dim mono">—</span>' };
}

// ========== Render Manage Table ==========
function renderManageTable() {
    const tbody = document.getElementById('manage-tbody');

    if (portfolio.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="8">尚無持股</td></tr>';
        return;
    }

    tbody.innerHTML = portfolio.map((stock, i) => {
        const sharesUnit = stock.market === 'TW' ? '張' : '股';
        const t = stock.targetPrice != null ? stock.targetPrice : '';
        const s = stock.stopLoss    != null ? stock.stopLoss    : '';
        return `<tr>
            <td><strong>${escapeHtml(stock.symbol)}</strong></td>
            <td>${escapeHtml(stock.name)}</td>
            <td>${stock.market === 'TW' ? '🇹🇼 台股' : '🇺🇸 美股'}</td>
            <td>${escapeHtml(stock.shares)} ${sharesUnit}</td>
            <td>${formatNum(stock.cost)}</td>
            <td><input type="number" class="cell-input" step="0.01" min="0" value="${t}" placeholder="—" onchange="updateAlert(${i}, 'targetPrice', this.value)" aria-label="目標價 ${escapeHtml(stock.name)}"></td>
            <td><input type="number" class="cell-input" step="0.01" min="0" value="${s}" placeholder="—" onchange="updateAlert(${i}, 'stopLoss', this.value)" aria-label="停損價 ${escapeHtml(stock.name)}"></td>
            <td><button class="btn-delete" onclick="deleteStock(${i})" aria-label="刪除 ${escapeHtml(stock.name)}"><i class="fas fa-trash" aria-hidden="true"></i> 刪除</button></td>
        </tr>`;
    }).join('');
}

// Inline editor for targetPrice / stopLoss on manage-table
function updateAlert(index, field, rawValue) {
    if (!portfolio[index]) return;
    const val = rawValue === '' ? null : parseFloat(rawValue);
    portfolio[index][field] = (val && val > 0) ? val : null;
    savePortfolio();
    // Re-render holdings table alerts if a refresh has occurred
    // (nav trigger — user has to refreshAll to see the badge change)
}

// ========== Render Empty Dashboard ==========
function renderEmptyDashboard() {
    document.getElementById('total-value').textContent = '$0';
    document.getElementById('total-cost').textContent = '$0';
    document.getElementById('total-pnl').textContent = '$0';
    document.getElementById('total-pnl-pct').textContent = '0%';
    document.getElementById('holdings-tbody').innerHTML = 
        '<tr class="empty-row"><td colspan="9">尚無持股，請到「持股管理」新增</td></tr>';
    
    // Clear charts
    if (chartInstances.allocation) chartInstances.allocation.destroy();
    if (chartInstances.pnl) chartInstances.pnl.destroy();
}

// ========== Charts ==========
function renderAllocationChart(results) {
    const ctx = document.getElementById('allocation-chart').getContext('2d');
    
    if (chartInstances.allocation) chartInstances.allocation.destroy();

    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];
    
    const data = results.map(({ stock, priceData }) => {
        const multiplier = stock.market === 'TW' ? 1000 : 1;
        return priceData.price * stock.shares * multiplier * marketRate(stock.market);
    });

    chartInstances.allocation = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: results.map(r => r.stock.name),
            datasets: [{
                data,
                backgroundColor: colors.slice(0, results.length),
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#9ca3af', font: { size: 12 }, padding: 16 }
                }
            },
            cutout: '65%'
        }
    });
}

function renderPnlChart(results) {
    const ctx = document.getElementById('pnl-chart').getContext('2d');
    
    if (chartInstances.pnl) chartInstances.pnl.destroy();

    const pnlData = results.map(({ stock, priceData }) => {
        const multiplier = stock.market === 'TW' ? 1000 : 1;
        const rate = marketRate(stock.market);
        const value = priceData.price * stock.shares * multiplier * rate;
        const cost = stock.cost * stock.shares * multiplier * rate;
        return value - cost;
    });

    chartInstances.pnl = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: results.map(r => r.stock.name),
            datasets: [{
                data: pnlData,
                backgroundColor: pnlData.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'),
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: '#9ca3af', font: { size: 11 } },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: '#9ca3af', font: { size: 11 } },
                    grid: { color: 'rgba(42,46,58,0.5)' }
                }
            }
        }
    });
}

// ========== Price Chart (Technical) ==========
function updateChartStockSelect() {
    const select = document.getElementById('chart-stock-select');
    select.innerHTML = '<option value="">選擇股票</option>' +
        portfolio.map((s, i) => `<option value="${i}">${escapeHtml(s.name)} (${escapeHtml(s.symbol)})</option>`).join('');
}

document.getElementById('chart-stock-select')?.addEventListener('change', function() {
    if (this.value !== '') loadPriceChart(parseInt(this.value));
});

document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const stockIdx = document.getElementById('chart-stock-select').value;
        if (stockIdx !== '') loadPriceChart(parseInt(stockIdx));
    });
});

async function loadPriceChart(stockIdx) {
    const stock = portfolio[stockIdx];
    const period = document.querySelector('.period-btn.active').dataset.period;
    
    const history = await fetchHistory(stock, period);
    if (!history || history.length === 0) {
        showToast('無法載入走勢數據', 'error');
        return;
    }

    const ctx = document.getElementById('price-chart').getContext('2d');
    if (chartInstances.price) chartInstances.price.destroy();

    // Calculate MA5, MA20
    const closes = history.map(d => d.close);
    const ma5 = calculateMA(closes, 5);
    const ma20 = calculateMA(closes, 20);

    chartInstances.price = new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.map(d => d.date),
            datasets: [
                {
                    label: stock.name,
                    data: closes,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'MA5',
                    data: ma5,
                    borderColor: '#f59e0b',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.3
                },
                {
                    label: 'MA20',
                    data: ma20,
                    borderColor: '#8b5cf6',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: {
                    labels: { color: '#9ca3af', font: { size: 12 } }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: period === '1y' ? 'month' : 'week' },
                    ticks: { color: '#9ca3af', font: { size: 11 }, maxTicksLimit: 8 },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: '#9ca3af', font: { size: 11 } },
                    grid: { color: 'rgba(42,46,58,0.5)' }
                }
            }
        }
    });

    // Update indicators
    const lastMA5 = ma5[ma5.length - 1];
    const lastMA20 = ma20[ma20.length - 1];
    const rsiSeries = calculateRSI(closes, 14);
    const macdObj = calculateMACD(closes);
    const lastRsi = rsiSeries[rsiSeries.length - 1];
    const lastMacd = macdObj.macd[macdObj.macd.length - 1];

    document.getElementById('ind-ma5').textContent = lastMA5 != null ? lastMA5.toFixed(2) : '--';
    document.getElementById('ind-ma20').textContent = lastMA20 != null ? lastMA20.toFixed(2) : '--';
    document.getElementById('ind-rsi').textContent = lastRsi != null ? lastRsi.toFixed(1) : '--';
    document.getElementById('ind-macd').textContent = lastMacd != null ? lastMacd.toFixed(3) : '--';

    renderMacdChart(history.map(d => d.date), macdObj, period);
    renderRsiChart(history.map(d => d.date), rsiSeries, period);
}

// ---------- MACD sub-chart ----------
function renderMacdChart(labels, macdObj, period) {
    const el = document.getElementById('macd-chart');
    if (!el) return;
    const ctx = el.getContext('2d');
    if (chartInstances.macd) chartInstances.macd.destroy();

    const histColors = macdObj.histogram.map(v =>
        v == null ? 'transparent' : (v >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)')
    );

    chartInstances.macd = new Chart(ctx, {
        data: {
            labels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Histogram',
                    data: macdObj.histogram,
                    backgroundColor: histColors,
                    borderWidth: 0,
                    order: 3,
                    barPercentage: 1.0,
                    categoryPercentage: 0.9,
                },
                {
                    type: 'line',
                    label: 'MACD',
                    data: macdObj.macd,
                    borderColor: '#e6edf7',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.2,
                    order: 1,
                },
                {
                    type: 'line',
                    label: 'Signal',
                    data: macdObj.signal,
                    borderColor: '#22d3ee',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.2,
                    order: 2,
                },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { labels: { color: '#8a95a8', font: { size: 11 }, boxWidth: 10 } },
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: period === '1y' ? 'month' : 'week' },
                    ticks: { color: '#5c6577', font: { size: 10 }, maxTicksLimit: 8 },
                    grid: { display: false },
                },
                y: {
                    ticks: { color: '#5c6577', font: { size: 10 } },
                    grid: { color: 'rgba(36,49,73,0.5)' },
                }
            }
        }
    });
}

// ---------- RSI sub-chart with 30 / 70 reference lines ----------
function renderRsiChart(labels, rsiSeries, period) {
    const el = document.getElementById('rsi-chart');
    if (!el) return;
    const ctx = el.getContext('2d');
    if (chartInstances.rsi) chartInstances.rsi.destroy();

    const line30 = labels.map(() => 30);
    const line70 = labels.map(() => 70);

    chartInstances.rsi = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'RSI(14)',
                    data: rsiSeries,
                    borderColor: '#a78bfa',
                    backgroundColor: 'rgba(167,139,250,0.08)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.2,
                    fill: false,
                },
                {
                    label: 'Overbought 70',
                    data: line70,
                    borderColor: 'rgba(239,68,68,0.5)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                },
                {
                    label: 'Oversold 30',
                    data: line30,
                    borderColor: 'rgba(16,185,129,0.5)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: {
                    labels: {
                        color: '#8a95a8',
                        font: { size: 11 },
                        boxWidth: 10,
                        filter: (item) => item.text === 'RSI(14)',
                    }
                },
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: period === '1y' ? 'month' : 'week' },
                    ticks: { color: '#5c6577', font: { size: 10 }, maxTicksLimit: 8 },
                    grid: { display: false },
                },
                y: {
                    min: 0, max: 100,
                    ticks: { color: '#5c6577', font: { size: 10 }, stepSize: 20 },
                    grid: { color: 'rgba(36,49,73,0.5)' },
                }
            }
        }
    });
}

// ========== Technical Indicators ==========
// All indicator functions return arrays of the SAME LENGTH as input (leading nulls where
// there isn't enough data yet), so callers can align them to the price chart's x-axis.
function calculateMA(data, period) {
    return data.map((_, i) => {
        if (i < period - 1) return null;
        const slice = data.slice(i - period + 1, i + 1);
        return slice.reduce((a, b) => a + b, 0) / period;
    });
}

function calculateEMA(data, period) {
    const result = new Array(data.length).fill(null);
    if (data.length < period) return result;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result[period - 1] = ema;
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
        result[i] = ema;
    }
    return result;
}

// RSI series using Wilder smoothing. First valid value is at index `period`.
function calculateRSI(data, period = 14) {
    const result = new Array(data.length).fill(null);
    if (data.length < period + 1) return result;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    return result;
}

// MACD returns { macd, signal, histogram } three series aligned to input length.
function calculateMACD(data) {
    const ema12 = calculateEMA(data, 12);
    const ema26 = calculateEMA(data, 26);
    const macd = data.map((_, i) =>
        (ema12[i] != null && ema26[i] != null) ? ema12[i] - ema26[i] : null
    );

    const signal = new Array(data.length).fill(null);
    const firstValid = macd.findIndex(v => v != null);
    if (firstValid >= 0) {
        const macdCompact = macd.slice(firstValid);
        const signalCompact = calculateEMA(macdCompact, 9);
        for (let i = 0; i < signalCompact.length; i++) {
            signal[firstValid + i] = signalCompact[i];
        }
    }

    const histogram = data.map((_, i) =>
        (macd[i] != null && signal[i] != null) ? macd[i] - signal[i] : null
    );

    return { macd, signal, histogram };
}

// ========== News ==========
async function fetchNews() {
    if (portfolio.length === 0) return;
    
    const container = document.getElementById('news-container');
    container.innerHTML = '<div class="card news-placeholder"><i class="fas fa-spinner fa-spin"></i><p>載入新聞中...</p></div>';

    try {
        // Use Google News RSS via proxy for stock-related news
        const symbols = portfolio.map(s => s.name).join(' OR ');
        const query = encodeURIComponent(`${symbols} 股票`);
        const url = `https://news.google.com/rss/search?q=${query}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

        const response = await fetchViaProxy(url);
        const text = await response.text();

        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const items = xml.querySelectorAll('item');

        if (items.length === 0) {
            container.innerHTML = '<div class="card news-placeholder"><i class="fas fa-newspaper"></i><p>暫無相關新聞</p></div>';
            return;
        }

        let html = '';
        const maxItems = Math.min(items.length, 12);

        for (let i = 0; i < maxItems; i++) {
            const item = items[i];
            const title = item.querySelector('title')?.textContent || '';
            const link = item.querySelector('link')?.textContent || '#';
            const pubDate = item.querySelector('pubDate')?.textContent || '';
            const source = item.querySelector('source')?.textContent || '新聞';
            const timeAgo = getTimeAgo(new Date(pubDate));

            html += `<div class="card news-card">
                <div class="news-source">${escapeHtml(source)}</div>
                <div class="news-title"><a href="${escapeHtml(safeUrl(link))}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></div>
                <div class="news-time">${escapeHtml(timeAgo)}</div>
            </div>`;
        }

        container.innerHTML = html;
    } catch (err) {
        console.warn('News fetch failed:', err);
        container.innerHTML = '<div class="card news-placeholder"><i class="fas fa-exclamation-triangle"></i><p>新聞載入失敗，請稍後重試</p></div>';
    }
}

// ========== Utilities ==========
function formatCurrency(value) {
    if (Math.abs(value) >= 1e8) return `$${(value / 1e8).toFixed(2)}億`;
    if (Math.abs(value) >= 1e4) return `$${(value / 1e4).toFixed(1)}萬`;
    return `$${value.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatNum(value) {
    return value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getTimeAgo(date) {
    const now = new Date();
    const diff = (now - date) / 1000;
    if (diff < 60) return '剛剛';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
    return `${Math.floor(diff / 86400)} 天前`;
}

function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}

// ========== Auto Refresh ==========
function startAutoRefresh() {
    // Refresh every hour (3600000ms)
    autoRefreshInterval = setInterval(() => {
        if (portfolio.length > 0) {
            refreshAll();
        }
    }, 3600000);
}

// ========== Serenity Allocation Calculator ==========
const serenityStocks = [
    { name: '緯創', ticker: '3231', weight: 0.35, price: 159, tier: '⭐ 最高' },
    { name: '穩懋', ticker: '3105', weight: 0.25, price: 411, tier: '🔥 高' },
    { name: '華邦電', ticker: '2344', weight: 0.20, price: 184.5, tier: '🔥 高' },
    { name: '緯穎', ticker: '6669', weight: 0.10, price: 5265, tier: '📈 中高' },
    { name: '台積電', ticker: '2330', weight: 0.10, price: 2445, tier: '🛡️ 底倉' },
];

function calcSerenityAlloc() {
    const budget = parseFloat(document.getElementById('serenity-budget').value) || 80000;
    const tbody = document.getElementById('serenity-alloc-tbody');

    tbody.innerHTML = serenityStocks.map(s => {
        const amount = Math.round(budget * s.weight);
        const shares = Math.floor(amount / s.price);
        return `<tr>
            <td>${s.name}</td>
            <td>${s.ticker}</td>
            <td>${(s.weight * 100).toFixed(0)}%</td>
            <td>$${amount.toLocaleString()}</td>
            <td>~${shares} 股</td>
            <td>${s.tier}</td>
        </tr>`;
    }).join('');
}

// Auto-calc on Enter key
document.getElementById('serenity-budget')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') calcSerenityAlloc();
});

// ========== My Holdings (from portfolio.json) ==========
async function loadMyHoldings() {
    try {
        const response = await fetch('portfolio.json?' + Date.now());
        if (!response.ok) throw new Error('No portfolio.json');
        const data = await response.json();
        myHoldings = data.holdings || [];
        document.getElementById('holdings-last-updated').textContent = `最後更新：${data.lastUpdated || '未知'}`;
        await renderMyHoldings();
        renderSerenityComparison();
    } catch (err) {
        console.warn('portfolio.json not found or empty:', err.message);
        document.getElementById('my-holdings-tbody').innerHTML = '<tr class="empty-row"><td colspan="9">尚無持股紀錄，請告知秘書更新</td></tr>';
    }
}

async function renderMyHoldings() {
    const tbody = document.getElementById('my-holdings-tbody');
    if (!myHoldings.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="9">尚無持股紀錄</td></tr>';
        updateMyHoldingsSummary(0, 0, 0);
        return;
    }

    let totalValue = 0, totalCost = 0;
    const rows = [];

    for (const h of myHoldings) {
        const stock = { market: h.market || 'TW', symbol: h.symbol, name: h.name };
        const priceData = await fetchPrice(stock);
        const multiplier = stock.market === 'TW' ? 1000 : 1;
        const value = priceData.price * h.shares * multiplier;
        const cost = h.cost * h.shares * multiplier;
        const pnl = value - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;

        totalValue += value;
        totalCost += cost;

        const pnlClass = pnl >= 0 ? 'profit-text' : 'loss-text';
        const inSerenity = serenityStocks.find(s => s.ticker === h.symbol);
        const serenityTag = inSerenity ? `<span class="serenity-tag">${inSerenity.tier}</span>` : '';

        rows.push(`<tr>
            <td>${h.symbol}</td>
            <td>${h.name} ${serenityTag}</td>
            <td>${stock.market}</td>
            <td>${h.shares}${stock.market === 'TW' ? '張' : '股'}</td>
            <td>$${h.cost.toLocaleString()}</td>
            <td>$${priceData.price.toLocaleString()}</td>
            <td>$${Math.round(value).toLocaleString()}</td>
            <td class="${pnlClass}">$${Math.round(pnl).toLocaleString()}</td>
            <td class="${pnlClass}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td>
        </tr>`);
    }

    tbody.innerHTML = rows.join('');
    updateMyHoldingsSummary(totalValue, totalCost, totalValue - totalCost);
}

function updateMyHoldingsSummary(totalValue, totalCost, totalPnl) {
    const pnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    document.getElementById('my-total-value').textContent = `$${Math.round(totalValue).toLocaleString()}`;
    document.getElementById('my-total-cost').textContent = `$${Math.round(totalCost).toLocaleString()}`;
    document.getElementById('my-total-pnl').textContent = `$${Math.round(totalPnl).toLocaleString()}`;
    document.getElementById('my-total-pnl-pct').textContent = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`;

    const pnlEl = document.getElementById('my-total-pnl');
    const pctEl = document.getElementById('my-total-pnl-pct');
    pnlEl.className = `card-value ${totalPnl >= 0 ? 'profit-text' : 'loss-text'}`;
    pctEl.className = `card-value ${totalPnl >= 0 ? 'profit-text' : 'loss-text'}`;
}

// ========== Serenity Cross-Reference ==========
function renderSerenityComparison() {
    const container = document.getElementById('serenity-comparison');
    if (!container) return;

    const holdingTickers = myHoldings.map(h => h.symbol);

    const inBoth = serenityStocks.filter(s => holdingTickers.includes(s.ticker));
    const recommendedNotHeld = serenityStocks.filter(s => !holdingTickers.includes(s.ticker));
    const heldNotRecommended = myHoldings.filter(h => !serenityStocks.find(s => s.ticker === h.symbol));

    let html = '<div class="comparison-grid">';

    // Held + Recommended
    html += '<div class="comparison-section match"><h4><i class="fas fa-check-circle"></i> 持有且在推薦中</h4>';
    if (inBoth.length) {
        html += '<ul>' + inBoth.map(s => `<li><strong>${s.name}</strong> (${s.ticker}) — ${s.tier}，權重 ${(s.weight*100).toFixed(0)}%</li>`).join('') + '</ul>';
    } else {
        html += '<p class="empty-note">無</p>';
    }
    html += '</div>';

    // Recommended but not held
    html += '<div class="comparison-section opportunity"><h4><i class="fas fa-lightbulb"></i> 推薦但未持有</h4>';
    if (recommendedNotHeld.length) {
        html += '<ul>' + recommendedNotHeld.map(s => `<li><strong>${s.name}</strong> (${s.ticker}) — ${s.tier}，建議權重 ${(s.weight*100).toFixed(0)}%</li>`).join('') + '</ul>';
    } else {
        html += '<p class="empty-note">全部都有持有 👍</p>';
    }
    html += '</div>';

    // Held but not recommended
    html += '<div class="comparison-section watch"><h4><i class="fas fa-eye"></i> 持有但不在推薦中</h4>';
    if (heldNotRecommended.length) {
        html += '<ul>' + heldNotRecommended.map(h => `<li><strong>${h.name}</strong> (${h.symbol}) — 不在 Serenity 當前推薦</li>`).join('') + '</ul>';
    } else {
        html += '<p class="empty-note">無</p>';
    }
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
}

// ========== NAV History ==========
const NAV_HISTORY_KEY = 'stockNavHistory';
const NAV_HISTORY_MAX = 90;

function readNavHistory() {
    try {
        const raw = localStorage.getItem(NAV_HISTORY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}
function recordNavSnapshot(value, cost) {
    if (!isFinite(value) || value <= 0) return;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const date = `${yyyy}-${mm}-${dd}`;
    const history = readNavHistory();
    const last = history[history.length - 1];
    const snapshot = { date, value: Math.round(value), cost: Math.round(cost) };
    if (last && last.date === date) {
        history[history.length - 1] = snapshot;
    } else {
        history.push(snapshot);
        while (history.length > NAV_HISTORY_MAX) history.shift();
    }
    try {
        localStorage.setItem(NAV_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.warn('Failed to persist NAV history:', e.message);
    }
    window.dispatchEvent(new CustomEvent('nav-history-updated', { detail: history }));
}
function getNavHistory() {
    return readNavHistory();
}

// ========== Export / Import ==========
function triggerDownload(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
    }, 0);
}
function stampFilename() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function exportPortfolioJSON() {
    const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        portfolio,
        navHistory: readNavHistory()
    };
    triggerDownload(`stockfolio-${stampFilename()}.json`, 'application/json;charset=utf-8', JSON.stringify(payload, null, 2));
    showToast('已匯出 JSON', 'success');
}
function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportPortfolioCSV() {
    const header = 'market,symbol,name,shares,cost';
    const rows = portfolio.map(s =>
        [s.market, s.symbol, s.name, s.shares, s.cost].map(csvEscape).join(',')
    );
    const csv = '﻿' + [header, ...rows].join('\r\n');
    triggerDownload(`stockfolio-${stampFilename()}.csv`, 'text/csv;charset=utf-8', csv);
    showToast('已匯出 CSV', 'success');
}
function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
            else if (ch === '"') inQuotes = false;
            else cur += ch;
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ',') { out.push(cur); cur = ''; }
            else cur += ch;
        }
    }
    out.push(cur);
    return out;
}
function importPortfolioCSV(text) {
    const cleaned = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
    if (!cleaned) { showToast('CSV 檔案為空', 'error'); return; }
    const lines = cleaned.split('\n').filter(l => l.trim());
    if (lines.length < 2) { showToast('CSV 沒有可用資料', 'error'); return; }
    const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const idx = {
        market: header.indexOf('market'),
        symbol: header.indexOf('symbol'),
        name:   header.indexOf('name'),
        shares: header.indexOf('shares'),
        cost:   header.indexOf('cost')
    };
    if (idx.market < 0 || idx.symbol < 0 || idx.shares < 0 || idx.cost < 0) {
        showToast('CSV 欄位錯誤，需 market/symbol/shares/cost', 'error');
        return;
    }
    let added = 0, skipped = 0;
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const market = (cells[idx.market] || '').trim().toUpperCase();
        const symbol = (cells[idx.symbol] || '').trim().toUpperCase();
        const name   = idx.name >= 0 ? (cells[idx.name] || '').trim() : symbol;
        const shares = parseFloat(cells[idx.shares]);
        const cost   = parseFloat(cells[idx.cost]);
        if (!symbol || !(market === 'TW' || market === 'US') || !isFinite(shares) || !isFinite(cost) || shares <= 0 || cost <= 0) {
            skipped++; continue;
        }
        if (portfolio.some(s => s.market === market && s.symbol === symbol)) {
            skipped++; continue;
        }
        portfolio.push({ market, symbol, name: name || symbol, shares, cost });
        added++;
    }
    savePortfolio();
    showToast(`已匯入 ${added} 檔，略過 ${skipped} 筆`, added > 0 ? 'success' : 'info');
    if (added > 0) refreshAll();
    else renderManageTable();
}
function importPortfolioFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const text = String(reader.result || '');
        if (/^\s*[{[]/.test(text)) {
            try {
                const data = JSON.parse(text);
                const list = Array.isArray(data) ? data : (Array.isArray(data.portfolio) ? data.portfolio : null);
                if (!list) { showToast('JSON 格式錯誤', 'error'); return; }
                let added = 0, skipped = 0;
                list.forEach(s => {
                    if (!s || !s.symbol || !s.market || !isFinite(s.shares) || !isFinite(s.cost)) { skipped++; return; }
                    if (portfolio.some(p => p.market === s.market && p.symbol === s.symbol)) { skipped++; return; }
                    portfolio.push({ market: s.market, symbol: s.symbol, name: s.name || s.symbol, shares: s.shares, cost: s.cost });
                    added++;
                });
                if (Array.isArray(data.navHistory)) {
                    const merged = mergeNavHistory(readNavHistory(), data.navHistory);
                    localStorage.setItem(NAV_HISTORY_KEY, JSON.stringify(merged));
                    window.dispatchEvent(new CustomEvent('nav-history-updated', { detail: merged }));
                }
                savePortfolio();
                showToast(`已匯入 ${added} 檔，略過 ${skipped} 筆`, added > 0 ? 'success' : 'info');
                if (added > 0) refreshAll(); else renderManageTable();
            } catch (e) {
                showToast('JSON 解析失敗', 'error');
            }
        } else {
            importPortfolioCSV(text);
        }
    };
    reader.onerror = () => showToast('讀取檔案失敗', 'error');
    reader.readAsText(file);
}
function mergeNavHistory(existing, incoming) {
    const byDate = new Map();
    [...existing, ...incoming].forEach(e => {
        if (e && e.date) byDate.set(e.date, e);
    });
    const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    while (merged.length > NAV_HISTORY_MAX) merged.shift();
    return merged;
}

// ========== Serenity single source (expose canonical data) ==========
function getSerenityStocks() {
    return serenityStocks.map(s => ({ ...s }));
}

// Expose data-layer API for app-enhancements.js and future callers
window.stockfolio = {
    getNavHistory,
    getSerenityStocks,
    exportPortfolioJSON,
    exportPortfolioCSV,
    importPortfolioFile,
    importPortfolioCSV,
    getPortfolio: () => portfolio.slice(),
};

// ========== P3-4 · Loading Skeletons ==========
const SKELETON_KPI_IDS = ['total-value', 'total-cost', 'total-pnl', 'total-pnl-pct'];

function showLoadingSkeletons() {
    // KPI values → shimmering blocks
    SKELETON_KPI_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('skeleton');
    });
    // Holdings table → 3 shimmering rows
    const tbody = document.getElementById('holdings-tbody');
    if (tbody) {
        tbody.innerHTML = Array.from({ length: 3 }, () => `
            <tr class="skeleton-row">
                <td><span class="sk-bar sk-bar-md"></span></td>
                <td><span class="sk-bar sk-bar-lg"></span></td>
                <td><span class="sk-bar sk-bar-sm"></span></td>
                <td><span class="sk-bar sk-bar-md"></span></td>
                <td><span class="sk-bar sk-bar-md"></span></td>
                <td><span class="sk-bar sk-bar-md"></span></td>
                <td><span class="sk-bar sk-bar-lg"></span></td>
                <td><span class="sk-bar sk-bar-md"></span></td>
                <td><span class="sk-bar sk-bar-sm"></span></td>
                <td><span class="sk-bar sk-bar-md"></span></td>
            </tr>
        `).join('');
    }
    // Chart containers → overlay shimmer
    document.querySelectorAll('#allocation-chart, #pnl-chart').forEach(canvas => {
        canvas.parentElement?.classList.add('loading');
    });
}

function hideLoadingSkeletons() {
    SKELETON_KPI_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('skeleton');
    });
    document.querySelectorAll('.chart-container.loading').forEach(el => el.classList.remove('loading'));
    // holdings-tbody skeleton rows are replaced when renderHoldingsTable runs.
}

// ========== P3-2 · Price Alerts (Notification) ==========
const ALERT_FIRED_KEY = 'stockAlertFired';   // { "TW:2330:target": timestamp } — de-dupe within 6h
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let notificationRequested = false;

function readAlertFired() {
    try { return JSON.parse(sessionStorage.getItem(ALERT_FIRED_KEY) || '{}'); }
    catch { return {}; }
}
function writeAlertFired(map) {
    try { sessionStorage.setItem(ALERT_FIRED_KEY, JSON.stringify(map)); } catch {}
}

async function ensureNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    if (notificationRequested) return false;
    notificationRequested = true;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
}

async function checkPriceAlerts(results) {
    const triggered = [];
    results.forEach(({ stock, priceData }) => {
        const alert = evaluatePriceAlert(stock, priceData.price);
        if (alert.kind === 'target' || alert.kind === 'stopLoss') {
            triggered.push({ stock, priceData, kind: alert.kind });
        }
    });
    if (triggered.length === 0) return;

    const fired = readAlertFired();
    const now = Date.now();
    const fresh = triggered.filter(t => {
        const key = `${t.stock.market}:${t.stock.symbol}:${t.kind}`;
        const last = fired[key];
        if (last && (now - last) < ALERT_COOLDOWN_MS) return false;
        fired[key] = now;
        return true;
    });
    writeAlertFired(fired);

    // Always show in-app toast for visible feedback
    fresh.forEach(t => {
        const label = t.kind === 'target' ? '達目標價' : '觸發停損';
        showToast(`🔔 ${t.stock.name} ${label}：${formatNum(t.priceData.price)}`, t.kind === 'target' ? 'success' : 'error');
    });

    // Browser Notification (best-effort)
    const granted = await ensureNotificationPermission();
    if (!granted) return;
    fresh.forEach(t => {
        const title = t.kind === 'target'
            ? `🎯 ${t.stock.name} 達目標價`
            : `⚠️ ${t.stock.name} 觸發停損`;
        const body  = `${t.stock.symbol} · 現價 ${formatNum(t.priceData.price)}` +
                      (t.kind === 'target' && t.stock.targetPrice ? ` · 目標 ${formatNum(t.stock.targetPrice)}` : '') +
                      (t.kind === 'stopLoss' && t.stock.stopLoss ? ` · 停損 ${formatNum(t.stock.stopLoss)}` : '');
        try { new Notification(title, { body, tag: `sf-${t.stock.market}-${t.stock.symbol}-${t.kind}` }); }
        catch (e) { /* silent */ }
    });
}

// ========== Init ==========
function init() {
    renderManageTable();
    if (portfolio.length > 0) {
        refreshAll();
    }
    startAutoRefresh();
    // Init serenity calculator with default value
    calcSerenityAlloc();
    // Load my real holdings
    loadMyHoldings();
}

init();
