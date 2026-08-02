'use strict';
(() => {
  const STALE_KEY = 'dc_fk_stale_context_evidence_v349';
  function extensionContextAvailable() {
    try { return Boolean(globalThis.chrome?.runtime?.id && typeof chrome.runtime.getURL === 'function'); }
    catch { return false; }
  }
  function persistStaleEvidence(reason) {
    try {
      const previous = JSON.parse(sessionStorage.getItem(STALE_KEY) || '[]');
      const now = Date.now();
      const last = previous[previous.length - 1];
      if (last && last.reason === reason && now - Number(last.at || 0) < 1500) return;
      previous.push({ type: 'stale-context-detected', reason, at: now, url: location.href });
      sessionStorage.setItem(STALE_KEY, JSON.stringify(previous.slice(-20)));
    } catch {}
  }
  function emitDiagnostic(type, detail = {}) {
    try { window.dispatchEvent(new CustomEvent('dc-fk-runtime-diagnostic', { detail: { type, at: Date.now(), ...detail } })); }
    catch {}
  }
  function showReloadNotice(event) {
    const reason = event?.detail?.reason || 'extension-context-invalid';
    if (!extensionContextAvailable()) persistStaleEvidence(reason);
    let notice = document.getElementById('dc-extension-reload-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'dc-extension-reload-notice';
      notice.setAttribute('role', 'alert');
      Object.assign(notice.style, {
        position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647',
        maxWidth: '360px', padding: '14px 16px', borderRadius: '12px',
        background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412',
        boxShadow: '0 12px 32px rgba(15,23,42,.22)',
        font: '600 13px/1.45 system-ui,Segoe UI,Arial,sans-serif'
      });
      notice.innerHTML = '<b style="display:block;margin-bottom:4px">Extension updated</b>Reload this Flipkart Seller Hub tab once, then open Ecom Insight again.';
      document.documentElement.appendChild(notice);
    }
    clearTimeout(notice._dcTimer);
    notice._dcTimer = setTimeout(() => notice.remove(), 9000);
    emitDiagnostic('reload-notice-shown', { reason });
  }
  function guardClick(event) {
    const trigger = event.target?.closest?.('#dc-flipkart-analytics-launcher, #dc-flipkart-analytics-dock button');
    if (!trigger || extensionContextAvailable()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showReloadNotice({ detail: { reason: 'guarded-click' } });
  }
  window.addEventListener('click', guardClick, true);
  window.addEventListener('dc-extension-context-invalid', showReloadNotice);
  window.addEventListener('error', event => {
    const message = String(event?.error?.message || event?.message || '');
    if (!/extension context invalidated|cannot access a chrome extension|chrome\.runtime/i.test(message)) return;
    event.preventDefault();
    showReloadNotice({ detail: { reason: message } });
  }, true);
  window.addEventListener('unhandledrejection', event => {
    const message = String(event?.reason?.message || event?.reason || '');
    if (!/extension context invalidated|cannot access a chrome extension|chrome\.runtime/i.test(message)) return;
    event.preventDefault();
    showReloadNotice({ detail: { reason: message } });
  });
})();