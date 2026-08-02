'use strict';
(() => {
  const COVERAGE_KEY = 'dc_fk_coverage_v341';
  const MODULES = ['orders','returns','listings','inventory','payments','settlements'];
  const state = {
    modules: Object.fromEntries(MODULES.map(key => [key, { status: 'not-scanned', records: 0, source: 'none', updatedAt: null }])),
    mode: 'not-scanned',
    importedReports: 0,
    lastFullSyncAt: null,
    lastUpdatedAt: null
  };

  const text = value => String(value ?? '').trim();
  const countMapped = key => Number(moduleStatus?.[key]?.mapped || 0);

  async function load() {
    try {
      const stored = (await chrome.storage.local.get(COVERAGE_KEY))[COVERAGE_KEY];
      if (stored && typeof stored === 'object') {
        Object.assign(state, stored);
        state.modules = { ...state.modules, ...(stored.modules || {}) };
      }
    } catch {}
  }

  async function saveCoverage() {
    state.lastUpdatedAt = Date.now();
    try { await chrome.storage.local.set({ [COVERAGE_KEY]: state }); } catch {}
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
    const cards = MODULES.map(key => {
      const item = state.modules[key] || {};
      const icon = item.status === 'complete' ? '✓' : item.status === 'partial' ? '◐' : item.status === 'skipped' ? '—' : '○';
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      const source = text(item.source || 'none').replaceAll('-', ' ');
      return `<div class="kpi"><small>${icon} ${label}</small><strong>${Number(item.records || 0).toLocaleString('en-IN')}</strong><small>${source}</small></div>`;
    }).join('');
    panel.innerHTML = `<div class="panel-head"><div><h3>Data Coverage</h3><small>${labelForMode(state.mode)}</small></div><small>${state.lastUpdatedAt ? 'Updated ' + new Date(state.lastUpdatedAt).toLocaleTimeString('en-IN') : 'Waiting for sync'}</small></div><div class="kpis">${cards}</div>`;
  }

  function updateFromLive(payload) {
    const module = text(payload?.meta?.module);
    const coverage = text(payload?.meta?.coverage);
    const networkCount = Array.isArray(payload?.network) ? payload.network.length : 0;
    const domTables = Array.isArray(payload?.dom?.tables) ? payload.dom.tables.reduce((sum, table) => sum + (table.rows?.length || 0), 0) : 0;
    const source = networkCount ? 'captured-api' : domTables ? 'visible-page' : 'no-records';

    if (module && state.modules[module]) {
      state.modules[module] = {
        status: /complete/.test(coverage) ? 'complete' : 'partial',
        records: Math.max(countMapped(module), domTables, networkCount),
        source,
        updatedAt: Date.now()
      };
    } else {
      for (const key of MODULES) {
        if (payload?.dom?.modules?.[key]) {
          state.modules[key] = {
            status: 'partial',
            records: Math.max(countMapped(key), domTables, networkCount),
            source,
            updatedAt: Date.now()
          };
        }
      }
    }
    saveCoverage().then(renderCoverage);
  }

  function updateFromProgress(progress) {
    if (progress.state === 'skipped' && state.modules[progress.module]) {
      state.modules[progress.module] = { status: 'skipped', records: countMapped(progress.module), source: progress.reason || 'not-found', updatedAt: Date.now() };
    }
    if (progress.state === 'done' && progress.mode === 'full-account') {
      for (const result of progress.results || []) {
        if (!state.modules[result.module]) continue;
        const previous = state.modules[result.module] || {};
        state.modules[result.module] = {
          ...previous,
          status: result.status === 'captured' ? 'complete' : result.status === 'not-found' ? 'skipped' : 'partial',
          records: Math.max(Number(previous.records || 0), countMapped(result.module)),
          source: result.status === 'captured' ? (previous.source || 'captured-api') : result.status,
          updatedAt: Date.now()
        };
      }
      state.lastFullSyncAt = Date.now();
    }
    saveCoverage().then(renderCoverage);
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.source !== 'DC_FK_HOST' || event.data?.token !== CHANNEL_TOKEN) return;
    if (event.data?.type === 'LIVE_DATA') updateFromLive(event.data.payload || {});
    if (event.data?.type === 'SYNC_PROGRESS') updateFromProgress(event.data.payload || {});
  });

  document.getElementById('fileInput')?.addEventListener('change', event => {
    const count = event.target?.files?.length || 0;
    if (!count) return;
    state.importedReports += count;
    saveCoverage().then(renderCoverage);
  });

  load().then(renderCoverage);
})();