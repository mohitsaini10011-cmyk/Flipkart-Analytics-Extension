'use strict';
(() => {
  const KEY = 'dc_fk_runtime_diagnostics_v350';
  const STALE_KEY = 'dc_fk_stale_context_evidence_v349';
  const OVERLAY_ID = 'dc-flipkart-analytics-overlay';
  const MAX_EVENTS = 300;
  const UNIQUE_EXTENSION_FILES = /(?:content|background|page-bridge|v34-core|v341-[\w-]+|v343-sync-controller|v345-runtime|v346-context-guard|v348-runtime-diagnostics)\.js/i;
  const sessionId = crypto.randomUUID();
  let writeQueue = Promise.resolve();
  let overlayOpen = Boolean(document.getElementById(OVERLAY_ID));

  function contextAvailable() {
    try { return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local); }
    catch { return false; }
  }
  function blankState() {
    return { sessionId, events: [], errors: [], counters: {}, syncSummaries: {} };
  }
  async function readState() {
    if (!contextAvailable()) return blankState();
    try {
      const state = (await chrome.storage.local.get(KEY))[KEY] || blankState();
      state.syncSummaries = state.syncSummaries || {};
      return state;
    } catch { return blankState(); }
  }
  function classifyError(message, filename, stack) {
    const hay = `${filename || ''}\n${stack || ''}\n${message || ''}`;
    let extensionBase = '';
    try { extensionBase = chrome.runtime.getURL(''); } catch {}
    if (extensionBase && hay.includes(extensionBase)) return 'extension';
    if (UNIQUE_EXTENSION_FILES.test(hay) || /Ecom Insight|dc-fk-|dc_fk_/i.test(hay)) return 'extension';
    if (/seller\.flipkart\.com|flipkart/i.test(hay)) return 'seller-page';
    return 'unknown';
  }
  function updateSyncSummary(state, type, detail) {
    const syncId = detail.syncId;
    if (!syncId) return;
    const row = state.syncSummaries[syncId] ||= {
      syncId,
      started: false,
      finished: false,
      requiresRestore: false,
      restoreCount: 0,
      navigationCount: 0,
      stallCount: 0
    };
    row.updatedAt = Date.now();
    if (type === 'sync-started') {
      row.started = true;
      row.startedAt = detail.at || Date.now();
      row.originalUrl = detail.originalUrl || row.originalUrl;
    } else if (type === 'sync-finished') {
      row.finished = true;
      row.finishedAt = detail.at || Date.now();
      row.result = detail.result;
      row.requiresRestore = Boolean(detail.requiresRestore);
      row.finalUrl = detail.finalUrl || row.finalUrl;
      row.restoreIssuedAt = detail.restoreIssuedAt || row.restoreIssuedAt || null;
    } else if (type === 'restore-issued') {
      row.restoreCount = Number(row.restoreCount || 0) + 1;
      row.restoreIssuedAt = detail.restoreIssuedAt || detail.at || Date.now();
      row.restoreTarget = detail.originalUrl || row.restoreTarget;
    } else if (type === 'sync-navigation') {
      row.navigationCount = Math.max(Number(row.navigationCount || 0), Number(detail.navigationCount || 0));
    } else if (type === 'sync-stall') {
      row.stallCount = Math.max(Number(row.stallCount || 0), Number(detail.stallCount || 0));
    }
  }
  function record(type, detail = {}, isError = false) {
    writeQueue = writeQueue.then(async () => {
      if (!contextAvailable()) return;
      const state = await readState();
      state.sessionId = sessionId;
      state.updatedAt = Date.now();
      state.events = Array.isArray(state.events) ? state.events : [];
      state.errors = Array.isArray(state.errors) ? state.errors : [];
      state.counters = state.counters || {};
      state.syncSummaries = state.syncSummaries || {};
      const entry = { type, at: Date.now(), url: location.href, ...detail };
      state.events.push(entry);
      state.events = state.events.slice(-MAX_EVENTS);
      state.counters[type] = Number(state.counters[type] || 0) + 1;
      updateSyncSummary(state, type, entry);
      if (isError) {
        state.errors.push(entry);
        state.errors = state.errors.slice(-100);
      }
      await chrome.storage.local.set({ [KEY]: state });
    }).catch(() => {});
    return writeQueue;
  }
  function confirmOverlay(source) {
    queueMicrotask(() => {
      const present = Boolean(document.getElementById(OVERLAY_ID));
      if (present && !overlayOpen) {
        overlayOpen = true;
        record('dashboard-opened', { source });
      }
    });
  }
  function confirmClosed(reason) {
    setTimeout(() => {
      const present = Boolean(document.getElementById(OVERLAY_ID));
      if (!present && overlayOpen) {
        overlayOpen = false;
        record('dashboard-closed', { reason });
      }
    }, 240);
  }
  async function migrateStaleEvidence() {
    if (!contextAvailable()) return;
    try {
      const items = JSON.parse(sessionStorage.getItem(STALE_KEY) || '[]');
      sessionStorage.removeItem(STALE_KEY);
      for (const item of items) await record('stale-context-detected', item);
    } catch {}
  }

  document.addEventListener('click', event => {
    const launcher = event.target?.closest?.('#dc-flipkart-analytics-launcher, #dc-flipkart-analytics-dock .dc-dock-main, #dc-flipkart-analytics-dock .dc-dock-play');
    if (launcher) {
      record('dashboard-open-request', { source: 'page-launcher' });
      setTimeout(() => confirmOverlay('page-launcher'), 0);
    }
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay && event.target === overlay) confirmClosed('overlay-click');
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById(OVERLAY_ID)) confirmClosed('escape');
  }, true);

  if (contextAvailable()) {
    try {
      chrome.runtime.onMessage.addListener(message => {
        if (message?.type !== 'OPEN_FLIPKART_ANALYTICS') return;
        const source = message.source === 'toolbar' ? 'toolbar' : 'runtime';
        record('dashboard-open-request', { source });
        setTimeout(() => confirmOverlay(source), 0);
      });
    } catch {}
  }

  window.addEventListener('dc-fk-runtime-diagnostic', event => {
    const detail = event.detail || {};
    record(detail.type || 'runtime-diagnostic', detail);
  });
  window.addEventListener('dc-fk-sync-lifecycle', event => {
    record('sync-lifecycle', { lifecycle: event.detail?.state || 'unknown', syncId: event.detail?.syncId || null });
  });
  window.addEventListener('error', event => {
    const message = String(event?.error?.message || event?.message || 'Unknown window error');
    const filename = event.filename || '';
    const stack = String(event?.error?.stack || '');
    record('page-error', { message, filename, stack, line: event.lineno || 0, column: event.colno || 0, origin: classifyError(message, filename, stack) }, true);
  });
  window.addEventListener('unhandledrejection', event => {
    const message = String(event?.reason?.message || event?.reason || 'Unhandled rejection');
    const stack = String(event?.reason?.stack || '');
    record('unhandled-rejection', { message, stack, origin: classifyError(message, '', stack) }, true);
  });

  window.addEventListener('dc-fk-runtime-report-request', async () => {
    await writeQueue;
    const state = await readState();
    const syncRows = Object.values(state.syncSummaries || {});
    const startedRows = syncRows.filter(row => row.started);
    const finishedRows = syncRows.filter(row => row.finished);
    const allStartedSyncsFinished = startedRows.every(row => row.finished);
    const noDuplicateRestores = syncRows.every(row => Number(row.restoreCount || 0) <= 1);
    const requiredRestoresComplete = finishedRows.filter(row => row.requiresRestore).every(row => Number(row.restoreCount || 0) === 1);
    const unnecessaryRestoresAbsent = finishedRows.filter(row => !row.requiresRestore).every(row => Number(row.restoreCount || 0) === 0);
    const extensionErrors = (state.errors || []).filter(error => error.origin === 'extension');
    const report = {
      sessionId,
      generatedAt: Date.now(),
      dashboardOpenCount: Number(state.counters?.['dashboard-opened'] || 0),
      syncStarted: startedRows.length,
      syncFinished: finishedRows.length,
      perSync: syncRows,
      allStartedSyncsFinished,
      noDuplicateRestores,
      requiredRestoresComplete,
      unnecessaryRestoresAbsent,
      exactlyOneRestorePerRequiredSync: allStartedSyncsFinished && noDuplicateRestores && requiredRestoresComplete && unnecessaryRestoresAbsent,
      totalConsoleErrorCount: (state.errors || []).length,
      extensionErrorCount: extensionErrors.length,
      errorsByOrigin: {
        extension: extensionErrors.length,
        sellerPage: (state.errors || []).filter(error => error.origin === 'seller-page').length,
        unknown: (state.errors || []).filter(error => error.origin === 'unknown').length
      },
      errors: state.errors || [],
      events: state.events || []
    };
    window.dispatchEvent(new CustomEvent('dc-fk-runtime-report', { detail: report }));
  });

  window.addEventListener('dc-extension-context-invalid', () => confirmClosed('context-invalid'));

  migrateStaleEvidence();
  record('diagnostics-loaded', { version: '3.5.0' });
})();