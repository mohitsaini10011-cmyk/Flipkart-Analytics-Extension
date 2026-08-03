'use strict';
(() => {
  const KEY = 'dc_fk_runtime_diagnostics_v352';
  const STALE_KEY = 'dc_fk_stale_context_evidence_v349';
  const WRITE_FAILURE_KEY = 'dc_fk_diagnostics_write_failures_v352';
  const CONTROLLER_STATE_KEY = 'dc_fk_sync_controller_v343';
  const TAB_SESSION_KEY = 'dc_fk_tab_session_v352';
  const TEST_RUN_KEY = 'dc_fk_runtime_test_run_v352';
  const OVERLAY_ID = 'dc-flipkart-analytics-overlay';
  const MAX_EVENTS = 300;
  const MAX_SUMMARIES = 100;
  const SUMMARY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const INTERRUPTED_GRACE_MS = 30 * 1000;
  const UNIQUE_EXTENSION_FILES = /(?:page-bridge|v34-core|v341-[\w-]+|v343-sync-controller|v345-runtime|v346-context-guard|v348-runtime-diagnostics)\.js/i;
  const sessionId = crypto.randomUUID();
  let writeQueue = Promise.resolve();
  let overlayOpen = Boolean(document.getElementById(OVERLAY_ID));

  function getOrCreateSessionValue(key) {
    try {
      let value = sessionStorage.getItem(key);
      if (!value) {
        value = crypto.randomUUID();
        sessionStorage.setItem(key, value);
      }
      return value;
    } catch { return crypto.randomUUID(); }
  }
  const tabSessionId = getOrCreateSessionValue(TAB_SESSION_KEY);
  function getCurrentRunId() { return getOrCreateSessionValue(TEST_RUN_KEY); }
  function setCurrentRunId(value) {
    const runId = value || crypto.randomUUID();
    try { sessionStorage.setItem(TEST_RUN_KEY, runId); } catch {}
    return runId;
  }

  function contextAvailable() {
    try { return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local); }
    catch { return false; }
  }
  function blankState() {
    return { sessionId, tabSessionId, events: [], errors: [], counters: {}, syncSummaries: {}, testRuns: {} };
  }
  async function readState() {
    if (!contextAvailable()) return blankState();
    try {
      const state = (await chrome.storage.local.get(KEY))[KEY] || blankState();
      state.syncSummaries = state.syncSummaries || {};
      state.testRuns = state.testRuns || {};
      return state;
    } catch { return blankState(); }
  }
  function classifyError(message, filename, stack) {
    const hay = `${filename || ''}\n${stack || ''}\n${message || ''}`;
    let extensionBase = '';
    try { extensionBase = chrome.runtime.getURL(''); } catch {}
    if (extensionBase && hay.includes(extensionBase)) return { origin: 'extension', confidence: 'confirmed' };
    if (UNIQUE_EXTENSION_FILES.test(hay)) return { origin: 'extension', confidence: 'confirmed' };
    if (/Ecom Insight|dc-fk-|dc_fk_/i.test(hay)) return { origin: 'extension', confidence: 'probable' };
    if (/seller\.flipkart\.com|flipkart/i.test(hay)) return { origin: 'seller-page', confidence: 'probable' };
    return { origin: 'unknown', confidence: 'unknown' };
  }
  function cleanupSummaries(state) {
    const now = Date.now();
    const rows = Object.values(state.syncSummaries || {})
      .filter(row => now - Number(row.updatedAt || row.startedAt || now) <= SUMMARY_MAX_AGE_MS)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, MAX_SUMMARIES);
    state.syncSummaries = Object.fromEntries(rows.map(row => [row.syncId, row]));
  }
  function readActiveControllerState() {
    try {
      const value = JSON.parse(sessionStorage.getItem(CONTROLLER_STATE_KEY) || 'null');
      return value?.active ? value : null;
    } catch { return null; }
  }
  function reconcileUnfinishedSyncs(state, reason = 'startup-reconciliation') {
    const now = Date.now();
    const active = readActiveControllerState();
    for (const row of Object.values(state.syncSummaries || {})) {
      if (!row.started || row.finished) continue;
      const isActive = Boolean(active && active.id === row.syncId && active.active);
      const age = now - Number(row.updatedAt || row.startedAt || now);
      if (isActive) {
        row.controllerActive = true;
        continue;
      }
      if (age < INTERRUPTED_GRACE_MS) continue;
      row.finished = true;
      row.result = 'interrupted';
      row.interrupted = true;
      row.interruptionReason = reason;
      row.finishedAt = now;
      row.updatedAt = now;
      row.requiresRestore = false;
      row.controllerActive = false;
    }
  }
  function updateSyncSummary(state, type, detail) {
    const syncId = detail.syncId;
    if (!syncId) return;
    const runId = detail.runId || getCurrentRunId();
    const row = state.syncSummaries[syncId] ||= {
      syncId,
      runId,
      tabSessionId: detail.tabSessionId || tabSessionId,
      started: false,
      finished: false,
      requiresRestore: false,
      restoreCount: 0,
      navigationCount: 0,
      stallCount: 0
    };
    row.runId = runId;
    row.tabSessionId = detail.tabSessionId || row.tabSessionId || tabSessionId;
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
      row.persistence = detail.persistence || row.persistence;
      row.persistenceDegraded = Boolean(detail.persistenceDegraded || detail.persistence?.degraded);
    } else if (type === 'restore-issued') {
      row.restoreCount = Number(row.restoreCount || 0) + 1;
      row.restoreIssuedAt = detail.restoreIssuedAt || detail.at || Date.now();
      row.restoreTarget = detail.originalUrl || row.restoreTarget;
      row.persistenceDegraded = Boolean(detail.persistenceDegraded || detail.persistence?.degraded || row.persistenceDegraded);
    } else if (type === 'sync-navigation') {
      row.navigationCount = Math.max(Number(row.navigationCount || 0), Number(detail.navigationCount || 0));
    } else if (type === 'sync-stall') {
      row.stallCount = Math.max(Number(row.stallCount || 0), Number(detail.stallCount || 0));
    } else if (type === 'restore-blocked-persistence-failed') {
      row.persistenceFailure = true;
    }
  }
  function persistWriteFailure(error, context = {}) {
    try {
      const previous = JSON.parse(sessionStorage.getItem(WRITE_FAILURE_KEY) || '[]');
      previous.push({
        at: Date.now(),
        message: String(error?.message || error || 'Diagnostics storage write failed'),
        runId: context.runId || getCurrentRunId(),
        type: context.type || 'unknown'
      });
      sessionStorage.setItem(WRITE_FAILURE_KEY, JSON.stringify(previous.slice(-50)));
    } catch {}
  }
  function record(type, detail = {}, isError = false) {
    writeQueue = writeQueue.then(async () => {
      if (!contextAvailable()) {
        persistWriteFailure('Extension storage unavailable', { type, runId: detail.runId });
        return;
      }
      const state = await readState();
      const runId = detail.runId || getCurrentRunId();
      state.sessionId = sessionId;
      state.tabSessionId = tabSessionId;
      state.updatedAt = Date.now();
      state.events = Array.isArray(state.events) ? state.events : [];
      state.errors = Array.isArray(state.errors) ? state.errors : [];
      state.counters = state.counters || {};
      state.syncSummaries = state.syncSummaries || {};
      state.testRuns = state.testRuns || {};
      const entry = { type, at: Date.now(), url: location.href, tabSessionId, runId, ...detail };
      state.events.push(entry);
      state.events = state.events.slice(-MAX_EVENTS);
      state.counters[type] = Number(state.counters[type] || 0) + 1;
      updateSyncSummary(state, type, entry);
      if (isError) {
        state.errors.push(entry);
        state.errors = state.errors.slice(-100);
      }
      cleanupSummaries(state);
      try {
        await chrome.storage.local.set({ [KEY]: state });
      } catch (error) {
        persistWriteFailure(error, { type, runId });
        throw error;
      }
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
  async function migrateSessionEvidence() {
    if (!contextAvailable()) return;
    try {
      const staleItems = JSON.parse(sessionStorage.getItem(STALE_KEY) || '[]');
      sessionStorage.removeItem(STALE_KEY);
      for (const item of staleItems) await record('stale-context-detected', item);
    } catch {}
    try {
      const failures = JSON.parse(sessionStorage.getItem(WRITE_FAILURE_KEY) || '[]');
      sessionStorage.removeItem(WRITE_FAILURE_KEY);
      for (const item of failures) await record('diagnostics-write-failure', item, true);
    } catch {}
  }
  async function mutateState(mutator) {
    writeQueue = writeQueue.then(async () => {
      if (!contextAvailable()) return;
      const state = await readState();
      state.syncSummaries = state.syncSummaries || {};
      state.testRuns = state.testRuns || {};
      await mutator(state);
      cleanupSummaries(state);
      try { await chrome.storage.local.set({ [KEY]: state }); }
      catch (error) { persistWriteFailure(error, { type: 'state-mutation' }); throw error; }
    }).catch(() => {});
    return writeQueue;
  }
  async function initializeState() {
    await mutateState(state => reconcileUnfinishedSyncs(state));
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
    record('sync-lifecycle', {
      lifecycle: event.detail?.state || 'unknown',
      syncId: event.detail?.syncId || null,
      runId: event.detail?.runId || getCurrentRunId()
    });
  });
  window.addEventListener('error', event => {
    const message = String(event?.error?.message || event?.message || 'Unknown window error');
    const filename = event.filename || '';
    const stack = String(event?.error?.stack || '');
    const classification = classifyError(message, filename, stack);
    record('page-error', {
      message,
      filename,
      stack,
      line: event.lineno || 0,
      column: event.colno || 0,
      origin: classification.origin,
      confidence: classification.confidence
    }, true);
  });
  window.addEventListener('unhandledrejection', event => {
    const message = String(event?.reason?.message || event?.reason || 'Unhandled rejection');
    const stack = String(event?.reason?.stack || '');
    const classification = classifyError(message, '', stack);
    record('unhandled-rejection', {
      message,
      stack,
      origin: classification.origin,
      confidence: classification.confidence
    }, true);
  });

  window.addEventListener('dc-fk-runtime-test-run-start', event => {
    const runId = setCurrentRunId(event.detail?.runId);
    mutateState(state => {
      reconcileUnfinishedSyncs(state, 'new-test-run-started');
      state.testRuns[runId] = { runId, tabSessionId, status: 'active', startedAt: Date.now(), updatedAt: Date.now() };
    }).then(() => record('test-run-started', { runId }));
  });
  window.addEventListener('dc-fk-runtime-test-run-reset', event => {
    const previousRunId = getCurrentRunId();
    const runId = setCurrentRunId(event.detail?.runId);
    mutateState(state => {
      reconcileUnfinishedSyncs(state, 'test-run-reset');
      if (state.testRuns[previousRunId]) {
        state.testRuns[previousRunId].status = 'reset';
        state.testRuns[previousRunId].endedAt = Date.now();
        state.testRuns[previousRunId].updatedAt = Date.now();
      }
      state.testRuns[runId] = { runId, tabSessionId, status: 'active', startedAt: Date.now(), updatedAt: Date.now() };
    }).then(() => record('test-run-reset', { runId, previousRunId }));
  });
  window.addEventListener('dc-fk-runtime-test-run-end', () => {
    const runId = getCurrentRunId();
    mutateState(state => {
      reconcileUnfinishedSyncs(state, 'test-run-ended');
      const row = state.testRuns[runId] ||= { runId, tabSessionId, startedAt: Date.now() };
      row.status = 'ended';
      row.endedAt = Date.now();
      row.updatedAt = Date.now();
    }).then(() => record('test-run-ended', { runId }));
  });

  window.addEventListener('dc-fk-runtime-report-request', async event => {
    await writeQueue;
    const state = await readState();
    const requestedRunId = event.detail?.runId || getCurrentRunId();
    const syncRows = Object.values(state.syncSummaries || {}).filter(row => row.runId === requestedRunId);
    const startedRows = syncRows.filter(row => row.started);
    const finishedRows = syncRows.filter(row => row.finished);
    const hasCompletedTestSync = startedRows.length > 0 && finishedRows.length > 0;
    const allStartedSyncsFinished = hasCompletedTestSync && startedRows.every(row => row.finished);
    const noDuplicateRestores = syncRows.every(row => Number(row.restoreCount || 0) <= 1);
    const requiredRestoresComplete = finishedRows.filter(row => row.requiresRestore).every(row => Number(row.restoreCount || 0) === 1);
    const unnecessaryRestoresAbsent = finishedRows.filter(row => !row.requiresRestore).every(row => Number(row.restoreCount || 0) === 0);
    const persistenceFailuresAbsent = syncRows.every(row => !row.persistenceFailure);
    const degradedPersistenceAbsent = syncRows.every(row => !row.persistenceDegraded);
    const runErrors = (state.errors || []).filter(error => error.runId === requestedRunId);
    const confirmedExtensionErrors = runErrors.filter(error => error.origin === 'extension' && error.confidence === 'confirmed');
    const probableExtensionErrors = runErrors.filter(error => error.origin === 'extension' && error.confidence === 'probable');
    const diagnosticsWriteFailures = runErrors.filter(error => error.type === 'diagnostics-write-failure');
    const report = {
      sessionId,
      tabSessionId,
      runId: requestedRunId,
      testRun: state.testRuns?.[requestedRunId] || null,
      generatedAt: Date.now(),
      dashboardOpenCount: (state.events || []).filter(item => item.runId === requestedRunId && item.type === 'dashboard-opened').length,
      syncStarted: startedRows.length,
      syncFinished: finishedRows.length,
      perSync: syncRows,
      hasCompletedTestSync,
      allStartedSyncsFinished,
      noDuplicateRestores,
      requiredRestoresComplete,
      unnecessaryRestoresAbsent,
      persistenceFailuresAbsent,
      degradedPersistenceAbsent,
      diagnosticsWriteFailuresAbsent: diagnosticsWriteFailures.length === 0,
      exactlyOneRestorePerRequiredSync: hasCompletedTestSync && allStartedSyncsFinished && noDuplicateRestores && requiredRestoresComplete && unnecessaryRestoresAbsent && persistenceFailuresAbsent,
      certificationPassed: hasCompletedTestSync && allStartedSyncsFinished && noDuplicateRestores && requiredRestoresComplete && unnecessaryRestoresAbsent && persistenceFailuresAbsent && degradedPersistenceAbsent && confirmedExtensionErrors.length === 0 && diagnosticsWriteFailures.length === 0,
      totalConsoleErrorCount: runErrors.length,
      confirmedExtensionErrorCount: confirmedExtensionErrors.length,
      probableExtensionErrorCount: probableExtensionErrors.length,
      errorsByOrigin: {
        confirmedExtension: confirmedExtensionErrors.length,
        probableExtension: probableExtensionErrors.length,
        sellerPage: runErrors.filter(error => error.origin === 'seller-page').length,
        unknown: runErrors.filter(error => error.origin === 'unknown').length
      },
      errors: runErrors,
      events: (state.events || []).filter(item => item.runId === requestedRunId)
    };
    window.dispatchEvent(new CustomEvent('dc-fk-runtime-report', { detail: report }));
  });

  window.addEventListener('dc-extension-context-invalid', () => confirmClosed('context-invalid'));

  initializeState().then(async () => {
    await migrateSessionEvidence();
    const runId = getCurrentRunId();
    await mutateState(state => {
      state.testRuns[runId] ||= { runId, tabSessionId, status: 'active', startedAt: Date.now(), updatedAt: Date.now() };
    });
    record('diagnostics-loaded', { version: '3.5.2', runId });
  });
})();