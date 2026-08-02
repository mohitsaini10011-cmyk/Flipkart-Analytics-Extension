'use strict';
(() => {
  const CAPTURE_KEY='dc_fk_capture_control_v34';
  const capture={generation:1,paused:false,clearTimestamp:0,activeSyncJobId:null};
  const safeNum=v=>Number.isFinite(Number(v))?Number(v):0;
  const txt=v=>String(v??'').trim();
  const sku=v=>txt(v).toUpperCase();

  async function loadCapture(){const d=await chrome.storage.local.get(CAPTURE_KEY);Object.assign(capture,d[CAPTURE_KEY]||{});}
  async function saveCapture(){await chrome.storage.local.set({[CAPTURE_KEY]:{...capture}});}
  function post(type,payload={}){try{window.parent.postMessage({source:'DC_FK_DASHBOARD',type,payload,token:CHANNEL_TOKEN},'*')}catch{}}

  function ids(row={}){
    const src=row.raw||row;
    const pick=(...keys)=>{for(const k of keys){const v=src[k]??row[k];if(v!==undefined&&v!==null&&String(v).trim())return String(v).trim()}return''};
    return {...row,orderId:pick('orderId','order_id','customerOrderId'),orderItemId:pick('orderItemId','order_item_id','orderItemID'),shipmentId:pick('shipmentId','shipment_id'),subOrderId:pick('subOrderId','suborderId','sub_order_id'),transactionId:pick('transactionId','transaction_id','paymentId'),settlementReference:pick('settlementReference','settlementRef','settlement_id','remittanceId'),returnId:pick('returnId','return_id'),refundId:pick('refundId','refund_id'),sku:sku(pick('sku','sellerSku','seller_sku'))};
  }
  function ledgerKey(raw={}){
    const x=ids(raw),type=txt(raw.financialType||raw.type||'financial').toLowerCase();
    if(x.transactionId)return`tx:${x.transactionId}`;
    if(x.settlementReference)return`settlement:${x.settlementReference}`;
    if(x.refundId)return`refund:${x.refundId}`;
    if(x.returnId)return`return:${x.returnId}`;
    if(x.orderItemId)return`item:${x.orderItemId}:${type}`;
    if(x.shipmentId)return`shipment:${x.shipmentId}:${type}`;
    if(x.subOrderId)return`suborder:${x.subOrderId}:${type}`;
    return`fallback:${txt(connectedSeller?.id)}:${x.orderId}:${x.sku}:${type}:${txt(raw.sourceFile||raw.url)}:${txt(raw.sourceRowReference||raw.rowNumber||raw.recordId)}`;
  }
  function upsertLedger(current=[],incoming=[]){
    const map=new Map();
    for(const raw of current){const x=ids(raw),k=ledgerKey(x);map.set(k,{...x,ledgerId:k,firstSeenAt:x.firstSeenAt||new Date().toISOString(),lastSeenAt:x.lastSeenAt||new Date().toISOString()})}
    for(const raw of incoming){const x=ids(raw),k=ledgerKey(x),old=map.get(k);map.set(k,{...(old||{}),...x,ledgerId:k,firstSeenAt:old?.firstSeenAt||new Date().toISOString(),lastSeenAt:new Date().toISOString(),revisionCount:safeNum(old?.revisionCount)+(old?1:0)})}
    return[...map.values()];
  }
  function match(row,ledger){
    const r=ids(row),tests=[x=>r.orderItemId&&x.orderItemId===r.orderItemId,x=>r.subOrderId&&x.subOrderId===r.subOrderId,x=>r.shipmentId&&x.shipmentId===r.shipmentId,x=>r.orderId&&r.sku&&x.orderId===r.orderId&&x.sku===r.sku];
    for(const test of tests){const c=ledger.filter(test);if(c.length===1)return c;if(c.length>1)return[]}
    const c=ledger.filter(x=>r.orderId&&x.orderId===r.orderId);return c.length===1?c:[];
  }

  if(typeof financialRecordKey==='function')financialRecordKey=ledgerKey;
  if(typeof mergeFinancialsIntoRows==='function'){
    mergeFinancialsIntoRows=function(base,network){
      const incoming=typeof financialRows==='function'?financialRows(network).map(ids):[];
      financialLedger=upsertLedger(financialLedger||[],incoming);
      const matched=new Set();
      const result=(base||[]).map(raw=>{
        const row=ids(raw),items=match(row,financialLedger);items.forEach(x=>matched.add(ledgerKey(x)));
        const sum=k=>items.reduce((a,x)=>a+safeNum(x[k]),0);
        const ledgerFees=sum('fees')+sum('collectionFee')+sum('fixedFee');
        const reportedFees=safeNum(row.orderReportedFees??row.fees);
        const ledgerSettlement=sum('settlement'),reportedSettlement=safeNum(row.orderReportedSettlement??row.settlement);
        const ledgerRefund=sum('refund'),reportedRefund=safeNum(row.orderReportedRefund??row.refund);
        return{...row,orderReportedFees:reportedFees,orderReportedSettlement:reportedSettlement,orderReportedRefund:reportedRefund,ledgerFees,ledgerSettlement,ledgerRefund,fees:items.length?ledgerFees:reportedFees,settlement:items.length?ledgerSettlement:reportedSettlement,refund:items.length?ledgerRefund:reportedRefund,shipping:items.length?sum('shipping'):safeNum(row.shipping),reverseShipping:items.length?sum('reverseShipping'):safeNum(row.reverseShipping),gst:items.length?sum('gst'):safeNum(row.gst),tds:items.length?sum('tds'):safeNum(row.tds),tcs:items.length?sum('tcs'):safeNum(row.tcs),adjustment:items.length?sum('adjustment'):safeNum(row.adjustment),reconciliationSource:items.length?'Ledger':'Order report',reconciliationStatus:items.length?'Reconciled':'Missing'};
      });
      const isReturn=x=>/return|refund|rto/i.test(String(x.type||x.financialType||''));
      unmatchedReturns=financialLedger.filter(x=>isReturn(x)&&!matched.has(ledgerKey(x)));
      unmatchedFinancials=financialLedger.filter(x=>!isReturn(x)&&!matched.has(ledgerKey(x)));
      return result;
    };
  }

  if(typeof migrateSellerNamespace==='function'){
    let migrationPromise=null;
    migrateSellerNamespace=async function(oldSeller,newSeller){
      if(migrationPromise)return migrationPromise;
      migrationPromise=(async()=>{
        const oldKey=sellerKeyFor(oldSeller),newKey=sellerKeyFor(newSeller);if(oldKey===newKey)return;
        const d=await chrome.storage.local.get([oldKey,newKey,STORAGE_INDEX_KEY]);const a=d[oldKey]||{},b=d[newKey]||{};
        const merge=(x=[],y=[],keyFn=z=>z.recordId||`${z.orderId||''}|${z.sku||''}|${z.date||''}|${z.qty||1}`)=>{const m=new Map();for(const z of[...x,...y]){const n=ids(z);m.set(keyFn(n),{...(m.get(keyFn(n))||{}),...n})}return[...m.values()]};
        const merged={...a,...b,rows:merge(a.rows,b.rows),inventoryRows:merge(a.inventoryRows,b.inventoryRows,z=>z.listingId||z.sku||z.recordId),financialLedger:upsertLedger(a.financialLedger||[],b.financialLedger||[]),unmatchedReturns:merge(a.unmatchedReturns,b.unmatchedReturns),unmatchedFinancials:merge(a.unmatchedFinancials,b.unmatchedFinancials),syncHistory:[...(a.syncHistory||[]),...(b.syncHistory||[])].slice(-500),skuCosts:{...(a.skuCosts||{}),...(b.skuCosts||{})}};
        await chrome.storage.local.set({[newKey]:merged});const verify=(await chrome.storage.local.get(newKey))[newKey];
        const fields=['rows','inventoryRows','financialLedger','unmatchedReturns','unmatchedFinancials'];
        if(!verify||!fields.every(k=>(verify[k]||[]).length===(merged[k]||[]).length))throw new Error('Seller migration verification failed');
        const index=d[STORAGE_INDEX_KEY]||{};index[sellerIdentityKey(newSeller)]={name:newSeller?.name||'',id:newSeller?.id||'',storageKey:newKey,updatedAt:Date.now(),verified:true};
        await chrome.storage.local.set({[STORAGE_INDEX_KEY]:index,[`${oldKey}__migrated_backup`]:{...a,migratedAt:Date.now()}});if(d[oldKey])await chrome.storage.local.remove(oldKey);
      })();
      try{return await migrationPromise}finally{migrationPromise=null}
    };
  }

  async function clearMode(mode){
    capture.generation++;capture.paused=true;capture.clearTimestamp=Date.now();capture.activeSyncJobId=null;await saveCapture();post('CLEAR_DATA_GENERATION',{generation:capture.generation,clearTimestamp:capture.clearTimestamp});
    if(mode==='orders')rows=[];if(mode==='financial'){financialLedger=[];unmatchedFinancials=[]}if(mode==='returns')unmatchedReturns=[];if(mode==='all'){rows=[];inventoryRows=[];financialLedger=[];unmatchedReturns=[];unmatchedFinancials=[];syncHistory=[];lastLiveSync=null}
    if(typeof save==='function')save();if(typeof render==='function')render();
  }
  function replaceClearButton(id,label,mode){const old=document.getElementById(id);if(!old)return;const btn=old.cloneNode(true);old.replaceWith(btn);btn.textContent=label;btn.onclick=async()=>{if(confirm(`${label}? Capture Sync Now tak paused rahega.`))await clearMode(mode)}}
  async function boot(){
    await loadCapture();replaceClearButton('clearOrders','Clear Orders Only','orders');replaceClearButton('resetExtension','Clear All Seller Data','all');
    const sync=document.getElementById('syncBtn');sync?.addEventListener('click',async()=>{capture.paused=false;capture.activeSyncJobId=crypto.randomUUID();await saveCapture();post('RESUME_CAPTURE',{generation:capture.generation,syncJobId:capture.activeSyncJobId})},true);
    const ok=Boolean(globalThis.PDFLib?.PDFDocument),crop=document.getElementById('cropProcessBtn'),preview=document.getElementById('cropPreviewBtn'),status=document.getElementById('cropStatus');if(crop)crop.disabled=!ok;if(preview)preview.disabled=!ok;if(status)status.textContent=ok?'PDF engine ready (pdf-lib loaded locally).':'PDF engine unavailable.';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
