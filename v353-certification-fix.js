'use strict';
(() => {
  const CONTROLLER_STATE_KEY = 'dc_fk_sync_controller_v343';
  const TEST_RUN_KEY = 'dc_fk_runtime_test_run_v352';
  const DIAGNOSTICS_KEY = 'dc_fk_runtime_diagnostics_v352';
  const OVERLAY_ID = 'dc-flipkart-analytics-overlay';
  const RAW_EVENTS = [
    'dc-fk-runtime-test-run-start',
    'dc-fk-runtime-test-run-reset',
    'dc-fk-runtime-test-run-end'
  ];

  function extensionContextAvailable() {
    try { return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local); }
    catch { return false; }
  }

  function currentRunId() {
    try {
      let value = sessionStorage.getItem(TEST_RUN_KEY);
      if (!value) {
        value = crypto.randomUUID();
        sessionStorage.setItem(TEST_RUN_KEY, value);
      }
      return value;
    } catch { return crypto.randomUUID(); }
  }

  function activeControllerState() {
    try {
      const value = JSON.parse(sessionStorage.getItem(CONTROLLER_STATE_KEY) || 'null');
      return value?.active ? value : null;
    } catch { return null; }
  }

  function dashboardFrame() {
    return document.querySelector(`#${OVERLAY_ID} iframe`);
  }

  function trustedDashboardMessage(event) {
    const frame = dashboardFrame();
    if (!frame?.contentWindow || event.source !== frame.contentWindow) return false;
    const data = event.data || {};
    if (data.source !== 'DC_FK_DASHBOARD') return false;
    let expected = '';
    try { expected = new URL(frame.src, location.href).searchParams.get('token') || ''; }
    catch { return false; }
    return Boolean(expected && data.token === expected);
  }

  function emitDiagnostic(type, detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent('dc-fk-runtime-diagnostic', {
        detail: { type, at: Date.now(), runId: detail.runId || currentRunId(), ...detail }
      }));
    } catch {}
  }

  function setRunId(value) {
    const runId = value || crypto.randomUUID();
    try { sessionStorage.setItem(TEST_RUN_KEY, runId); } catch {}
    return runId;
  }

  function handleControl(action, requestedRunId) {
    const active = activeControllerState();
    if (active) {
      emitDiagnostic('test-run-control-rejected', {
        action,
        reason: 'sync-active',
        runId: active.runId || currentRunId(),
        syncId: active.id || null
      });
      return;
    }

    if (action === 'start') {
      const runId = setRunId(requestedRunId);
      emitDiagnostic('test-run-started', { runId, accepted: true, owner: 'controller' });
      return;
    }

    if (action === 'reset') {
      const previousRunId = currentRunId();
      const runId = setRunId(requestedRunId);
      emitDiagnostic('test-run-reset', { runId, previousRunId, accepted: true, owner: 'controller' });
      return;
    }

    if (action === 'end') {
      const runId = currentRunId();
      emitDiagnostic('test-run-ended', { runId, accepted: true, owner: 'controller', syncActive: false });
    }
  }

  // Block legacy page-level controls before the old controller/diagnostics listeners see them.
  for (const name of RAW_EVENTS) {
    window.addEventListener(name, event => {
      event.stopImmediatePropagation();
      emitDiagnostic('test-run-control-rejected', {
        action: name.endsWith('start') ? 'start' : name.endsWith('reset') ? 'reset' : 'end',
        reason: 'untrusted-page-event',
        runId: currentRunId()
      });
    }, true);
  }

  // Trusted controls must come from the token-bearing embedded dashboard frame.
  window.addEventListener('message', event => {
    if (!trustedDashboardMessage(event)) return;
    const type = event.data?.type;
    if (type === 'RUNTIME_TEST_RUN_START') handleControl('start', event.data?.payload?.runId);
    else if (type === 'RUNTIME_TEST_RUN_RESET') handleControl('reset', event.data?.payload?.runId);
    else if (type === 'RUNTIME_TEST_RUN_END') handleControl('end');
  }, true);

  function strictErrorClassification(error) {
    const message = String(error?.message || '');
    const filename = String(error?.filename || '');
    const stack = String(error?.stack || '');
    const hay = `${filename}\n${stack}\n${message}`;
    let extensionBase = '';
    try { extensionBase = chrome.runtime.getURL(''); } catch {}
    if (extensionBase && (filename.startsWith(extensionBase) || stack.includes(extensionBase))) {
      return { origin: 'extension', confidence: 'confirmed' };
    }
    if (/v343-sync-controller\.js|v346-context-guard\.js|v348-runtime-diagnostics\.js|v353-certification-fix\.js|dc-fk-|dc_fk_|Ecom Insight/i.test(hay)) {
      return { origin: 'extension', confidence: 'probable' };
    }
    if (/seller\.flipkart\.com|flipkart/i.test(hay)) {
      return { origin: 'seller-page', confidence: 'probable' };
    }
    return { origin: 'unknown', confidence: 'unknown' };
  }

  async function buildStrictReport(requestedRunId) {
    const runId = requestedRunId || currentRunId();
    let state = { events: [], errors: [], syncSummaries: {}, testRuns: {} };
    if (extensionContextAvailable()) {
      try { state = (await chrome.storage.local.get(DIAGNOSTICS_KEY))[DIAGNOSTICS_KEY] || state; }
      catch {}
    }
    const syncRows = Object.values(state.syncSummaries || {}).filter(row => row.runId === runId);
    const startedRows = syncRows.filter(row => row.started);
    const finishedRows = syncRows.filter(row => row.finished);
    const hasCompletedTestSync = startedRows.length > 0 && finishedRows.length > 0;
    const allStartedSyncsFinished = hasCompletedTestSync && startedRows.every(row => row.finished);
    const noDuplicateRestores = syncRows.every(row => Number(row.restoreCount || 0) <= 1);
    const requiredRestoresComplete = finishedRows.filter(row => row.requiresRestore).every(row => Number(row.restoreCount || 0) === 1);
    const unnecessaryRestoresAbsent = finishedRows.filter(row => !row.requiresRestore).every(row => Number(row.restoreCount || 0) === 0);
    const persistenceFailuresAbsent = syncRows.every(row => !row.persistenceFailure);
    const degradedPersistenceAbsent = syncRows.every(row => !row.persistenceDegraded);
    const runErrors = (state.errors || []).filter(error => error.runId === runId).map(error => ({
      ...error,
      ...strictErrorClassification(error)
    }));
    const confirmedExtensionErrors = runErrors.filter(error => error.origin === 'extension' && error.confidence === 'confirmed');
    const probableExtensionErrors = runErrors.filter(error => error.origin === 'extension' && error.confidence === 'probable');
    const testRun = state.testRuns?.[runId] || null;
    const certificationPassed = Boolean(
      hasCompletedTestSync &&
      allStartedSyncsFinished &&
      noDuplicateRestores &&
      requiredRestoresComplete &&
      unnecessaryRestoresAbsent &&
      persistenceFailuresAbsent &&
      degradedPersistenceAbsent &&
      confirmedExtensionErrors.length === 0
    );
    return {
      runId,
      generatedAt: Date.now(),
      testRun,
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
      confirmedExtensionErrorCount: confirmedExtensionErrors.length,
      probableExtensionErrorCount: probableExtensionErrors.length,
      errors: runErrors,
      events: (state.events || []).filter(event => event.runId === runId),
      certificationPassed,
      reportVersion: '3.5.3-strict'
    };
  }

  // Replace the legacy report calculation with strict current-extension attribution.
  window.addEventListener('dc-fk-runtime-report-request', event => {
    event.stopImmediatePropagation();
    buildStrictReport(event.detail?.runId).then(report => {
      window.dispatchEvent(new CustomEvent('dc-fk-runtime-report', { detail: report }));
    });
  }, true);
})();
