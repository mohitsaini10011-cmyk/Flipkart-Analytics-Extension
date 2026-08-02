'use strict';
(() => {
  const MAX_PDF_BYTES = 75 * 1024 * 1024;
  const MAX_PDF_PAGES = 500;
  const PDF_CHUNK_PAGES = 100;
  const TABLE_PAGE_SIZE = 250;
  const BENCHMARK_ROWS = 100000;
  let selectedPdf = null;
  let previewUrl = null;
  const tablePages = new WeakMap();
  const text = value => String(value ?? '').trim();
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const yieldUi = () => new Promise(resolve => setTimeout(resolve, 0));

  function setStatus(message, error = false) {
    const node = document.getElementById('cropStatus');
    if (!node) return;
    node.textContent = message;
    node.style.color = error ? '#b91c1c' : '';
  }

  async function downloadBytes(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    try {
      const id = await chrome.downloads.download({ url, filename, saveAs: true });
      if (!id) throw new Error('Browser did not accept the download');
      return id;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  function ensurePdfControls() {
    const settings = document.querySelector('#crop .crop-settings');
    if (settings && !document.getElementById('invoicePreset')) {
      const invoice = document.createElement('label');
      invoice.innerHTML = 'Invoice Layout<select id="invoicePreset"><option value="standard">Portrait Standard</option><option value="compact">Portrait Compact</option><option value="landscape-split">Landscape Label + Invoice</option><option value="label-only">Label Only</option></select>';
      const order = document.createElement('label');
      order.innerHTML = 'Combined Ordering<select id="combinedOrder"><option value="paired">Label → Invoice per page</option><option value="labels-first">All Labels → All Invoices</option><option value="original">Preserve source-page sequence</option></select>';
      settings.append(invoice, order);
    }
    const actions = document.querySelector('#crop .settings-actions');
    if (actions && !document.getElementById('v343LabelsPdf')) {
      actions.innerHTML = '';
      const specs = [
        ['cropPreviewBtn','Preview Labels','preview'],
        ['v343LabelsPdf','Labels PDF','labels'],
        ['v343InvoicesPdf','Invoice PDF','invoices'],
        ['v343CombinedPdf','Combined PDF','combined']
      ];
      specs.forEach(([id,label,mode]) => {
        const button = document.createElement('button');
        button.id = id;
        button.type = 'button';
        button.className = mode === 'combined' ? 'primary' : 'secondary';
        button.dataset.v343Pdf = mode;
        button.textContent = label;
        button.addEventListener('click', () => mode === 'preview' ? previewLabels() : runPdf(mode));
        actions.appendChild(button);
      });
    }
  }

  function outputSize(box, mode) {
    const width = box.right - box.left, height = box.top - box.bottom;
    const sizes = { '4x6':[288,432], '5x3':[360,216], a4:[595.28,841.89] };
    if (mode === 'original' || !sizes[mode]) return [width,height];
    let [w,h] = sizes[mode];
    if ((width > height) !== (w > h)) [w,h] = [h,w];
    return [w,h];
  }

  function pageBoxes(page) {
    const { width, height } = page.getSize();
    const landscape = width > height;
    const invoicePreset = document.getElementById('invoicePreset')?.value || 'standard';
    if (landscape) {
      if (invoicePreset === 'landscape-split') {
        return {
          landscape,
          label: { left: width * .02, bottom: height * .5, right: width * .98, top: height * .98 },
          invoice: { left: width * .02, bottom: height * .02, right: width * .98, top: height * .5 }
        };
      }
      return { landscape, label: { left: width*.02, bottom: height*.05, right: width*.98, top: height*.95 }, invoice: null };
    }
    if (invoicePreset === 'label-only') return { landscape, label: { left: width*.32, bottom: 0, right: width*.68, top: height*.418 }, invoice: null };
    if (invoicePreset === 'compact') return {
      landscape,
      label: { left: width*.30, bottom: 0, right: width*.70, top: height*.46 },
      invoice: { left: 0, bottom: height*.46, right: width, top: height }
    };
    return {
      landscape,
      label: { left: width*.32, bottom: 0, right: width*.68, top: height*.418 },
      invoice: { left: 0, bottom: height*.452, right: width, top: height }
    };
  }

  function labelBox(page) {
    const preset = document.getElementById('cropPreset')?.value || 'flipkart';
    const { width, height } = page.getSize();
    if (preset === 'tight') return { left: width*.015, bottom: height*.015, right: width*.985, top: height*.985 };
    if (preset === 'custom') {
      const top = Math.max(0,num(document.getElementById('cropTop')?.value));
      const right = Math.max(0,num(document.getElementById('cropRight')?.value));
      const bottom = Math.max(0,num(document.getElementById('cropBottom')?.value));
      const left = Math.max(0,num(document.getElementById('cropLeft')?.value));
      return { left, bottom, right: Math.max(left+1,width-right), top: Math.max(bottom+1,height-top) };
    }
    return pageBoxes(page).label;
  }

  async function addCrop(target, sourcePage, box, sizeMode) {
    if (!box) return false;
    const embedded = await target.embedPage(sourcePage, box);
    const [pageWidth,pageHeight] = outputSize(box,sizeMode);
    const cropWidth = box.right-box.left, cropHeight = box.top-box.bottom;
    const scale = Math.min(pageWidth/cropWidth,pageHeight/cropHeight);
    const drawWidth = cropWidth*scale, drawHeight = cropHeight*scale;
    const page = target.addPage([pageWidth,pageHeight]);
    page.drawPage(embedded,{x:(pageWidth-drawWidth)/2,y:(pageHeight-drawHeight)/2,width:drawWidth,height:drawHeight});
    return true;
  }

  async function saveChunk(source, mode, start, end) {
    const target = await PDFLib.PDFDocument.create();
    const sizeMode = document.getElementById('cropPageSize')?.value || 'original';
    const ordering = document.getElementById('combinedOrder')?.value || 'paired';
    const labels = [], invoices = [];
    for (let index=start; index<end; index++) {
      const page = source.getPage(index);
      const boxes = pageBoxes(page);
      labels.push({ page, box: labelBox(page) });
      if (boxes.invoice) invoices.push({ page, box: boxes.invoice });
    }
    const addLabels = async () => { for (const item of labels) await addCrop(target,item.page,item.box,sizeMode); };
    const addInvoices = async () => { for (const item of invoices) await addCrop(target,item.page,item.box,'original'); };
    if (mode === 'labels') await addLabels();
    else if (mode === 'invoices') await addInvoices();
    else if (ordering === 'labels-first') { await addLabels(); await addInvoices(); }
    else {
      for (let index=start; index<end; index++) {
        const page = source.getPage(index), boxes = pageBoxes(page);
        await addCrop(target,page,labelBox(page),sizeMode);
        if (boxes.invoice) await addCrop(target,page,boxes.invoice,'original');
      }
    }
    if (!target.getPageCount()) throw new Error('No pages matched selected output/layout');
    target.setProducer('Flipkart Analytics & Tools v3.4.3');
    const bytes = await target.save({ useObjectStreams:true, addDefaultPage:false, objectsPerTick:20 });
    if (!bytes?.length || bytes.length < 100) throw new Error('Generated PDF is empty');
    return { bytes, pages: target.getPageCount(), labels: mode === 'invoices' ? 0 : labels.length, invoices: mode === 'labels' ? 0 : invoices.length };
  }

  async function buildAndDownload(mode, preview = false) {
    if (!selectedPdf) throw new Error('Select a PDF first');
    if (!globalThis.PDFLib?.PDFDocument) throw new Error('Bundled PDF engine unavailable');
    if (selectedPdf.size > MAX_PDF_BYTES) throw new Error('PDF exceeds 75 MB safe-processing limit. Split the source PDF first.');
    const sourceBytes = new Uint8Array(await selectedPdf.arrayBuffer());
    const source = await PDFLib.PDFDocument.load(sourceBytes,{ignoreEncryption:false,updateMetadata:false});
    const count = source.getPageCount();
    if (!count) throw new Error('PDF has no pages');
    if (count > MAX_PDF_PAGES) throw new Error(`PDF has ${count} pages; maximum safe limit is ${MAX_PDF_PAGES}.`);
    const estimatedMb = (selectedPdf.size * 4.5) / 1048576;
    if (estimatedMb > 350) throw new Error(`Estimated expanded memory ${estimatedMb.toFixed(0)} MB is unsafe. Split the PDF.`);
    const chunks = preview ? 1 : Math.ceil(count / PDF_CHUNK_PAGES);
    let totalLabels=0,totalInvoices=0,totalOutputPages=0;
    const stem = selectedPdf.name.replace(/\.pdf$/i,'') || 'flipkart';
    for (let part=0; part<chunks; part++) {
      const start = part*PDF_CHUNK_PAGES;
      const end = preview ? Math.min(count,10) : Math.min(count,start+PDF_CHUNK_PAGES);
      setStatus(`Processing pages ${start+1}-${end} of ${count}…`);
      const result = await saveChunk(source,mode,start,end);
      totalLabels += result.labels; totalInvoices += result.invoices; totalOutputPages += result.pages;
      if (preview) return result.bytes;
      const suffix = mode === 'labels' ? 'labels' : mode === 'invoices' ? 'invoices' : 'combined';
      const partSuffix = chunks > 1 ? `-part-${String(part+1).padStart(2,'0')}` : '';
      await downloadBytes(result.bytes,`${stem}-${suffix}${partSuffix}.pdf`);
      await yieldUi();
    }
    setStatus(`PDF structure checked: ${totalOutputPages} output page(s), ${totalLabels} label(s), ${totalInvoices} invoice(s). Barcode/QR scanner validation is still required on a printed sample.`);
  }

  async function runPdf(mode) {
    const controls = [...document.querySelectorAll('#crop button,#crop select,#crop input')];
    controls.forEach(node => node.disabled = true);
    try { await buildAndDownload(mode,false); }
    catch (error) { setStatus(`PDF failed: ${error.message || error}`,true); if (typeof show === 'function') show(`PDF failed: ${error.message || error}`,true); }
    finally { controls.forEach(node => node.disabled = false); }
  }

  async function previewLabels() {
    try {
      const bytes = await buildAndDownload('labels',true);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
      const frame = document.getElementById('cropPreview');
      if (frame) { frame.src=previewUrl; frame.classList.remove('hidden'); document.getElementById('cropPreviewEmpty')?.classList.add('hidden'); }
      setStatus('Preview generated for first 10 pages. PDF structure checked; barcode/QR scanner validation remains required.');
    } catch (error) { setStatus(`Preview failed: ${error.message || error}`,true); }
  }

  function bindPdfInput() {
    const input = document.getElementById('cropPdfInput');
    if (input && input.dataset.v343 !== '1') {
      input.dataset.v343='1';
      input.addEventListener('change',event => {
        event.stopImmediatePropagation();
        selectedPdf = event.target.files?.[0] || null;
        if (selectedPdf) setStatus(`${selectedPdf.name} · ${(selectedPdf.size/1048576).toFixed(2)} MB · ready. Safe limit 75 MB / 500 pages.`);
      },true);
    }
    const drop = document.getElementById('cropDrop');
    if (drop && drop.dataset.v343 !== '1') {
      drop.dataset.v343='1';
      drop.addEventListener('drop',event => {
        event.stopImmediatePropagation();
        selectedPdf=[...(event.dataTransfer?.files||[])].find(file=>/\.pdf$/i.test(file.name))||null;
        if (selectedPdf) setStatus(`${selectedPdf.name} · ${(selectedPdf.size/1048576).toFixed(2)} MB · ready.`);
      },true);
    }
  }

  function paginateTable(table) {
    const body = table.tBodies?.[0];
    if (!body || body.rows.length <= TABLE_PAGE_SIZE || table.dataset.v343Paged === '1') return;
    const allRows = [...body.rows].map(row => row.cloneNode(true));
    table.dataset.v343Paged='1';
    tablePages.set(table,{rows:allRows,page:0});
    const controls=document.createElement('div'); controls.className='settings-actions dc-pagination';
    const prev=document.createElement('button'),next=document.createElement('button'),info=document.createElement('span');
    prev.className=next.className='secondary'; prev.textContent='Previous'; next.textContent='Next';
    const draw=()=>{const state=tablePages.get(table),pages=Math.ceil(state.rows.length/TABLE_PAGE_SIZE);body.replaceChildren(...state.rows.slice(state.page*TABLE_PAGE_SIZE,(state.page+1)*TABLE_PAGE_SIZE).map(row=>row.cloneNode(true)));info.textContent=`Page ${state.page+1}/${pages} · ${state.rows.length.toLocaleString('en-IN')} rows`;prev.disabled=state.page===0;next.disabled=state.page>=pages-1;};
    prev.onclick=()=>{const state=tablePages.get(table);state.page=Math.max(0,state.page-1);draw();};
    next.onclick=()=>{const state=tablePages.get(table);state.page=Math.min(Math.ceil(state.rows.length/TABLE_PAGE_SIZE)-1,state.page+1);draw();};
    controls.append(prev,info,next); table.insertAdjacentElement('afterend',controls); draw();
  }

  function paginateRenderedTables() { document.querySelectorAll('.table-wrap table').forEach(paginateTable); }

  function accountingGate() {
    const ledger=Array.isArray(financialLedger)?financialLedger:[], orderRows=Array.isArray(rows)?rows:[];
    const unmatched=(Array.isArray(unmatchedFinancials)?unmatchedFinancials.length:0)+(Array.isArray(unmatchedReturns)?unmatchedReturns.length:0);
    const manual=orderRows.filter(row=>['manual_review_required','ambiguous','unmatched'].includes(row.reconciliationStatus)).length;
    const strictMatched=orderRows.filter(row=>row.reconciliationStatus==='matched').length;
    const settlementTotal=ledger.reduce((sum,row)=>sum+num(row.settlement||row.netSettlement||row.paidAmount),0);
    const payoutTotal=num(document.getElementById('auditPayoutTotal')?.value);
    const taxExpected=num(document.getElementById('auditTaxExpected')?.value);
    const taxLedger=ledger.reduce((sum,row)=>sum+num(row.gst)+num(row.tds)+num(row.tcs),0);
    const periodFrom=document.getElementById('auditPeriodFrom')?.value, periodTo=document.getElementById('auditPeriodTo')?.value;
    const rowPass=orderRows.length>0&&strictMatched===orderRows.length&&unmatched===0&&manual===0;
    const payoutPass=payoutTotal>0&&Math.abs(settlementTotal-payoutTotal)<=1;
    const taxPass=taxExpected>=0&&Math.abs(taxLedger-taxExpected)<=1;
    const periodPass=Boolean(periodFrom&&periodTo&&new Date(periodFrom)<=new Date(periodTo));
    return {rowPass,payoutPass,taxPass,periodPass,complete:rowPass&&payoutPass&&taxPass&&periodPass,strictMatched,unmatched,manual,settlementTotal,payoutTotal,taxLedger,taxExpected};
  }

  function installAccountingAudit() {
    const section=document.getElementById('profit'); if(!section)return;
    let panel=document.getElementById('v343AccountingAudit');
    if(!panel){panel=document.createElement('article');panel.id='v343AccountingAudit';panel.className='panel';section.prepend(panel);}
    const previousValues={payout:document.getElementById('auditPayoutTotal')?.value||'',tax:document.getElementById('auditTaxExpected')?.value||'',from:document.getElementById('auditPeriodFrom')?.value||'',to:document.getElementById('auditPeriodTo')?.value||''};
    const gate=accountingGate();
    panel.innerHTML=`<div class="panel-head"><div><h3>${gate.complete?'Accounting Reconciliation Complete':'Accounting Reconciliation Pending'}</h3><small>Requires strict row matching, payout total, tax total and complete reporting period.</small></div><strong>${gate.complete?'All Gates Passed':'Review Required'}</strong></div><div class="form-grid"><label>Bank/UTR Payout Total<input id="auditPayoutTotal" type="number" step="0.01" value="${previousValues.payout}"></label><label>GST + TDS + TCS Report Total<input id="auditTaxExpected" type="number" step="0.01" value="${previousValues.tax}"></label><label>Period From<input id="auditPeriodFrom" type="date" value="${previousValues.from}"></label><label>Period To<input id="auditPeriodTo" type="date" value="${previousValues.to}"></label><button id="auditRecheck" class="primary">Recheck Accounting Gates</button></div><div class="kpis"><div class="kpi"><small>Row Matching</small><strong>${gate.rowPass?'Pass':'Fail'}</strong></div><div class="kpi"><small>Payout Match</small><strong>${gate.payoutPass?'Pass':'Fail'}</strong></div><div class="kpi"><small>Tax Match</small><strong>${gate.taxPass?'Pass':'Fail'}</strong></div><div class="kpi"><small>Period Complete</small><strong>${gate.periodPass?'Pass':'Fail'}</strong></div><div class="kpi"><small>Ledger Settlement</small><strong>₹${gate.settlementTotal.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Ledger Taxes</small><strong>₹${gate.taxLedger.toLocaleString('en-IN')}</strong></div></div>`;
    document.getElementById('auditRecheck')?.addEventListener('click',installAccountingAudit);
  }

  async function realBenchmark() {
    const output=document.getElementById('stressDiagnosticOutput'),button=document.getElementById('runStressDiagnostic'); if(button)button.disabled=true;
    try{
      const start=performance.now();
      const syntheticOrders=new Array(BENCHMARK_ROWS),syntheticLedger=new Array(BENCHMARK_ROWS);
      for(let i=0;i<BENCHMARK_ROWS;i++){
        syntheticOrders[i]={recordId:`ITEM-${i}`,orderId:`OD${1000000000+i}`,orderItemId:`ITEM-${i}`,sku:`SKU-${i%5000}`,qty:(i%3)+1,sale:299+(i%700),status:i%7===0?'Returned':'Delivered',state:`STATE-${i%30}`};
        syntheticLedger[i]={ledgerKey:`TX-${i}|commission|ITEM-${i}`,transactionId:`TX-${i}`,orderItemId:`ITEM-${i}`,chargeType:'commission',commission:(i%50)+1,settlement:200+(i%500)};
        if(i&&i%10000===0)await yieldUi();
      }
      const mapStart=performance.now(),orderMap=new Map(syntheticOrders.map(row=>[row.recordId,row])),ledgerMap=new Map(syntheticLedger.map(row=>[row.ledgerKey,row]));
      const grouped=new Map();for(const row of syntheticOrders)grouped.set(row.sku,(grouped.get(row.sku)||0)+row.sale*row.qty);
      const serialized=JSON.stringify({orders:syntheticOrders.slice(0,5000),ledger:syntheticLedger.slice(0,5000)});
      const tempKey='dc_fk_v343_benchmark_tmp';await chrome.storage.local.set({[tempKey]:serialized});const readBack=(await chrome.storage.local.get(tempKey))[tempKey];await chrome.storage.local.remove(tempKey);
      if(readBack.length!==serialized.length)throw new Error('Temporary storage read-back mismatch');
      const elapsed=Math.round(performance.now()-start),mapElapsed=Math.round(performance.now()-mapStart),bytes=new Blob([JSON.stringify(syntheticOrders),JSON.stringify(syntheticLedger)]).size;
      if(output)output.textContent=`Real 100k benchmark passed: ${elapsed} ms total · ${mapElapsed} ms dedup/group/serialize · ${(bytes/1048576).toFixed(1)} MB serialized · ${orderMap.size.toLocaleString('en-IN')} orders · ${ledgerMap.size.toLocaleString('en-IN')} ledger rows · temporary storage read-back verified.`;
    }catch(error){if(output)output.textContent=`Benchmark failed: ${error.message||error}`;}finally{if(button)button.disabled=false;}
  }

  function installBenchmark() {
    const section=document.getElementById('settings');if(!section)return;
    let panel=document.getElementById('productionDiagnostics');
    if(!panel){panel=document.createElement('article');panel.id='productionDiagnostics';panel.className='panel';section.appendChild(panel);}
    panel.innerHTML='<div class="panel-head"><div><h3>Production Diagnostics</h3><small>100k synthetic orders + ledger + grouping + serialization + temporary storage verification</small></div><button id="runStressDiagnostic" class="secondary">Run Real 100k Test</button></div><p id="stressDiagnosticOutput" class="hint">Not run yet. Large tables use 250-row pages.</p>';
    document.getElementById('runStressDiagnostic')?.addEventListener('click',realBenchmark);
  }

  function wrapRender() {
    if(typeof render!=='function'||render.__v343Wrapped)return;
    const original=render;
    render=function(...args){const result=original.apply(this,args);queueMicrotask(()=>{ensurePdfControls();bindPdfInput();installAccountingAudit();installBenchmark();paginateRenderedTables();});return result;};
    render.__v343Wrapped=true;
  }

  function boot(){wrapRender();ensurePdfControls();bindPdfInput();installAccountingAudit();installBenchmark();paginateRenderedTables();setStatus('PDF engine ready. Outputs use 100-page chunks. PDF structure is checked; printed barcode/QR scanner validation is still required.');}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();