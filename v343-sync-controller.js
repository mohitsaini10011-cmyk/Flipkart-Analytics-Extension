'use strict';
(() => {
  const STATE_KEY = 'dc_fk_sync_controller_v343';
  const OVERLAY_ID = 'dc-flipkart-analytics-overlay';
  const MAX_SYNC_MS = 15 * 60 * 1000;
  const STALL_MS = 2 * 60 * 1000;
  let state = null;
  let heartbeatTimer = null;
  let lastFingerprint = '';
  let lastChangeAt = Date.now();

  const frame = () => document.querySelector(`#${OVERLAY_ID} iframe`);
  const validUrl = value => {
    try {
      const url = new URL(value, location.href);
      return /(^|\.)seller\.flipkart\.com$/i.test(url.hostname) ? url.href : '';
    } catch { return ''; }
  };
  const sameUrl = (a, b) => validUrl(a) === validUrl(b);

  async function persist(completed = null) {
    try {
      if (state) sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
      else sessionStorage.removeItem(STATE_KEY);
    } catch {}
    try {
      await chrome.storage.local.set({ [STATE_KEY]: completed || state });
    } catch {}
  }

  function stopTimer() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  async function finish(result, restore = true) {
    if (!state) return;
    const completed = { ...state, active: false, result, finishedAt: Date.now(), finalUrl: location.href };
    const originalUrl = validUrl(state.originalUrl);
    state = null;
    stopTimer();
    await persist(completed);
    if (restore && originalUrl && !sameUrl(location.href, originalUrl)) location.assign(originalUrl);
  }

  function fingerprint() {
    const grids = [...document.querySelectorAll('table,[role="grid"]')];
    const rows = grids.reduce((sum, grid) => sum + grid.querySelectorAll('tbody tr,[role="row"]').length, 0);
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
      persist();
    } else if (now - lastChangeAt >= STALL_MS) {
      state.stallCount = Number(state.stallCount || 0) + 1;
      state.lastStallAt = now;
      lastChangeAt = now;
      persist();
      try {
        frame()?.contentWindow?.postMessage({ source: 'DC_FK_HOST', type: 'SYNC_WATCHDOG_STALL', payload: { stallCount: state.stallCount, elapsedMs: now - state.startedAt } }, '*');
      } catch {}
    }
    if (now - state.startedAt >= MAX_SYNC_MS) finish('timeout', true);
  }

  function startTimer() {
    stopTimer();
    heartbeatTimer = setInterval(heartbeat, 5000);
  }

  function begin() {
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
    lastFingerprint = fingerprint();
    lastChangeAt = Date.now();
    persist();
    startTimer();
  }

  function markNavigation() {
    if (!state?.active) return;
    state.lastProgressAt = Date.now();
    if (state.visitedUrls[state.visitedUrls.length - 1] !== location.href) {
      state.visitedUrls.push(location.href);
      state.visitedUrls = state.visitedUrls.slice(-30);
      state.navigationCount++;
    }
    persist();
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
    if (['AUTO_SYNC_DONE','SYNC_DONE','AUTO_SYNC_COMPLETE'].includes(type)) finish('completed', true);
    if (['AUTO_SYNC_ERROR','SYNC_ERROR'].includes(type)) finish('error', true);
    if (type === 'CANCEL_AUTO_SYNC') finish('cancelled', true);
  }, true);

  const push = history.pushState.bind(history);
  history.pushState = function(...args) { const result = push(...args); queueMicrotask(markNavigation); return result; };
  const replace = history.replaceState.bind(history);
  history.replaceState = function(...args) { const result = replace(...args); queueMicrotask(markNavigation); return result; };
  addEventListener('popstate', markNavigation);
  addEventListener('hashchange', markNavigation);
  addEventListener('pagehide', () => persist());

  try {
    const recovered = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    if (recovered?.active) {
      state = recovered;
      if (Date.now() - Number(state.startedAt || 0) >= MAX_SYNC_MS) finish('expired', true);
      else { lastFingerprint = fingerprint(); lastChangeAt = Date.now(); startTimer(); markNavigation(); }
    }
  } catch { try { sessionStorage.removeItem(STATE_KEY); } catch {} }
})();