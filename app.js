const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const CHANNEL_TOKEN=new URLSearchParams(location.search).get('token')||'';

const STORAGE_INDEX_KEY='dc_fk_sellers_v32';
const sellerSlug=v=>String(v||'unassigned').toLowerCase().replace(/[^a-z0-9_-]/g,'_').slice(0,80);
const sellerKeyFor=s=>'dc_fk_data_v32_'+sellerSlug(s?.stableKey||s?.id||s?.name||'unassigned');
const sellerKey=()=>sellerKeyFor(connectedSeller);
function sellerIdentityKey(s){return sellerSlug(s?.id||s?.name||'unassigned')}
async function migrateSellerNamespace(oldSeller,newSeller){if(!chrome.storage?.local)return;const oldKey=sellerKeyFor(oldSeller),newKey=sellerKeyFor(newSeller);if(oldKey===newKey)return;const data=await chrome.storage.local.get([oldKey,newKey,STORAGE_INDEX_KEY]);if(data[oldKey]&&!data[newKey])await chrome.storage.local.set({[newKey]:data[oldKey]});const index=data[STORAGE_INDEX_KEY]||{};index[sellerIdentityKey(newSeller)]={name:newSeller?.name||'',id:newSeller?.id||'',storageKey:newKey,updatedAt:Date.now()};await chrome.storage.local.set({[STORAGE_INDEX_KEY]:index});if(data[oldKey])await chrome.storage.local.remove(oldKey);}
function serialRows(){return rows.map(r=>({...r,date:r.date instanceof Date&&!isNaN(r.date)?r.date.toISOString():null}))}
function persistSellerData(){if(!chrome.storage?.local)return;const key=sellerKey(),data={rows:serialRows(),inventoryRows,unmatchedReturns,unmatchedFinancials,financialLedger,syncHistory,skuCosts,settings:{costPct,packCost,adSpend,otherExpense},mapping,lastLiveSync,moduleStatus};chrome.storage.local.set({[key]:data,connectedSeller});}
function loadSellerData(done=()=>{}){const key=sellerKey();chrome.storage.local.get([key],r=>{const d=r[key]||{};rows=(d.rows||[]).map(x=>({...x,date:x.date?new Date(x.date):null}));inventoryRows=d.inventoryRows||[];unmatchedReturns=d.unmatchedReturns||[];unmatchedFinancials=d.unmatchedFinancials||[];financialLedger=d.financialLedger||[];syncHistory=d.syncHistory||[];skuCosts=d.skuCosts||{};mapping=d.mapping||{};lastLiveSync=d.lastLiveSync||null;moduleStatus=d.moduleStatus||moduleStatus;if(d.settings)({costPct=42,packCost=12,adSpend=0,otherExpense=0}=d.settings);done();});}
function revokeLater(u){setTimeout(()=>URL.revokeObjectURL(u),60000)}

