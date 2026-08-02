'use strict';
(() => {
  const PAGE_SIZE = 250;
  const BENCHMARK_ROWS = 100000;
  const pagedTables = new WeakMap();
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const yieldUi = () => new Promise(resolve => setTimeout(resolve, 0));

  function accountingGate() {
    const ledger = Array.isArray(financialLedger) ? financialLedger : [];
    const orderRows = Array.isArray(rows) ? rows : [];
    const unmatched = (Array.isArray(unmatchedFinancials) ? unmatchedFinancials.length : 0) + (Array.isArray(unmatchedReturns) ? unmatchedReturns.length : 0);
    const manual = orderRows.filter(row => ['manual_review_required', 'ambiguous', 'unmatched'].includes(row.reconciliationStatus)).length;
    const strictMatched = orderRows.filter(row => row.reconciliationStatus === 'matched').length;
    const settlementTotal = ledger.reduce((sum, row) => sum + num(row.settlement || row.netSettlement || row.paidAmount), 0);
    const payoutTotal = num(document.getElementById('auditPayoutTotal')?.value);
    const taxExpected = num(document.getElementById('auditTaxExpected')?.value);
    const taxLedger = ledger.reduce((sum, row) => sum + num(row.gst) + num(row.tds) + num(row.tcs), 0);
    const from = document.getElementById('auditPeriodFrom')?.value;
    const to = document.getElementById('auditPeriodTo')?.value;
    const rowPass = orderRows.length > 0 && strictMatched === orderRows.length && unmatched === 0 && manual === 0;
    const payoutPass = payoutTotal > 0 && Math.abs(settlementTotal - payoutTotal) <= 1;
    const taxPass = taxExpected >= 0 && Math.abs(taxLedger - taxExpected) <= 1;
    const periodPass = Boolean(from && to && new Date(from) <= new Date(to));
    return { rowPass, payoutPass, taxPass, periodPass, complete: rowPass && payoutPass && taxPass && periodPass, strictMatched, unmatched, manual, settlementTotal, payoutTotal, taxLedger, taxExpected };
  }

  function installAccountingAudit() {
    const section = document.getElementById('profit');
    if (!section) return;
    let panel = document.getElementById('accountingAuditPanel');
    if (!panel) {
      panel = document.createElement('article');
      panel.id = 'accountingAuditPanel';
      panel.className = 'panel';
      panel.innerHTML = `<div class="panel-head"><div><h3>Accounting Reconciliation</h3><small>Final profit requires row, payout, tax and reporting-period checks.</small></div><strong id="accountingAuditStatus">Review Required</strong></div><div class="form-grid"><label>Bank / UTR Payout Total<input id="auditPayoutTotal" type="number" min="0" step="0.01"></label><label>GST + TDS + TCS Report Total<input id="auditTaxExpected" type="number" min="0" step="0.01"></label><label>Period From<input id="auditPeriodFrom" type="date"></label><label>Period To<input id="auditPeriodTo" type="date"></label></div><div id="accountingAuditResults"></div>`;
      section.prepend(panel);
      panel.querySelectorAll('input').forEach(input => input.addEventListener('input', renderAccountingAudit));
    }
    renderAccountingAudit();
  }

  function renderAccountingAudit() {
    const out = document.getElementById('accountingAuditResults');
    const status = document.getElementById('accountingAuditStatus');
    if (!out || !status) return;
    const g = accountingGate();
    status.textContent = g.complete ? 'Accounting Complete' : 'Review Required';
    const row = (label, pass, detail) => `<div class="summary-row"><span>${pass ? '✓' : '○'} ${label}</span><b>${detail}</b></div>`;
    out.innerHTML = row('Order-row reconciliation', g.rowPass, `${g.strictMatched}/${Array.isArray(rows) ? rows.length : 0}`) + row('Unmatched/manual entries', g.unmatched === 0 && g.manual === 0, `${g.unmatched + g.manual}`) + row('Bank / UTR payout', g.payoutPass, `₹${g.settlementTotal.toLocaleString('en-IN')}`) + row('GST / TDS / TCS', g.taxPass, `₹${g.taxLedger.toLocaleString('en-IN')}`) + row('Reporting period', g.periodPass, g.periodPass ? 'Valid' : 'Required');
  }

  function paginateTable(table) {
    const body = table.tBodies?.[0];
    if (!body || body.rows.length <= PAGE_SIZE) return;
    const signature = `${body.rows.length}|${body.textContent.length}`;
    if (table.dataset.pageSignature === signature) return;
    table.dataset.pageSignature = signature;
    const allRows = [...body.rows].map(row => row.cloneNode(true));
    const state = { rows: allRows, page: 0 };
    pagedTables.set(table, state);
    table.parentElement?.querySelector('.dc-pagination')?.remove();
    const controls = document.createElement('div');
    controls.className = 'settings-actions dc-pagination';
    const prev = document.createElement('button');
    const next = document.createElement('button');
    const info = document.createElement('span');
    prev.className = next.className = 'secondary';
    prev.textContent = 'Previous';
    next.textContent = 'Next';
    const draw = () => {
      const pages = Math.ceil(state.rows.length / PAGE_SIZE);
      body.replaceChildren(...state.rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE).map(row => row.cloneNode(true)));
      info.textContent = `Page ${state.page + 1}/${pages} · ${state.rows.length.toLocaleString('en-IN')} rows`;
      prev.disabled = state.page === 0;
      next.disabled = state.page >= pages - 1;
    };
    prev.onclick = () => { state.page = Math.max(0, state.page - 1); draw(); };
    next.onclick = () => { state.page = Math.min(Math.ceil(state.rows.length / PAGE_SIZE) - 1, state.page + 1); draw(); };
    controls.append(prev, info, next);
    table.insertAdjacentElement('afterend', controls);
    draw();
  }

  function paginateRenderedTables() {
    document.querySelectorAll('.table-wrap table').forEach(paginateTable);
  }

  async function runBenchmark() {
    const button = document.getElementById('runLargeBenchmark');
    const output = document.getElementById('largeBenchmarkOutput');
    if (button) button.disabled = true;
    try {
      const started = performance.now();
      const orders = [];
      const ledger = [];
      for (let i = 0; i < BENCHMARK_ROWS; i++) {
        const orderId = `TEST-${String(i).padStart(7, '0')}`;
        const sku = `SKU-${i % 5000}`;
        orders.push({ recordId: `ITEM-${i}`, orderId, sku, qty: 1 + (i % 3), sale: 299 + (i % 800), status: i % 9 ? 'Delivered' : 'Returned', state: `STATE-${i % 30}` });
        ledger.push({ transactionId: `TX-${i}`, recordId: `ITEM-${i}`, orderId, sku, settlement: 240 + (i % 700), fees: 20 + (i % 40), gst: i % 18, tds: i % 4, tcs: i % 3 });
        if (i && i % 10000 === 0) await yieldUi();
      }
      const dedupeStarted = performance.now();
      const orderMap = new Map(orders.map(item => [item.recordId, item]));
      const ledgerMap = new Map(ledger.map(item => [`${item.transactionId}|${item.recordId}`, item]));
      const grouped = new Map();
      for (const item of orders) grouped.set(item.sku, (grouped.get(item.sku) || 0) + item.qty);
      const json = JSON.stringify({ orders, ledger });
      const tempKey = `dc_fk_benchmark_${Date.now()}`;
      await chrome.storage.local.set({ [tempKey]: { count: orders.length, bytes: json.length, checksum: orderMap.size + ledgerMap.size + grouped.size } });
      const verify = await chrome.storage.local.get(tempKey);
      await chrome.storage.local.remove(tempKey);
      if (!verify[tempKey] || verify[tempKey].count !== BENCHMARK_ROWS) throw new Error('Storage read-back verification failed');
      const elapsed = Math.round(performance.now() - started);
      const compute = Math.round(performance.now() - dedupeStarted);
      if (output) output.textContent = `100k orders + 100k ledger benchmark passed · ${elapsed} ms total · ${compute} ms dedupe/group/serialize/storage · ${(json.length / 1048576).toFixed(1)} MB serialized`;
    } catch (error) {
      if (output) output.textContent = `Benchmark failed: ${error.message || error}`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function installDiagnostics() {
    const section = document.getElementById('settings');
    if (!section || document.getElementById('largeAccountDiagnostics')) return;
    const panel = document.createElement('article');
    panel.id = 'largeAccountDiagnostics';
    panel.className = 'panel';
    panel.innerHTML = `<div class="panel-head"><div><h3>Large-Account Diagnostics</h3><small>Runs isolated synthetic object, reconciliation and Chrome storage checks.</small></div><button id="runLargeBenchmark" class="secondary">Run 100k Benchmark</button></div><p id="largeBenchmarkOutput" class="hint">Not run yet. Production seller data will not be modified.</p>`;
    section.appendChild(panel);
    document.getElementById('runLargeBenchmark')?.addEventListener('click', runBenchmark);
  }

  function wrapRender() {
    if (typeof render !== 'function' || render.__v345Wrapped) return;
    const original = render;
    const wrapped = function(...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => {
        installAccountingAudit();
        installDiagnostics();
        paginateRenderedTables();
      });
      return result;
    };
    wrapped.__v345Wrapped = true;
    render = wrapped;
  }

  function boot() {
    wrapRender();
    installAccountingAudit();
    installDiagnostics();
    paginateRenderedTables();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
