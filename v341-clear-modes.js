'use strict';
(() => {
  const CAPTURE_KEY = 'dc_fk_capture_control_v34';

  async function pauseCaptureForClear() {
    const stored = await chrome.storage.local.get(CAPTURE_KEY);
    const current = stored[CAPTURE_KEY] || {};
    const control = {
      generation: Math.max(1, Number(current.generation) || 1) + 1,
      paused: true,
      clearTimestamp: Date.now(),
      activeSyncJobId: null
    };
    await chrome.storage.local.set({ [CAPTURE_KEY]: control });
    try {
      window.parent.postMessage({ source: 'DC_FK_DASHBOARD', type: 'CLEAR_DATA_GENERATION', payload: { generation: control.generation, clearTimestamp: control.clearTimestamp }, token: CHANNEL_TOKEN }, '*');
    } catch {}
    return control;
  }

  function resetArrays(mode) {
    if (mode === 'orders') { rows = []; return; }
    if (mode === 'orders_returns') { rows = []; unmatchedReturns = []; return; }
    if (mode === 'orders_financial') {
      rows = []; financialLedger = []; unmatchedFinancials = [];
      if (typeof manualReviewFinancials !== 'undefined') manualReviewFinancials = [];
      return;
    }
    if (mode === 'all') {
      rows = []; inventoryRows = []; financialLedger = []; unmatchedReturns = []; unmatchedFinancials = [];
      if (typeof manualReviewFinancials !== 'undefined') manualReviewFinancials = [];
      syncHistory = []; lastLiveSync = null; skuCosts = {};
    }
  }

  async function runClear(mode, label) {
    const warning = mode === 'orders'
      ? 'Orders clear honge. Existing returns aur financial ledger preserve rahenge.'
      : mode === 'orders_returns'
        ? 'Orders aur return/RTO records clear honge. Financial ledger preserve rahega.'
        : mode === 'orders_financial'
          ? 'Orders, settlements, payments aur unmatched financial records clear honge.'
          : 'Is seller ka orders, returns, inventory, financial ledger, costs aur sync history sab clear hoga.';
    if (!confirm(`${label}?\n\n${warning}\n\nCapture Sync Now tak paused rahega.`)) return;
    const buttons = document.querySelectorAll('[data-clear-mode], #resetExtension');
    buttons.forEach(button => { button.disabled = true; });
    try {
      await pauseCaptureForClear();
      resetArrays(mode);
      if (typeof save === 'function') await save();
      if (typeof render === 'function') render();
      if (typeof show === 'function') show(`${label} complete. Sync Now se fresh capture start karein.`);
    } catch (error) {
      console.error('Clear mode failed', error);
      if (typeof show === 'function') show(`Clear failed: ${error?.message || error}`, true);
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function makeButton(id, label, mode) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.className = 'danger';
    button.dataset.clearMode = mode;
    button.textContent = label;
    button.addEventListener('click', () => runClear(mode, label));
    return button;
  }

  function installClearModes() {
    const oldClear = document.getElementById('clearOrders');
    if (!oldClear || document.getElementById('clearOrdersReturns')) return;
    const parent = oldClear.parentElement;
    const first = makeButton('clearOrders', 'Clear Orders only', 'orders');
    oldClear.replaceWith(first);
    first.insertAdjacentElement('afterend', makeButton('clearOrdersReturns', 'Clear Orders + Returns', 'orders_returns'));
    document.getElementById('clearOrdersReturns').insertAdjacentElement('afterend', makeButton('clearOrdersFinancial', 'Clear Orders + Financial Ledger', 'orders_financial'));
    const reset = document.getElementById('resetExtension');
    if (reset) reset.replaceWith(makeButton('resetExtension', 'Clear all seller data', 'all'));
    else if (parent) parent.appendChild(makeButton('resetExtension', 'Clear all seller data', 'all'));
  }

  function loadRuntime(file, runtimeName) {
    if (document.querySelector(`script[data-runtime="${runtimeName}"]`)) return;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(file);
    script.async = false;
    script.dataset.runtime = runtimeName;
    (document.head || document.documentElement).appendChild(script);
  }

  function loadAdditionalRuntimes() {
    loadRuntime('v341-backup-schema.js', 'v341-backup-schema');
    loadRuntime('v341-data-coverage.js', 'v341-data-coverage');
    loadRuntime('v341-seller-identity.js', 'v341-seller-identity');
    loadRuntime('v341-orders-parser.js', 'v341-orders-parser');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { installClearModes(); loadAdditionalRuntimes(); }, { once: true });
  } else {
    installClearModes();
    loadAdditionalRuntimes();
  }
})();