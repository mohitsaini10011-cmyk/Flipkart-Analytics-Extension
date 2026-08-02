'use strict';
chrome.runtime.onInstalled.addListener(()=>chrome.storage.local.set({installedAt:Date.now()}));

async function showToolbarFailure(tabId) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({ tabId, title: 'Ecom Insight — Reload this Seller Hub tab once' });
    setTimeout(async () => {
      try {
        await chrome.action.setBadgeText({ tabId, text: '' });
        await chrome.action.setTitle({ tabId, title: 'Ecom Insight' });
      } catch {}
    }, 9000);
  } catch {}
}

chrome.action.onClicked.addListener(async tab=>{
  if(!tab?.id || !/^https:\/\/(?:[^/]+\.)?seller\.flipkart\.com\//i.test(tab.url||'')) return;
  try {
    await chrome.tabs.sendMessage(tab.id,{type:'OPEN_FLIPKART_ANALYTICS',source:'toolbar'});
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Ecom Insight' });
  } catch {
    await showToolbarFailure(tab.id);
  }
});