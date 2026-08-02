'use strict';
(() => {
  const CAPTURE_KEY='dc_fk_capture_control_v34';
  const capture={generation:1,paused:false,clearTimestamp:0,activeSyncJobId:null};
  const safeNum=v=>Number.isFinite(Number(v))?Number(v):0;
  const txt=v=>String(v??'').trim();
  const sku=v=>txt(v).toUpperCase();
  let manualReviewFinancials=[];

  async function loadCapture(){const d=await chrome.storage.local.get(CAPTURE_KEY);Object.assign(capture,d[CAPTURE_KEY]||{});}
  async function saveCapture(){await chrome.storage.local.set({[CAPTURE_KEY]:{...capture}});}
  function post(type,payload={}){try{window.parent.postMessage({source:'DC_FK_DASHBOARD',type,payload,token:CHANNEL_TOKEN},'*')}catch{}}

  function canonicalChargeType(value){
    const s=txt(value).toLowerCase().replace(/[\s-]+/g,'_');
    if(/commission|marketplace_fee|marketplacefee/.test(s))return'commission';
    if(/reverse.*ship|return.*ship|reverse_freight/.test(s))return'reverse_shipping';
    if(/shipping|logistic|freight/.test(s))return'shipping';
    if(/\bgst\b|tax_on_fee/.test(s))return'gst';
    if(/\btds\b/.test(s))return'tds';
    if(/\btcs\b/.test(s))return'tcs';
    if(/fixed.*fee/.test(s))return'fixed_fee';
    if(/collection.*fee/.test(s))return'collection_fee';
    if(/refund/.test(s))return'refund';
    if(/penalty|fine/.test(s))return'penalty';
    if(/adjust|compensation|recovery|claim/.test(s))return'adjustment';
    return s||'financial';
  }

  function ids(row={}){
    const src=row.raw||row;
    const pick=(...keys)=>{for(const k of keys){const v=src[k]??row[k];if(v!==undefined&&v!==null&&String(v).trim())return String(v).trim()}return''};
    return {...row,orderId:pick('orderId','order_id','customerOrderId'),orderItemId:pick('orderItemId','order_item_id','orderItemID'),shipmentId:pick('shipmentId','shipment_id'),subOrderId:pick('subOrderId','suborderId','sub_order_id'),transactionId:pick('transactionId','transaction_id','paymentId'),settlementReference:pick('settlementReference','settlementRef','settlement_id','remittanceId'),returnId:pick('returnId','return_id'),refundId:pick('refundId','refund_id'),sku:sku(pick('sku','sellerSku','seller_sku')),qty:Math.max(1,safeNum(pick('qty','quantity','itemQuantity'))||safeNum(row.qty)||1),chargeType:canonicalChargeType(pick('chargeType','charge_type','feeType','type','financialType'))};
  }
  function ledgerKey(raw={}){
    const x=ids(raw),type=x.chargeType;
    if(x.transactionId)return`tx:${x.transactionId}|charge:${type}|item:${x.orderItemId||x.subOrderId||'none'}|sku:${x.sku||'none'}`;
    if(x.settlementReference)return`settlement:${x.settlementReference}|charge:${type}|item:${x.orderItemId||x.subOrderId||'none'}|sku:${x.sku||'none'}`;
    if(x.refundId)return`refund:${x.refundId}|item:${x.orderItemId||x.subOrderId||'none'}`;
    if(x.returnId)return`return:${x.returnId}|item:${x.orderItemId||x.subOrderId||'none'}`;
    if(x.orderItemId)return`item:${x.orderItemId}:${type}`;
    if(x.shipmentId)return`shipment:${x.shipmentId}:${type}`;
    if(x.subOrderId)return`suborder:${x.subOrderId}:${type}`;
    return`fallback:${txt(connectedSeller?.id)}:${x.orderId}:${x.sku}:${x.qty}:${type}:${txt(raw.sourceFile||raw.url)}:${txt(raw.sourceRowReference||raw.rowNumber||raw.recordId)}`;
  }
  function upsertLedger(current=[],incoming=[]){
    const map=new Map();
    for(const raw of current){const x=ids(raw),k=ledgerKey(x);map.set(k,{...x,ledgerId:k,firstSeenAt:x.firstSeenAt||new Date().toISOString(),lastSeenAt:x.lastSeenAt||new Date().toISOString()})}
    for(const raw of incoming){const x=ids(raw),k=ledgerKey(x),old=map.get(k);map.set(k,{...(old||{}),...x,ledgerId:k,firstSeenAt:old?.firstSeenAt||new Date().toISOString(),lastSeenAt:new Date().toISOString(),revisionCount:safeNum(old?.revisionCount)+(old?1:0)})}
    return[...map.values()];
  }

  function strictMatch(row,ledger,alreadyMatched){
    const r=ids(row),available=ledger.filter(x=>!alreadyMatched.has(ledgerKey(x)));
    const uniqueOrAmbiguous=(items,reason)=>{
      if(!items.length)return null;
      return {items,status:items.length===1?'matched':'ambiguous',reason};
    };
    let result;
    result=uniqueOrAmbiguous(available.filter(x=>r.orderItemId&&x.orderItemId===r.orderItemId),'order_item_id_exact');if(result)return result;
    result=uniqueOrAmbiguous(available.filter(x=>r.subOrderId&&x.subOrderId===r.subOrderId),'sub_order_id_exact');if(result)return result;
    result=uniqueOrAmbiguous(available.filter(x=>r.transactionId&&r.orderItemId&&x.transactionId===r.transactionId&&x.chargeType===r.chargeType&&x.orderItemId===r.orderItemId),'transaction_charge_item');if(result)return result;
    result=uniqueOrAmbiguous(available.filter(x=>r.transactionId&&r.sku&&x.transactionId===r.transactionId&&x.chargeType===r.chargeType&&x.sku===r.sku),'transaction_charge_sku');if(result)return result;
    result=uniqueOrAmbiguous(available.filter(x=>r.orderId&&r.sku&&x.orderId===r.orderId&&x.sku===r.sku&&safeNum(x.qty)===safeNum(r.qty)),'order_sku_quantity');if(result)return result;
    result=uniqueOrAmbiguous(available.filter(x=>r.orderId&&r.sku&&x.orderId===r.orderId&&x.sku===r.sku),'order_sku');if(result)return result;
    const orderOnly=available.filter(x=>r.orderId&&x.orderId===r.orderId);
    if(orderOnly.length)return{items:[],manualCandidates:orderOnly,status:'manual_review_required',reason:'order_id_only_ambiguous'};
    return{items:[],status:'unmatched',reason:'no_strict_identifier_match'};
  }

  function ensureMatchCountPanel(){
    const section=document.getElementById('settlements');if(!section)return null;
    let el=document.getElementById('financialMatchCounts');
    if(!el){el=document.createElement('div');el.id='financialMatchCounts';el.className='kpis';const anchor=section.querySelector('#settlementKpis');anchor?.insertAdjacentElement('afterend',el)}
    return el;
  }
  function renderMatchCounts(matchedCount,unmatchedCount,manualCount,ambiguousCount){
    const el=ensureMatchCountPanel();if(!el)return;
    const cards=[['Matched Financial Records',matchedCount],['Unmatched Financial Records',unmatchedCount],['Manual Review Required',manualCount],['Ambiguous Records',ambiguousCount]];
    el.innerHTML=cards.map(([label,value])=>`<div class="kpi"><small>${label}</small><strong>${Number(value||0).toLocaleString('en-IN')}</strong></div>`).join('');
  }

  if(typeof financialRecordKey==='function')financialRecordKey=ledgerKey;
  if(typeof mergeFinancialsIntoRows==='function'){
    mergeFinancialsIntoRows=function(base,network){
      const incoming=typeof financialRows==='function'?financialRows(network).map(ids):[];
      financialLedger=upsertLedger(financialLedger||[],incoming);
      const matched=new Set(),manualIds=new Set();
      let ambiguousCount=0;
      const result=(base||[]).map(raw=>{
        const row=ids(raw),decision=strictMatch(row,financialLedger,matched);
        const items=decision.status==='matched'?decision.items:[];
        if(decision.status==='ambiguous')ambiguousCount+=decision.items.length;
        if(decision.status==='manual_review_required')for(const x of decision.manualCandidates||[])manualIds.add(ledgerKey(x));
        items.forEach(x=>matched.add(ledgerKey(x)));
        const sum=k=>items.reduce((a,x)=>a+safeNum(x[k]),0);
        const ledgerFees=sum('fees')+sum('collectionFee')+sum('fixedFee');
        const reportedFees=safeNum(row.orderReportedFees??row.fees);
        const ledgerSettlement=sum('settlement'),reportedSettlement=safeNum(row.orderReportedSettlement??row.settlement);
        const ledgerRefund=sum('refund'),reportedRefund=safeNum(row.orderReportedRefund??row.refund);
        return{...row,orderReportedFees:reportedFees,orderReportedSettlement:reportedSettlement,orderReportedRefund:reportedRefund,ledgerFees,ledgerSettlement,ledgerRefund,fees:items.length?ledgerFees:reportedFees,settlement:items.length?ledgerSettlement:reportedSettlement,refund:items.length?ledgerRefund:reportedRefund,shipping:items.length?sum('shipping'):safeNum(row.shipping),reverseShipping:items.length?sum('reverseShipping'):safeNum(row.reverseShipping),gst:items.length?sum('gst'):safeNum(row.gst),tds:items.length?sum('tds'):safeNum(row.tds),tcs:items.length?sum('tcs'):safeNum(row.tcs),adjustment:items.length?sum('adjustment'):safeNum(row.adjustment),reconciliationSource:items.length?'Ledger':'Order report',reconciliationStatus:decision.status,reconciliationReason:decision.reason};
      });
      const isReturn=x=>/return|refund|rto/i.test(String(x.type||x.financialType||x.chargeType||''));
      manualReviewFinancials=financialLedger.filter(x=>manualIds.has(ledgerKey(x))).map(x=>({...x,matchStatus:'manual_review_required',matchReason:'order_id_only_ambiguous'}));
      unmatchedReturns=financialLedger.filter(x=>isReturn(x)&&!matched.has(ledgerKey(x))&&!manualIds.has(ledgerKey(x)));
      unmatchedFinancials=financialLedger.filter(x=>!isReturn(x)&&!matched.has(ledgerKey(x))&&!manualIds.has(ledgerKey(x)));
      renderMatchCounts(matched.size,unmatchedReturns.length+unmatchedFinancials.length,manualReviewFinancials.length,ambiguousCount);
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
    if(mode==='orders')rows=[];if(mode==='financial'){financialLedger=[];unmatchedFinancials=[];manualReviewFinancials=[]}if(mode==='returns')unmatchedReturns=[];if(mode==='all'){rows=[];inventoryRows=[];financialLedger=[];unmatchedReturns=[];unmatchedFinancials=[];manualReviewFinancials=[];syncHistory=[];lastLiveSync=null}
    if(typeof save==='function')save();if(typeof render==='function')render();renderMatchCounts(0,unmatchedReturns.length+unmatchedFinancials.length,manualReviewFinancials.length,0);
  }
  function replaceClearButton(id,label,mode){const old=document.getElementById(id);if(!old)return;const btn=old.cloneNode(true);old.replaceWith(btn);btn.textContent=label;btn.onclick=async()=>{if(confirm(`${label}? Capture Sync Now tak paused rahega.`))await clearMode(mode)}}
  async function boot(){
    await loadCapture();replaceClearButton('clearOrders','Clear Orders Only','orders');replaceClearButton('resetExtension','Clear All Seller Data','all');renderMatchCounts(0,(unmatchedReturns||[]).length+(unmatchedFinancials||[]).length,manualReviewFinancials.length,0);
    const sync=document.getElementById('syncBtn');sync?.addEventListener('click',async()=>{capture.paused=false;capture.activeSyncJobId=crypto.randomUUID();await saveCapture();post('RESUME_CAPTURE',{generation:capture.generation,syncJobId:capture.activeSyncJobId})},true);
    const ok=Boolean(globalThis.PDFLib?.PDFDocument),crop=document.getElementById('cropProcessBtn'),preview=document.getElementById('cropPreviewBtn'),status=document.getElementById('cropStatus');if(crop)crop.disabled=!ok;if(preview)preview.disabled=!ok;if(status)status.textContent=ok?'PDF engine ready (pdf-lib loaded locally).':'PDF engine unavailable.';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();