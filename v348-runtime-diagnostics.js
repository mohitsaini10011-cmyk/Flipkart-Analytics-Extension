'use strict';
(() => {
  const KEY = 'dc_fk_runtime_diagnostics_v349';
  const STALE_KEY = 'dc_fk_stale_context_evidence_v349';
  const OVERLAY_ID = 'dc-flipkart-analytics-overlay';
  const MAX_EVENTS = 300;
  const EXTENSION_FILES = /(?:content|background|page-bridge|v34|v341|v343|v345|v346|v348|v349|dashboard|app)\.js/i;
  const sessionId = crypto.randomUUID();
  let writeQueue = Promise.resolve();
  let overlayOpen = Boolean(document.getElementById(OVERLAY_ID));

  function contextAvailable() {
    try { return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local); }
    catch { return false; }
  }
  async function readState() {
    if (!contextAvailable()) return { sessionId, events: [], errors: [], counters: {} };
    try { return (await chrome.storage.local.get(KEY))[KEY] || { sessionId, events: [], errors: [], counters: {} }; }
    catch { return { sessionId, events: [], errors: [], counters: {} }; }
  }
  function classifyError(message, filename, stack) {
    const hay = `${filename || ''}\n${stack || ''}\n${message || ''}`;
    if (/chrome-extension:\/\//i.test(hay) || EXTENSION_FILES.test(hay) || /Ecom Insight|dc-fk-|dc_fk_/i.test(hay)) return 'extension';
    if (/seller\.flipkart\.com|flipkart/i.test(hay)) return 'seller-page';
    return 'unknown';
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
      const entry = { type, at: Date.now(), url: location.href, ...detail };
      state.events.push(entry);
      state.events = state.events.slice(-MAX_EVENTS);
      state.counters[type] = Number(state.counters[type] || 0) + 1;
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
    const events = state.events || [];
    const starts = events.filter(item => item.type === 'sync-started' && item.syncId);
    const finishes = events.filter(item => item.type === 'sync-finished' && item.syncId);
    const restores = events.filter(item => item.type === 'restore-issued' && item.syncId);
    const perSync = {};
    for (const event of starts) perSync[event.syncId] = { syncId: event.syncId, started: true, finished: false, requiresRestore: false, restoreCount: 0 };
    for (const event of finishes) {
      const row = perSync[event.syncId] ||= { syncId: event.syncId, started: false, finished: false, requiresRestore: false, restoreCount: 0 };
      row.finished = true;
      row.result = event.result;
      row.requiresRestore = Boolean(event.requiresRestore);
    }
    for (const event of restores) {
      const row = perSync[event.syncId] ||= { syncId: event.syncId, started: false, finished: false, requiresRestore: true, restoreCount: 0 };
      row.restoreCount++;
    }
    const syncRows = Object.values(perSync);
    const noDuplicateRestores = syncRows.every(row => row.restoreCount <= 1);
    const requiredRestoresComplete = syncRows.filter(row => row.finished && row.requiresRestore).every(row => row.restoreCount === 1);
    const unnecessaryRestoresAbsent = syncRows.filter(row => row.finished && !row.requiresRestore).every(row => row.restoreCount === 0);
    const extensionErrors = (state.errors || []).filter(error => error.origin === 'extension');
    const report = {
      sessionId,
      generatedAt: Date.now(),
      dashboardOpenCount: Number(state.counters?.['dashboard-opened'] || 0),
      syncStarted: starts.length,
      syncFinished: finishes.length,
      perSync: syncRows,
      noDuplicateRestores,
      requiredRestoresComplete,
      unnecessaryRestoresAbsent,
      exactlyOneRestorePerRequiredSync: noDuplicateRestores && requiredRestoresComplete && unnecessaryRestoresAbsent,
      totalConsoleErrorCount: (state.errors || []).length,
      extensionErrorCount: extensionErrors.length,
      errorsByOrigin: {
        extension: extensionErrors.length,
        sellerPage: (state.errors || []).filter(error => error.origin === 'seller-page').length,
        unknown: (state.errors || []).filter(error => error.origin === 'unknown').length
      },
      errors: state.errors || [],
      events
    };
    window.dispatchEvent(new CustomEvent('dc-fk-runtime-report', { detail: report }));
  });

  window.addEventListener('dc-extension-context-invalid', () => {
    confirmClosed('context-invalid');
  });

  migrateStaleEvidence();
  record('diagnostics-loaded', { version: '3.4.9' });
})();
