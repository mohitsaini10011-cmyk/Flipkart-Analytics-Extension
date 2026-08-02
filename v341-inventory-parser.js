'use strict';
(() => {
  const text = value => String(value ?? '').trim();
  const numberValue = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || text(value) === '') return null;
    const parsed = Number(text(value).replace(/[₹,%\s,]/g, '').replace(/\((.*?)\)/, '-$1'));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const upper = value => text(value).toUpperCase();
  const own = (object, key) => Boolean(object && Object.prototype.hasOwnProperty.call(object, key));

  const aliases = {
    sku: ['sellerSku', 'seller_sku', 'sku', 'skuId', 'sellerSkuId'],
    listingId: ['listingId', 'listing_id', 'listingIdentifier', 'listingCode'],
    fsn: ['fsn', 'FSN', 'productId', 'product_id'],
    title: ['productTitle', 'product_title', 'productName', 'product_name', 'title', 'name'],
    brand: ['brand', 'brandName', 'brand_name'],
    category: ['category', 'categoryName', 'category_name', 'vertical'],
    availableQty: ['availableQty', 'availableQuantity', 'available_quantity', 'availableStock', 'available_stock', 'stock', 'inventory'],
    reservedQty: ['reservedQty', 'reservedQuantity', 'reserved_quantity', 'reservedStock', 'reserved_stock'],
    blockedQty: ['blockedQty', 'blockedQuantity', 'blocked_quantity', 'blockedStock', 'blocked_stock'],
    warehouse: ['warehouseId', 'warehouse_id', 'warehouseName', 'warehouse_name', 'locationId', 'location_id'],
    variantId: ['variantId', 'variant_id'],
    status: ['listingStatus', 'listing_status', 'inventoryStatus', 'inventory_status', 'status'],
    sellingPrice: ['sellingPrice', 'selling_price', 'finalPrice', 'final_price', 'price'],
    mrp: ['mrp', 'maximumRetailPrice', 'maximum_retail_price'],
    updatedAt: ['updatedAt', 'updated_at', 'lastUpdated', 'last_updated', 'modifiedAt', 'modified_at']
  };

  function flatten(object, prefix = '', output = {}, depth = 0) {
    if (!object || typeof object !== 'object' || depth > 5) return output;
    for (const [key, value] of Object.entries(object)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, output, depth + 1);
      else if (!Array.isArray(value)) {
        output[path] = value;
        if (!own(output, key)) output[key] = value;
      }
    }
    return output;
  }

  function pick(flat, keys) {
    for (const key of keys) {
      if (own(flat, key) && flat[key] !== null && flat[key] !== undefined && text(flat[key]) !== '') return flat[key];
      const suffix = `.${key}`.toLowerCase();
      const match = Object.keys(flat).find(path => path.toLowerCase().endsWith(suffix));
      if (match && text(flat[match]) !== '') return flat[match];
    }
    return null;
  }

  function classifyEndpoint(url = '') {
    const value = text(url).toLowerCase();
    if (/inventory|stock|availability/.test(value)) return { source: 'Inventory API', confidence: 98 };
    if (/listing/.test(value)) return { source: 'Listings API', confidence: 94 };
    if (/catalog|product/.test(value)) return { source: 'Catalog API', confidence: 88 };
    return { source: 'Network JSON', confidence: 80 };
  }

  function walk(value, visitor, depth = 0) {
    if (depth > 9 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visitor, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    visitor(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, visitor, depth + 1);
  }

  function parseCandidate(raw, endpoint) {
    const flat = flatten(raw);
    const sku = upper(pick(flat, aliases.sku));
    const listingId = text(pick(flat, aliases.listingId));
    const fsn = text(pick(flat, aliases.fsn));
    const availableQty = numberValue(pick(flat, aliases.availableQty));
    if (!sku || (!listingId && !fsn) || availableQty === null) return null;
    if (sku.length < 2 || sku.length > 160 || /^(UNKNOWN|NA|N\/A|NULL)$/.test(sku)) return null;
    const warehouse = text(pick(flat, aliases.warehouse));
    return {
      listingId,
      sku,
      fsn,
      title: text(pick(flat, aliases.title)) || sku,
      brand: text(pick(flat, aliases.brand)),
      category: text(pick(flat, aliases.category)),
      stock: Math.max(0, availableQty),
      availableQty: Math.max(0, availableQty),
      reservedQty: Math.max(0, numberValue(pick(flat, aliases.reservedQty)) ?? 0),
      blockedQty: Math.max(0, numberValue(pick(flat, aliases.blockedQty)) ?? 0),
      warehouse,
      warehouseId: warehouse,
      variantId: text(pick(flat, aliases.variantId)),
      status: text(pick(flat, aliases.status)) || 'Listing',
      sale: numberValue(pick(flat, aliases.sellingPrice)) ?? 0,
      mrp: numberValue(pick(flat, aliases.mrp)) ?? 0,
      updatedAt: text(pick(flat, aliases.updatedAt)) || new Date().toISOString(),
      source: endpoint.source,
      confidence: endpoint.confidence,
      apiVerified: true
    };
  }

  function stableKey(row) {
    return [text(row.listingId || row.fsn), upper(row.sku), text(row.warehouseId || row.warehouse), text(row.variantId)].join('|');
  }

  function parseNetwork(network = []) {
    const records = [];
    let rejected = 0;
    for (const response of network) {
      const endpoint = classifyEndpoint(response?.url);
      if (!/inventory|stock|availability|listing|catalog|product/i.test(text(response?.url))) continue;
      walk(response?.data, object => {
        const candidate = parseCandidate(object, endpoint);
        if (candidate) records.push(candidate);
        else {
          const flat = flatten(object);
          const hasInventoryHint = aliases.sku.some(key => own(flat, key)) || aliases.availableQty.some(key => own(flat, key));
          if (hasInventoryHint) rejected++;
        }
      });
    }
    return { records, rejected };
  }

  function domFallback(listings = []) {
    return listings.filter(item => item?.sku).map(item => ({
      ...item,
      sku: upper(item.sku),
      listingId: text(item.listingId),
      fsn: text(item.fsn),
      warehouse: text(item.warehouse),
      warehouseId: text(item.warehouseId || item.warehouse),
      availableQty: Math.max(0, numberValue(item.stock) ?? 0),
      stock: Math.max(0, numberValue(item.stock) ?? 0),
      source: 'DOM Fallback',
      confidence: 55,
      apiVerified: false
    }));
  }

  function mergeInventory(existing = [], apiRecords = [], domRecords = []) {
    const map = new Map();
    let duplicates = 0;
    const add = record => {
      const key = stableKey(record);
      if (!key.replaceAll('|', '')) return;
      const previous = map.get(key);
      if (previous) duplicates++;
      if (!previous || Number(record.confidence || 0) >= Number(previous.confidence || 0)) map.set(key, { ...previous, ...record });
    };
    existing.forEach(add);
    domRecords.forEach(add);
    apiRecords.forEach(add);
    return { rows: [...map.values()], duplicates };
  }

  function ensureCoveragePanel() {
    const section = document.getElementById('inventory');
    if (!section) return null;
    let panel = document.getElementById('inventoryCoveragePanel');
    if (!panel) {
      panel = document.createElement('article');
      panel.id = 'inventoryCoveragePanel';
      panel.className = 'panel';
      const kpis = document.getElementById('inventoryKpis');
      kpis?.insertAdjacentElement('afterend', panel);
    }
    return panel;
  }

  function renderCoverage(rows, rejected, duplicates) {
    const panel = ensureCoveragePanel();
    if (!panel) return;
    const api = rows.filter(row => row.apiVerified).length;
    const dom = rows.filter(row => !row.apiVerified).length;
    const mode = api && !dom ? '🟢 API Verified' : api ? '🟡 Mixed (API + DOM)' : '🔴 DOM Fallback';
    panel.innerHTML = `<div class="panel-head"><div><h3>Inventory Data Coverage</h3><small>${mode}</small></div></div><div class="kpis"><div class="kpi"><small>Total Inventory Records</small><strong>${rows.length.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>API Records</small><strong>${api.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>DOM Records</small><strong>${dom.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Rejected Records</small><strong>${rejected.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Duplicate Records</small><strong>${duplicates.toLocaleString('en-IN')}</strong></div></div>`;
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.source !== 'DC_FK_HOST' || event.data?.token !== CHANNEL_TOKEN || event.data?.type !== 'LIVE_DATA') return;
    const payload = event.data.payload || {};
    queueMicrotask(() => {
      try {
        const parsed = parseNetwork(payload.network || []);
        const dom = domFallback(payload.dom?.listings || []);
        const merged = mergeInventory(inventoryRows || [], parsed.records, dom);
        inventoryRows = merged.rows;
        if (moduleStatus?.inventory) {
          moduleStatus.inventory.detected = moduleStatus.inventory.detected || parsed.records.length > 0 || dom.length > 0;
          moduleStatus.inventory.mapped = inventoryRows.length;
        }
        if (moduleStatus?.listings) {
          moduleStatus.listings.detected = moduleStatus.listings.detected || parsed.records.length > 0 || dom.length > 0;
          moduleStatus.listings.mapped = inventoryRows.length;
        }
        renderCoverage(inventoryRows, parsed.rejected, merged.duplicates);
        if (typeof save === 'function') save();
        if (typeof render === 'function') render();
        if (typeof updateConnectionUI === 'function') updateConnectionUI();
      } catch (error) {
        console.warn('[Flipkart Analytics] Structured inventory parser failed:', error);
      }
    });
  });

  document.addEventListener('DOMContentLoaded', () => renderCoverage(inventoryRows || [], 0, 0), { once: true });
})();