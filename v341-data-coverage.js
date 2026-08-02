'use strict';
(() => {
  const COVERAGE_PREFIX = 'dc_fk_coverage_v341_';
  const LEGACY_COVERAGE_KEY = 'dc_fk_coverage_v341';
  const MODULES = ['orders','returns','listings','inventory','payments','settlements'];
  const text = value => String(value ?? '').trim();
  const slug = value => text(value || 'unassigned').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80) || 'unassigned';
  const countMapped = key => Number(moduleStatus?.[key]?.mapped || 0);

  function currentSellerIdentity() {
    const seller = connectedSeller || latestSellerInfo || {};
    const stableKey = slug(seller.stableKey || seller.id || seller.name || 'unassigned');
    return {
      stableKey,
      name: text(seller.name),
      id: text(seller.id),
      storageKey: COVERAGE_PREFIX + stableKey
    };
  }

  function emptyState(identity = currentSellerIdentity()) {
    return {
      sellerKey: identity.stableKey,
      sellerName: identity.name,
      sellerId: identity.id,
      modules: Object.fromEntries(MODULES.map(key => [key, { status: 'not-scanned', records: 0, source: 'none', updatedAt: null }])),
      mode: 'not-scanned',
      importedReports: 0,
      lastFullSyncAt: null,
      lastUpdatedAt: null
    };
  }

  let activeIdentity = currentSellerIdentity();
  let state = emptyState(activeIdentity);
  let switchPromise = Promise.resolve();

  async function migrateLegacyCoverage(identity) {
    if (identity.stableKey === 'unassigned') return;
    const data = await chrome.storage.local.get([LEGACY_COVERAGE_KEY, identity.storageKey]);
    if (!data[identity.storageKey] && data[LEGACY_COVERAGE_KEY] && typeof data[LEGACY_COVERAGE_KEY] === 'object') {
      const migrated = {
        ...emptyState(identity),
        ...data[LEGACY_COVERAGE_KEY],
        sellerKey: identity.stableKey,
        sellerName: identity.name,
        sellerId: identity.id,
        migratedFromGlobalCoverage: true,
        migratedAt: Date.now()
      };
      migrated.modules = { ...emptyState(identity).modules, ...(data[LEGACY_COVERAGE_KEY].modules || {}) };
      await chrome.storage.local.set({ [identity.storageKey]: migrated });
    }
    if (data[LEGACY_COVERAGE_KEY]) await chrome.storage.local.remove(LEGACY_COVERAGE_KEY);
  }

  async function loadForSeller(identity = currentSellerIdentity()) {
    activeIdentity = identity;
    await migrateLegacyCoverage(identity);
    const stored = (await chrome.storage.local.get(identity.storageKey))[identity.storageKey];
    state = emptyState(identity);
    if (stored && typeof stored === 'object' && stored.sellerKey === identity.stableKey) {
      state = { ...state, ...stored, sellerKey: identity.stableKey, sellerName: identity.name || stored.sellerName || '', sellerId: identity.id || stored.sellerId || '' };
      state.modules = { ...emptyState(identity).modules, ...(stored.modules || {}) };
    }
    renderCoverage();
  }

  async function ensureCurrentSeller() {
    const next = currentSellerIdentity();
    if (next.stableKey === activeIdentity.stableKey) {
      state.sellerName = next.name || state.sellerName;
      state.sellerId = next.id || state.sellerId;
      return;
    }
    switchPromise = switchPromise.then(() => loadForSeller(next));
    await switchPromise;
  }

  async function saveCoverage() {
    await ensureCurrentSeller();
    const identity = currentSellerIdentity();
    if (identity.stableKey !== activeIdentity.stableKey || state.sellerKey !== identity.stableKey) {
      console.warn('[Flipkart Analytics] Coverage save blocked: seller namespace mismatch');
      return false;
    }
    state.sellerName = identity.name || state.sellerName;
    state.sellerId = identity.id || state.sellerId;
    state.lastUpdatedAt = Date.now();
    await chrome.storage.local.set({ [identity.storageKey]: { ...state } });
    return true;
  }

  function deriveOverallMode() {
    const values = Object.values(state.modules);
    const complete = values.filter(item => item.status === 'complete').length;
    const partial = values.filter(item => item.status === 'partial').length;
    if (complete === MODULES.length) return 'full-account';
    if (complete || partial) return 'partial-account';
    if (state.importedReports > 0) return 'imported-reports';
    return 'not-scanned';
  }

  function labelForMode(mode) {
    return {
      'full-account': '🟢 Full Account Coverage',
      'partial-account': '🟡 Partial Account Coverage',
      'imported-reports': '🔵 Imported Report Coverage',
      'not-scanned': '🔴 Not Scanned'
    }[mode] || '🔴 Not Scanned';
  }

  function ensurePanel() {
    const overview = document.getElementById('overview');
    if (!overview) return null;
    let panel = document.getElementById('dataCoveragePanel');
    if (!panel) {
      panel = document.createElement('article');
      panel.id = 'dataCoveragePanel';
      panel.className = 'panel';
      overview.querySelector('.kpis')?.insertAdjacentElement('afterend', panel);
    }
    return panel;
  }

  function renderCoverage() {
    state.mode = deriveOverallMode();
    const panel = ensurePanel();
    if (!panel) return;
    const sellerLabel = state.sellerName || state.sellerId || activeIdentity.stableKey === 'unassigned' ? (state.sellerName || state.sellerId || 'Unassigned seller') : activeIdentity.stableKey;
    const cards = MODULES.map(key => {
      const item = state.modules[key] || {};
      const icon = item.status === 'complete' ? '✓' : item.status === 'partial' ? '◐' : item.status === 'skipped' ? '—' : '○';
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      const source = text(item.source || 'none').replaceAll('-', ' ');
      return `<div class="kpi"><small>${icon} ${label}</small><strong>${Number(item.records || 0).toLocaleString('en-IN')}</strong><small>${source}</small></div>`;
    }).join('');
    panel.innerHTML = `<div class="panel-head"><div><h3>Data Coverage</h3><small>Seller: ${sellerLabel} · ${labelForMode(state.mode)}</small></div><small>${state.lastUpdatedAt ? 'Updated ' + new Date(state.lastUpdatedAt).toLocaleTimeString('en-IN') : 'Waiting for sync'}</small></div><div class="kpis">${cards}</div>`;
  }

  async function updateFromLive(payload) {
    await ensureCurrentSeller();
    const module = text(payload?.meta?.module);
    const coverage = text(payload?.meta?.coverage);
    const networkCount = Array.isArray(payload?.network) ? payload.network.length : 0;
    const domTables = Array.isArray(payload?.dom?.tables) ? payload.dom.tables.reduce((sum, table) => sum + (table.rows?.length || 0), 0) : 0;
    const source = networkCount ? 'captured-api' : domTables ? 'visible-page' : 'no-records';
    if (module && state.modules[module]) {
      state.modules[module] = { status: /complete/.test(coverage) ? 'complete' : 'partial', records: Math.max(countMapped(module), domTables, networkCount), source, updatedAt: Date.now() };
    } else {
      for (const key of MODULES) if (payload?.dom?.modules?.[key]) state.modules[key] = { status: 'partial', records: Math.max(countMapped(key), domTables, networkCount), source, updatedAt: Date.now() };
    }
    await saveCoverage();
    renderCoverage();
  }

  async function updateFromProgress(progress) {
    await ensureCurrentSeller();
    if (progress.state === 'skipped' && state.modules[progress.module]) state.modules[progress.module] = { status: 'skipped', records: countMapped(progress.module), source: progress.reason || 'not-found', updatedAt: Date.now() };
    if (progress.state === 'done' && progress.mode === 'full-account') {
      for (const result of progress.results || []) {
        if (!state.modules[result.module]) continue;
        const previous = state.modules[result.module] || {};
        state.modules[result.module] = { ...previous, status: result.status === 'captured' ? 'complete' : result.status === 'not-found' ? 'skipped' : 'partial', records: Math.max(Number(previous.records || 0), countMapped(result.module)), source: result.status === 'captured' ? (previous.source || 'captured-api') : result.status, updatedAt: Date.now() };
      }
      state.lastFullSyncAt = Date.now();
    }
    await saveCoverage();
    renderCoverage();
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.source !== 'DC_FK_HOST' || event.data?.token !== CHANNEL_TOKEN) return;
    if (event.data?.type === 'LIVE_DATA') updateFromLive(event.data.payload || {}).catch(console.warn);
    if (event.data?.type === 'SYNC_PROGRESS') updateFromProgress(event.data.payload || {}).catch(console.warn);
  });

  document.getElementById('fileInput')?.addEventListener('change', async event => {
    const count = event.target?.files?.length || 0;
    if (!count) return;
    await ensureCurrentSeller();
    state.importedReports += count;
    await saveCoverage();
    renderCoverage();
  });

  window.DCFKCoverage = {
    getCurrent: () => ({ ...state, modules: structuredClone(state.modules) }),
    getStorageKey: () => currentSellerIdentity().storageKey,
    reloadForCurrentSeller: () => loadForSeller(currentSellerIdentity()),
    clearCurrentSeller: async () => {
      const identity = currentSellerIdentity();
      await chrome.storage.local.remove(identity.storageKey);
      state = emptyState(identity);
      renderCoverage();
    }
  };

  loadForSeller(activeIdentity).catch(error => console.warn('[Flipkart Analytics] Coverage load failed', error));
})();