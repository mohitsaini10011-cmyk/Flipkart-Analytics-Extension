'use strict';
(() => {
  const text = value => String(value ?? '').trim();
  const upper = value => text(value).toUpperCase();
  const own = (object, key) => Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
  const numberValue = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || text(value) === '') return null;
    const parsed = Number(text(value).replace(/[₹,%\s,]/g, '').replace(/\((.*?)\)/, '-$1'));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const directAliases = {
    orderId: ['orderId','order_id','customerOrderId','customer_order_id'],
    orderItemId: ['orderItemId','order_item_id','orderItemID','orderLineId','order_line_id'],
    shipmentId: ['shipmentId','shipment_id','shipmentIdentifier'],
    subOrderId: ['subOrderId','suborderId','sub_order_id'],
    sku: ['sellerSku','seller_sku','sku','skuId','sellerSkuId'],
    fsn: ['fsn','FSN','productId','product_id'],
    listingId: ['listingId','listing_id','listingIdentifier'],
    title: ['productTitle','product_title','productName','product_name','title','itemTitle'],
    quantity: ['quantity','qty','itemQuantity','item_quantity'],
    status: ['orderStatus','order_status','shipmentStatus','shipment_status','fulfilmentStatus','fulfillmentStatus','status'],
    sale: ['sellingPrice','selling_price','itemPrice','item_price','saleAmount','sale_amount','price'],
    date: ['orderDate','order_date','createdAt','created_at','placedAt','placed_at'],
    state: ['state','shippingState','shipping_state','deliveryState','delivery_state'],
    city: ['city','shippingCity','shipping_city','deliveryCity','delivery_city'],
    awb: ['awb','awbNumber','awb_number','trackingId','tracking_id'],
    courier: ['courier','courierName','courier_name','logisticsPartner','logistics_partner']
  };
  const approvedContainers = ['order','orderItem','order_item','item','shipment','product','listing','pricing','deliveryAddress','shippingAddress','address','tracking'];

  function pickDirect(object, aliases) {
    for (const key of aliases) {
      if (own(object, key) && object[key] !== null && object[key] !== undefined && text(object[key]) !== '') return { value: object[key], path: key };
    }
    for (const container of approvedContainers) {
      const nested = object?.[container];
      if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
      for (const key of aliases) {
        if (own(nested, key) && nested[key] !== null && nested[key] !== undefined && text(nested[key]) !== '') return { value: nested[key], path: `${container}.${key}` };
      }
    }
    return { value: null, path: null };
  }

  function looksLikeOrderRecord(object) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
    const order = pickDirect(object, directAliases.orderId).value;
    const item = pickDirect(object, directAliases.orderItemId).value;
    const shipment = pickDirect(object, directAliases.shipmentId).value;
    const sku = pickDirect(object, directAliases.sku).value;
    const status = pickDirect(object, directAliases.status).value;
    return Boolean((order || item || shipment) && (sku || status));
  }

  function normalizeStatus(value) {
    const s = text(value).toLowerCase();
    if (/deliver/.test(s)) return 'Delivered';
    if (/cancel/.test(s)) return 'Cancelled';
    if (/return|refund/.test(s)) return 'Returned';
    if (/\brto\b|return to origin/.test(s)) return 'RTO';
    if (/ship|dispatch|in transit|ready to dispatch/.test(s)) return 'Shipped';
    if (/pending|new|approved|processing|packed/.test(s)) return 'Pending';
    return text(value) || 'Pending';
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseRecord(raw, source, recordPath) {
    const fields = {};
    for (const [name, aliases] of Object.entries(directAliases)) fields[name] = pickDirect(raw, aliases);
    const orderId = text(fields.orderId.value);
    const orderItemId = text(fields.orderItemId.value);
    const shipmentId = text(fields.shipmentId.value);
    const subOrderId = text(fields.subOrderId.value);
    const sku = upper(fields.sku.value);
    if (!(orderItemId || shipmentId || (orderId && sku))) return null;
    if (!sku && !orderItemId && !shipmentId) return null;
    const quantity = Math.max(1, numberValue(fields.quantity.value) ?? 1);
    const date = parseDate(fields.date.value);
    const recordId = orderItemId || shipmentId || subOrderId || `${orderId}|${sku}|${quantity}`;
    return {
      recordId,
      orderId,
      orderItemId,
      shipmentId,
      subOrderId,
      sku,
      fsn: text(fields.fsn.value),
      listingId: text(fields.listingId.value),
      title: text(fields.title.value) || sku || orderId,
      qty: quantity,
      status: normalizeStatus(fields.status.value),
      sale: Math.max(0, numberValue(fields.sale.value) ?? 0),
      date,
      state: text(fields.state.value),
      city: text(fields.city.value),
      awb: text(fields.awb.value),
      courier: text(fields.courier.value),
      source: source.label,
      sourceUrl: source.url,
      parser: 'structured-orders-v341',
      confidence: source.confidence,
      apiVerified: true,
      recordPath,
      fieldProvenance: Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, item.path]).filter(([, path]) => path))
    };
  }

  function endpointInfo(url = '') {
    const value = text(url).toLowerCase();
    if (/order-item|orderitem|order_item/.test(value)) return { label: 'Order Items API', confidence: 99, url };
    if (/shipment/.test(value) && /order/.test(value)) return { label: 'Order Shipment API', confidence: 97, url };
    if (/orders?/.test(value)) return { label: 'Orders API', confidence: 95, url };
    if (/graphql|search|view/.test(value)) return { label: 'Structured Network JSON', confidence: 86, url };
    return { label: 'Network JSON', confidence: 80, url };
  }

  function collectRecordObjects(value, path = '$', output = [], depth = 0, seen = new WeakSet()) {
    if (depth > 10 || value === null || value === undefined) return output;
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectRecordObjects(item, `${path}[${index}]`, output, depth + 1, seen));
      return output;
    }
    if (typeof value !== 'object' || seen.has(value)) return output;
    seen.add(value);
    if (looksLikeOrderRecord(value)) output.push({ object: value, path });
    for (const [key, child] of Object.entries(value)) {
      if (!child || typeof child !== 'object') continue;
      collectRecordObjects(child, `${path}.${key}`, output, depth + 1, seen);
    }
    return output;
  }

  function stableKey(row) {
    return text(row.recordId || row.orderItemId || row.shipmentId || `${row.orderId}|${upper(row.sku)}|${row.qty || 1}`);
  }

  function parseNetwork(network = []) {
    const records = new Map();
    const rejected = new Set();
    for (const response of network) {
      const source = endpointInfo(response?.url);
      const candidates = collectRecordObjects(response?.data);
      for (const candidate of candidates) {
        const row = parseRecord(candidate.object, source, candidate.path);
        if (!row) {
          rejected.add(`${response?.url || ''}|${candidate.path}`);
          continue;
        }
        const key = stableKey(row);
        const previous = records.get(key);
        if (!previous || row.confidence >= previous.confidence) records.set(key, row);
      }
    }
    return { rows: [...records.values()], rejected: rejected.size };
  }

  function mergeRows(existing = [], incoming = []) {
    const map = new Map();
    let duplicates = 0;
    const add = row => {
      const key = stableKey(row);
      if (!key) return;
      const previous = map.get(key);
      if (previous) duplicates++;
      if (!previous || Number(row.confidence || 0) >= Number(previous.confidence || 0)) {
        map.set(key, { ...previous, ...row, date: row.date || previous?.date || null });
      }
    };
    existing.forEach(add);
    incoming.forEach(add);
    return { rows: [...map.values()], duplicates };
  }

  function ensurePanel() {
    const section = document.getElementById('orders');
    if (!section) return null;
    let panel = document.getElementById('ordersParserCoverage');
    if (!panel) {
      panel = document.createElement('article');
      panel.id = 'ordersParserCoverage';
      panel.className = 'panel';
      section.querySelector('.toolbar')?.insertAdjacentElement('afterend', panel);
    }
    return panel;
  }

  function renderCoverage(parsed, duplicates) {
    const panel = ensurePanel();
    if (!panel) return;
    panel.innerHTML = `<div class="panel-head"><div><h3>Orders Data Quality</h3><small>Schema-safe order/item parsing</small></div></div><div class="kpis"><div class="kpi"><small>Structured API Records</small><strong>${parsed.rows.length.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Rejected Candidates</small><strong>${parsed.rejected.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Duplicate Records</small><strong>${duplicates.toLocaleString('en-IN')}</strong></div></div>`;
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.source !== 'DC_FK_HOST' || event.data?.token !== CHANNEL_TOKEN || event.data?.type !== 'LIVE_DATA') return;
    const payload = event.data.payload || {};
    queueMicrotask(() => {
      try {
        const parsed = parseNetwork(payload.network || []);
        if (!parsed.rows.length) return;
        const merged = mergeRows(rows || [], parsed.rows);
        rows = merged.rows;
        if (moduleStatus?.orders) {
          moduleStatus.orders.detected = true;
          moduleStatus.orders.mapped = rows.length;
        }
        renderCoverage(parsed, merged.duplicates);
        if (typeof save === 'function') save();
        if (typeof render === 'function') render();
        if (typeof updateConnectionUI === 'function') updateConnectionUI();
      } catch (error) {
        console.warn('[Flipkart Analytics] Structured orders parser failed:', error);
      }
    });
  });
})();