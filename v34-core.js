'use strict';
(() => {
  const CAPTURE_KEY='dc_fk_capture_control_v34';
  const capture={generation:1,paused:false,clearTimestamp:0,activeSyncJobId:null};
  const safeNum=v=>Number.isFinite(Number(v))?Number(v):0;
  const txt=v=>String(v??'').trim();
  const sku=v=>txt(v).toUpperCase();
  const hasOwn=(obj,key)=>Boolean(obj&&Object.prototype.hasOwnProperty.call(obj,key));
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
    if(/promotion/.test(s))return'promotion';
    if(/packag/.test(s))return'packaging';
    if(/cancel/.test(s))return'cancellation';
    if(/adjust|compensation|recovery|claim/.test(s))return'adjustment';
    return s||'other';
  }

  function ids(row={}){
    const src=row.raw||row;
    const pick=(...keys)=>{for(const k of keys){const v=src[k]??row[k];if(v!==undefined&&v!==null&&String(v).trim())return String(v).trim()}return''};
    return {...row,orderId:pick('orderId','order_id','customerOrderId'),orderItemId:pick('orderItemId','order_item_id','orderItemID'),shipmentId:pick('shipmentId','shipment_id'),subOrderId:pick('subOrderId','suborderId','sub_order_id'),transactionId:pick('transactionId','transaction_id','paymentId'),settlementReference:pick('settlementReference','settlementRef','settlement_id','remittanceId'),returnId:pick('returnId','return_id'),refundId:pick('refundId','refund_id'),sku:sku(pick('sku','sellerSku','seller_sku')),qty:Math.max(1,safeNum(pick('qty','quantity','itemQuantity'))||safeNum(row.qty)||1),chargeType:canonicalChargeType(pick('chargeType','charge_type','feeType','type','financialType'))};
  }

  function readPresentField(source,keys,label){
    for(const obj of [source,source?.raw].filter(Boolean)){
      for(const key of keys){
        if(!hasOwn(obj,key))continue;
        const raw=obj[key];
        if(raw===undefined||raw===null||String(raw).trim()==='')continue;
        return{value:safeNum(raw),present:true,source:label,key};
      }
    }
    return{value:0,present:false,source:label,key:null};
  }
  function aggregatePresentFields(items,groups,label='ledger'){
    let value=0,present=false;const keys=[];
    for(const item of items){
      for(const aliases of groups){const f=readPresentField(item,aliases,label);if(f.present){value+=f.value;present=true;keys.push(f.key);break}}
    }
    return{value,present,source:label,keys};
  }
  function chooseFinancialField(ledger,report,captured){
    if(ledger?.present)return ledger;
    if(report?.present)return report;
    if(captured?.present)return captured;
    return{value:0,present:false,source:'absent',key:null};
  }

  const fieldAliases={
    sellingPrice:['sellingPrice','sale','price','itemPrice'],settlement:['settlement','settlementAmount','netSettlement','paymentAmount'],commission:['commission','commissionFee'],marketplaceFee:['marketplaceFee','marketplace_fee','fees'],shipping:['shipping','shippingFee','shippingCharge','forwardShipping'],reverseShipping:['reverseShipping','reverseShippingFee','returnShippingFee'],gst:['gst','gstAmount','taxOnFees'],tds:['tds','tdsAmount'],tcs:['tcs','tcsAmount'],collectionFee:['collectionFee','collection_fee'],fixedFee:['fixedFee','fixed_fee'],adjustment:['adjustment','adjustmentAmount','compensation','recovery'],refund:['refund','refundAmount'],penalty:['penalty','penaltyAmount'],otherCharges:['otherCharges','other_charges'],returnCharges:['returnCharges','returnCharge'],cancellationCharges:['cancellationCharges','cancellationCharge'],packagingFee:['packagingFee','packaging_fee'],promotionFee:['promotionFee','promotion_fee'],taxes:['taxes','taxAmount']
  };
  function ledgerFinancial(items,field){return aggregatePresentFields(items,[fieldAliases[field]||[field]],'ledger');}
  function sourceFinancial(row,field,label){
    const special={
      settlement:label==='report'?['orderReportedSettlement','reportSettlement','settlement']:['capturedSettlement','settlement'],
      marketplaceFee:label==='report'?['orderReportedFees','reportFees','marketplaceFee','fees']:['capturedFees','marketplaceFee','fees'],
      refund:label==='report'?['orderReportedRefund','reportRefund','refund']:['capturedRefund','refund']
    };
    return readPresentField(row,special[field]||fieldAliases[field]||[field],label);
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
    const uniqueOrAmbiguous=(items,reason)=>items.length?{items,status:items.length===1?'matched':'ambiguous',reason}:null;
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

  function ensureMatchCountPanel(){const section=document.getElementById('settlements');if(!section)return null;let el=document.getElementById('financialMatchCounts');if(!el){el=document.createElement('div');el.id='financialMatchCounts';el.className='kpis';section.querySelector('#settlementKpis')?.insertAdjacentElement('afterend',el)}return el;}
  function renderMatchCounts(matchedCount,unmatchedCount,manualCount,ambiguousCount){const el=ensureMatchCountPanel();if(!el)return;const cards=[['Matched Financial Records',matchedCount],['Unmatched Financial Records',unmatchedCount],['Manual Review Required',manualCount],['Ambiguous Records',ambiguousCount]];el.innerHTML=cards.map(([label,value])=>`<div class="kpi"><small>${label}</small><strong>${Number(value||0).toLocaleString('en-IN')}</strong></div>`).join('');}

  if(typeof financialRecordKey==='function')financialRecordKey=ledgerKey;
  if(typeof mergeFinancialsIntoRows==='function'){
    mergeFinancialsIntoRows=function(base,network){
      const incoming=typeof financialRows==='function'?financialRows(network).map(ids):[];
      financialLedger=upsertLedger(financialLedger||[],incoming);
      const matched=new Set(),manualIds=new Set();let ambiguousCount=0;
      const fields=['sellingPrice','settlement','commission','marketplaceFee','shipping','reverseShipping','gst','tds','tcs','collectionFee','fixedFee','adjustment','refund','penalty','otherCharges','returnCharges','cancellationCharges','packagingFee','promotionFee','taxes'];
      const result=(base||[]).map(raw=>{
        const row=ids(raw),decision=strictMatch(row,financialLedger,matched),items=decision.status==='matched'?decision.items:[];
        if(decision.status==='ambiguous')ambiguousCount+=decision.items.length;
        if(decision.status==='manual_review_required')for(const x of decision.manualCandidates||[])manualIds.add(ledgerKey(x));
        items.forEach(x=>matched.add(ledgerKey(x)));
        const chosen={},financialSources={},financialPresence={};
        for(const field of fields){const selected=chooseFinancialField(ledgerFinancial(items,field),sourceFinancial(row,field,'report'),sourceFinancial(row,field,'captured'));chosen[field]=selected.value;financialSources[field]=selected.source;financialPresence[field]=selected.present;}
        const feeParts=['commission','marketplaceFee','collectionFee','fixedFee'];
        const fees=feeParts.some(k=>financialPresence[k])?feeParts.reduce((a,k)=>a+safeNum(chosen[k]),0):0;
        return{...row,orderReportedFees:sourceFinancial(row,'marketplaceFee','report').value,orderReportedSettlement:sourceFinancial(row,'settlement','report').value,orderReportedRefund:sourceFinancial(row,'refund','report').value,ledgerFees:feeParts.reduce((a,k)=>{const f=ledgerFinancial(items,k);return a+(f.present?f.value:0)},0),ledgerSettlement:ledgerFinancial(items,'settlement').value,ledgerRefund:ledgerFinancial(items,'refund').value,fees,settlement:chosen.settlement,refund:chosen.refund,sale:financialPresence.sellingPrice?chosen.sellingPrice:safeNum(row.sale),shipping:chosen.shipping,reverseShipping:chosen.reverseShipping,gst:chosen.gst,tds:chosen.tds,tcs:chosen.tcs,adjustment:chosen.adjustment,commission:chosen.commission,collectionFee:chosen.collectionFee,fixedFee:chosen.fixedFee,penalty:chosen.penalty,otherCharges:chosen.otherCharges,returnCharges:chosen.returnCharges,cancellationCharges:chosen.cancellationCharges,packagingFee:chosen.packagingFee,promotionFee:chosen.promotionFee,taxes:chosen.taxes,financialSources,financialPresence,reconciliationSource:items.length?'Mixed field-level sources':'Order report',reconciliationStatus:decision.status,reconciliationReason:decision.reason};
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
    migrateSellerNamespace=async function(oldSeller,newSeller){if(migrationPromise)return migrationPromise;migrationPromise=(async()=>{const oldKey=sellerKeyFor(oldSeller),newKey=sellerKeyFor(newSeller);if(oldKey===newKey)return;const d=await chrome.storage.local.get([oldKey,newKey,STORAGE_INDEX_KEY]),a=d[oldKey]||{},b=d[newKey]||{};const merge=(x=[],y=[],keyFn=z=>z.recordId||`${z.orderId||''}|${z.sku||''}|${z.date||''}|${z.qty||1}`)=>{const m=new Map();for(const z of[...x,...y]){const n=ids(z);m.set(keyFn(n),{...(m.get(keyFn(n))||{}),...n})}return[...m.values()]};const merged={...a,...b,rows:merge(a.rows,b.rows),inventoryRows:merge(a.inventoryRows,b.inventoryRows,z=>z.listingId||z.sku||z.recordId),financialLedger:upsertLedger(a.financialLedger||[],b.financialLedger||[]),unmatchedReturns:merge(a.unmatchedReturns,b.unmatchedReturns),unmatchedFinancials:merge(a.unmatchedFinancials,b.unmatchedFinancials),syncHistory:[...(a.syncHistory||[]),...(b.syncHistory||[])].slice(-500),skuCosts:{...(a.skuCosts||{}),...(b.skuCosts||{})}};await chrome.storage.local.set({[newKey]:merged});const verify=(await chrome.storage.local.get(newKey))[newKey],fields=['rows','inventoryRows','financialLedger','unmatchedReturns','unmatchedFinancials'];if(!verify||!fields.every(k=>(verify[k]||[]).length===(merged[k]||[]).length))throw new Error('Seller migration verification failed');const index=d[STORAGE_INDEX_KEY]||{};index[sellerIdentityKey(newSeller)]={name:newSeller?.name||'',id:newSeller?.id||'',storageKey:newKey,updatedAt:Date.now(),verified:true};await chrome.storage.local.set({[STORAGE_INDEX_KEY]:index,[`${oldKey}__migrated_backup`]:{...a,migratedAt:Date.now()}});if(d[oldKey])await chrome.storage.local.remove(oldKey);})();try{return await migrationPromise}finally{migrationPromise=null}};
  }

  async function clearMode(mode){capture.generation++;capture.paused=true;capture.clearTimestamp=Date.now();capture.activeSyncJobId=null;await saveCapture();post('CLEAR_DATA_GENERATION',{generation:capture.generation,clearTimestamp:capture.clearTimestamp});if(mode==='orders')rows=[];if(mode==='financial'){financialLedger=[];unmatchedFinancials=[];manualReviewFinancials=[]}if(mode==='returns')unmatchedReturns=[];if(mode==='all'){rows=[];inventoryRows=[];financialLedger=[];unmatchedReturns=[];unmatchedFinancials=[];manualReviewFinancials=[];syncHistory=[];lastLiveSync=null}if(typeof save==='function')save();if(typeof render==='function')render();renderMatchCounts(0,unmatchedReturns.length+unmatchedFinancials.length,manualReviewFinancials.length,0);}
  function replaceClearButton(id,label,mode){const old=document.getElementById(id);if(!old)return;const btn=old.cloneNode(true);old.replaceWith(btn);btn.textContent=label;btn.onclick=async()=>{if(confirm(`${label}? Capture Sync Now tak paused rahega.`))await clearMode(mode)}}
  async function boot(){await loadCapture();replaceClearButton('clearOrders','Clear Orders Only','orders');replaceClearButton('resetExtension','Clear All Seller Data','all');renderMatchCounts(0,(unmatchedReturns||[]).length+(unmatchedFinancials||[]).length,manualReviewFinancials.length,0);document.getElementById('syncBtn')?.addEventListener('click',async()=>{capture.paused=false;capture.activeSyncJobId=crypto.randomUUID();await saveCapture();post('RESUME_CAPTURE',{generation:capture.generation,syncJobId:capture.activeSyncJobId})},true);const ok=Boolean(globalThis.PDFLib?.PDFDocument),crop=document.getElementById('cropProcessBtn'),preview=document.getElementById('cropPreviewBtn'),status=document.getElementById('cropStatus');if(crop)crop.disabled=!ok;if(preview)preview.disabled=!ok;if(status)status.textContent=ok?'PDF engine ready (pdf-lib loaded locally).':'PDF engine unavailable.';}

  const migrationIntegrityScript=document.createElement('script');
  migrationIntegrityScript.src=chrome.runtime.getURL('v341-migration-integrity.js');
  migrationIntegrityScript.async=false;
  document.documentElement.appendChild(migrationIntegrityScript);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();