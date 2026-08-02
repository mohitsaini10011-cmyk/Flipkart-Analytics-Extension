'use strict';
chrome.runtime.onInstalled.addListener(()=>chrome.storage.local.set({installedAt:Date.now()}));
chrome.action.onClicked.addListener(async tab=>{
  if(!tab?.id || !/^https:\/\/(?:[^/]+\.)?seller\.flipkart\.com\//i.test(tab.url||'')) return;
  try{await chrome.tabs.sendMessage(tab.id,{type:'OPEN_FLIPKART_ANALYTICS',source:'toolbar'});}catch(e){}
});
