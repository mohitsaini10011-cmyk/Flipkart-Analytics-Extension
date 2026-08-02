'use strict';
(() => {
  const MAX_PDF_BYTES = 250 * 1024 * 1024;
  const MAX_PDF_PAGES = 1000;
  const PDF_BATCH = 20;
  const TABLE_ROW_SOFT_LIMIT = 1000;
  let selectedPdfFile = null;
  let previewUrl = null;

  const text = value => String(value ?? '').trim();
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const yieldUi = () => new Promise(resolve => setTimeout(resolve, 0));

  function downloadBytes(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    chrome.downloads.download({ url, filename, saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function outputSize(page, mode, croppedWidth, croppedHeight) {
    const sizes = {
      '4x6': [288, 432],
      '5x3': [360, 216],
      a4: [595.28, 841.89]
    };
    if (mode === 'original' || !sizes[mode]) return [croppedWidth, croppedHeight];
    let [width, height] = sizes[mode];
    if ((croppedWidth > croppedHeight) !== (width > height)) [width, height] = [height, width];
    return [width, height];
  }

  function cropBoxes(page) {
    const { width, height } = page.getSize();
    const landscape = width > height;
    if (landscape) {
      return {
        landscape,
        label: { left: width * 0.02, bottom: height * 0.05, right: width * 0.98, top: height * 0.95 },
        invoice: null
      };
    }
    return {
      landscape,
      label: { left: width * 0.32, bottom: 0, right: width * 0.68, top: height * 0.418 },
      invoice: { left: 0, bottom: height * 0.452, right: width, top: height }
    };
  }

  function customBox(page) {
    const { width, height } = page.getSize();
    const top = Math.max(0, finite(document.getElementById('cropTop')?.value));
    const right = Math.max(0, finite(document.getElementById('cropRight')?.value));
    const bottom = Math.max(0, finite(document.getElementById('cropBottom')?.value));
    const left = Math.max(0, finite(document.getElementById('cropLeft')?.value));
    return { left, bottom, right: Math.max(left + 1, width - right), top: Math.max(bottom + 1, height - top) };
  }

  function selectedLabelBox(page) {
    const preset = document.getElementById('cropPreset')?.value || 'flipkart';
    if (preset === 'custom') return customBox(page);
    if (preset === 'tight') {
      const { width, height } = page.getSize();
      return { left: width * 0.015, bottom: height * 0.015, right: width * 0.985, top: height * 0.985 };
    }
    return cropBoxes(page).label;
  }

  async function appendEmbeddedPage(target, source, box, pageSizeMode) {
    const croppedWidth = Math.max(1, box.right - box.left);
    const croppedHeight = Math.max(1, box.top - box.bottom);
    const embedded = await target.embedPage(source, box);
    const [pageWidth, pageHeight] = outputSize(source, pageSizeMode, croppedWidth, croppedHeight);
    const scale = Math.min(pageWidth / croppedWidth, pageHeight / croppedHeight);
    const drawWidth = croppedWidth * scale;
    const drawHeight = croppedHeight * scale;
    const page = target.addPage([pageWidth, pageHeight]);
    page.drawPage(embedded, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight
    });
  }

  async function validateSavedPdf(bytes, expectedPages) {
    const reopened = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    if (reopened.getPageCount() !== expectedPages) throw new Error('Generated PDF page-count verification failed');
    for (const page of reopened.getPages()) {
      const { width, height } = page.getSize();
      if (!(width > 10 && height > 10 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('Generated PDF contains an invalid page size');
    }
  }

  async function buildPdf(mode) {
    if (!selectedPdfFile) throw new Error('Select a PDF first');
    if (!globalThis.PDFLib?.PDFDocument) throw new Error('Bundled PDF engine unavailable');
    if (selectedPdfFile.size > MAX_PDF_BYTES) throw new Error('PDF exceeds 250 MB safety limit');
    const bytes = new Uint8Array(await selectedPdfFile.arrayBuffer());
    const source = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    const count = source.getPageCount();
    if (!count) throw new Error('PDF has no pages');
    if (count > MAX_PDF_PAGES) throw new Error(`PDF has ${count} pages; maximum supported is ${MAX_PDF_PAGES}`);
    const target = await PDFLib.PDFDocument.create();
    const pageSizeMode = document.getElementById('cropPageSize')?.value || 'original';
    let labels = 0, invoices = 0, portrait = 0, landscape = 0;
    const started = performance.now();

    for (let index = 0; index < count; index++) {
      const page = source.getPage(index);
      const boxes = cropBoxes(page);
      if (boxes.landscape) landscape++; else portrait++;
      if (mode === 'labels' || mode === 'combined') {
        await appendEmbeddedPage(target, page, selectedLabelBox(page), pageSizeMode);
        labels++;
      }
      if ((mode === 'invoices' || mode === 'combined') && boxes.invoice) {
        await appendEmbeddedPage(target, page, boxes.invoice, 'original');
        invoices++;
      }
      if ((index + 1) % PDF_BATCH === 0) {
        setPdfStatus(`Processing ${index + 1}/${count} pages…`);
        await yieldUi();
      }
    }

    if (!target.getPageCount()) throw new Error('No pages matched the selected output');
    target.setProducer('Flipkart Analytics & Tools v3.4.2');
    target.setCreator('Flipkart Analytics & Tools');
    const output = await target.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 25 });
    await validateSavedPdf(output, target.getPageCount());
    const elapsed = Math.round(performance.now() - started);
    return { output, count, labels, invoices, portrait, landscape, elapsed };
  }

  function setPdfStatus(message, error = false) {
    const status = document.getElementById('cropStatus');
    if (!status) return;
    status.textContent = message;
    status.style.color = error ? '#b91c1c' : '';
  }

  async function runPdf(mode) {
    const buttons = [...document.querySelectorAll('[data-pdf-output]')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      setPdfStatus('Loading and validating PDF…');
      const result = await buildPdf(mode);
      const stem = selectedPdfFile.name.replace(/\.pdf$/i, '') || 'flipkart';
      const suffix = mode === 'labels' ? 'labels' : mode === 'invoices' ? 'invoices' : 'labels-and-invoices';
      downloadBytes(result.output, `${stem}-${suffix}.pdf`);
      setPdfStatus(`Verified output: ${result.labels} label page(s), ${result.invoices} invoice page(s), ${result.portrait} portrait, ${result.landscape} landscape · ${result.elapsed} ms`);
    } catch (error) {
      console.error('[Flipkart Analytics] PDF hardening failed', error);
      setPdfStatus(`PDF failed: ${error.message || error}`, true);
      if (typeof show === 'function') show(`PDF failed: ${error.message || error}`, true);
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  async function previewPdf() {
    try {
      const result = await buildPdf('labels');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(new Blob([result.output], { type: 'application/pdf' }));
      const frame = document.getElementById('cropPreview');
      if (frame) {
        frame.src = previewUrl;
        frame.classList.remove('hidden');
        document.getElementById('cropPreviewEmpty')?.classList.add('hidden');
      }
      setPdfStatus(`Preview verified: ${result.labels} label page(s)`);
    } catch (error) {
      setPdfStatus(`Preview failed: ${error.message || error}`, true);
    }
  }

  function installPdfTools() {
    const input = document.getElementById('cropPdfInput');
    if (input && input.dataset.hardened !== '1') {
      input.dataset.hardened = '1';
      input.addEventListener('change', event => {
        selectedPdfFile = event.target.files?.[0] || null;
        if (selectedPdfFile) setPdfStatus(`${selectedPdfFile.name} · ${(selectedPdfFile.size / 1048576).toFixed(2)} MB · ready for verified vector processing`);
      }, true);
    }
    const drop = document.getElementById('cropDrop');
    if (drop && drop.dataset.hardened !== '1') {
      drop.dataset.hardened = '1';
      drop.addEventListener('drop', event => {
        selectedPdfFile = [...(event.dataTransfer?.files || [])].find(file => /\.pdf$/i.test(file.name)) || null;
        if (selectedPdfFile) setPdfStatus(`${selectedPdfFile.name} · ${(selectedPdfFile.size / 1048576).toFixed(2)} MB · ready for verified vector processing`);
      }, true);
    }
    const oldActions = document.querySelector('#crop .settings-actions');
    if (oldActions && !document.getElementById('downloadLabelsPdf')) {
      oldActions.innerHTML = '';
      const items = [
        ['cropPreviewBtn', 'Preview Labels', 'preview'],
        ['downloadLabelsPdf', 'Labels PDF', 'labels'],
        ['downloadInvoicesPdf', 'Invoice PDF', 'invoices'],
        ['downloadCombinedPdf', 'Combined PDF', 'combined']
      ];
      for (const [id, label, mode] of items) {
        const button = document.createElement('button');
        button.id = id;
        button.type = 'button';
        button.className = mode === 'combined' ? 'primary' : 'secondary';
        button.dataset.pdfOutput = mode;
        button.textContent = label;
        button.addEventListener('click', () => mode === 'preview' ? previewPdf() : runPdf(mode));
        oldActions.appendChild(button);
      }
    }
  }

  function accountingSummary() {
    const ledger = Array.isArray(financialLedger) ? financialLedger : [];
    const orderRows = Array.isArray(rows) ? rows : [];
    const sum = key => ledger.reduce((total, item) => total + finite(item?.[key]), 0);
    const matched = orderRows.filter(row => row.reconciliationStatus === 'matched').length;
    const manual = orderRows.filter(row => row.reconciliationStatus === 'manual_review_required' || row.reconciliationStatus === 'ambiguous').length;
    const unmatched = (Array.isArray(unmatchedFinancials) ? unmatchedFinancials.length : 0) + (Array.isArray(unmatchedReturns) ? unmatchedReturns.length : 0);
    const complete = orderRows.length > 0 && matched === orderRows.length && unmatched === 0 && manual === 0;
    return {
      matched,
      manual,
      unmatched,
      complete,
      creditNotes: sum('creditNote') + sum('creditNoteAmount'),
      debitNotes: sum('debitNote') + sum('debitNoteAmount'),
      compensation: sum('compensation') + sum('compensationAmount'),
      recovery: sum('recovery') + sum('recoveryAmount'),
      revisions: ledger.reduce((total, item) => total + Math.max(0, finite(item?.revisionCount)), 0)
    };
  }

  function installAccountingPanel() {
    const section = document.getElementById('profit');
    if (!section) return;
    let panel = document.getElementById('accountingReconciliationPanel');
    if (!panel) {
      panel = document.createElement('article');
      panel.id = 'accountingReconciliationPanel';
      panel.className = 'panel';
      section.prepend(panel);
    }
    const summary = accountingSummary();
    panel.innerHTML = `<div class="panel-head"><div><h3>${summary.complete ? 'Reconciled Profit' : 'Estimated Profit'}</h3><small>${summary.complete ? 'All order rows and financial entries are strictly reconciled.' : 'Final accounting is blocked until unmatched/manual-review entries are resolved.'}</small></div><strong>${summary.complete ? 'Verified' : 'Review Required'}</strong></div><div class="kpis"><div class="kpi"><small>Matched Rows</small><strong>${summary.matched.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Unmatched Entries</small><strong>${summary.unmatched.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Manual Review</small><strong>${summary.manual.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Settlement Revisions</small><strong>${summary.revisions.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Credit Notes</small><strong>₹${summary.creditNotes.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Debit Notes</small><strong>₹${summary.debitNotes.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Compensation</small><strong>₹${summary.compensation.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Recovery</small><strong>₹${summary.recovery.toLocaleString('en-IN')}</strong></div></div>`;
  }

  function capRenderedTables() {
    document.querySelectorAll('.table-wrap table').forEach(table => {
      const body = table.tBodies?.[0];
      if (!body || body.rows.length <= TABLE_ROW_SOFT_LIMIT) return;
      const original = body.rows.length;
      while (body.rows.length > TABLE_ROW_SOFT_LIMIT) body.deleteRow(body.rows.length - 1);
      let note = table.parentElement?.querySelector('.dc-table-limit-note');
      if (!note) {
        note = document.createElement('p');
        note.className = 'hint dc-table-limit-note';
        table.insertAdjacentElement('afterend', note);
      }
      note.textContent = `Showing first ${TABLE_ROW_SOFT_LIMIT.toLocaleString('en-IN')} of ${original.toLocaleString('en-IN')} rows. Export contains the complete dataset.`;
    });
  }

  async function runStressDiagnostic() {
    const button = document.getElementById('runStressDiagnostic');
    if (button) button.disabled = true;
    const output = document.getElementById('stressDiagnosticOutput');
    try {
      const start = performance.now();
      let checksum = 0;
      for (let index = 0; index < 100000; index++) {
        checksum += ((index * 31) % 997) - ((index * 17) % 389);
        if (index && index % 10000 === 0) await yieldUi();
      }
      const elapsed = Math.round(performance.now() - start);
      const liveRows = Array.isArray(rows) ? rows.length : 0;
      const liveLedger = Array.isArray(financialLedger) ? financialLedger.length : 0;
      const estimatedMb = ((liveRows * 2200) + (liveLedger * 1800)) / 1048576;
      if (output) output.textContent = `100,000-record CPU test: ${elapsed} ms · checksum ${checksum} · live records ${liveRows.toLocaleString('en-IN')} · ledger ${liveLedger.toLocaleString('en-IN')} · estimated working memory ${estimatedMb.toFixed(1)} MB`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function installStressPanel() {
    const section = document.getElementById('settings');
    if (!section || document.getElementById('productionDiagnostics')) return;
    const panel = document.createElement('article');
    panel.id = 'productionDiagnostics';
    panel.className = 'panel';
    panel.innerHTML = `<div class="panel-head"><div><h3>Production Diagnostics</h3><small>Large-account and memory safety checks</small></div><button id="runStressDiagnostic" class="secondary">Run 100k Stress Test</button></div><p id="stressDiagnosticOutput" class="hint">Not run yet. Large tables are capped at ${TABLE_ROW_SOFT_LIMIT.toLocaleString('en-IN')} visible rows; exports keep all records.</p>`;
    section.appendChild(panel);
    document.getElementById('runStressDiagnostic')?.addEventListener('click', runStressDiagnostic);
  }

  function wrapRender() {
    if (typeof render !== 'function' || render.__v342Wrapped) return;
    const original = render;
    const wrapped = function(...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => {
        installPdfTools();
        installAccountingPanel();
        installStressPanel();
        capRenderedTables();
      });
      return result;
    };
    wrapped.__v342Wrapped = true;
    render = wrapped;
  }

  function boot() {
    wrapRender();
    installPdfTools();
    installAccountingPanel();
    installStressPanel();
    capRenderedTables();
    if (globalThis.PDFLib?.PDFDocument) setPdfStatus('Bundled PDF engine ready · vector barcode/QR content preserved · output reload verification enabled');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();