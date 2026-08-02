'use strict';
(() => {
  const KEY = 'dc_fk_runtime_diagnostics_v348';
  const OVERLAY_ID = 'dc-flipkart-analytics-overlay';
  const MAX_EVENTS = 200;
  let lastOpenSource = 'toolbar-or-runtime';
  let overlayWasPresent = Boolean(document.getElementById(OVERLAY_ID));
  let restoreCount = 0;
  const sessionId = crypto.randomUUID();

  function contextAvailable() {
    try { return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local); }
    catch { return false; }
  }

  async function readState() {
    if (!contextAvailable()) return { sessionId, events: [], errors: [], counters: {} };
    try {
      return (await chrome.storage.local.get(KEY))[KEY] || { sessionId, events: [], errors: [], counters: {} };
    } catch {
      return { sessionId, events: [], errors: [], counters: {} };
    }
  }

  async function record(type, detail = {}, isError = false) {
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
      state.errors = state.errors.slice(-50);
    }
    try { await chrome.storage.local.set({ [KEY]: state }); } catch {}
  }

  document.addEventListener('click', event => {
    const launcher = event.target?.closest?.('#dc-flipkart-analytics-launcher, #dc-flipkart-analytics-dock .dc-dock-main, #dc-flipkart-analytics-dock .dc-dock-play');
    if (launcher) lastOpenSource = 'page-launcher';
  }, true);

  const observer = new MutationObserver(() => {
    const present = Boolean(document.getElementById(OVERLAY_ID));
    if (present && !overlayWasPresent) {
      record('dashboard-opened', { source: lastOpenSource });
      lastOpenSource = 'toolbar-or-runtime';
    }
    if (!present && overlayWasPresent) record('dashboard-closed');
    overlayWasPresent = present;
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('dc-fk-runtime-diagnostic', event => {
    const detail = event.detail || {};
    if (detail.type === 'restore-issued') restoreCount++;
    record(detail.type || 'runtime-diagnostic', { ...detail, restoreCount });
  });

  window.addEventListener('dc-fk-sync-lifecycle', event => {
    record('sync-lifecycle', { lifecycle: event.detail?.state || 'unknown' });
  });

  window.addEventListener('error', event => {
    const message = String(event?.error?.message || event?.message || 'Unknown window error');
    record('page-error', { message, filename: event.filename || '', line: event.lineno || 0, column: event.colno || 0 }, true);
  });

  window.addEventListener('unhandledrejection', event => {
    const message = String(event?.reason?.message || event?.reason || 'Unhandled rejection');
    record('unhandled-rejection', { message }, true);
  });

  window.addEventListener('dc-fk-runtime-report-request', async () => {
    const state = await readState();
    const restoreEvents = (state.events || []).filter(item => item.type === 'restore-issued');
    const report = {
      sessionId,
      generatedAt: Date.now(),
      dashboardOpenCount: Number(state.counters?.['dashboard-opened'] || 0),
      syncStarted: Number(state.counters?.['sync-started'] || 0),
      syncFinished: Number(state.counters?.['sync-finished'] || 0),
      restoreCount: restoreEvents.length,
      exactlyOneRestorePerFinishedSync: restoreEvents.length <= Number(state.counters?.['sync-finished'] || 0),
      consoleErrorCount: (state.errors || []).length,
      errors: state.errors || [],
      events: state.events || []
    };
    window.dispatchEvent(new CustomEvent('dc-fk-runtime-report', { detail: report }));
  });

  window.addEventListener('dc-extension-context-invalid', () => {
    record('stale-context-detected');
    observer.disconnect();
  });

  record('diagnostics-loaded', { version: '3.4.8' });
})();