let rows=[], inventoryRows=[], unmatchedReturns=[], unmatchedFinancials=[], financialLedger=[], syncHistory=[], skuCosts={}, mapping={}, costPct=42, packCost=12, adSpend=0, otherExpense=0, connectedSeller=null, latestSellerInfo=null, lastLiveSync=null, moduleStatus={orders:{detected:false,mapped:0},listings:{detected:false,mapped:0},inventory:{detected:false,mapped:0},payments:{detected:false,mapped:0},returns:{detected:false,mapped:0},settlements:{detected:false,mapped:0}}, capturedApis=[], developerMode=false;
const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const pct=n=>(Number(n||0)).toFixed(1)+'%';
const norm=s=>String(s??'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const aliases={recordId:['orderitemid','order item id','shipmentid','shipment id','suborderid','sub order id','transactionid','transaction id'],orderId:['orderid','order id','customerorderid'],sku:['seller sku','seller_sku','sellerSku','sellerSkuId','sku','skuId'],title:['producttitle','productname','title','product'],status:['orderstatus','orderStatus','finalstatus','shipmentstatus','shipmentStatus','returnstatus','returnStatus','status'],qty:['qty','quantity','itemquantity','itemQuantity','orderedQuantity'],sale:['saleamount','sellingprice','sellingPrice','itemprice','itemPrice','totalprice','orderamount','grosssale','revenue','finalPrice'],date:['orderdate','orderedon','date','createddate','dispatchdate'],state:['shippingstate','customerstate','delivery state','state'],city:['shippingcity','customercity','city'],fees:['marketplacefee','commission','totalfees','flipkartfee','deductions','fee'],shipping:['shippingfee','shippingcharge','logisticsfee','forwardshippingfee'],reverseShipping:['reverseshippingfee','returnshippingfee','reversefreight'],settlement:['settlementamount','netsettlement','paymentamount','netpayable'],cost:['productcost','costofgoods','cogs','purchaseprice'],returnReason:['returnreason','customerreturnreason','reason'],stock:['stock','inventory','availablequantity','availableQuantity','availableqty','currentStock'],gst:['gstonfees','gstamount','taxamount'],tds:['tds','tdsamount'],tcs:['tcs','tcsamount'],adjustment:['adjustment','adjustmentamount','compensation','recovery','claimamount']}
function findCol(headers, keys){const hs=headers.map(h=>({raw:h,n:norm(h)}));for(const k of keys){const nk=norm(k);let f=hs.find(x=>x.n===nk);if(f)return f.raw}for(const k of keys){const nk=norm(k);let f=hs.find(x=>x.n.includes(nk)||nk.includes(x.n));if(f)return f.raw}return null}
function parseNum(v){if(typeof v==='number')return v;return Number(String(v??'').replace(/[₹,%\s,]/g,'').replace(/\((.*?)\)/,'-$1'))||0}
function parseDate(v){if(v instanceof Date&&!isNaN(v))return v;if(typeof v==='number'&&v>20000){const d=new Date((v-25569)*86400*1000);return isNaN(d)?null:d}if(v==null||String(v).trim()==='')return null;const d=new Date(v);return isNaN(d)?null:d}
function normalizeStatus(v){const s=String(v||'').toLowerCase();if(/deliver|complete/.test(s))return'Delivered';if(/cancel/.test(s))return'Cancelled';if(/rto|return to origin/.test(s))return'RTO';if(/return|refund/.test(s))return'Returned';if(/ship|dispatch|transit/.test(s))return'Shipped';return'Pending'}
function mapRows(raw){
 if(!raw.length)return[];const headers=[...new Set(raw.flatMap(Object.keys))];mapping={};for(const [k,a] of Object.entries(aliases))mapping[k]=findCol(headers,a);$('#mappingView').textContent=JSON.stringify(mapping,null,2);
 if(!mapping.orderId||!mapping.sku||!mapping.status)return[];
 return raw.map((r,i)=>{const orderId=String(r[mapping.orderId]??'').trim(),sku=String(r[mapping.sku]??'').trim(),recordId=String(mapping.recordId?r[mapping.recordId]??'':'').trim();return{
  recordId:recordId||[orderId,sku,String(r[mapping.date]??''),String(r[mapping.qty]??1)].join('|'),orderId,sku:sku.toUpperCase(),title:String(r[mapping.title]??sku??'Product'),status:normalizeStatus(r[mapping.status]),qty:Math.max(1,parseNum(r[mapping.qty])||1),sale:parseNum(r[mapping.sale]),date:parseDate(r[mapping.date]),state:String(r[mapping.state]??'Unknown'),city:String(r[mapping.city]??''),fees:parseNum(r[mapping.fees]),shipping:parseNum(r[mapping.shipping]),reverseShipping:parseNum(r[mapping.reverseShipping]),settlement:parseNum(r[mapping.settlement]),cost:parseNum(r[mapping.cost]),returnReason:String(r[mapping.returnReason]??'Not specified'),stock:parseNum(r[mapping.stock]),gst:parseNum(r[mapping.gst]),tds:parseNum(r[mapping.tds]),tcs:parseNum(r[mapping.tcs]),adjustment:parseNum(r[mapping.adjustment])
 }}).filter(r=>r.orderId.length>=6&&r.sku.length>=3&&!/^\d+$/.test(r.sku)&&!/unknown|dashboard|search|home|listing/i.test(r.sku))
}
function rowKey(r){return String(r.recordId||[r.orderId,r.sku,r.date instanceof Date&&!isNaN(r.date)?r.date.toISOString().slice(0,10):'',r.qty].join('|'))}

async function parseFile(file){const ext=file.name.split('.').pop().toLowerCase();if(ext==='csv'){const text=await file.text();return csvToObjects(text)}if(ext==='xlsx'){return await parseXlsx(file)}throw new Error('Unsupported file type')}
function csvToObjects(text){const lines=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&q&&n==='"'){cell+='"';i++}else if(c==='"'){q=!q}else if(c===','&&!q){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(x=>x!==''))lines.push(row);row=[];cell=''}else cell+=c}if(cell||row.length){row.push(cell);lines.push(row)}const h=lines.shift()||[];return lines.map(r=>Object.fromEntries(h.map((x,i)=>[x||`Column${i+1}`,r[i]??''])))}
async function unzip(buf){const u=new Uint8Array(buf),dv=new DataView(buf);let eocd=-1;for(let i=u.length-22;i>=0&&i>u.length-66000;i--)if(dv.getUint32(i,true)===0x06054b50){eocd=i;break}if(eocd<0)throw Error('Invalid XLSX file');const count=dv.getUint16(eocd+10,true),cd=dv.getUint32(eocd+16,true),files={};let p=cd;for(let j=0;j<count;j++){if(dv.getUint32(p,true)!==0x02014b50)break;const method=dv.getUint16(p+10,true),cs=dv.getUint32(p+20,true),nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),lo=dv.getUint32(p+42,true),name=new TextDecoder().decode(u.slice(p+46,p+46+nl));const lnl=dv.getUint16(lo+26,true),lel=dv.getUint16(lo+28,true),start=lo+30+lnl+lel,data=u.slice(start,start+cs);let out;if(method===0)out=data;else if(method===8){const ds=new DecompressionStream('deflate-raw');out=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer())}if(out)files[name]=out;p+=46+nl+el+cl}return files}
function xmlText(bytes){return new TextDecoder().decode(bytes)}
async function parseXlsx(file){const z=await unzip(await file.arrayBuffer());const ss=[];if(z['xl/sharedStrings.xml']){const doc=new DOMParser().parseFromString(xmlText(z['xl/sharedStrings.xml']),'text/xml');doc.querySelectorAll('si').forEach(si=>ss.push([...si.querySelectorAll('t')].map(x=>x.textContent).join('')))}const wb=new DOMParser().parseFromString(xmlText(z['xl/workbook.xml']),'text/xml');const rel=new DOMParser().parseFromString(xmlText(z['xl/_rels/workbook.xml.rels']),'text/xml');const rels={};rel.querySelectorAll('Relationship').forEach(x=>rels[x.getAttribute('Id')]=x.getAttribute('Target'));const sheet=wb.querySelector('sheet');let target=rels[sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')];if(!target)target='worksheets/sheet1.xml';const path=target.startsWith('xl/')?target:'xl/'+target.replace(/^\//,'');const doc=new DOMParser().parseFromString(xmlText(z[path]),'text/xml');const grid=[];doc.querySelectorAll('row').forEach(r=>{const arr=[];r.querySelectorAll('c').forEach(c=>{const ref=c.getAttribute('r')||'A1',letters=ref.match(/[A-Z]+/)[0];let idx=0;for(const ch of letters)idx=idx*26+ch.charCodeAt(0)-64;idx--;const t=c.getAttribute('t'),v=c.querySelector('v')?.textContent??'',inline=c.querySelector('is t')?.textContent;arr[idx]=t==='s'?ss[Number(v)]:(t==='inlineStr'?inline:v)});grid.push(arr)});const h=grid.shift()||[];return grid.map(r=>Object.fromEntries(h.map((x,i)=>[x||`Column${i+1}`,r[i]??''])))}
function filtered(){const f=$('#fromDate').value?new Date($('#fromDate').value):null,t=$('#toDate').value?new Date($('#toDate').value+'T23:59:59'):null;return rows.filter(r=>(!f||r.date>=f)&&(!t||r.date<=t))}
function metrics(data=filtered(),includeGlobal=true){const itemCount=data.length,total=data.reduce((a,r)=>a+r.qty,0),by=s=>data.filter(r=>r.status===s).reduce((a,r)=>a+r.qty,0),deliveredRows=data.filter(r=>r.status==='Delivered'),sales=deliveredRows.reduce((a,r)=>a+r.sale*r.qty,0),cost=deliveredRows.reduce((a,r)=>a+(r.cost||skuCosts[String(r.sku).toUpperCase()]||r.sale*costPct/100)*r.qty,0),marketFees=data.reduce((a,r)=>a+Math.max(0,r.fees||0),0),shipping=data.reduce((a,r)=>a+Math.max(0,r.shipping||0),0),reverseShipping=data.reduce((a,r)=>a+Math.max(0,r.reverseShipping||0),0),gst=data.reduce((a,r)=>a+Math.max(0,r.gst||0),0),withholding=data.reduce((a,r)=>a+Math.max(0,r.tds||0)+Math.max(0,r.tcs||0),0),adjustments=data.reduce((a,r)=>a+(r.adjustment||0),0),fees=marketFees+shipping+reverseShipping+gst+withholding-adjustments,packaging=packCost*deliveredRows.reduce((a,r)=>a+r.qty,0),global=includeGlobal?(adSpend+otherExpense):0,profit=sales-cost-fees-packaging-global;return{itemCount,total,delivered:by('Delivered'),cancelled:by('Cancelled'),returned:by('Returned'),rto:by('RTO'),shipped:by('Shipped'),sales,cost,marketFees,shipping,reverseShipping,gst,withholding,adjustments,fees,packaging,global,profit,margin:sales?profit/sales*100:0}}
function group(data,key){const o={};for(const r of data){const k=typeof key==='function'?key(r):r[key];(o[k]??=[]).push(r)}return o}
function skuStats(data=filtered()){const totalSales=metrics(data,false).sales;return Object.entries(group(data,'sku')).map(([sku,a])=>{const m=metrics(a,false),returns=a.filter(x=>['Returned','RTO'].includes(x.status)).reduce((n,x)=>n+x.qty,0),overhead=totalSales>0?(adSpend+otherExpense)*(m.sales/totalSales):0;return{sku,orders:a.length,qty:a.reduce((s,x)=>s+x.qty,0),delivered:m.delivered,cancelled:m.cancelled,returned:m.returned,rto:m.rto,sales:m.sales,profit:m.profit-overhead,returnRate:a.reduce((n,x)=>n+x.qty,0)?returns/a.reduce((n,x)=>n+x.qty,0)*100:0,stock:Math.max(0,...a.map(x=>x.stock||0))}}).sort((a,b)=>b.orders-a.orders)}
function renderBars(el,items,color=''){const max=Math.max(1,...items.map(x=>Math.abs(x.value)));$(el).innerHTML=items.map(x=>`<div class="bar-row"><span title="${x.label}">${esc(x.label).slice(0,18)}</span><div class="bar-track"><div class="bar-fill ${color}" style="width:${Math.abs(x.value)/max*100}%"></div></div><b>${x.display??x.value}</b></div>`).join('')||'<p class="hint">No data available.</p>'}
function trendDateKey(value){
  const d=value instanceof Date?value:new Date(value);
  return Number.isNaN(d.getTime())?null:d.toISOString().slice(5,10);
}
function renderTrend(data){
  const chart=$('#trendChart');
  if(!chart)return;
  const valid=(Array.isArray(data)?data:[]).filter(r=>trendDateKey(r?.date));
  if(!valid.length){chart.innerHTML='<p class="hint">No dated order data available for this period.</p>';return}
  const g=group(valid,r=>trendDateKey(r.date));
  const labels=Object.keys(g).filter(Boolean).sort();
  const metric=$('#trendMetric')?.value||'orders';
  const vals=labels.map(k=>metric==='orders'?g[k].length:metric==='sales'?metrics(g[k]).sales:metrics(g[k]).profit);
  const w=800,h=220,pad=28,max=Math.max(1,...vals.map(v=>Math.abs(Number(v)||0)));
  const x=i=>pad+i*(w-2*pad)/Math.max(1,vals.length-1);
  const y=v=>h-pad-(Number(v)||0)/max*(h-2*pad);
  const pts=vals.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
  chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2874f0" stop-opacity=".35"/><stop offset="1" stop-color="#2874f0" stop-opacity="0"/></linearGradient></defs><path d="M${pad},${h-pad} L${pts} L${w-pad},${h-pad} Z" fill="url(#fill)"/><polyline points="${pts}" fill="none" stroke="#2874f0" stroke-width="3"/><g fill="#2874f0">${vals.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="3"/>`).join('')}</g></svg>`;
}
function render(){const data=filtered(),m=metrics(data),total=Math.max(1,m.total);$('#kpis').innerHTML=[['Total Orders',m.total,'Selected period','▣'],['Delivered Orders',m.delivered,pct(m.delivered/total*100),'✓'],['Cancelled Orders',m.cancelled,pct(m.cancelled/total*100),'✕'],['Returns + RTO',m.returned+m.rto,pct((m.returned+m.rto)/total*100),'↩'],['Total Sales',money(m.sales),'Delivered revenue','₹'],['Net Profit',money(m.profit),pct(m.margin)+' margin','↗']].map(x=>kpiHtml(...x)).join('');renderTrend(data);
const parts=[['Delivered',m.delivered,'#159947'],['Cancelled',m.cancelled,'#ef3340'],['Returned',m.returned,'#f97316'],['RTO',m.rto,'#7c3aed'],['Other',Math.max(0,m.total-m.delivered-m.cancelled-m.returned-m.rto),'#2874f0']],deg=parts.map(x=>x[1]/total*360);let acc=0,grad=parts.map((x,i)=>{const s=acc;acc+=deg[i];return`${x[2]} ${s}deg ${acc}deg`}).join(',');$('#donutWrap').innerHTML=`<div class="donut" style="background:conic-gradient(${grad})"></div><div class="legend">${parts.map(x=>`<div class="legend-row"><span><i class="dot" style="background:${x[2]}"></i>${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div>`;
const st=Object.entries(group(data,'state')).map(([k,a])=>({label:k,value:a.length})).sort((a,b)=>b.value-a.value).slice(0,5);renderBars('#stateBars',st);const ss=skuStats(data);renderBars('#profitBars',ss.filter(x=>x.profit>0).sort((a,b)=>b.profit-a.profit).slice(0,5).map(x=>({label:x.sku,value:x.profit,display:money(x.profit)})),'green');renderBars('#lossBars',ss.filter(x=>x.profit<0).sort((a,b)=>a.profit-b.profit).slice(0,5).map(x=>({label:x.sku,value:x.profit,display:money(x.profit)})),'red');
$('#skuTable').innerHTML=tableHtml(['SKU','Orders','Delivered','Return %','Sales','Profit'],ss.slice(0,8).map(x=>[x.sku,x.orders,x.delivered,pct(x.returnRate),money(x.sales),money(x.profit)]),5);renderActions(m,ss);renderOrders(data);renderAnalytics(m,ss);renderProfit(m,ss);renderSettlements(data,m);renderReturns(m,ss,data);renderInventory(ss);renderCosts();const lossRate=m.total?(m.returned+m.rto+m.cancelled)/m.total:0;const score=Math.max(0,Math.min(100,Math.round(100-lossRate*55-(m.sales&&m.profit<0?25:0)-(inventoryRows.some(x=>x.stock===0)?10:0))));if($('#sellerScore'))$('#sellerScore').textContent=(rows.length||inventoryRows.length)?score+'/100':'—';save();}
function tableHtml(headers,data,profitCol=-1){return`<thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${data.map(r=>`<tr>${r.map((v,i)=>`<td class="${i===profitCol?(String(v).includes('-')?'bad':'good'):''}">${v&&typeof v==='object'&&v.__html?v.__html:esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>`}
function renderActions(m,ss){const worst=[...ss].sort((a,b)=>b.returnRate-a.returnRate)[0],loss=[...ss].sort((a,b)=>a.profit-b.profit)[0];$('#actions').innerHTML=`<div class="action"><b>Protect your top performer</b><small>${ss[0]?.sku||'—'} has the highest order volume.</small></div><div class="action warn"><b>Reduce return risk</b><small>${worst?.sku||'—'} return/RTO rate is ${pct(worst?.returnRate)}.</small></div><div class="action bad"><b>Review loss-making SKU</b><small>${loss?.sku||'—'} generated ${money(loss?.profit)} estimated profit.</small></div>`}
function renderOrders(data){const q=($('#orderSearch')?.value||'').toLowerCase(),s=$('#statusFilter')?.value||'';const d=data.filter(r=>(!s||r.status===s)&&(!q||[r.orderId,r.sku,r.state,r.city].join(' ').toLowerCase().includes(q))).slice(0,500);$('#ordersTable').innerHTML=(data.length>500?'<caption class="truncation-note">Showing first 500 of '+data.length.toLocaleString()+' records. Export CSV includes all filtered records.</caption>':'')+tableHtml(['Order ID','Date','SKU','Status','Qty','Sale','State','Settlement'],d.map(r=>[r.orderId,r.date instanceof Date&&!isNaN(r.date)?r.date.toLocaleDateString('en-IN'):'—',r.sku,r.status,r.qty,money(r.sale),r.state,money(r.settlement)]))}
function renderAnalytics(m,ss){$('#analyticsKpis').innerHTML=[['Total Orders',m.total,'','▣'],['Delivered',m.delivered,pct(m.delivered/Math.max(1,m.total)*100),'✓'],['Cancelled',m.cancelled,pct(m.cancelled/Math.max(1,m.total)*100),'✕'],['Customer Returns',m.returned,pct(m.returned/Math.max(1,m.total)*100),'↩'],['RTO Orders',m.rto,pct(m.rto/Math.max(1,m.total)*100),'▤'],['Net Profit',money(m.profit),pct(m.margin),'₹']].map(x=>kpiHtml(...x)).join('');$('#analyticsTable').innerHTML=tableHtml(['SKU','Orders','Qty','Delivered','Cancelled','Returns','RTO','Return %','Profit'],ss.map(x=>[x.sku,x.orders,x.qty,x.delivered,x.cancelled,x.returned,x.rto,pct(x.returnRate),money(x.profit)]),8);const high=ss.filter(x=>x.orders>=100),med=ss.filter(x=>x.orders>=20&&x.orders<100),low=ss.filter(x=>x.orders<20);$('#segments').innerHTML=[['high','High Volume',high],['medium','Medium Volume',med],['low','Low Volume',low]].map(([c,l,a])=>`<div class="segment ${c}"><b>${l}<small style="display:block;color:#64748b">${a.length} SKUs</small></b><strong>${a.reduce((s,x)=>s+x.orders,0)}</strong><strong>${pct(a.reduce((s,x)=>s+x.orders,0)/Math.max(1,m.total)*100)}</strong></div>`).join('')}
function renderProfit(m,ss){$('#profitSummary').innerHTML=[['Gross Sale',money(m.sales)],['Cost of Goods',money(m.cost)],['Marketplace Fees',money(m.marketFees)],['Forward Shipping',money(m.shipping)],['Reverse Shipping',money(m.reverseShipping)],['GST + TDS/TCS',money(m.gst+m.withholding)],['Adjustments / Recoveries',money(m.adjustments)],['Packaging Cost',money(m.packaging)],['Ad Spend',money(adSpend)],['Other Expenses',money(otherExpense)]].map(x=>`<div class="summary-row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')+`<div class="summary-row total"><span>Mapped Net Profit</span><b>${money(m.profit)}</b></div>`;$('#profitTable').innerHTML=tableHtml(['SKU','Orders','Sales','Estimated Cost','Return %','Net Profit','Margin'],ss.map(x=>[x.sku,x.orders,money(x.sales),money((skuCosts[x.sku]||x.sales*costPct/100)),pct(x.returnRate),money(x.profit),pct(x.sales?x.profit/x.sales*100:0)]),5)}
function renderSettlements(data,m){const rec=data.reduce((s,r)=>s+r.settlement,0),expected=data.reduce((s,r)=>s+(r.status==='Delivered'?r.sale*r.qty:0)-r.fees-r.shipping-r.reverseShipping-r.gst-r.tds-r.tcs+(r.adjustment||0),0);$('#settlementKpis').innerHTML=[['Expected Settlement',money(expected),'Based on mapped charges','₹'],['Recorded Settlement',money(rec),'','✓'],['Variance',money(rec-expected),'Needs reconciliation','⇄'],['Unmatched Rows',data.filter(r=>r.status==='Delivered'&&!r.settlement).length,'','◷']].map(x=>kpiHtml(...x)).join('');$('#settlementTable').innerHTML=tableHtml(['Order ID','Record ID','SKU','Sale','Charges','Recorded Settlement','Variance'],data.filter(r=>r.settlement||r.status==='Delivered').slice(0,500).map(r=>{const ch=r.fees+r.shipping+r.reverseShipping+r.gst+r.tds+r.tcs-(r.adjustment||0),exp=(r.status==='Delivered'?r.sale*r.qty:0)-ch;return[r.orderId,r.recordId||'—',r.sku,money(r.sale*r.qty),money(ch),money(r.settlement),money(r.settlement-exp)]}),5)}
function renderReturns(m,ss,data){$('#returnKpis').innerHTML=[['Customer Returns',m.returned,pct(m.returned/Math.max(1,m.total)*100),'↩'],['RTO Orders',m.rto,pct(m.rto/Math.max(1,m.total)*100),'▤'],['Mapped Return Charges',money(data.filter(r=>['Returned','RTO'].includes(r.status)).reduce((a,r)=>a+(r.reverseShipping||0)+(r.fees||0),0)),'From report/API','₹'],['High Risk SKUs',ss.filter(x=>x.returnRate>30).length,'Above 30%','!']].map(x=>kpiHtml(...x)).join('');renderBars('#riskBars',[...ss].sort((a,b)=>b.returnRate-a.returnRate).slice(0,7).map(x=>({label:x.sku,value:x.returnRate,display:pct(x.returnRate)})),'orange');const reasons=Object.entries(group(data.filter(r=>['Returned','RTO'].includes(r.status)),'returnReason')).map(([k,a])=>({label:k,value:a.length})).sort((a,b)=>b.value-a.value);renderBars('#reasonBars',reasons.slice(0,7),'red')}
function renderInventory(ss){
 const inv=(inventoryRows||[]).filter(x=>x.sku);
 const orderMap=Object.fromEntries(ss.map(x=>[x.sku,x]));
 $('#inventoryKpis').innerHTML=[['Active SKUs',inv.length,'','◫'],['Low Stock',inv.filter(x=>x.stock>0&&x.stock<20).length,'Below 20','!'],['Out of Stock',inv.filter(x=>x.stock===0).length,'','✕'],['High Return Stock',inv.filter(x=>x.returnRate>30&&x.stock>0).length,'Review purchase','↩']].map(x=>kpiHtml(...x)).join('');
 $('#inventoryTable').innerHTML=tableHtml(['SKU','Product','Current Stock','30-Day Orders','Velocity','Days of Stock','Return %','Recommendation'],inv.map(x=>{const cutoff=Date.now()-30*86400000,recent=rows.filter(r=>r.sku===x.sku&&r.date instanceof Date&&!isNaN(r.date)&&r.date.getTime()>=cutoff),ord=recent.reduce((n,r)=>n+r.qty,0),vel=ord/30,days=vel?x.stock/vel:null;return[x.sku,x.title||'',x.stock,ord,vel.toFixed(1)+'/day',days==null?'—':days.toFixed(0),pct(x.returnRate),x.stock===0?'Restock':days!=null&&days<7?'Urgent Reorder':days!=null&&days>90?'Overstock':'Healthy']}));
}
function renderCosts(){
 if(!$('#costCoverage')||!$('#costTable')) return;
 const skus=[...new Set([...rows.map(r=>r.sku),...inventoryRows.map(r=>r.sku)].filter(Boolean))];
 const covered=skus.filter(k=>skuCosts[k]>0).length;
 $('#costCoverage').innerHTML=`<div class="summary-row"><span>Total SKUs</span><b>${skus.length}</b></div><div class="summary-row"><span>Cost Added</span><b>${covered}</b></div><div class="summary-row total"><span>Coverage</span><b>${pct(skus.length?covered/skus.length*100:0)}</b></div>`;
 $('#costTable').innerHTML=tableHtml(['SKU','Purchase Cost','Action'],Object.entries(skuCosts).sort().map(([sku,cost])=>[sku,money(cost),{__html:`<button class="delete-cost" data-sku="${esc(sku)}">Delete</button>`}]));
 $$('.delete-cost').forEach(b=>b.onclick=()=>{delete skuCosts[b.dataset.sku];save();render();});
}
function calculate(){const p=parseNum($('#calcPrice').value),c=parseNum($('#calcCost').value),f=parseNum($('#calcFees').value),s=parseNum($('#calcShip').value),r=parseNum($('#calcReturn').value)/100,net=p-c-f-s-r*(c+s);$('#calcResult').innerHTML=`<small>Expected profit per order</small><div class="result-big">${money(net)}</div><div class="summary-row"><span>Margin</span><b>${pct(p?net/p*100:0)}</b></div><div class="summary-row"><span>Break-even price</span><b>${money((c+f+s+r*(c+s))/(1||1))}</b></div><div class="summary-row"><span>Expected return loss</span><b>${money(r*(c+s))}</b></div>`}
function save(){persistSellerData()}
function show(msg,error=false){const n=$('#notice');n.textContent=msg;n.className='notice'+(error?' error':'');setTimeout(()=>n.classList.add('hidden'),5000)}
$$('#nav button').forEach(b=>b.onclick=()=>{const id=b.dataset.page;$$('#nav button').forEach(x=>x.classList.toggle('active',x===b));$$('.page').forEach(x=>x.classList.toggle('active',x.id===id));$('#pageTitle').textContent=b.querySelector('span').textContent});$$('[data-pagejump]').forEach(b=>b.onclick=()=>document.querySelector(`#nav button[data-page="${b.dataset.pagejump}"]`).click());
$('#fileInput').onchange=async e=>{try{let all=[];for(const f of e.target.files)all.push(...await parseFile(f));rows=mapRows(all);if(!rows.length)throw Error('No usable rows found.');show(`${rows.length.toLocaleString()} rows imported successfully.`);render()}catch(err){show(err.message||'Import failed.',true)}};
function updateConnectionUI(){
 const banner=$('#connectBanner'),live=$('#liveStatus'),info=connectedSeller||latestSellerInfo||{};
 $('#sideSellerName').textContent=info.name||'Seller not detected';$('#sideSellerId').textContent='Seller ID: '+(info.id||'Not detected')+(info.source?' • '+info.source:'');
 $('#sideConnectionDot').classList.toggle('connected',!!connectedSeller);$('#sideConnectionText').textContent=connectedSeller?'Connected':'Not connected';
 if(connectedSeller){banner.classList.add('hidden');live.classList.remove('hidden');$('#liveSeller').textContent='Connected';$('#headerSellerName').textContent=connectedSeller.name||'Not detected';$('#headerSellerId').textContent=connectedSeller.id||'Not detected';$('#lastSync').textContent=lastLiveSync?`Last sync ${new Date(lastLiveSync).toLocaleTimeString('en-IN')}`:'Connected · waiting for data';}
 else{banner.classList.remove('hidden');live.classList.add('hidden');$('#connectText').textContent=`Map ${info.name||'this seller'}${info.id?' (Seller ID: '+info.id+')':''} to enable current-page orders, returns, inventory and settlement capture.`;}
 if($('#manualSellerName')){$('#manualSellerName').value=info.name||'';$('#manualSellerId').value=info.id||'';}
 $$('.fetching-status [data-module]').forEach(el=>{const key=el.dataset.module,s=moduleStatus[key]||{},ok=(s.mapped||0)>0;el.classList.toggle('ok',ok);el.classList.toggle('pending',!ok);el.textContent=(ok?'✓ ':'○ ')+key.charAt(0).toUpperCase()+key.slice(1)+(s.detected?` (${s.mapped||0})`:'')});
}
$('#connectSeller').onclick=()=>{connectedSeller=latestSellerInfo||{name:'Flipkart Seller',id:''};chrome.storage.local.set({connectedSeller});updateConnectionUI();postHost('REQUEST_LIVE_DATA');show('Seller connected. Current page live capture enabled.');};
const postHost=(type,payload={})=>window.parent.postMessage({source:'DC_FK_DASHBOARD',type,payload,token:CHANNEL_TOKEN},'*');
$('#syncBtn').onclick=()=>{postHost('AUTO_SYNC_ALL');$('#syncBtn').disabled=true;$('#cancelSyncBtn')?.classList.remove('hidden');show('Safe sync started for the currently open Flipkart page. Other modules ke liye unka page open karke Sync Now use karein.');};
if($('#cancelSyncBtn'))$('#cancelSyncBtn').onclick=()=>postHost('CANCEL_AUTO_SYNC');
$('#trendMetric').onchange=render;$('#fromDate').onchange=render;$('#toDate').onchange=render;$('#orderSearch').oninput=()=>renderOrders(filtered());$('#statusFilter').onchange=()=>renderOrders(filtered());
$('#recalc').onclick=()=>{costPct=parseNum($('#costPct').value);packCost=parseNum($('#packCost').value);adSpend=parseNum($('#adSpend').value);otherExpense=parseNum($('#otherExpense').value);render()};$('#calculate').onclick=calculate;
$('#exportOrders').onclick=()=>{const d=filtered(),h=['Order ID','Date','SKU','Status','Qty','Sale','State','Settlement'],csv=[h,...d.map(r=>[r.orderId,r.date instanceof Date&&!isNaN(r.date)?r.date.toISOString().slice(0,10):'',r.sku,r.status,r.qty,r.sale,r.state,r.settlement])].map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n');const u=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));chrome.downloads.download({url:u,filename:'flipkart-orders-export.csv',saveAs:true});revokeLater(u)};
if($('#saveSkuCost')) $('#saveSkuCost').onclick=()=>{const sku=$('#costSku')?.value.trim()||'',cost=parseNum($('#costValue')?.value);if(!sku||cost<=0)return show('Valid SKU aur purchase cost enter karein.',true);skuCosts[sku.toUpperCase()]=cost;if($('#costSku'))$('#costSku').value='';if($('#costValue'))$('#costValue').value='';save();render();show('Product cost saved.');};
if($('#exportCosts')) $('#exportCosts').onclick=()=>{const csv=['SKU,Purchase Cost',...Object.entries(skuCosts).map(([k,v])=>`"${k.replaceAll('"','""')}",${v}`)].join('\n');const u=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));chrome.downloads.download({url:u,filename:'flipkart-product-costs.csv',saveAs:true});revokeLater(u)};
$('#saveSellerIdentity').onclick=()=>{const name=$('#manualSellerName').value.trim(),id=$('#manualSellerId').value.trim();if(!name&&!id)return show('Seller name ya Seller ID enter karein.',true);connectedSeller={...(connectedSeller||{}),name:name||connectedSeller?.name||'',id:id||connectedSeller?.id||'',stableKey:connectedSeller?.stableKey||sellerIdentityKey({name:name||connectedSeller?.name,id:id||connectedSeller?.id}),manual:true};chrome.storage.local.set({connectedSeller});loadSellerData(()=>{render();updateConnectionUI();show('Seller identity saved and seller-specific data loaded.');});};
if($('#clearOrders'))$('#clearOrders').onclick=()=>{if(confirm('Clear only order and settlement data?')){rows=[];for(const k of ['orders','returns','payments','settlements'])moduleStatus[k].mapped=0;save();render();updateConnectionUI();postHost('CLEAR_CAPTURE_BUFFER');lastLiveSync=null;show('Order data cleared and captured buffer reset.')}};if($('#clearInventory'))$('#clearInventory').onclick=()=>{if(confirm('Clear only inventory/listing data?')){inventoryRows=[];moduleStatus.inventory.mapped=0;moduleStatus.listings.mapped=0;save();render();updateConnectionUI();show('Inventory data cleared.')}};if($('#clearCosts'))$('#clearCosts').onclick=()=>{if(confirm('Clear all saved SKU costs?')){skuCosts={};save();render();show('Product costs cleared.')}};if($('#resetExtension'))$('#resetExtension').onclick=()=>{if(confirm('Reset complete extension including seller identity and settings?'))chrome.storage.local.clear(()=>location.reload())};$('#downloadBackup').onclick=()=>{const safeRows=rows.map(r=>({...r,date:r.date instanceof Date&&!isNaN(r.date)?r.date.toISOString():null}));const u=URL.createObjectURL(new Blob([JSON.stringify({version:'3.2',schema:'dc-fk-backup-v3.2',seller:connectedSeller,rows:safeRows,inventoryRows,unmatchedReturns,unmatchedFinancials,financialLedger,syncHistory,skuCosts,settings:{costPct,packCost,adSpend,otherExpense}},null,2)],{type:'application/json'}));chrome.downloads.download({url:u,filename:'flipkart-analytics-backup.json',saveAs:true});revokeLater(u)};
const today=new Date(),from=new Date(today);from.setDate(today.getDate()-30);$('#fromDate').value=from.toISOString().slice(0,10);$('#toDate').value=today.toISOString().slice(0,10);calculate();renderUnmatched();
chrome.storage?.local.get(['connectedSeller','theme'],r=>{connectedSeller=r.connectedSeller?{...r.connectedSeller,stableKey:r.connectedSeller.stableKey||sellerIdentityKey(r.connectedSeller)}:null;if(r.theme==='dark')document.body.classList.add('dark');loadSellerData(()=>{document.querySelector('#costPct').value=costPct;document.querySelector('#packCost').value=packCost;document.querySelector('#adSpend').value=adSpend;document.querySelector('#otherExpense').value=otherExpense;render();updateConnectionUI();if(new URLSearchParams(location.search).get('live')==='1'){postHost('REQUEST_LIVE_DATA');setTimeout(()=>postHost('REQUEST_LIVE_DATA'),1200)}});});
function flattenRecord(obj,prefix='',out={},depth=0){
  if(depth>5||obj==null)return out;
  if(Array.isArray(obj))return out;
  for(const [k,v] of Object.entries(obj)){
    const key=prefix?`${prefix}.${k}`:k;
    if(v==null||typeof v==='string'||typeof v==='number'||typeof v==='boolean'){
      out[k]??=v; out[key]=v;
    }else if(typeof v==='object') flattenRecord(v,key,out,depth+1);
  }
  return out;
}
function collectArrays(obj,out=[],depth=0){
  if(depth>10||obj==null)return out;
  if(Array.isArray(obj)){
    if(obj.length&&obj.some(x=>x&&typeof x==='object'&&!Array.isArray(x)))out.push(obj);
    for(const v of obj.slice(0,80))collectArrays(v,out,depth+1)
  }else if(typeof obj==='object')for(const v of Object.values(obj))collectArrays(v,out,depth+1);
  return out
}
function recordScore(item){
 const keys=Object.keys(item).map(norm).join(' '), vals=Object.values(item).filter(v=>typeof v!=='object').join(' ').toLowerCase();
 let score=0;
 if(/orderitemid|shipmentid|suborderid/.test(keys))score+=6;
 else if(/customerorderid|orderid/.test(keys))score+=4;
 if(/sellersku|sellerstockkeepingunit|sku/.test(keys)&&!/fsn|listingid/.test(keys))score+=5;
 if(/orderstatus|shipmentstatus|fulfilmentstatus|returnstatus/.test(keys))score+=3;
 if(/sellingprice|itemprice|orderamount|quantity|orderedquantity/.test(keys))score+=2;
 if(/delivered|cancelled|returned|rto|shipped|dispatch/.test(vals))score+=2;
 return score;
}
function networkToRows(network){
  const raw=[], seen=new Set();
  for(const p of network||[]){
    if(typeof p.data==='string')continue;
    for(const arr of collectArrays(p.data))for(const item of arr){
      if(!item||typeof item!=='object'||Array.isArray(item))continue;
      const flat=flattenRecord(item);
      if(recordScore(flat)<4)continue;
      const sig=JSON.stringify(flat).slice(0,600);if(seen.has(sig))continue;seen.add(sig);raw.push(flat);
    }
  }
  return raw;
}
function tableToObjects(t){if(!t?.headers?.length)return[];return (t.rows||[]).map(r=>Object.fromEntries(t.headers.map((h,i)=>[h||`Column${i+1}`,r[i]??''])))}
function listingToRows(listings){return (listings||[]).map((x,i)=>({
  'Order ID':x.orderId||`LISTING-${i+1}`,'Seller SKU':x.sku,'Product Title':x.title,'Order Status':'Pending','Quantity':1,
  'Selling Price':x.sale||0,'Available Quantity':x.stock||0,'Customer Return Rate':x.returnRate||0,'Source Type':'Flipkart Listing'
}))}
function extractSellerFromNetwork(network){
 for(const p of network||[]){
  if(!p.data||typeof p.data!=='object')continue;
  const txt=JSON.stringify(p.data).slice(0,200000);
  const id=(txt.match(/"(?:sellerId|seller_id|sellerIdentifier|sellerCode|merchantId|merchant_id|merchantCode|accountId|account_id|partnerId|vendorId)"\s*:\s*"?([A-Z0-9_-]{4,})/i)||[])[1]||'';
  const name=(txt.match(/"(?:sellerName|displayName|merchantName|accountName|businessName|storeName|sellerDisplayName)"\s*:\s*"([^"]{3,80})"/i)||[])[1]||'';
  if(id||name)return{name,id,detected:true,url:p.url,source:'profile/network API',confidence:/profile|seller-profile|merchant-profile/i.test(p.url||'')?'verified':'probable'};
 }
 return null;
}


function financialRecordKey(x){
 return [x.transactionId||'',x.settlementRef||'',x.returnId||'',x.recordId||'',x.orderId||'',x.sku||'',x.type||'',x.date||'',x.settlement||0,x.fees||0,x.refund||0].join('|');
}
function financialRows(network){
 const out=new Map();
 for(const p of network||[]){
  const type=classifyApi(p.url,p.data);if(!['payments','settlements','returns'].includes(type))continue;
  for(const arr of collectArrays(p.data))for(const item of arr){
   if(!item||typeof item!=='object'||Array.isArray(item))continue;
   const f=flattenRecord(item),keys=Object.keys(f),pick=rx=>{const k=keys.find(x=>rx.test(norm(x)));return k?f[k]:''};
   const x={type,orderId:String(pick(/customerorderid|^orderid$/)).trim(),sku:String(pick(/sellersku|sellerstockkeepingunit|^sku$/)).trim().toUpperCase(),recordId:String(pick(/orderitemid|shipmentid|suborderid/)).trim(),transactionId:String(pick(/transactionid|paymentid|ledgerid/)).trim(),settlementRef:String(pick(/settlementreference|settlementid|remittanceid|payoutid/)).trim(),returnId:String(pick(/returnid|refundid|rmaid/)).trim(),date:String(pick(/settlementdate|paymentdate|returndate|createddate|date/)||''),settlement:parseNum(pick(/settlementamount|netsettlement|paymentamount|netpayable|amountpaid/)),fees:parseNum(pick(/marketplacefee|commission|totalfees|flipkartfee|deduction/)),collectionFee:parseNum(pick(/collectionfee/)),fixedFee:parseNum(pick(/fixedfee/)),shipping:parseNum(pick(/forwardshippingfee|shippingcharge|logisticsfee/)),reverseShipping:parseNum(pick(/reverseshippingfee|returnshippingfee|reversefreight/)),gst:parseNum(pick(/gstonfees|gstamount|taxamount/)),tds:parseNum(pick(/^tds|tdsamount/)),tcs:parseNum(pick(/^tcs|tcsamount/)),refund:parseNum(pick(/refundamount|refundedamount/)),creditNote:parseNum(pick(/creditnoteamount|creditamount/)),debitNote:parseNum(pick(/debitnoteamount|debitamount/)),compensation:parseNum(pick(/compensation|claimamount/)),recovery:parseNum(pick(/recovery|recoveryamount/)),adjustment:parseNum(pick(/adjustmentamount/)),status:type==='returns'?normalizeStatus(pick(/returnstatus|status|type/)):'',returnReason:String(pick(/returnreason|customerreturnreason|reason/)||'')};
   if(!x.orderId&&!x.recordId&&!x.transactionId&&!x.settlementRef&&!x.returnId)continue;
   const key=financialRecordKey(x);if(!out.has(key))out.set(key,x);
  }
 }
 return [...out.values()];
}
function mergeFinancialsIntoRows(base,network){
 const incoming=financialRows(network),ledgerMap=new Map((financialLedger||[]).map(x=>[financialRecordKey(x),x]));for(const x of incoming)ledgerMap.set(financialRecordKey(x),x);financialLedger=[...ledgerMap.values()];
 const byRecord=new Map(),byOrderSku=new Map();
 for(const x of financialLedger){if(x.recordId)byRecord.set(x.recordId,[...(byRecord.get(x.recordId)||[]),x]);if(x.orderId&&x.sku)byOrderSku.set(x.orderId+'|'+x.sku,[...(byOrderSku.get(x.orderId+'|'+x.sku)||[]),x]);}
 const matched=new Set();
 const result=base.map(r=>{let xs=byRecord.get(r.recordId)||byOrderSku.get(r.orderId+'|'+r.sku)||[];if(!xs.length)return r;xs.forEach(x=>matched.add(financialRecordKey(x)));const sum=k=>xs.reduce((a,x)=>a+(Number(x[k])||0),0),last=[...xs].reverse().find(x=>x.status||x.returnReason)||{};return{...r,settlement:(r.settlement||0)+sum('settlement'),fees:(r.fees||0)+sum('fees')+sum('collectionFee')+sum('fixedFee'),shipping:(r.shipping||0)+sum('shipping'),reverseShipping:(r.reverseShipping||0)+sum('reverseShipping'),gst:(r.gst||0)+sum('gst'),tds:(r.tds||0)+sum('tds'),tcs:(r.tcs||0)+sum('tcs'),refund:(r.refund||0)+sum('refund'),creditNote:(r.creditNote||0)+sum('creditNote'),debitNote:(r.debitNote||0)+sum('debitNote'),compensation:(r.compensation||0)+sum('compensation'),recovery:(r.recovery||0)+sum('recovery'),adjustment:(r.adjustment||0)+sum('adjustment'),status:last.status||r.status,returnReason:last.returnReason||r.returnReason};});
 unmatchedReturns=financialLedger.filter(x=>x.type==='returns'&&!matched.has(financialRecordKey(x)));
 unmatchedFinancials=financialLedger.filter(x=>x.type!=='returns'&&!matched.has(financialRecordKey(x)));
 return result;
}
function classifyApi(url='',data){
 const u=String(url).toLowerCase(), sample=JSON.stringify(data||{}).slice(0,16000).toLowerCase();
 // Endpoint/business-record priority. Profile is deliberately last because most payloads contain seller/account IDs.
 if(/settlement|remittance|reconciliation|payout-summary/.test(u)||/settlementamount|netpayable|settlementreference|remittanceid/.test(sample))return'settlements';
 if(/payment|payout|transaction|ledger|invoice-adjustment/.test(u)||/paymentamount|banksettlement|transactionid|paymentreference/.test(sample))return'payments';
 if(/return|refund|rto|reverse/.test(u)||/returnreason|refundamount|returnid|reverseShipping/i.test(sample))return'returns';
 if(/inventory|stock|availability/.test(u)||/availablequantity|currentstock|inventoryquantity/.test(sample))return'inventory';
 if(/order|shipment|dispatch|fulfil/.test(u)||/orderid|orderitemid|shipmentid|suborderid/.test(sample))return'orders';
 if(/listing|catalog|product/.test(u)||/sellersku|listingid|fsn/.test(sample))return'listings';
 if(/profile|seller-profile|account-profile|merchant-profile/.test(u)||/sellername|merchantname|businessname/.test(sample))return'profile';
 return'other';
}
function countObjectRecords(data){
 let count=0;for(const a of collectArrays(data))count+=a.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).length;return count;
}
function topKeys(data){
 const keys=new Set();
 const walk=(x,d=0)=>{if(d>3||x==null)return;if(Array.isArray(x)){for(const v of x.slice(0,3))walk(v,d+1);return}if(typeof x==='object')for(const [k,v] of Object.entries(x)){keys.add(k);walk(v,d+1)}};walk(data);return[...keys].slice(0,12);
}
const SENSITIVE_KEY=/token|authorization|cookie|phone|mobile|email|address|bank|accountnumber|ifsc|customername|recipient|pincode/i;
function redactSensitive(value,depth=0){if(depth>8)return'[TRUNCATED]';if(Array.isArray(value))return value.slice(0,100).map(v=>redactSensitive(v,depth+1));if(value&&typeof value==='object'){const o={};for(const [k,v] of Object.entries(value))o[k]=SENSITIVE_KEY.test(k)?'[REDACTED]':redactSensitive(v,depth+1);return o}return value}

function renderUnmatched(){
 const rt=$('#unmatchedReturnsTable'),ft=$('#unmatchedFinancialsTable'),hist=$('#syncHistoryTable');
 if(rt)rt.innerHTML='<thead><tr><th>Return ID</th><th>Order ID</th><th>SKU</th><th>Status</th><th>Reason</th><th>Refund</th></tr></thead><tbody>'+((unmatchedReturns||[]).slice(0,500).map(x=>`<tr><td>${esc(x.returnId||x.recordId||'—')}</td><td>${esc(x.orderId||'—')}</td><td>${esc(x.sku||'—')}</td><td>${esc(x.status||'Returned')}</td><td>${esc(x.returnReason||'—')}</td><td>${money(x.refund||0)}</td></tr>`).join('')||'<tr><td colspan="6">No unmatched returns.</td></tr>')+'</tbody>';
 if(ft)ft.innerHTML='<thead><tr><th>Reference</th><th>Order ID</th><th>SKU</th><th>Type</th><th>Settlement</th><th>Fees/Taxes</th></tr></thead><tbody>'+((unmatchedFinancials||[]).slice(0,500).map(x=>`<tr><td>${esc(x.settlementRef||x.transactionId||x.recordId||'—')}</td><td>${esc(x.orderId||'—')}</td><td>${esc(x.sku||'—')}</td><td>${esc(x.type||'—')}</td><td>${money(x.settlement||0)}</td><td>${money((x.fees||0)+(x.gst||0)+(x.tds||0)+(x.tcs||0))}</td></tr>`).join('')||'<tr><td colspan="6">No unmatched financial records.</td></tr>')+'</tbody>';
 if(hist)hist.innerHTML='<thead><tr><th>Time</th><th>Module</th><th>Mapped</th><th>Source</th></tr></thead><tbody>'+((syncHistory||[]).map(x=>`<tr><td>${new Date(x.at).toLocaleString('en-IN')}</td><td>${esc(x.module||'current page')}</td><td>${Number(x.mapped||0).toLocaleString()}</td><td>${esc(x.source||'—')}</td></tr>`).join('')||'<tr><td colspan="4">No sync history yet.</td></tr>')+'</tbody>';
}
function refreshInspector(){
 if(!developerMode){if($('#apiInspectorKpis'))$('#apiInspectorKpis').innerHTML=kpiHtml('Developer Mode','Off','Enable to inspect redacted endpoints','⌁');if($('#apiInspectorTable'))$('#apiInspectorTable').innerHTML='<tbody><tr><td>Developer Mode is disabled.</td></tr></tbody>';return;}
 const grouped={};for(const p of capturedApis){const c=classifyApi(p.url,p.data);(grouped[c]??=[]).push(p)};
 const total=capturedApis.length, mapped=rows.length, cats=Object.keys(grouped).filter(k=>k!=='other').length;
 if($('#apiInspectorKpis'))$('#apiInspectorKpis').innerHTML=kpiHtml('Captured APIs',total,'Current browser session','⌁')+kpiHtml('Detected Modules',cats,'Classified endpoints','▦')+kpiHtml('Valid Order Rows',mapped,'Used in dashboard','✓');
 const table=$('#apiInspectorTable');if(!table)return;
 const body=capturedApis.slice().reverse().map((p,i)=>{const c=classifyApi(p.url,p.data),rec=countObjectRecords(p.data),keys=topKeys(p.data).join(', ');return`<tr data-api-index="${capturedApis.length-1-i}"><td><span class="api-badge ${c}">${c}</span></td><td title="${String(p.url).replace(/"/g,'&quot;')}">${String(p.url).slice(0,78)}</td><td>${p.kind||'json'}</td><td>${rec}</td><td>${keys||'—'}</td></tr>`}).join('');
 table.innerHTML=`<thead><tr><th>Type</th><th>Endpoint</th><th>Source</th><th>Object records</th><th>Detected keys</th></tr></thead><tbody>${body||'<tr><td colspan="5">No API responses captured yet. Flipkart page refresh karke Sync Now karein.</td></tr>'}</tbody>`;
 table.querySelectorAll('tbody tr[data-api-index]').forEach(tr=>tr.onclick=()=>{const p=capturedApis[Number(tr.dataset.apiIndex)];$('#apiPreview').textContent=JSON.stringify(redactSensitive({url:p.url,kind:p.kind,at:p.at,data:p.data}),null,2).slice(0,150000)});
}
function downloadJson(name,data){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));chrome.downloads.download({url:u,filename:name,saveAs:true});revokeLater(u)}
if($('#refreshInspector'))$('#refreshInspector').onclick=refreshInspector;
if($('#developerMode'))$('#developerMode').onchange=e=>{developerMode=e.target.checked;$('#exportCapturedApis').disabled=!developerMode;$('#apiPreview').textContent=developerMode?'Select an endpoint to inspect redacted JSON structure.':'Enable Developer Mode to inspect redacted JSON structure.';refreshInspector()};if($('#exportCapturedApis'))$('#exportCapturedApis').onclick=()=>{if(!developerMode)return;downloadJson('flipkart-captured-api-responses-redacted.json',redactSensitive(capturedApis))};

window.addEventListener('message',e=>{if(e.source===window.parent&&e.data?.source==='DC_FK_HOST'&&e.data?.token===CHANNEL_TOKEN&&e.data?.type==='SYNC_PROGRESS'){const p=e.data.payload||{};if(p.state==='loading')show(`Auto sync: ${p.label} (${p.index}/${p.total})`);else if(p.state==='done'){show('Current Flipkart page sync completed. Other module page open karke Sync Now repeat karein.');$('#syncBtn').disabled=false;$('#cancelSyncBtn')?.classList.add('hidden')}else if(p.state==='cancelled'){show('Automatic sync cancelled.');$('#syncBtn').disabled=false;$('#cancelSyncBtn')?.classList.add('hidden')}else if(p.state==='error'){show('Automatic sync failed: '+(p.message||'Unknown error'),true);$('#syncBtn').disabled=false;$('#cancelSyncBtn')?.classList.add('hidden')};}});

window.addEventListener('message',e=>{
  if(e.source!==window.parent||e.data?.source!=='DC_FK_HOST'||e.data?.token!==CHANNEL_TOKEN||e.data?.type!=='LIVE_DATA')return;
  const payload=e.data.payload||{};capturedApis=(payload.network||[]).slice(-80);refreshInspector();renderUnmatched();{const domSeller=payload.dom?.sellerInfo||null, netSeller=extractSellerFromNetwork(payload.network)||null; latestSellerInfo=(domSeller?.detected&&domSeller?.name)?{...(netSeller||{}),...domSeller}:(netSeller||domSeller||latestSellerInfo);}const previousSeller={...(connectedSeller||{})},previousSellerKey=sellerKey();if(!connectedSeller&&latestSellerInfo?.detected&&(latestSellerInfo.name||latestSellerInfo.id)){connectedSeller={name:latestSellerInfo.name||'Flipkart Seller',id:latestSellerInfo.id||'',manual:false,autoDetected:true};chrome.storage?.local.set({connectedSeller});}else if(connectedSeller&&latestSellerInfo&&!connectedSeller.manual){connectedSeller={...connectedSeller,...Object.fromEntries(Object.entries(latestSellerInfo).filter(([,v])=>v))};chrome.storage?.local.set({connectedSeller});}if(payload.dom?.modules)for(const [k,v] of Object.entries(payload.dom.modules))if(moduleStatus[k]&&v)moduleStatus[k].detected=true;for(const p of payload.network||[]){const u=String(p.url||'').toLowerCase();if(/order/.test(u))moduleStatus.orders.detected=true;if(/listing|catalog/.test(u))moduleStatus.listings.detected=true;if(/inventory|stock/.test(u))moduleStatus.inventory.detected=true;if(/payment/.test(u))moduleStatus.payments.detected=true;if(/return|refund|rto/.test(u))moduleStatus.returns.detected=true;if(/settlement/.test(u))moduleStatus.settlements.detected=true;}if(previousSellerKey!==sellerKey()){migrateSellerNamespace(previousSeller,connectedSeller).then(()=>loadSellerData(()=>{render();updateConnectionUI()}));}else updateConnectionUI();if(!connectedSeller)return;
  if(payload.dom?.listings?.length){
    const bySku=new Map(inventoryRows.map(x=>[x.sku,x]));
    for(const x of payload.dom.listings)if(x.sku)bySku.set(x.sku,{...bySku.get(x.sku),...x});
    inventoryRows=[...bySku.values()];moduleStatus.listings.mapped=inventoryRows.length;moduleStatus.inventory.mapped=inventoryRows.filter(x=>Number.isFinite(+x.stock)).length;
  }
  const orderNetwork=(payload.network||[]).filter(p=>classifyApi(p.url,p.data)==='orders');
  let raw=networkToRows(orderNetwork);
  let source='captured Flipkart order API responses';
  if(!raw.length&&payload.dom?.modules?.orders){raw=(payload.dom?.tables||[]).flatMap(tableToObjects);source='visible Flipkart order table';}
  const mapped=mergeFinancialsIntoRows(mapRows(raw),payload.network||[]).filter(r=>{const oid=String(r.orderId||'').trim(),sku=String(r.sku||'').trim();return oid.length>=8&&sku.length>=3&&!/^\d+$/.test(sku)&&sku!=='UNKNOWN-SKU'&&!/^LISTING-/i.test(oid)});
  if(mapped.length){
    const byId=new Map(rows.map(x=>[rowKey(x),x]));for(const x of mapped)byId.set(rowKey(x),{...byId.get(rowKey(x)),...x});rows=[...byId.values()];moduleStatus.orders.mapped=rows.length;moduleStatus.returns.mapped=rows.filter(x=>/Returned|RTO/.test(x.status)).length;moduleStatus.settlements.mapped=rows.filter(x=>x.settlement>0).length;moduleStatus.payments.mapped=moduleStatus.settlements.mapped;lastLiveSync=Date.now();syncHistory=[{at:lastLiveSync,module:classifyApi(location.href,{}),mapped:mapped.length,source},...syncHistory].slice(0,100);mapping.liveSource=`${source} (${mapped.length} records)`;
    if(payload.dom?.metrics)mapping.pageMetrics=payload.dom.metrics;
    $('#mappingView').textContent=JSON.stringify(mapping,null,2);save();render();updateConnectionUI();
    show(`${mapped.length.toLocaleString()} valid order records mapped. ${capturedApis.length.toLocaleString()} API responses inspected.`)
  }else{
    save();render();show(inventoryRows.length?'Inventory/listing data synced. Har required Flipkart module page par Sync Now repeat karein.':'Detailed records nahi mile. Relevant Flipkart module page open karke Sync Now karein.',false)
  }
});



if($('#restoreBackup'))$('#restoreBackup').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;const d=JSON.parse(await f.text());if(d.schema!=='dc-fk-backup-v3.2'||!Array.isArray(d.rows)||!Array.isArray(d.inventoryRows)||d.rows.length>500000)throw Error('Invalid or unsupported backup schema');rows=d.rows.map(x=>({...x,date:x.date?new Date(x.date):null}));inventoryRows=d.inventoryRows;unmatchedReturns=Array.isArray(d.unmatchedReturns)?d.unmatchedReturns:[];unmatchedFinancials=Array.isArray(d.unmatchedFinancials)?d.unmatchedFinancials:[];financialLedger=Array.isArray(d.financialLedger)?d.financialLedger:[];syncHistory=Array.isArray(d.syncHistory)?d.syncHistory:[];skuCosts=d.skuCosts||{};if(d.settings)({costPct=42,packCost=12,adSpend=0,otherExpense=0}=d.settings);if(d.seller&&connectedSeller&&sellerIdentityKey(d.seller)!==sellerIdentityKey(connectedSeller)&&!confirm('Backup kisi dusre seller ka hai. Current seller data replace karna hai?'))throw Error('Restore cancelled: seller mismatch');if(d.seller)connectedSeller={...d.seller,stableKey:d.seller.stableKey||sellerIdentityKey(d.seller)};save();render();updateConnectionUI();show('Backup restored successfully.');}catch(err){show('Backup restore failed: '+err.message,true)}finally{e.target.value=''}};
if($('#darkModeBtn'))$('#darkModeBtn').onclick=()=>{document.body.classList.toggle('dark');chrome.storage.local.set({theme:document.body.classList.contains('dark')?'dark':'light'})};
if($('#printReport'))$('#printReport').onclick=()=>window.print();
