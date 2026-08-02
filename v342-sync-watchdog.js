'use strict';
(() => {
  const STATE_KEY = 'dc_fk_sync_watchdog_v342';
  const SESSION_KEY = 'dc_fk_sync_watchdog_session_v342';
  const MAX_SYNC_MS = 15 * 60 * 1000;
  const STALL_MS = 2 * 60 * 1000;
  let state = null;
  let lastFingerprint = '';
  let lastChangeAt = Date.now();

  function validSellerUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return /(^|\.)seller\.flipkart\.com$/i.test(parsed.hostname) ? parsed.href : '';
    } catch { return ''; }
  }

  function saveSession() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch {}
    chrome.storage.local.set({ [STATE_KEY]: state }).catch(() => {});
  }

  function clearSession(result) {
    const completed = state ? { ...state, active: false, result, finishedAt: Date.now(), finalUrl: location.href } : null;
    state = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    if (completed) chrome.storage.local.set({ [STATE_KEY]: completed }).catch(() => {});
  }

  function restoreOriginal(reason) {
    if (!state) return;
    const original = validSellerUrl(state.originalUrl);
    clearSession(reason);
    if (original && location.href !== original) location.assign(original);
  }

  function beginSync() {
    if (state?.active) return;
    state = {
      active: true,
      id: crypto.randomUUID(),
      originalUrl: location.href,
      startedAt: Date.now(),
      lastProgressAt: Date.now(),
      visitedUrls: [location.href],
      navigationCount: 0,
      stallCount: 0
    };
    lastFingerprint = '';
    lastChangeAt = Date.now();
    saveSession();
  }

  function markNavigation() {
    if (!state?.active) return;
    state.lastProgressAt = Date.now();
    if (state.visitedUrls[state.visitedUrls.length - 1] !== location.href) {
      state.visitedUrls.push(location.href);
      state.visitedUrls = state.visitedUrls.slice(-30);
      state.navigationCount++;
    }
    saveSession();
  }

  function fingerprint() {
    const grids = [...document.querySelectorAll('table,[role="grid"]')];
    const rows = grids.reduce((total, grid) => total + grid.querySelectorAll('tbody tr,[role="row"]').length, 0);
    return `${location.href}|${document.title}|${rows}|${document.body?.innerText?.length || 0}`;
  }

  function heartbeat() {
    if (!state?.active) return;
    const now = Date.now();
    const current = fingerprint();
    if (current !== lastFingerprint) {
      lastFingerprint = current;
      lastChangeAt = now;
      state.lastProgressAt = now;
      saveSession();
    } else if (now - lastChangeAt > STALL_MS) {
      state.stallCount++;
      state.lastStallAt = now;
      lastChangeAt = now;
      saveSession();
    }
    if (now - state.startedAt > MAX_SYNC_MS) restoreOriginal('timeout-restored');
  }

  function recoverSession() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (!stored?.active) return;
      if (Date.now() - Number(stored.startedAt || 0) > MAX_SYNC_MS) {
        state = stored;
        restoreOriginal('expired-session-restored');
        return;
      }
      state = stored;
      markNavigation();
    } catch {}
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (data?.source !== 'DC_FK_DASHBOARD') return;
    if (data.type === 'AUTO_SYNC_ALL') beginSync();
    if (data.type === 'CANCEL_AUTO_SYNC' && state?.active) setTimeout(() => restoreOriginal('cancelled-restored'), 800);
  }, true);

  const originalPush = history.pushState.bind(history);
  history.pushState = function(...args) {
    const result = originalPush(...args);
    queueMicrotask(markNavigation);
    return result;
  };
  const originalReplace = history.replaceState.bind(history);
  history.replaceState = function(...args) {
    const result = originalReplace(...args);
    queueMicrotask(markNavigation);
    return result;
  };
  addEventListener('popstate', markNavigation);
  addEventListener('hashchange', markNavigation);
  addEventListener('pagehide', saveSession);

  recoverSession();
  setInterval(heartbeat, 5000);
})();