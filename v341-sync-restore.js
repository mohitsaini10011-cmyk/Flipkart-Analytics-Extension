'use strict';
(() => {
  const STATE_KEY = 'dc_fk_sync_restore_v341';
  const OVERLAY_ID = 'dc-flipkart-analytics-overlay';
  let monitorTimer = null;
  let sawRunning = false;
  let cancelRequested = false;

  const now = () => Date.now();
  const currentFrame = () => document.querySelector(`#${OVERLAY_ID} iframe`);

  function readState() {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.originalUrl || Number(parsed.expiresAt || 0) < now()) {
        sessionStorage.removeItem(STATE_KEY);
        return null;
      }
      return parsed;
    } catch {
      sessionStorage.removeItem(STATE_KEY);
      return null;
    }
  }

  function writeState(state) {
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  function clearState() {
    try { sessionStorage.removeItem(STATE_KEY); } catch {}
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = null;
    sawRunning = false;
    cancelRequested = false;
  }

  function sameUrl(a, b) {
    try {
      const first = new URL(a, location.href);
      const second = new URL(b, location.href);
      return first.href === second.href;
    } catch {
      return String(a) === String(b);
    }
  }

  function notifyFrame(payload) {
    const frame = currentFrame();
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage({
        source: 'DC_FK_HOST',
        type: 'SYNC_RESTORE_STATUS',
        payload
      }, '*');
    } catch {}
  }

  function restoreOriginal(reason) {
    const state = readState();
    if (!state) return clearState();
    if (sameUrl(location.href, state.originalUrl)) {
      notifyFrame({ restored: true, reason, originalUrl: state.originalUrl });
      return clearState();
    }

    writeState({ ...state, restoring: true, restoreReason: reason, restoreStartedAt: now() });
    notifyFrame({ restored: false, restoring: true, reason, originalUrl: state.originalUrl });

    try {
      location.assign(state.originalUrl);
    } catch {
      try { location.href = state.originalUrl; } catch {}
    }
  }

  function startMonitor() {
    if (monitorTimer) return;
    monitorTimer = setInterval(() => {
      const state = readState();
      if (!state) return clearState();

      const running = Boolean(window.__DC_FK_AUTO_SYNCING__);
      if (running) {
        sawRunning = true;
        writeState({ ...state, sawRunning: true, lastRunningAt: now() });
        return;
      }

      const persistedSawRunning = Boolean(state.sawRunning);
      const finished = sawRunning || persistedSawRunning;
      if (cancelRequested && finished) return restoreOriginal('cancelled');
      if (finished && now() - Number(state.startedAt || 0) > 1200) return restoreOriginal('completed-or-error');

      if (Number(state.expiresAt || 0) - now() < 5000) restoreOriginal('timeout');
    }, 300);
  }

  window.addEventListener('message', event => {
    const frame = currentFrame();
    if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
    if (event.data?.source !== 'DC_FK_DASHBOARD') return;

    if (event.data?.type === 'AUTO_SYNC_ALL') {
      const existing = readState();
      const originalUrl = existing?.restoring ? existing.originalUrl : location.href;
      writeState({
        originalUrl,
        startedAt: now(),
        expiresAt: now() + 10 * 60 * 1000,
        sawRunning: false,
        restoring: false
      });
      sawRunning = false;
      cancelRequested = false;
      startMonitor();
    }

    if (event.data?.type === 'CANCEL_AUTO_SYNC') {
      cancelRequested = true;
      const state = readState();
      if (state) writeState({ ...state, cancelRequested: true });
      startMonitor();
    }
  }, true);

  const pending = readState();
  if (pending?.restoring) {
    if (sameUrl(location.href, pending.originalUrl)) clearState();
    else setTimeout(() => restoreOriginal('resume-restore'), 250);
  } else if (pending) {
    cancelRequested = Boolean(pending.cancelRequested);
    sawRunning = Boolean(pending.sawRunning);
    startMonitor();
  }
})();