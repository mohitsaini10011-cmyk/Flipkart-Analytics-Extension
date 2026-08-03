'use strict';
(() => {
  const STATE_KEY = 'dc_fk_sync_controller_v343';
  const TAB_SESSION_KEY = 'dc_fk_tab_session_v352';
  const TEST_RUN_KEY = 'dc_fk_runtime_test_run_v352';
  const OVERLAY_ID = 'dc-flipkart-analytics-overlay';
  const MAX_SYNC_MS = 15 * 60 * 1000;
  const STALL_MS = 2 * 60 * 1000;
  let state = null;
  let heartbeatTimer = null;
  let lastFingerprint = '';
  let lastChangeAt = Date.now();
  let finishing = false;
  let restoreIssued = false;

  const frame = () => document.querySelector(`#${OVERLAY_ID} iframe`);
  function extensionContextAvailable() {
    try { return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local); }
    catch { return false; }
  }
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
  function getTestRunId() { return getOrCreateSessionValue(TEST_RUN_KEY); }
  const validUrl = value => {
    try {
      const url = new URL(value, location.href);
      return /(^|\.)seller\.flipkart\.com$/i.test(url.hostname) ? url.href : '';
    } catch { return ''; }
  };
  const sameUrl = (a, b) => validUrl(a) === validUrl(b);

  async function persistRecord(record = state, keepSessionFallback = true) {
    let sessionSaved = false;
    let chromeSaved = false;
    try {
      if (record) {
        sessionStorage.setItem(STATE_KEY, JSON.stringify(record));
        sessionSaved = true;
      } else {
        sessionStorage.removeItem(STATE_KEY);
        sessionSaved = true;
      }
    } catch {}
    if (extensionContextAvailable()) {
      try {
        await chrome.storage.local.set({ [STATE_KEY]: record });
        chromeSaved = true;
      } catch {}
    }
    if (chromeSaved && !keepSessionFallback && !record?.active) {
      try { sessionStorage.removeItem(STATE_KEY); } catch {}
    }
    return {
      ok: chromeSaved || sessionSaved,
      chromeSaved,
      sessionSaved,
      degraded: sessionSaved && !chromeSaved
    };
  }

  function stopTimer() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function emitDiagnostic(type, detail = {}) {
    try {
      const activeRunId = detail.runId || state?.runId || getTestRunId();
      window.dispatchEvent(new CustomEvent('dc-fk-runtime-diagnostic', {
        detail: {
          type,
          at: Date.now(),
          tabSessionId,
          runId: activeRunId,
          syncId: state?.id || detail.syncId || null,
          ...detail
        }
      }));
    } catch {}
  }

  async function finish(result, restore = true) {
    if (!state || finishing) return;
    finishing = true;
    const activeState = state;
    const syncId = activeState.id;
    const activeRunId = activeState.runId || getTestRunId();
    const originalUrl = validUrl(activeState.originalUrl);
    const requiresRestore = Boolean(restore && originalUrl && !sameUrl(location.href, originalUrl));
    const completed = {
      ...activeState,
      tabSessionId,
      runId: activeRunId,
      active: false,
      result,
      finishedAt: Date.now(),
      finalUrl: location.href,
      requiresRestore
    };

    if (requiresRestore && !restoreIssued) {
      restoreIssued = true;
      completed.restoreIssuedAt = Date.now();
      completed.restoreTarget = originalUrl;
    }

    state = null;
    stopTimer();
    const persisted = await persistRecord(completed, true);
    completed.persistence = persisted;
    emitDiagnostic('sync-finished', {
      runId: activeRunId,
      syncId,
      result,
      originalUrl,
      finalUrl: location.href,
      requiresRestore,
      restoreIssuedAt: completed.restoreIssuedAt || null,
      persistence: persisted,
      persistenceDegraded: persisted.degraded
    });

    if (completed.restoreIssuedAt && persisted.ok) {
      emitDiagnostic('restore-issued', {
        runId: activeRunId,
        syncId,
        result,
        originalUrl,
        fromUrl: location.href,
        restoreIssuedAt: completed.restoreIssuedAt,
        persistence: persisted,
        persistenceDegraded: persisted.degraded
      });
      location.assign(originalUrl);
      return;
    }
    if (completed.restoreIssuedAt && !persisted.ok) {
      restoreIssued = false;
      emitDiagnostic('restore-blocked-persistence-failed', { runId: activeRunId, syncId, originalUrl });
    }
    finishing = false;
  }

  function fingerprint() {
    const grids = [...document.querySelectorAll('table,[role="grid"]')];
    const rows = grids.reduce((sum, grid) => sum + grid.querySelectorAll('tbody tr,[role="row"]').length, 0);
    return `${location.href}|${document.title}|${rows}|${document.body?.innerText?.length || 0}`;
  }

  function heartbeat() {
    if (!extensionContextAvailable()) {
      stopTimer();
      const syncId = state?.id || null;
      const runId = state?.runId || getTestRunId();
      state = null;
      emitDiagnostic('context-invalid-heartbeat-stop', { runId, syncId });
      return;
    }
    if (!state?.active) return;
    const now = Date.now();
    const current = fingerprint();
    if (current !== lastFingerprint) {
      lastFingerprint = current;
      lastChangeAt = now;
      state.lastProgressAt = now;
      persistRecord(state);
    } else if (now - lastChangeAt >= STALL_MS) {
      state.stallCount = Number(state.stallCount || 0) + 1;
      state.lastStallAt = now;
      lastChangeAt = now;
      persistRecord(state);
      emitDiagnostic('sync-stall', { runId: state.runId, syncId: state.id, stallCount: state.stallCount, elapsedMs: now - state.startedAt });
      try {
        frame()?.contentWindow?.postMessage({
          source: 'DC_FK_HOST',
          type: 'SYNC_WATCHDOG_STALL',
          payload: { stallCount: state.stallCount, elapsedMs: now - state.startedAt }
        }, '*');
      } catch {}
    }
    if (now - state.startedAt >= MAX_SYNC_MS) finish('timeout', true);
  }

  function startTimer() {
    stopTimer();
    if (!extensionContextAvailable()) return;
    heartbeatTimer = setInterval(heartbeat, 5000);
  }

  function begin() {
    if (!extensionContextAvailable() || state?.active) return;
    const runId = getTestRunId();
    restoreIssued = false;
    finishing = false;
    state = {
      active: true,
      id: crypto.randomUUID(),
      tabSessionId,
      runId,
      originalUrl: location.href,
      startedAt: Date.now(),
      lastProgressAt: Date.now(),
      visitedUrls: [location.href],
      navigationCount: 0,
      stallCount: 0
    };
    lastFingerprint = fingerprint();
    lastChangeAt = Date.now();
    persistRecord(state);
    startTimer();
    emitDiagnostic('sync-started', { runId, syncId: state.id, originalUrl: state.originalUrl });
  }

  function markNavigation() {
    if (!state?.active) return;
    state.lastProgressAt = Date.now();
    if (state.visitedUrls[state.visitedUrls.length - 1] !== location.href) {
      state.visitedUrls.push(location.href);
      state.visitedUrls = state.visitedUrls.slice(-30);
      state.navigationCount++;
      emitDiagnostic('sync-navigation', { runId: state.runId, syncId: state.id, url: location.href, navigationCount: state.navigationCount });
    }
    persistRecord(state);
  }

  function trustedDashboardMessage(event) {
    const dashboard = frame();
    if (!dashboard?.contentWindow || event.source !== dashboard.contentWindow) return false;
    const data = event.data || {};
    if (data.source !== 'DC_FK_DASHBOARD') return false;
    const expected = new URL(dashboard.src, location.href).searchParams.get('token') || '';
    return !expected || data.token === expected;
  }

  window.addEventListener('message', event => {
    if (!trustedDashboardMessage(event)) return;
    const type = event.data?.type;
    if (type === 'AUTO_SYNC_ALL') begin();
    if (type === 'CANCEL_AUTO_SYNC') emitDiagnostic('cancel-requested', { runId: state?.runId || getTestRunId(), syncId: state?.id || null });
  }, true);

  window.addEventListener('dc-fk-sync-lifecycle', event => {
    const lifecycle = event.detail?.state;
    if (lifecycle === 'done') finish('completed', true);
    else if (lifecycle === 'error') finish('error', true);
    else if (lifecycle === 'cancelled') finish('cancelled', true);
  });

  window.addEventListener('dc-extension-context-invalid', () => {
    const syncId = state?.id || null;
    const runId = state?.runId || getTestRunId();
    stopTimer();
    state = null;
    finishing = false;
    emitDiagnostic('context-invalid-cleanup', { runId, syncId });
  });

  window.addEventListener('dc-fk-runtime-test-run-start', event => {
    if (state?.active) {
      emitDiagnostic('test-run-control-rejected', { action: 'start', reason: 'sync-active', runId: state.runId, syncId: state.id });
      return;
    }
    const nextRunId = event.detail?.runId || crypto.randomUUID();
    try { sessionStorage.setItem(TEST_RUN_KEY, nextRunId); } catch {}
    emitDiagnostic('test-run-started', { runId: nextRunId });
  });
  window.addEventListener('dc-fk-runtime-test-run-reset', event => {
    if (state?.active) {
      emitDiagnostic('test-run-control-rejected', { action: 'reset', reason: 'sync-active', runId: state.runId, syncId: state.id });
      return;
    }
    const nextRunId = event.detail?.runId || crypto.randomUUID();
    try { sessionStorage.setItem(TEST_RUN_KEY, nextRunId); } catch {}
    emitDiagnostic('test-run-reset', { runId: nextRunId });
  });
  window.addEventListener('dc-fk-runtime-test-run-end', () => {
    emitDiagnostic('test-run-ended', { runId: state?.runId || getTestRunId(), syncId: state?.id || null, syncActive: Boolean(state?.active) });
  });

  const push = history.pushState.bind(history);
  history.pushState = function(...args) { const result = push(...args); queueMicrotask(markNavigation); return result; };
  const replace = history.replaceState.bind(history);
  history.replaceState = function(...args) { const result = replace(...args); queueMicrotask(markNavigation); return result; };
  addEventListener('popstate', markNavigation);
  addEventListener('hashchange', markNavigation);
  addEventListener('pagehide', () => persistRecord(state));

  async function recoverState() {
    let recovered = null;
    try { recovered = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch {}
    if (!recovered) return;

    if (recovered.active && extensionContextAvailable()) {
      state = { ...recovered, tabSessionId: recovered.tabSessionId || tabSessionId, runId: recovered.runId || getTestRunId() };
      restoreIssued = Boolean(recovered.restoreIssuedAt);
      if (Date.now() - Number(state.startedAt || 0) >= MAX_SYNC_MS) await finish('expired', true);
      else {
        lastFingerprint = fingerprint();
        lastChangeAt = Date.now();
        startTimer();
        markNavigation();
      }
      return;
    }

    if (recovered.active === false) {
      let chromeCopy = null;
      if (extensionContextAvailable()) {
        try { chromeCopy = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || null; } catch {}
        if (!chromeCopy || chromeCopy.id !== recovered.id || !chromeCopy.finishedAt) {
          try {
            await chrome.storage.local.set({ [STATE_KEY]: recovered });
            chromeCopy = recovered;
          } catch {}
        }
      }
      if (chromeCopy && chromeCopy.id === recovered.id && chromeCopy.finishedAt) {
        try { sessionStorage.removeItem(STATE_KEY); } catch {}
        emitDiagnostic('completed-fallback-cleaned', { runId: recovered.runId || getTestRunId(), syncId: recovered.id });
      } else {
        emitDiagnostic('completed-fallback-retained', { runId: recovered.runId || getTestRunId(), syncId: recovered.id });
      }
    }
  }

  recoverState();
})();