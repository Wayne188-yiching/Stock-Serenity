/* ============================================================
   Stock-Serenity — app-enhancements.js
   Loaded AFTER app.js. Adds:
     · Onboarding tour (welcome modal + 5-step spotlight + settings)
     · Drawer (right slide-over) for Add Stock, mirrors #add-stock-form
     · Mobile bottom tab bar → sidebar nav sync
     · Settings popover open/close
     · KPI Total Value sparkline (post-render enhancement)
     · Serenity budget preset chips
   Nothing here modifies existing app.js functions or DOM contracts.
============================================================ */

(function () {
  'use strict';

  // ============================================================
  // 1 · MOBILE TAB BAR ⇆ SIDEBAR NAV
  // ============================================================
  document.querySelectorAll('.mobile-tabbar .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const page = tab.dataset.page;
      const navItem = document.querySelector(`.sidebar .nav-item[data-page="${page}"]`);
      if (navItem) navItem.click(); // reuses app.js navigation handler
      document.querySelectorAll('.mobile-tabbar .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Keep mobile tab bar in sync when sidebar is clicked
  document.querySelectorAll('.sidebar .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      document.querySelectorAll('.mobile-tabbar .tab').forEach(t =>
        t.classList.toggle('active', t.dataset.page === page)
      );
    });
  });

  // ============================================================
  // 2 · DRAWER · Add Stock
  //   Portfolio page's "+ 新增持股" button opens the drawer.
  //   On submit, mirror drawer values into #add-stock-form and
  //   dispatch its submit — so app.js addStock() runs unchanged.
  // ============================================================
  const drawer   = document.getElementById('add-stock-drawer');
  const overlay  = document.getElementById('drawer-overlay');
  const openBtn  = document.getElementById('open-drawer-btn');
  const closeBtn = document.getElementById('drawer-close');
  const cancelBtn= document.getElementById('drawer-cancel');
  const submitBtn= document.getElementById('drawer-submit');

  function openDrawer() {
    if (!drawer) return;
    drawer.hidden = false; overlay.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.hidden = true; overlay.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  openBtn?.addEventListener('click', openDrawer);
  closeBtn?.addEventListener('click', closeDrawer);
  cancelBtn?.addEventListener('click', closeDrawer);
  overlay?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !drawer?.hidden) closeDrawer();
  });

  // Market toggle inside drawer
  const marketToggle = document.getElementById('drawer-market');
  const unitToggle   = document.getElementById('drawer-unit-toggle');
  const unitLabelEl  = document.getElementById('drawer-unit-label');
  let drawerMarket = 'TW';
  let drawerUnit   = 'lot'; // 'lot' (張) | 'share' (股)

  function syncUnitVisibility() {
    if (!unitToggle) return;
    if (drawerMarket === 'US') {
      unitToggle.hidden = true;
      drawerUnit = 'share';
      if (unitLabelEl) unitLabelEl.textContent = '股';
    } else {
      unitToggle.hidden = false;
      if (unitLabelEl) unitLabelEl.textContent = drawerUnit === 'share' ? '股' : '張';
    }
  }
  marketToggle?.querySelectorAll('.market-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      drawerMarket = opt.dataset.mkt;
      marketToggle.querySelectorAll('.market-opt').forEach(o =>
        o.classList.toggle('market-opt-active', o === opt)
      );
      syncUnitVisibility();
      // Re-run name autofill in case market changed the ticker's meaning
      queueNameLookup();
    });
  });
  unitToggle?.querySelectorAll('.unit-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      drawerUnit = opt.dataset.unit;
      unitToggle.querySelectorAll('.unit-opt').forEach(o =>
        o.classList.toggle('unit-opt-active', o === opt)
      );
      if (unitLabelEl) unitLabelEl.textContent = drawerUnit === 'share' ? '股' : '張';
    });
  });
  syncUnitVisibility();

  // ---------- Ticker → auto-fill stock name ----------
  const drawerSymbolEl = document.getElementById('drawer-symbol');
  const drawerNameEl   = document.getElementById('drawer-name');
  let symbolLookupTimer = null;
  let lastLookedUp = '';

  function queueNameLookup() {
    clearTimeout(symbolLookupTimer);
    symbolLookupTimer = setTimeout(runNameLookup, 600);
  }
  async function runNameLookup() {
    if (!drawerSymbolEl || !drawerNameEl) return;
    let sym = drawerSymbolEl.value.trim().replace(/\.TW$/i, '').toUpperCase();
    if (!sym || sym.length < 2) return;
    // Only autofill if name empty OR previously filled by us
    if (drawerNameEl.value && drawerNameEl.dataset.autoFilled !== 'true') return;
    const key = `${drawerMarket}:${sym}`;
    if (key === lastLookedUp) return;
    lastLookedUp = key;
    const name = await window.stockfolio?.fetchStockName?.(drawerMarket, sym);
    if (name && drawerSymbolEl.value.trim().replace(/\.TW$/i, '').toUpperCase() === sym) {
      // Only apply if user hasn't since typed a different symbol
      if (!drawerNameEl.value || drawerNameEl.dataset.autoFilled === 'true') {
        drawerNameEl.value = name;
        drawerNameEl.dataset.autoFilled = 'true';
      }
    }
  }
  drawerSymbolEl?.addEventListener('input', queueNameLookup);
  drawerSymbolEl?.addEventListener('blur', runNameLookup);
  // If user manually edits the name, stop auto-overwriting
  drawerNameEl?.addEventListener('input', () => {
    drawerNameEl.dataset.autoFilled = 'false';
  });

  // Submit drawer → mirror to #add-stock-form and dispatch submit
  submitBtn?.addEventListener('click', () => {
    const marketSel = document.getElementById('stock-market');
    const symbolIn  = document.getElementById('stock-symbol');
    const nameIn    = document.getElementById('stock-name');
    const sharesIn  = document.getElementById('stock-shares');
    const costIn    = document.getElementById('stock-cost');
    const targetIn  = document.getElementById('stock-target');
    const stopIn    = document.getElementById('stock-stoploss');
    const form      = document.getElementById('add-stock-form');
    if (!marketSel || !symbolIn || !sharesIn || !costIn || !form) return;

    marketSel.value = drawerMarket;
    // Fire change event so app.js's shares label handler updates
    marketSel.dispatchEvent(new Event('change'));

    let sym = document.getElementById('drawer-symbol')?.value?.trim() || '';
    sym = sym.replace(/\.TW$/i, ''); // strip .TW suffix
    symbolIn.value = sym;
    nameIn.value    = document.getElementById('drawer-name')?.value?.trim() || '';
    sharesIn.value  = document.getElementById('drawer-shares')?.value || '';
    costIn.value    = document.getElementById('drawer-cost')?.value || '';
    if (targetIn) targetIn.value = document.getElementById('drawer-target')?.value || '';
    if (stopIn)   stopIn.value   = document.getElementById('drawer-stoploss')?.value || '';
    // Mirror unit choice into hidden input on the inline form
    const unitHidden = document.getElementById('stock-shareunit');
    if (unitHidden) unitHidden.value = drawerMarket === 'US' ? 'share' : drawerUnit;

    // Trigger existing addStock via form submit
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    // Clear drawer inputs & close (only if no validation error toast fired)
    setTimeout(() => {
      ['drawer-symbol','drawer-name','drawer-shares','drawer-cost','drawer-target','drawer-stoploss'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      if (drawerNameEl) drawerNameEl.dataset.autoFilled = 'false';
      lastLookedUp = '';
      closeDrawer();
    }, 100);
  });

  // ============================================================
  // 3 · SETTINGS POPOVER
  // ============================================================
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPop = document.getElementById('settings-popover');
  settingsBtn?.addEventListener('click', e => {
    e.stopPropagation();
    if (!settingsPop) return;
    settingsPop.hidden = !settingsPop.hidden;
  });
  document.addEventListener('click', e => {
    if (!settingsPop || settingsPop.hidden) return;
    if (settingsPop.contains(e.target) || settingsBtn?.contains(e.target)) return;
    settingsPop.hidden = true;
  });
  // Toggle rows
  settingsPop?.querySelectorAll('.toggle').forEach(t => {
    t.addEventListener('click', ev => {
      ev.stopPropagation();
      const on = t.dataset.on === 'true';
      t.dataset.on = String(!on);
    });
  });

  // ============================================================
  // 4 · ONBOARDING TOUR
  // ============================================================
  const ONB_KEY = 'stockfolio-onboarded'; // 'true' | 'skipped' | absent
  const bd       = document.getElementById('onb-backdrop');
  const welcome  = document.getElementById('onb-welcome');
  const tooltip  = document.getElementById('onb-tooltip');
  const ttStep   = document.getElementById('onb-tt-step');
  const ttTitle  = document.getElementById('onb-tt-title');
  const ttBody   = document.getElementById('onb-tt-body');
  const ttProg   = document.getElementById('onb-tt-progress');
  const ttBack   = document.getElementById('onb-tt-back');
  const ttNext   = document.getElementById('onb-tt-next');
  const ttSkip   = document.getElementById('onb-tt-skip');
  const ttClose  = document.getElementById('onb-tt-close');
  const settingsDot = document.getElementById('settings-dot');

  const STEPS = [
    { target: '.sidebar-nav', place: 'right',
      title: '五個頁面',
      body:  '總覽、持股管理、走勢圖、新聞、Serenity — 隨時從左側切換。手機版下方會出現分頁列。' },
    { target: '.summary-cards', place: 'below',
      title: '數字是主角',
      body:  '總市值最大（primary），其他三張顯示總成本、總損益、報酬率。每張卡下緣有 30 日 sparkline。' },
    { target: '#holdings-tbody', place: 'above',
      title: '點列展開明細',
      body:  '每一列顯示持股狀況；hover 高亮，點列可查看該股 30 日走勢與快速編輯。' },
    { target: '.nav-item-serenity', place: 'right',
      title: 'Serenity 策略頁',
      body:  'AI/半導體高信念選股 + 配置計算器 + 12 條 checklist，適合短線高波動操作。' },
    { target: '#settings-btn', place: 'right',
      title: '隨時可以再啟動',
      body:  '完成！左下角「設定」可以隨時重新啟動這份導覽。祝投資愉快 🎉' }
  ];
  let cursor = 0;

  function readyToShowWelcome() {
    const state = localStorage.getItem(ONB_KEY);
    if (state === 'true' || state === 'skipped') return false;
    return true;
  }

  function showWelcome() {
    if (!welcome || !bd) return;
    bd.hidden = false; welcome.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function hideWelcome() {
    if (!welcome || !bd) return;
    welcome.hidden = true; bd.hidden = true;
    document.body.style.overflow = '';
  }

  // Wire welcome buttons
  document.getElementById('onb-start')?.addEventListener('click', () => {
    hideWelcome();
    cursor = 0;
    startTour();
  });
  document.getElementById('onb-skip')?.addEventListener('click', () => {
    localStorage.setItem(ONB_KEY, 'skipped');
    hideWelcome();
    if (settingsDot) settingsDot.hidden = false; // reminder user can restart
  });
  document.getElementById('onb-never')?.addEventListener('change', e => {
    if (e.target.checked) localStorage.setItem(ONB_KEY, 'skipped');
    else localStorage.removeItem(ONB_KEY);
  });

  // Wire tour buttons
  ttNext?.addEventListener('click', () => {
    if (cursor < STEPS.length - 1) { cursor++; renderStep(); }
    else finishTour();
  });
  ttBack?.addEventListener('click', () => {
    if (cursor > 0) { cursor--; renderStep(); }
  });
  ttSkip?.addEventListener('click', () => { finishTour(true); });
  ttClose?.addEventListener('click', () => { finishTour(true); });

  // Restart from settings
  document.getElementById('restart-tour')?.addEventListener('click', () => {
    if (settingsPop) settingsPop.hidden = true;
    localStorage.removeItem(ONB_KEY);
    cursor = 0;
    // Navigate to dashboard first
    document.querySelector('.sidebar .nav-item[data-page="dashboard"]')?.click();
    setTimeout(startTour, 200);
  });

  function clearHighlight() {
    document.querySelectorAll('.onb-highlight').forEach(el => el.classList.remove('onb-highlight'));
  }
  function startTour() {
    if (!tooltip || !bd) return;
    bd.hidden = false;
    tooltip.hidden = false;
    cursor = 0;
    renderStep();
  }
  function renderStep() {
    const step = STEPS[cursor];
    if (!step) return;
    // Ensure we're on dashboard for first 3 steps
    if (cursor <= 2) {
      const dash = document.querySelector('.sidebar .nav-item[data-page="dashboard"]');
      if (dash && !dash.classList.contains('active')) dash.click();
    }
    ttTitle.textContent = step.title;
    ttBody.textContent  = step.body;
    ttStep.textContent  = `${cursor + 1} / ${STEPS.length}`;
    ttBack.disabled = cursor === 0;
    ttBack.style.visibility = cursor === 0 ? 'hidden' : '';
    ttNext.textContent = cursor === STEPS.length - 1 ? '完成 ✓' : '下一步 →';

    // Progress dots
    ttProg.innerHTML = STEPS.map((_, i) => {
      const cls = i < cursor ? 'done' : i === cursor ? 'current' : '';
      return `<span class="${cls}"></span>`;
    }).join('');

    // Highlight + position tooltip
    clearHighlight();
    const target = document.querySelector(step.target);
    if (!target) return;
    target.classList.add('onb-highlight');
    positionTooltip(target, step.place);
    // Scroll into view smoothly (without scrollIntoView — use window.scrollTo)
    const rect = target.getBoundingClientRect();
    if (rect.top < 40 || rect.bottom > window.innerHeight - 40) {
      const y = window.scrollY + rect.top - Math.max(80, (window.innerHeight - rect.height) / 3);
      window.scrollTo({ top: y, behavior: 'smooth' });
      // Reposition after scroll
      setTimeout(() => positionTooltip(target, step.place), 260);
    }
  }
  function positionTooltip(target, place) {
    if (!tooltip) return;
    const rect = target.getBoundingClientRect();
    const ttW = 400;
    const gap = 16;
    let top, left;
    tooltip.classList.remove('tt-above','tt-below','tt-left','tt-right');
    if (place === 'below') {
      top  = rect.bottom + gap;
      left = rect.left + rect.width / 2 - ttW / 2;
      tooltip.classList.add('tt-below');
    } else if (place === 'above') {
      top  = rect.top - tooltip.offsetHeight - gap;
      left = rect.left + rect.width / 2 - ttW / 2;
      tooltip.classList.add('tt-above');
    } else if (place === 'left') {
      top  = rect.top + rect.height / 2 - tooltip.offsetHeight / 2;
      left = rect.left - ttW - gap;
      tooltip.classList.add('tt-left');
    } else { // right (default)
      top  = rect.top + rect.height / 2 - tooltip.offsetHeight / 2;
      left = rect.right + gap;
      tooltip.classList.add('tt-right');
    }
    // Clamp within viewport
    const vw = window.innerWidth, vh = window.innerHeight;
    left = Math.max(12, Math.min(left, vw - ttW - 12));
    top  = Math.max(12 + window.scrollY, top + window.scrollY);
    tooltip.style.left = left + 'px';
    tooltip.style.top  = top + 'px';
  }
  function finishTour(skipped) {
    if (!tooltip || !bd) return;
    tooltip.hidden = true;
    bd.hidden = true;
    clearHighlight();
    localStorage.setItem(ONB_KEY, skipped ? 'skipped' : 'true');
    document.body.style.overflow = '';
    if (settingsDot) settingsDot.hidden = true;
  }

  // Reposition on resize (throttled)
  let rzTimer = null;
  window.addEventListener('resize', () => {
    if (tooltip?.hidden) return;
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      const step = STEPS[cursor];
      const target = step && document.querySelector(step.target);
      if (target) positionTooltip(target, step.place);
    }, 150);
  });

  // Boot welcome on first load
  if (readyToShowWelcome()) {
    // small delay so app.js init finishes first
    setTimeout(showWelcome, 400);
  }

  // ============================================================
  // 5 · KPI · Total Value sparkline · driven by NAV history
  //   Reads window.stockfolio.getNavHistory() and rebuilds the SVG
  //   path whenever a new NAV snapshot is recorded.
  // ============================================================
  const SPARK_W = 320, SPARK_H = 32, SPARK_PAD = 2;
  function drawTotalValueSpark() {
    const svg = document.getElementById('spark-total-value');
    if (!svg) return;
    const pathEl = svg.querySelector('path');
    if (!pathEl) return;

    const history = (window.stockfolio?.getNavHistory?.() || []);
    if (history.length < 2) {
      // Not enough real data yet — flat baseline
      pathEl.setAttribute('d', `M0,${SPARK_H - SPARK_PAD} L${SPARK_W},${SPARK_H - SPARK_PAD}`);
      return;
    }
    const points = history.slice(-30);
    const values = points.map(p => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = SPARK_W / (points.length - 1);
    const usableH = SPARK_H - SPARK_PAD * 2;
    const d = points.map((p, i) => {
      const x = i * stepX;
      const y = SPARK_PAD + (1 - (p.value - min) / range) * usableH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    pathEl.setAttribute('d', d);
  }
  drawTotalValueSpark();
  window.addEventListener('nav-history-updated', drawTotalValueSpark);

  // ============================================================
  // 6 · SERENITY · Budget preset chips
  // ============================================================
  document.querySelectorAll('.budget-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.budget;
      const input = document.getElementById('serenity-budget');
      if (input) {
        input.value = val;
        document.querySelectorAll('.budget-preset').forEach(b => b.classList.toggle('active', b === btn));
        if (typeof calcSerenityAlloc === 'function') calcSerenityAlloc();
      }
    });
  });

  // ============================================================
  // 7a · Export / Import wiring
  // ============================================================
  document.getElementById('export-btn')?.addEventListener('click', () => {
    window.stockfolio?.exportPortfolioJSON?.();
  });
  document.getElementById('csv-export')?.addEventListener('click', () => {
    window.stockfolio?.exportPortfolioCSV?.();
  });
  const csvImportBtn = document.getElementById('csv-import');
  if (csvImportBtn) {
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'file';
    hiddenInput.accept = '.csv,.json,text/csv,application/json';
    hiddenInput.style.display = 'none';
    document.body.appendChild(hiddenInput);
    csvImportBtn.addEventListener('click', () => hiddenInput.click());
    hiddenInput.addEventListener('change', () => {
      const file = hiddenInput.files?.[0];
      if (file) window.stockfolio?.importPortfolioFile?.(file);
      hiddenInput.value = '';
    });
  }

  // ============================================================
  // 7b · Serenity allocation bar — populated from single source
  //   app.js's serenityStocks array is the canonical source; the
  //   stacked bar is rebuilt from it instead of hard-coded HTML.
  // ============================================================
  function renderSerenityAllocBar() {
    const bar = document.getElementById('serenity-alloc-bar');
    if (!bar || !window.stockfolio?.getSerenityStocks) return;
    const stocks = window.stockfolio.getSerenityStocks();
    if (!stocks.length) return;
    bar.innerHTML = stocks.map((s, i) => {
      const w = (s.weight * 100).toFixed(0);
      const label = `${s.name} ${w}%`;
      const escLabel = label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `<div class="alloc-segment seg-${i+1}" style="width:${w}%"><span>${escLabel}</span></div>`;
    }).join('');
  }
  renderSerenityAllocBar();

  // ============================================================
  // 8 · Holdings count badge (observe #holdings-tbody changes)
  // ============================================================
  const holdingsTbody = document.getElementById('holdings-tbody');
  const holdingsBadge = document.getElementById('holdings-count-badge');
  const holdingsCount = document.getElementById('holdings-count');
  if (holdingsTbody && (holdingsBadge || holdingsCount)) {
    const updateCount = () => {
      const rows = holdingsTbody.querySelectorAll('tr:not(.empty-row)');
      const n = rows.length;
      if (holdingsBadge) holdingsBadge.textContent = String(n);
      if (holdingsCount) holdingsCount.textContent = String(n);
    };
    updateCount();
    new MutationObserver(updateCount).observe(holdingsTbody, { childList: true });
  }

  // ============================================================
  // 8 · TABLE SORT + SEARCH (P3-1)
  //   Post-render enhancement: sorts / filters existing tbody rows.
  //   Re-applies automatically after app.js re-renders via MutationObserver.
  //   Sort state persists in sessionStorage.
  // ============================================================
  const SORT_STATES = {};
  function readSortState(key) {
    if (SORT_STATES[key]) return SORT_STATES[key];
    try {
      const raw = sessionStorage.getItem('sortState:' + key);
      SORT_STATES[key] = raw ? JSON.parse(raw) : { col: null, dir: 0 };
    } catch { SORT_STATES[key] = { col: null, dir: 0 }; }
    return SORT_STATES[key];
  }
  function writeSortState(key, state) {
    SORT_STATES[key] = state;
    try { sessionStorage.setItem('sortState:' + key, JSON.stringify(state)); } catch {}
  }

  function parseCellValue(cell, type) {
    const txt = (cell.textContent || '').trim();
    if (type === 'num') {
      // Extract leading +/- and digits; strip $ , 張 股 % etc.
      const m = txt.replace(/[,$\s]/g, '').match(/-?\+?\d+(\.\d+)?/);
      return m ? parseFloat(m[0].replace('+', '')) : 0;
    }
    return txt;
  }

  function sortTableRows(tableEl, state) {
    const tbody = tableEl.tBodies[0];
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    // Skip if empty-row placeholder
    if (rows.length === 0 || rows[0].classList.contains('empty-row')) return;
    if (state.col == null || state.dir === 0) return; // no sort → keep original order (managed by re-render)

    const ths = tableEl.tHead ? Array.from(tableEl.tHead.querySelectorAll('th')) : [];
    const type = ths[state.col]?.dataset.sortType || 'text';

    rows.sort((a, b) => {
      const va = parseCellValue(a.cells[state.col], type);
      const vb = parseCellValue(b.cells[state.col], type);
      if (type === 'num') return state.dir * (va - vb);
      return state.dir * String(va).localeCompare(String(vb), 'zh-Hant');
    });
    rows.forEach(r => tbody.appendChild(r));
  }

  function updateSortIndicators(tableEl, state) {
    const ths = tableEl.tHead ? Array.from(tableEl.tHead.querySelectorAll('th')) : [];
    ths.forEach((th, i) => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (i === state.col && state.dir !== 0) {
        th.classList.add(state.dir > 0 ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function applySearchFilter(tableEl, query) {
    const tbody = tableEl.tBodies[0];
    if (!tbody) return;
    const q = query.trim().toLowerCase();
    let visible = 0;
    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
      if (row.classList.contains('empty-row')) { row.style.display = q ? 'none' : ''; return; }
      const symbol = (row.cells[0]?.textContent || '').toLowerCase();
      const name   = (row.cells[1]?.textContent || '').toLowerCase();
      const match  = !q || symbol.includes(q) || name.includes(q);
      row.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    // Show/hide a synthetic "no result" row
    let noRow = tbody.querySelector('tr.no-result-row');
    if (q && visible === 0) {
      if (!noRow) {
        const cols = tableEl.tHead?.querySelectorAll('th').length || 1;
        noRow = document.createElement('tr');
        noRow.className = 'empty-row no-result-row';
        noRow.innerHTML = `<td colspan="${cols}">找不到符合「<strong></strong>」的持股</td>`;
        tbody.appendChild(noRow);
      }
      noRow.querySelector('strong').textContent = query;
      noRow.style.display = '';
    } else if (noRow) {
      noRow.style.display = 'none';
    }
  }

  function wireTable({ tableId, stateKey, searchInputId }) {
    const tableEl = document.getElementById(tableId);
    if (!tableEl) return;
    const searchEl = searchInputId ? document.getElementById(searchInputId) : null;
    let mutating = false; // guard against MutationObserver → reapply → mutation loop

    const reapply = () => {
      if (mutating) return;
      mutating = true;
      try {
        const state = readSortState(stateKey);
        sortTableRows(tableEl, state);
        updateSortIndicators(tableEl, state);
        if (searchEl) applySearchFilter(tableEl, searchEl.value || '');
      } finally {
        // Release on next microtask so pending MutationObserver callbacks bail out.
        setTimeout(() => { mutating = false; }, 0);
      }
    };

    // Click on th → cycle asc → desc → none
    tableEl.tHead?.querySelectorAll('th[data-sort-key]').forEach(th => {
      th.addEventListener('click', () => {
        const col = parseInt(th.dataset.sortKey, 10);
        const state = readSortState(stateKey);
        let nextDir;
        if (state.col !== col) nextDir = 1;
        else if (state.dir === 1) nextDir = -1;
        else if (state.dir === -1) nextDir = 0;
        else nextDir = 1;
        const newState = { col: nextDir === 0 ? null : col, dir: nextDir };
        writeSortState(stateKey, newState);
        reapply();
      });
    });

    // Search — debounce-lite via input event
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        if (mutating) return;
        mutating = true;
        try { applySearchFilter(tableEl, searchEl.value); }
        finally { setTimeout(() => { mutating = false; }, 0); }
      });
    }

    // Re-apply after app.js re-renders tbody (only when NOT caused by our own sort)
    const tbody = tableEl.tBodies[0];
    if (tbody) {
      new MutationObserver(() => { if (!mutating) reapply(); }).observe(tbody, { childList: true });
    }

    reapply();
  }

  wireTable({ tableId: 'holdings-table', stateKey: 'holdings', searchInputId: 'holdings-search' });
  wireTable({ tableId: 'manage-table',   stateKey: 'manage',   searchInputId: 'manage-search' });

  // ============================================================
  // 9 · EXPORT / IMPORT wiring (P2-3 button binding · promised in README)
  //   app.js already exposes handlers via window.stockfolio
  // ============================================================
  const sf = window.stockfolio || {};

  // Dashboard header 匯出 → JSON download
  document.getElementById('export-btn')?.addEventListener('click', () => {
    sf.exportPortfolioJSON?.();
  });

  // Portfolio page 匯出 CSV
  document.getElementById('csv-export')?.addEventListener('click', () => {
    sf.exportPortfolioCSV?.();
  });

  // Portfolio page 匯入 → hidden file input
  const importBtn = document.getElementById('csv-import');
  if (importBtn) {
    let hiddenFile = document.getElementById('sf-import-file');
    if (!hiddenFile) {
      hiddenFile = document.createElement('input');
      hiddenFile.type = 'file';
      hiddenFile.id = 'sf-import-file';
      hiddenFile.accept = '.json,.csv';
      hiddenFile.style.display = 'none';
      document.body.appendChild(hiddenFile);
    }
    importBtn.addEventListener('click', () => hiddenFile.click());
    hiddenFile.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      sf.importPortfolioFile?.(file);
      hiddenFile.value = ''; // allow re-selecting same file
    });
  }

})();
