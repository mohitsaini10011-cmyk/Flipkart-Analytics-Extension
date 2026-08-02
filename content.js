'use strict';
(() => {
  const LAUNCHER_ID='dc-flipkart-analytics-launcher',OVERLAY_ID='dc-flipkart-analytics-overlay',DOCK_ID='dc-flipkart-analytics-dock';
  let networkPayloads=[];
  let bridgeToken='';
  const channelToken=crypto.randomUUID();
  let syncCancelled=false;
  let syncGeneration=0;
  let capturePausedUntil=0;
  const text=el=>String(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
  const num=v=>Number(String(v||'').replace(/[^0-9.-]/g,''))||0;
  function closeDashboard(){syncCancelled=true;syncGeneration++;const o=document.getElementById(OVERLAY_ID);if(!o)return;o.classList.add('dc-closing');document.documentElement.classList.remove('dc-fk-modal-open');setTimeout(()=>o.remove(),180)}
  function detectSellerInfo(){
    const body=text(document.body);
    const html=document.documentElement.innerHTML||'';
    const storageDump=[];
    const collectStorage=st=>{try{for(let i=0;i<Math.min(st.length,80);i++){const k=st.key(i)||'';if(!/seller|merchant|vendor|account|profile/i.test(k))continue;const v=String(st.getItem(k)||'').slice(0,12000);storageDump.push(k+'='+v)}}catch(e){}};
    collectStorage(localStorage);collectStorage(sessionStorage);
    const hay=[html,body,...storageDump].join('\n');
    const idPatterns=[
      /["'](?:sellerId|seller_id|sellerIdentifier|sellerCode|seller_code|merchantId|merchant_id|merchantCode|accountId|account_id|partnerId|vendorId)["']\s*[:=]\s*["']?([A-Z0-9_-]{4,})/i,
      /(?:seller|merchant|vendor|partner)\s*(?:id|code|identifier)\s*[:#-]?\s*([A-Z0-9_-]{4,})/i,
      /\b(?:sellerId|merchantId|vendorId)=([A-Z0-9_-]{4,})\b/i
    ];
    let id=''; for(const r of idPatterns){const m=hay.match(r);if(m&& !/^(dashboard|seller|flipkart)$/i.test(String(m[1]))){const candidate=String(m[1]).trim();if(/^[A-Z0-9_-]{4,80}$/i.test(candidate)){id=candidate;break}}}

    const bad=/seller hub|flipkart analytics|flipkart seller|help|logout|profile|search|notification|support|dashboard|home|orders|listings|inventory|payments|growth|ads|reports|add listing|learn more|downloads|uploads|actions|all listings/i;
    const candidates=[];
    const pushCandidate=(v,score=0)=>{v=String(v||'').replace(/\s+/g,' ').trim();if(!v||v.length<3||v.length>60||bad.test(v)||/^\d+$/.test(v))return;candidates.push({v,score})};
    const selectors=[
      '[data-testid*=account i]','[data-testid*=profile i]','[data-testid*=seller i]',
      '[aria-label*=account i]','[aria-label*=profile i]','[aria-label*=seller i]',
      '[class*=account i]','[class*=profile i]','[class*=seller i]','[class*=merchant i]',
      'header button','header [role=button]','nav button','button'
    ];
    document.querySelectorAll(selectors.join(',')).forEach(el=>{
      const r=el.getBoundingClientRect();
      if(r.width<1||r.height<1)return;
      let score=0;
      if(r.top<140)score+=4;
      if(r.left>innerWidth*.65)score+=5;
      if(/account|profile|seller|merchant/i.test(String(el.className)+' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('data-testid')||'')))score+=4;
      pushCandidate(text(el),score);
    });
    // Flipkart usually shows the account name in uppercase at the top-right.
    [...document.querySelectorAll('body *')].forEach(el=>{
      if(el.children.length>2)return;
      const v=text(el),r=el.getBoundingClientRect();
      if(r.width<1||r.height<1||r.top>170||r.left<innerWidth*.55)return;
      if(/^[A-Z][A-Z0-9 _&.-]{2,40}$/.test(v))pushCandidate(v,8);
    });
    candidates.sort((a,b)=>b.score-a.score||a.v.length-b.v.length);
    let name=candidates[0]?.v||'';
    if(!name){
      const lines=body.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      name=lines.find(x=>/^[A-Z][A-Z0-9 _&.-]{3,35}$/.test(x)&&!bad.test(x))||'';
    }
    return {name,id,url:location.href,detected:!!(name||id),source:name||id?'seller-portal':'none'};
  }
  function scrapeListings(){
    const href=location.href.toLowerCase();
    if(!/listing|catalog|inventory|stock/.test(href)) return [];
    const out=[],seen=new Set();
    const bad=/^(search|notifications?|home|listings?|inventory|orders?|payments?|growth|ads|reports?|actions?|downloads?|uploads?|active|blocked|inactive|archived)$/i;
    const candidates=[...document.querySelectorAll('a,button,div,span')].filter(el=>{
      const t=text(el);
      return t.length>=4&&t.length<=90&&!bad.test(t)&&!/^[0-9,.%₹\s]+$/.test(t)&&/^[A-Z0-9][A-Z0-9_.\- ]+$/i.test(t);
    });
    for(const el of candidates){
      const sku=text(el).trim();
      if(seen.has(sku)||bad.test(sku)||/^(checkboxoutlineblank|morevert|openinnew)$/i.test(sku))continue;
      let row=el;
      for(let i=0;i<9&&row?.parentElement;i++){
        row=row.parentElement;
        const rt=text(row);
        if(/\b[\d,]+\s*units?\b/i.test(rt)&&/(listing\s*:|final\s*:|returns?)/i.test(rt)&&rt.length<1800)break;
      }
      const rt=text(row);
      if(!/\b[\d,]+\s*units?\b/i.test(rt)||!/(listing\s*:|final\s*:|returns?)/i.test(rt))continue;
      const stock=(rt.match(/([\d,]+)\s*units?/i)||[])[1];
      const ret=(rt.match(/returns?\s*([\d.]+)%/i)||rt.match(/([\d.]+)%/i)||[])[1];
      const price=(rt.match(/(?:listing|final)\s*:\s*₹?\s*([\d,.]+)/i)||[])[1];
      const titleEls=[...row.querySelectorAll('a,div,span')].map(text).filter(x=>x&&x!==sku&&x.length>4&&x.length<120&&!bad.test(x)&&!/checkboxoutlineblank|morevert|openinnew|stock|returns?|listing\s*:|final\s*:|units?|average|apply/i.test(x)&&!/^₹?[\d,.%\s]+$/.test(x));
      const title=titleEls.find(x=>/[a-z ]{3,}/i.test(x))||sku;
      out.push({sku,title,stock:num(stock),returnRate:num(ret),sale:num(price),status:'Listing'});
      seen.add(sku);
      if(out.length>=500)break;
    }
    return out;
  }
  function scrapeVisiblePage(){
    const pageText=text(document.body),metrics={};
    const pats={activeListings:/Active\s*([\d,.]+[kK]?)/i,readyForActivation:/Ready for Activation\s*([\d,.]+[kK]?)/i,blocked:/Blocked\s*([\d,.]+[kK]?)/i,inactive:/Inactive\s*([\d,.]+[kK]?)/i,archived:/Archived\s*([\d,.]+[kK]?)/i};
    const parseCompact=s=>{s=String(s||'').replace(/,/g,'');return /k$/i.test(s)?parseFloat(s)*1000:Number(s)||0};
    for(const [k,r] of Object.entries(pats)){const m=pageText.match(r);if(m)metrics[k]=parseCompact(m[1]);}
    const tables=[...document.querySelectorAll('table')].map(table=>({headers:[...table.querySelectorAll('thead th')].map(text),rows:[...table.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(text))})).filter(t=>t.rows.length);
    const href=location.href.toLowerCase();const modules={orders:/order/.test(href),listings:/listing|catalog/.test(href)||!!scrapeListings().length,inventory:/inventory|stock/.test(href),payments:/payment/.test(href),returns:/return/.test(href),settlements:/settlement/.test(href)};return {url:location.href,title:document.title,metrics,tables,listings:scrapeListings(),sellerInfo:detectSellerInfo(),modules,capturedAt:new Date().toISOString()};
  }
  function requestNetworkBuffer(){if(bridgeToken)window.postMessage({source:'DC_FK_CONTENT',type:'GET_NETWORK_BUFFER',token:bridgeToken},'*');}
  function sendLiveData(frame,meta={}){if(Date.now()<capturePausedUntil)return;requestNetworkBuffer();setTimeout(()=>frame?.contentWindow?.postMessage({source:'DC_FK_HOST',type:'LIVE_DATA',payload:{dom:scrapeVisiblePage(),network:networkPayloads.slice(-80),meta},token:channelToken},'*'),180)}
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function findPortalNav(label){
    const wanted=label.toLowerCase();
    const els=[...document.querySelectorAll('a,button,[role="button"]')].filter(el=>{
      if(el.closest('#'+OVERLAY_ID)||el.closest('#'+DOCK_ID)||el.id===LAUNCHER_ID)return false;
      const t=text(el).toLowerCase();
      return t===wanted||t.startsWith(wanted+' ')||t.endsWith(' '+wanted);
    });
    return els.sort((a,b)=>{
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
      return (ar.left-br.left)||(ar.top-br.top);
    })[0]||null;
  }
  async function waitForPortalChange(beforeUrl,beforeText,timeout=10000){
    const started=Date.now();
    while(Date.now()-started<timeout){
      await sleep(350);
      const nowText=text(document.body).slice(0,2500);
      if(location.href!==beforeUrl||nowText!==beforeText){await sleep(900);return true}
    }
    return false;
  }
  async function expandVisibleData(){
    const containers=[...document.querySelectorAll('table,[role="grid"],[class*=table i],[class*=pagination i]')];
    for(let pass=0;pass<20&&!syncCancelled;pass++){
      let btn=null;
      for(const c of containers){
        const found=[...c.querySelectorAll('button,a,[role="button"]')].find(el=>/^(load more|view more|show more|next|›|>)$/i.test(text(el))&&!el.disabled&&el.getBoundingClientRect().height>0&&el.getAttribute('aria-disabled')!=='true');
        if(found){btn=found;break}
      }
      if(!btn)break;
      const before=text(document.body).slice(0,5000);btn.click();await waitForPortalChange(location.href,before,8000);sendLiveData(document.querySelector('#'+OVERLAY_ID+' iframe'),{paginationPass:pass+1});
    }
  }
  async function autoSyncAll(frame){
    if(window.__DC_FK_AUTO_SYNCING__)return;window.__DC_FK_AUTO_SYNCING__=true;syncCancelled=false;const generation=++syncGeneration;
    try{
      frame?.contentWindow?.postMessage({source:'DC_FK_HOST',type:'SYNC_PROGRESS',payload:{state:'start',total:1},token:channelToken},'*');
      frame?.contentWindow?.postMessage({source:'DC_FK_HOST',type:'SYNC_PROGRESS',payload:{state:'loading',label:'Current Flipkart page',index:1,total:1},token:channelToken},'*');
      await expandVisibleData();if(syncCancelled||generation!==syncGeneration)return;
      sendLiveData(frame,{safeSync:true,page:document.title,url:location.href});
      frame?.contentWindow?.postMessage({source:'DC_FK_HOST',type:'SYNC_PROGRESS',payload:{state:'done',success:1,total:1,restored:true,guided:true},token:channelToken},'*');
    }catch(err){frame?.contentWindow?.postMessage({source:'DC_FK_HOST',type:'SYNC_PROGRESS',payload:{state:'error',message:String(err?.message||err)},token:channelToken},'*');}
    finally{window.__DC_FK_AUTO_SYNCING__=false;}
  }

  function openDashboard(){
    const existing=document.getElementById(OVERLAY_ID);if(existing){existing.classList.remove('dc-closing');sendLiveData(existing.querySelector('iframe'));return}
    const overlay=document.createElement('div');overlay.id=OVERLAY_ID;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
    const modal=document.createElement('section');modal.className='dc-fk-modal';
    const iframe=document.createElement('iframe');iframe.className='dc-fk-dashboard-frame';iframe.src=chrome.runtime.getURL('dashboard.html?embedded=1&live=1&token='+encodeURIComponent(channelToken));iframe.title='Flipkart Analytics Dashboard';iframe.addEventListener('load',()=>setTimeout(()=>sendLiveData(iframe),200));
    modal.append(iframe);overlay.append(modal);overlay.onmousedown=e=>{if(e.target===overlay)closeDashboard()};document.body.append(overlay);document.documentElement.classList.add('dc-fk-modal-open');requestAnimationFrame(()=>overlay.classList.add('dc-open'));
  }
  function mountLauncher(){if(document.getElementById(LAUNCHER_ID)||!document.body)return;const b=document.createElement('button');b.id=LAUNCHER_ID;b.type='button';b.title='Flipkart Analytics';b.innerHTML='<span class="dc-tooltip">Open Flipkart Analytics</span><svg viewBox="0 0 32 32" fill="none"><path d="M7 25V14M14 25V8M21 25V17M27 25V5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M4.5 25.5H28" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>';b.onclick=openDashboard;document.body.append(b)}
  function mountDock(){if(document.getElementById(DOCK_ID)||!document.body)return;const d=document.createElement('div');d.id=DOCK_ID;d.innerHTML='<button class="dc-dock-collapse">«</button><button class="dc-dock-main"><span class="dc-dock-logo">F</span><span><b>Seller Lens</b><small>by Flipkart</small></span></button><button class="dc-dock-off">Turn Off</button><button class="dc-dock-play">▶</button>';d.querySelector('.dc-dock-main').onclick=openDashboard;d.querySelector('.dc-dock-play').onclick=openDashboard;d.querySelector('.dc-dock-off').onclick=()=>{d.style.display='none';document.getElementById(LAUNCHER_ID).style.display='grid'};d.querySelector('.dc-dock-collapse').onclick=()=>d.classList.toggle('dc-collapsed');document.body.append(d)}
  chrome.runtime.onMessage.addListener(m=>{if(m?.type==='OPEN_FLIPKART_ANALYTICS'){openDashboard();return Promise.resolve({ok:true})}});
  window.addEventListener('message',e=>{if(e.source!==window||e.data?.source!=='DC_FK_PAGE')return;if(e.data.type==='BRIDGE_READY'){bridgeToken=e.data.token||'';requestNetworkBuffer();return}if(!bridgeToken||e.data.token!==bridgeToken)return;if(e.data.type==='NETWORK_DATA'){if(Date.now()<capturePausedUntil)return;networkPayloads.push({url:e.data.url,data:e.data.data,kind:e.data.kind,at:Date.now()});if(networkPayloads.length>80)networkPayloads.shift()}if(e.data.type==='NETWORK_BUFFER'){networkPayloads=e.data.items||networkPayloads;}});
  window.addEventListener('message',e=>{const frame=document.querySelector('#'+OVERLAY_ID+' iframe');if(e.source!==frame?.contentWindow||e.data?.source!=='DC_FK_DASHBOARD'||e.data?.token!==channelToken)return;document.querySelector('#'+OVERLAY_ID+' iframe');if(e.data?.type==='REQUEST_LIVE_DATA')sendLiveData(frame);if(e.data?.type==='AUTO_SYNC_ALL')autoSyncAll(frame);if(e.data?.type==='CANCEL_AUTO_SYNC'){syncCancelled=true;syncGeneration++}if(e.data?.type==='CLEAR_CAPTURE_BUFFER'){capturePausedUntil=Date.now()+5000;networkPayloads=[];window.postMessage({source:'DC_FK_CONTENT',type:'CLEAR_NETWORK_BUFFER',token:bridgeToken},'*')}});
  const mount=()=>{mountLauncher();mountDock();requestNetworkBuffer()};
  setInterval(()=>{const f=document.querySelector('#'+OVERLAY_ID+' iframe');if(f)sendLiveData(f)},15000);
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',mount,{once:true}):mount();
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDashboard()});
  let mountTimer=0;new MutationObserver(()=>{clearTimeout(mountTimer);mountTimer=setTimeout(()=>{if(document.body){if(!document.getElementById(LAUNCHER_ID))mountLauncher();if(!document.getElementById(DOCK_ID))mountDock()}},500)}).observe(document.documentElement,{childList:true,subtree:true});
})();
