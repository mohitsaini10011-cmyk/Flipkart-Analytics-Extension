(() => {
  if (window.__DC_FK_BRIDGE__) return;
  window.__DC_FK_BRIDGE__ = true;
  const buffer=[];const token=crypto.randomUUID();const MAX_BYTES=250000;const seen=new Map();
  const push=(url,data,kind='json')=>{const u=String(url||'');let serial='';try{serial=typeof data==='string'?data:JSON.stringify(data)}catch{return}if(serial.length>MAX_BYTES)return;const key=u+'|'+serial.length+'|'+serial.slice(0,160);if(seen.has(key)&&Date.now()-seen.get(key)<10000)return;seen.set(key,Date.now());buffer.push({url:u,data,kind,at:Date.now()});if(buffer.length>50)buffer.splice(0,buffer.length-50);window.postMessage({source:'DC_FK_PAGE',type:'NETWORK_DATA',url:u,data,kind,token},'*');};
  const originalFetch=window.fetch;
  window.fetch=async function(...args){
    const res=await originalFetch.apply(this,args);
    try{
      const c=res.clone(), ct=(c.headers.get('content-type')||'').toLowerCase();
      if(ct.includes('json')) push(args[0]?.url||args[0],await c.json(),'fetch');
      else if(ct.includes('csv')||ct.includes('text/plain')) { const txt=await c.text(); if(txt.length<2000000) push(args[0]?.url||args[0],txt,'text'); }
    }catch(e){}
    return res;
  };
  const xo=XMLHttpRequest.prototype.open, xs=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...rest){this.__dcUrl=url;return xo.call(this,method,url,...rest)};
  XMLHttpRequest.prototype.send=function(...args){
    this.addEventListener('load',()=>{try{
      const ct=(this.getResponseHeader('content-type')||'').toLowerCase();
      if(ct.includes('json')) push(this.__dcUrl,JSON.parse(this.responseText),'xhr');
      else if((ct.includes('csv')||ct.includes('text/plain'))&&String(this.responseText||'').length<2000000) push(this.__dcUrl,this.responseText,'text');
    }catch(e){}});
    return xs.apply(this,args)
  };
  window.addEventListener('message',e=>{
    if(e.source===window&&e.data?.source==='DC_FK_CONTENT'&&e.data?.token===token){
      if(e.data?.type==='GET_NETWORK_BUFFER')window.postMessage({source:'DC_FK_PAGE',type:'NETWORK_BUFFER',items:buffer.slice(-50),token},'*');
      if(e.data?.type==='CLEAR_NETWORK_BUFFER'){buffer.length=0;seen.clear();}
    }
  });
  window.postMessage({source:'DC_FK_PAGE',type:'BRIDGE_READY',token},'*');
})();
