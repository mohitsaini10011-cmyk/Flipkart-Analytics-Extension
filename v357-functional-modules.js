'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const cash = v => typeof money === 'function' ? money(v) : `₹${Number(v || 0).toLocaleString('en-IN')}`;
  const percent = v => typeof pct === 'function' ? pct(v) : `${Number(v || 0).toFixed(1)}%`;
  const safe = v => typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emptyRow = (cols, text) => `<tbody><tr><td colspan="${cols}"><div class="dc-empty-state"><b>No data available</b><small>${safe(text)}</small></div></td></tr></tbody>`;
  let orderPage = 0;
  const ORDER_PAGE_SIZE = 100;

  function installStyles(){
    if ($('#v357Styles')) return;
    const style = document.createElement('style');
    style.id = 'v357Styles';
    style.textContent = `.dc-empty-state{padding:28px;text-align:center;color:#64748b}.dc-empty-state b{display:block;color:#172554;margin-bottom:6px}.dc-module-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}.dc-module-tools input,.dc-module-tools select{border:1px solid var(--line);background:#fff;border-radius:8px;padding:9px 10px}.dc-pagination{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:10px}.dc-details{position:fixed;right:22px;top:22px;bottom:22px;width:min(420px,calc(100vw - 44px));z-index:30;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 25px 80px #07195744;padding:18px;overflow:auto}.dc-details.hidden{display:none}.dc-details-head{display:flex;justify-content:space-between;align-items:center}.dc-details dl{display:grid;grid-template-columns:130px 1fr;gap:10px;margin-top:18px}.dc-details dt{color:#64748b}.dc-details dd{margin:0;word-break:break-word}.dc-mini-chart{display:flex;align-items:flex-end;gap:6px;height:150px;padding:14px 0}.dc-mini-chart span{flex:1;min-width:8px;background:#2874f0;border-radius:5px 5px 0 0;position:relative}.dc-mini-chart span:hover:after{content:attr(data-label);position:absolute;bottom:100%;left:50%;transform:translateX(-50%);white-space:nowrap;background:#071957;color:#fff;padding:4px 6px;border-radius:5px;font-size:10px}.dc-status{display:inline-flex;padding:4px 8px;border-radius:999px;background:#eef4ff}.dc-status.Delivered{background:#eafaf0;color:#087a36}.dc-status.Returned,.dc-status.RTO,.dc-status.Cancelled{background:#fff0ed;color:#a13c29}`;
    document.head.appendChild(style);
  }

  function ensureOrderTools(){
    const toolbar = $('#orders .toolbar');
    if (!toolbar || $('#orderSort')) return;
    const sort = document.createElement('select');
    sort.id = 'orderSort';
    sort.innerHTML = '<option value="date-desc">Newest first</option><option value="date-asc">Oldest first</option><option value="sale-desc">Highest sale</option><option value="sale-asc">Lowest sale</option><option value="sku">SKU A–Z</option>';
    sort.addEventListener('change', () => { orderPage = 0; renderOrders(typeof filtered === 'function' ? filtered() : rows); });
    toolbar.insertBefore(sort, $('#exportOrders'));
  }

  function sortedOrders(data){
    const q = ($('#orderSearch')?.value || '').toLowerCase();
    const status = $('#statusFilter')?.value || '';
    const mode = $('#orderSort')?.value || 'date-desc';
    const result = (Array.isArray(data) ? data : []).filter(r => (!status || r.status === status) && (!q || [r.orderId,r.sku,r.state,r.city,r.recordId].join(' ').toLowerCase().includes(q)));
    result.sort((a,b) => mode === 'date-asc' ? (+a.date || 0) - (+b.date || 0) : mode === 'sale-desc' ? Number(b.sale||0)-Number(a.sale||0) : mode === 'sale-asc' ? Number(a.sale||0)-Number(b.sale||0) : mode === 'sku' ? String(a.sku||'').localeCompare(String(b.sku||'')) : (+b.date || 0)-(+a.date || 0));
    return result;
  }

  function installOrderDetails(){
    if ($('#orderDetailsDrawer')) return;
    const drawer = document.createElement('aside');
    drawer.id = 'orderDetailsDrawer'; drawer.className = 'dc-details hidden';
    drawer.innerHTML = '<div class="dc-details-head"><h3>Order Details</h3><button id="closeOrderDetails" class="secondary">Close</button></div><div id="orderDetailsBody"></div>';
    document.body.appendChild(drawer);
    $('#closeOrderDetails').onclick = () => drawer.classList.add('hidden');
  }

  function showOrderDetails(row){
    const drawer = $('#orderDetailsDrawer'), body = $('#orderDetailsBody'); if(!drawer || !body) return;
    const fields = [['Order ID',row.orderId],['Record ID',row.recordId||'—'],['SKU',row.sku],['Title',row.title||'—'],['Status',row.status],['Quantity',row.qty],['Sale',cash(Number(row.sale||0)*Number(row.qty||1))],['Settlement',cash(row.settlement)],['Fees',cash(row.fees)],['Shipping',cash(row.shipping)],['Reverse shipping',cash(row.reverseShipping)],['GST/TDS/TCS',cash(Number(row.gst||0)+Number(row.tds||0)+Number(row.tcs||0))],['State',row.state||'—'],['City',row.city||'—'],['Date',row.date instanceof Date&&!isNaN(row.date)?row.date.toLocaleString('en-IN'):'—'],['Reconciliation',row.reconciliationStatus||'Not reconciled']];
    body.innerHTML = `<dl>${fields.map(([k,v])=>`<dt>${safe(k)}</dt><dd>${safe(v)}</dd>`).join('')}</dl>`;
    drawer.classList.remove('hidden');
  }

  function functionalRenderOrders(data){
    const table = $('#ordersTable'); if(!table) return;
    const all = sortedOrders(data), pages = Math.max(1, Math.ceil(all.length / ORDER_PAGE_SIZE)); orderPage = Math.min(orderPage, pages-1);
    const pageRows = all.slice(orderPage*ORDER_PAGE_SIZE,(orderPage+1)*ORDER_PAGE_SIZE);
    table.innerHTML = pageRows.length ? `<thead><tr><th>Order ID</th><th>Date</th><th>SKU</th><th>Status</th><th>Qty</th><th>Sale</th><th>State</th><th>Settlement</th><th>Action</th></tr></thead><tbody>${pageRows.map((r,i)=>`<tr><td>${safe(r.orderId)}</td><td>${r.date instanceof Date&&!isNaN(r.date)?r.date.toLocaleDateString('en-IN'):'—'}</td><td>${safe(r.sku)}</td><td><span class="dc-status ${safe(r.status)}">${safe(r.status)}</span></td><td>${Number(r.qty||0)}</td><td>${cash(Number(r.sale||0)*Number(r.qty||1))}</td><td>${safe(r.state||'—')}</td><td>${cash(r.settlement)}</td><td><button class="linkbtn dc-order-view" data-index="${i}">View</button></td></tr>`).join('')}</tbody>` : emptyRow(9,'Sync the Flipkart Orders page or import an order report.');
    let pager = $('#ordersPager'); if(!pager){pager=document.createElement('div');pager.id='ordersPager';pager.className='dc-pagination';table.parentElement?.appendChild(pager)}
    pager.innerHTML = `<button class="secondary" id="ordersPrev" ${orderPage===0?'disabled':''}>Previous</button><span>${all.length.toLocaleString('en-IN')} rows · Page ${orderPage+1}/${pages}</span><button class="secondary" id="ordersNext" ${orderPage>=pages-1?'disabled':''}>Next</button>`;
    $('#ordersPrev')?.addEventListener('click',()=>{orderPage=Math.max(0,orderPage-1);functionalRenderOrders(data)}); $('#ordersNext')?.addEventListener('click',()=>{orderPage=Math.min(pages-1,orderPage+1);functionalRenderOrders(data)});
    $$('.dc-order-view').forEach((button,i)=>button.onclick=()=>showOrderDetails(pageRows[i]));
  }

  function renderMiniChart(container, values, labels){
    if(!container) return; const max=Math.max(1,...values.map(v=>Math.abs(Number(v)||0)));
    container.innerHTML = values.length ? `<div class="dc-mini-chart">${values.map((v,i)=>`<span style="height:${Math.max(4,Math.abs(Number(v)||0)/max*100)}%" data-label="${safe(labels[i])}: ${cash(v)}"></span>`).join('')}</div>` : '<div class="dc-empty-state"><b>No chart data</b><small>Sync or import dated orders.</small></div>';
  }

  function enhanceAnalytics(){
    const page=$('#analytics'); if(!page) return;
    const sales=$('#salesAnalyticsView'), profit=$('#profitIntelligenceView');
    if(sales && !$('#monthlySalesChart')){const p=document.createElement('article');p.className='panel';p.innerHTML='<h3>Monthly Sales Trend</h3><div id="monthlySalesChart"></div>';sales.appendChild(p)}
    if(profit && !$('#profitDistributionChart')){const p=document.createElement('article');p.className='panel';p.innerHTML='<h3>SKU Profit Distribution</h3><div id="profitDistributionChart"></div>';profit.appendChild(p)}
    const data=typeof filtered==='function'?filtered():(rows||[]); const monthMap={}; for(const r of data){if(!(r.date instanceof Date)||isNaN(r.date))continue;const k=r.date.toISOString().slice(0,7);monthMap[k]=(monthMap[k]||0)+(r.status==='Delivered'?Number(r.sale||0)*Number(r.qty||1):0)}
    const months=Object.keys(monthMap).sort().slice(-12); renderMiniChart($('#monthlySalesChart'),months.map(k=>monthMap[k]),months);
    const stats=typeof skuStats==='function'?skuStats(data):[]; const buckets=[stats.filter(x=>x.profit<0).length,stats.filter(x=>x.profit===0).length,stats.filter(x=>x.profit>0&&x.profit<1000).length,stats.filter(x=>x.profit>=1000).length]; renderMiniChart($('#profitDistributionChart'),buckets,['Loss','Break-even','Profit < ₹1k','Profit ≥ ₹1k']);
  }

  function enhanceSettlement(){
    const page=$('#settlements'); if(!page || $('#settlementTools')) return;
    const tools=document.createElement('div'); tools.id='settlementTools'; tools.className='dc-module-tools'; tools.innerHTML='<button class="secondary" id="exportSettlementCsv">Export Reconciliation CSV</button><button class="secondary" id="exportUnmatchedCsv">Export Unmatched CSV</button><span class="hint">Import Reports accepts order, payment and settlement CSV/XLSX files together.</span>'; page.insertBefore(tools,page.children[1]||null);
    const exportRows=(name,list)=>{const items=Array.isArray(list)?list:[];if(!items.length){typeof show==='function'&&show('No records available to export.',true);return}const keys=[...new Set(items.flatMap(Object.keys))].filter(k=>typeof items.find(x=>x[k]!==undefined)?.[k]!=='object');const csv=[keys,...items.map(x=>keys.map(k=>x[k]??''))].map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');const u=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));chrome.downloads.download({url:u,filename:name,saveAs:true});setTimeout(()=>URL.revokeObjectURL(u),60000)};
    $('#exportSettlementCsv').onclick=()=>exportRows('settlement-reconciliation.csv',rows); $('#exportUnmatchedCsv').onclick=()=>exportRows('unmatched-financials.csv',[...(unmatchedFinancials||[]),...(unmatchedReturns||[])]);
  }

  function enhanceInventory(){
    const page=$('#inventory'); if(!page || $('#inventorySearch')) return;
    const tools=document.createElement('div');tools.className='dc-module-tools';tools.innerHTML='<input id="inventorySearch" placeholder="Search SKU or product"><select id="inventoryFilter"><option value="">All stock</option><option value="out">Out of stock</option><option value="low">Low stock</option><option value="healthy">Healthy</option></select><button class="secondary" id="exportInventory">Export Inventory CSV</button>';page.insertBefore(tools,page.querySelector('.panel'));
    const redraw=()=>{const query=$('#inventorySearch').value.toLowerCase(),filter=$('#inventoryFilter').value;const source=(inventoryRows||[]).filter(r=>(!query||[r.sku,r.title].join(' ').toLowerCase().includes(query))&&(!filter||(filter==='out'?Number(r.stock||0)===0:filter==='low'?Number(r.stock||0)>0&&Number(r.stock||0)<20:Number(r.stock||0)>=20)));const table=$('#inventoryTable');if(!table)return;table.innerHTML=source.length?`<thead><tr><th>SKU</th><th>Product</th><th>Stock</th><th>Source</th><th>Return %</th><th>Recommendation</th></tr></thead><tbody>${source.map(r=>`<tr><td>${safe(r.sku)}</td><td>${safe(r.title||'—')}</td><td>${Number(r.stock||0)}</td><td>${safe(r.source||r.coverage||'Captured')}</td><td>${percent(r.returnRate||0)}</td><td>${Number(r.stock||0)===0?'Restock now':Number(r.stock||0)<20?'Low stock':'Healthy'}</td></tr>`).join('')}</tbody>`:emptyRow(6,'No inventory rows match the selected filter.')};
    $('#inventorySearch').oninput=redraw;$('#inventoryFilter').onchange=redraw;$('#exportInventory').onclick=()=>{const list=inventoryRows||[];if(!list.length)return typeof show==='function'&&show('No inventory records to export.',true);const csv=['SKU,Product,Stock,Return Rate',...list.map(r=>[r.sku,r.title||'',r.stock||0,r.returnRate||0].map(v=>`"${String(v).replaceAll('"','""')}"`).join(','))].join('\n');const u=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));chrome.downloads.download({url:u,filename:'flipkart-inventory.csv',saveAs:true});setTimeout(()=>URL.revokeObjectURL(u),60000)};redraw();
  }

  function enhanceCosts(){
    const page=$('#costs');if(!page||$('#bulkCostImport'))return;const panel=page.querySelector('.panel');if(!panel)return;const label=document.createElement('label');label.className='secondary upload';label.textContent='Bulk Import Costs CSV';const input=document.createElement('input');input.type='file';input.accept='.csv';input.hidden=true;input.id='bulkCostImport';label.appendChild(input);panel.querySelector('.form-grid')?.appendChild(label);
    input.onchange=async()=>{try{const file=input.files?.[0];if(!file)return;const text=await file.text();const parsed=typeof csvToObjects==='function'?csvToObjects(text):[];let added=0;for(const row of parsed){const keys=Object.keys(row),skuKey=keys.find(k=>/sku/i.test(k)),costKey=keys.find(k=>/cost|purchase/i.test(k));const sku=String(row[skuKey]||'').trim().toUpperCase(),cost=typeof parseNum==='function'?parseNum(row[costKey]):Number(row[costKey]);if(sku&&cost>0){skuCosts[sku]=cost;added++}}if(typeof save==='function')save();if(typeof render==='function')render();if(typeof show==='function')show(`${added} SKU costs imported.`)}catch(error){typeof show==='function'&&show(`Cost import failed: ${error.message||error}`,true)}finally{input.value=''}};
  }

  function enhanceAll(){installStyles();ensureOrderTools();installOrderDetails();enhanceAnalytics();enhanceSettlement();enhanceInventory();enhanceCosts();if(typeof functionalRenderOrders==='function')functionalRenderOrders(typeof filtered==='function'?filtered():(rows||[]));}
  function boot(){
    if(typeof renderOrders==='function') renderOrders=function(data){functionalRenderOrders(data)};
    const oldRender=typeof render==='function'?render:null;
    if(oldRender&&!oldRender.__v357Wrapped){const wrapped=function(...args){const out=oldRender.apply(this,args);queueMicrotask(enhanceAll);return out};wrapped.__v357Wrapped=true;render=wrapped}
    document.addEventListener('click',event=>{if(event.target?.closest?.('#nav button[data-page="analytics"]'))queueMicrotask(enhanceAnalytics)});
    enhanceAll();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();