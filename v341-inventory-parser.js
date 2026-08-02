'use strict';
(() => {
  const text = value => String(value ?? '').trim();
  const upper = value => text(value).toUpperCase();
  const own = (object, key) => Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
  const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const numberValue = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || text(value) === '') return null;
    const parsed = Number(text(value).replace(/[₹,%\s,]/g, '').replace(/\((.*?)\)/, '-$1'));
    return Number.isFinite(parsed) ? parsed : null;
  };

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

  const approvedNestedContainers = new Set([
    'inventory', 'stock', 'availability', 'quantity', 'quantities', 'listing', 'product',
    'pricing', 'price', 'warehouse', 'location', 'seller', 'metadata', 'attributes'
  ]);

  function directPick(record, keys) {
    for (const key of keys) {
      if (own(record, key) && record[key] !== null && record[key] !== undefined && text(record[key]) !== '') {
        return { value: record[key], path: key };
      }
    }
    for (const [containerKey, container] of Object.entries(record)) {
      if (!approvedNestedContainers.has(containerKey.toLowerCase()) || !isObject(container)) continue;
      for (const key of keys) {
        if (own(container, key) && container[key] !== null && container[key] !== undefined && text(container[key]) !== '') {
          return { value: container[key], path: `${containerKey}.${key}` };
        }
      }
    }
    return { value: null, path: null };
  }

  function schemaHints(record) {
    if (!isObject(record)) return { sku: false, identity: false, quantity: false, warehouse: false };
    const sku = directPick(record, aliases.sku).value !== null;
    const identity = directPick(record, aliases.listingId).value !== null || directPick(record, aliases.fsn).value !== null;
    const quantity = directPick(record, aliases.availableQty).value !== null;
    const warehouse = directPick(record, aliases.warehouse).value !== null;
    return { sku, identity, quantity, warehouse };
  }

  function isRecordObject(record) {
    const hints = schemaHints(record);
    return hints.sku && hints.identity && hints.quantity;
  }

  function classifyEndpoint(url = '', schemaVerified = false) {
    const value = text(url).toLowerCase();
    if (/inventory|stock|availability/.test(value)) return { source: 'Inventory API', confidence: 98 };
    if (/listing/.test(value)) return { source: 'Listings API', confidence: 94 };
    if (/catalog|product/.test(value)) return { source: 'Catalog API', confidence: 88 };
    return schemaVerified ? { source: 'Schema-verified Network JSON', confidence: 90 } : { source: 'Network JSON', confidence: 72 };
  }

  function collectRecordNodes(value, path = '$', output = [], seen = new WeakSet(), depth = 0) {
    if (depth > 10 || value === null || value === undefined) return output;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isRecordObject(item)) output.push({ record: item, path: `${path}[${index}]` });
        else collectRecordNodes(item, `${path}[${index}]`, output, seen, depth + 1);
      });
      return output;
    }
    if (!isObject(value) || seen.has(value)) return output;
    seen.add(value);
    if (isRecordObject(value)) {
      output.push({ record: value, path });
      return output;
    }
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') collectRecordNodes(child, `${path}.${key}`, output, seen, depth + 1);
    }
    return output;
  }

  function parseCandidate(raw, endpoint, recordPath) {
    const skuField = directPick(raw, aliases.sku);
    const listingField = directPick(raw, aliases.listingId);
    const fsnField = directPick(raw, aliases.fsn);
    const qtyField = directPick(raw, aliases.availableQty);
    const sku = upper(skuField.value);
    const listingId = text(listingField.value);
    const fsn = text(fsnField.value);
    const availableQty = numberValue(qtyField.value);
    if (!sku || (!listingId && !fsn) || availableQty === null) return null;
    if (sku.length < 2 || sku.length > 160 || /^(UNKNOWN|NA|N\/A|NULL)$/.test(sku)) return null;

    const warehouseField = directPick(raw, aliases.warehouse);
    const titleField = directPick(raw, aliases.title);
    const brandField = directPick(raw, aliases.brand);
    const categoryField = directPick(raw, aliases.category);
    const reservedField = directPick(raw, aliases.reservedQty);
    const blockedField = directPick(raw, aliases.blockedQty);
    const variantField = directPick(raw, aliases.variantId);
    const statusField = directPick(raw, aliases.status);
    const sellingField = directPick(raw, aliases.sellingPrice);
    const mrpField = directPick(raw, aliases.mrp);
    const updatedField = directPick(raw, aliases.updatedAt);
    const warehouse = text(warehouseField.value);

    return {
      listingId,
      sku,
      fsn,
      title: text(titleField.value) || sku,
      brand: text(brandField.value),
      category: text(categoryField.value),
      stock: Math.max(0, availableQty),
      availableQty: Math.max(0, availableQty),
      reservedQty: Math.max(0, numberValue(reservedField.value) ?? 0),
      blockedQty: Math.max(0, numberValue(blockedField.value) ?? 0),
      warehouse,
      warehouseId: warehouse,
      variantId: text(variantField.value),
      status: text(statusField.value) || 'Listing',
      sale: numberValue(sellingField.value) ?? 0,
      mrp: numberValue(mrpField.value) ?? 0,
      updatedAt: text(updatedField.value) || new Date().toISOString(),
      source: endpoint.source,
      confidence: endpoint.confidence,
      apiVerified: true,
      recordPath,
      fieldProvenance: {
        sku: skuField.path,
        listingId: listingField.path,
        fsn: fsnField.path,
        availableQty: qtyField.path,
        warehouse: warehouseField.path
      }
    };
  }

  function stableKey(row) {
    return [text(row.listingId || row.fsn), upper(row.sku), text(row.warehouseId || row.warehouse), text(row.variantId)].join('|');
  }

  function responseFingerprint(response, index) {
    return `${text(response?.url)}|${Number(response?.at || 0)}|${index}`;
  }

  function parseNetwork(network = []) {
    const records = [];
    const acceptedPaths = new Set();
    const rejectedPaths = new Set();
    const candidateFingerprints = new Set();

    network.forEach((response, responseIndex) => {
      const nodes = collectRecordNodes(response?.data);
      const schemaVerified = nodes.length > 0;
      const endpoint = classifyEndpoint(response?.url, schemaVerified);
      if (!schemaVerified && !/inventory|stock|availability|listing|catalog|product/i.test(text(response?.url))) return;
      const base = responseFingerprint(response, responseIndex);
      for (const node of nodes) {
        const pathKey = `${base}|${node.path}`;
        if (acceptedPaths.has(pathKey) || rejectedPaths.has(pathKey)) continue;
        const candidate = parseCandidate(node.record, endpoint, node.path);
        if (!candidate) {
          rejectedPaths.add(pathKey);
          continue;
        }
        const fingerprint = `${base}|${stableKey(candidate)}|${node.path}`;
        if (candidateFingerprints.has(fingerprint)) continue;
        candidateFingerprints.add(fingerprint);
        acceptedPaths.add(pathKey);
        records.push(candidate);
      }
    });

    return { records, rejected: rejectedPaths.size };
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
    const duplicateKeys = new Set();
    const add = record => {
      const key = stableKey(record);
      if (!key.replaceAll('|', '')) return;
      const previous = map.get(key);
      if (previous) duplicateKeys.add(key);
      if (!previous || Number(record.confidence || 0) >= Number(previous.confidence || 0)) map.set(key, { ...previous, ...record });
    };
    existing.forEach(add);
    domRecords.forEach(add);
    apiRecords.forEach(add);
    return { rows: [...map.values()], duplicates: duplicateKeys.size };
  }

  function ensureCoveragePanel() {
    const section = document.getElementById('inventory');
    if (!section) return null;
    let panel = document.getElementById('inventoryCoveragePanel');
    if (!panel) {
      panel = document.createElement('article');
      panel.id = 'inventoryCoveragePanel';
      panel.className = 'panel';
      document.getElementById('inventoryKpis')?.insertAdjacentElement('afterend', panel);
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
        console.warn('[Flipkart Analytics] Schema-safe inventory parser failed:', error);
      }
    });
  });

  document.addEventListener('DOMContentLoaded', () => renderCoverage(inventoryRows || [], 0, 0), { once: true });
})();