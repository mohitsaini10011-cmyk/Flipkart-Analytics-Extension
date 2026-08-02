'use strict';
(() => {
  const text = value => String(value ?? '').trim();
  const normalizeId = value => text(value).toUpperCase();
  const validId = value => /^[A-Z0-9_-]{4,80}$/.test(normalizeId(value)) && !/^(SELLER|FLIPKART|DASHBOARD|ACCOUNT|MERCHANT|VENDOR)$/.test(normalizeId(value));

  const VERIFIED_KEYS = ['sellerId','seller_id','sellerIdentifier','sellerCode','seller_code'];
  const PROBABLE_KEYS = ['merchantId','merchant_id','merchantCode'];
  const WEAK_KEYS = ['accountId','account_id','partnerId','vendorId'];

  function scanObject(value, url = '', depth = 0, seen = new WeakSet(), matches = []) {
    if (!value || typeof value !== 'object' || depth > 7) return matches;
    if (seen.has(value)) return matches;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) scanObject(item, url, depth + 1, seen, matches);
      return matches;
    }
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw === 'string' || typeof raw === 'number') {
        const id = normalizeId(raw);
        if (!validId(id)) continue;
        if (VERIFIED_KEYS.includes(key)) matches.push({ id, source: /profile|seller|account/i.test(url) ? 'Profile API' : 'Seller API', confidence: 'Verified', score: 100, key, url });
        else if (PROBABLE_KEYS.includes(key)) matches.push({ id, source: /profile|merchant|account/i.test(url) ? 'Merchant/Profile API' : 'Merchant API', confidence: 'Probable', score: 72, key, url });
        else if (WEAK_KEYS.includes(key)) matches.push({ id, source: 'Generic account field', confidence: 'Unverified', score: 35, key, url });
      } else if (raw && typeof raw === 'object') scanObject(raw, url, depth + 1, seen, matches);
    }
    return matches;
  }

  function bestNetworkIdentity(network = []) {
    const all = [];
    for (const response of network) scanObject(response?.data, text(response?.url), 0, new WeakSet(), all);
    all.sort((a, b) => b.score - a.score || Number(/profile/i.test(b.url)) - Number(/profile/i.test(a.url)));
    return all[0] || null;
  }

  function evaluateDomIdentity(info = {}) {
    const id = normalizeId(info.id);
    if (!validId(id)) return null;
    const source = text(info.source) || 'Seller portal DOM';
    return { id, source: source === 'seller-portal' ? 'Seller portal DOM' : source, confidence: 'Probable', score: 62 };
  }

  function ensureIdentityMeta() {
    const card = document.getElementById('sellerProfileCard');
    if (!card) return null;
    let meta = document.getElementById('sellerIdentityMeta');
    if (!meta) {
      meta = document.createElement('small');
      meta.id = 'sellerIdentityMeta';
      meta.style.display = 'block';
      meta.style.marginTop = '5px';
      meta.style.opacity = '.75';
      card.querySelector('.seller-profile-copy')?.appendChild(meta);
    }
    return meta;
  }

  function renderIdentityMeta(identity) {
    const meta = ensureIdentityMeta();
    if (!meta) return;
    const source = text(identity?.identitySource || identity?.source || 'Not verified');
    const confidence = text(identity?.identityConfidence || identity?.confidence || 'Unverified');
    meta.textContent = `Source: ${source} · Confidence: ${confidence}`;
    meta.dataset.confidence = confidence.toLowerCase();
  }

  async function applyIdentity(candidate, payload) {
    if (!candidate) {
      renderIdentityMeta(connectedSeller || latestSellerInfo || {});
      return;
    }
    if (connectedSeller?.manual) {
      connectedSeller = { ...connectedSeller, identitySource: 'Manual entry', identityConfidence: 'Verified' };
      await chrome.storage.local.set({ connectedSeller });
      renderIdentityMeta(connectedSeller);
      return;
    }

    const dom = payload?.dom?.sellerInfo || {};
    const name = text(dom.name || connectedSeller?.name || latestSellerInfo?.name || 'Flipkart Seller');
    const currentConfidence = text(connectedSeller?.identityConfidence);
    const ranks = { Verified: 3, Probable: 2, Unverified: 1, '': 0 };
    const shouldReplaceId = !validId(connectedSeller?.id) || ranks[candidate.confidence] >= ranks[currentConfidence];
    const next = {
      ...(connectedSeller || {}),
      name,
      id: shouldReplaceId ? candidate.id : connectedSeller.id,
      identitySource: shouldReplaceId ? candidate.source : connectedSeller.identitySource,
      identityConfidence: shouldReplaceId ? candidate.confidence : connectedSeller.identityConfidence,
      identityKey: shouldReplaceId ? candidate.key || '' : connectedSeller.identityKey || '',
      autoDetected: true,
      manual: false
    };
    connectedSeller = next;
    latestSellerInfo = { ...(latestSellerInfo || {}), ...next, detected: Boolean(next.name || next.id) };
    await chrome.storage.local.set({ connectedSeller: next });
    if (typeof updateConnectionUI === 'function') updateConnectionUI();
    renderIdentityMeta(next);
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.source !== 'DC_FK_HOST' || event.data?.token !== CHANNEL_TOKEN || event.data?.type !== 'LIVE_DATA') return;
    const payload = event.data.payload || {};
    queueMicrotask(async () => {
      try {
        const network = bestNetworkIdentity(payload.network || []);
        const dom = evaluateDomIdentity(payload.dom?.sellerInfo || {});
        const candidate = !network ? dom : !dom ? network : network.score >= dom.score ? network : dom;
        await applyIdentity(candidate, payload);
      } catch (error) {
        console.warn('[Flipkart Analytics] Seller identity validation failed:', error);
      }
    });
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (connectedSeller?.manual) {
      connectedSeller.identitySource = 'Manual entry';
      connectedSeller.identityConfidence = 'Verified';
    }
    renderIdentityMeta(connectedSeller || {});
  }, { once: true });
})();