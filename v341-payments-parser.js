'use strict';
(() => {
  const text = value => String(value ?? '').trim();
  const upper = value => text(value).toUpperCase();
  const own = (object, key) => Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
  const numberValue = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || text(value) === '') return null;
    const raw = text(value).replace(/[₹,%\s,]/g, '').replace(/\((.*?)\)/, '-$1');
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const aliases = {
    transactionId: ['transactionId','transaction_id','paymentId','payment_id','referenceId','reference_id','utr','utrNumber'],
    settlementId: ['settlementId','settlement_id','settlementReference','settlement_reference','remittanceId','remittance_id'],
    orderId: ['orderId','order_id','customerOrderId','customer_order_id'],
    orderItemId: ['orderItemId','order_item_id','orderLineId','order_line_id'],
    shipmentId: ['shipmentId','shipment_id','shipmentIdentifier'],
    sku: ['sellerSku','seller_sku','sku','skuId','sellerSkuId'],
    chargeType: ['chargeType','charge_type','feeType','fee_type','componentType','component_type','transactionType','transaction_type'],
    amount: ['amount','transactionAmount','transaction_amount','paymentAmount','payment_amount','netAmount','net_amount'],
    settlement: ['settlementAmount','settlement_amount','netPayable','net_payable','paidAmount','paid_amount'],
    commission: ['commission','commissionFee','commission_fee','marketplaceFee','marketplace_fee'],
    fixedFee: ['fixedFee','fixed_fee'],
    collectionFee: ['collectionFee','collection_fee'],
    shipping: ['shippingFee','shipping_fee','shippingCharge','shipping_charge'],
    reverseShipping: ['reverseShippingFee','reverse_shipping_fee','returnShippingFee','return_shipping_fee'],
    gst: ['gst','gstAmount','gst_amount','taxAmount','tax_amount'],
    tds: ['tds','tdsAmount','tds_amount'],
    tcs: ['tcs','tcsAmount','tcs_amount'],
    refund: ['refundAmount','refund_amount'],
    adjustment: ['adjustment','adjustmentAmount','adjustment_amount','recoveryAmount','recovery_amount','compensationAmount','compensation_amount'],
    penalty: ['penalty','penaltyAmount','penalty_amount'],
    date: ['transactionDate','transaction_date','paymentDate','payment_date','createdAt','created_at','postedAt','posted_at'],
    status: ['paymentStatus','payment_status','transactionStatus','transaction_status','status']
  };
  const containers = ['payment','transaction','settlement','remittance','order','orderItem','shipment','fees','charges','taxes','amounts'];

  function pickDirect(object, keys) {
    for (const key of keys) if (own(object, key) && text(object[key]) !== '') return { value: object[key], path: key };
    for (const container of containers) {
      const nested = object?.[container];
      if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
      for (const key of keys) if (own(nested, key) && text(nested[key]) !== '') return { value: nested[key], path: `${container}.${key}` };
    }
    return { value: null, path: null };
  }

  function looksLikePayment(object) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
    const tx = pickDirect(object, aliases.transactionId).value;
    const settlement = pickDirect(object, aliases.settlementId).value;
    const orderItem = pickDirect(object, aliases.orderItemId).value;
    const amount = pickDirect(object, aliases.amount).value;
    const type = pickDirect(object, aliases.chargeType).value;
    return Boolean((tx || settlement || orderItem) && (amount !== null || type));
  }

  function endpointInfo(url = '') {
    const value = text(url).toLowerCase();
    if (/payment|transaction|payout/.test(value)) return { label: 'Payments API', confidence: 98, url };
    if (/settlement|remittance/.test(value)) return { label: 'Settlement API', confidence: 96, url };
    if (/graphql|search|view/.test(value)) return { label: 'Structured Network JSON', confidence: 86, url };
    return { label: 'Network JSON', confidence: 80, url };
  }

  function collect(value, path = '$', output = [], depth = 0, seen = new WeakSet()) {
    if (depth > 10 || value === null || value === undefined) return output;
    if (Array.isArray(value)) {
      value.forEach((item, index) => collect(item, `${path}[${index}]`, output, depth + 1, seen));
      return output;
    }
    if (typeof value !== 'object' || seen.has(value)) return output;
    seen.add(value);
    if (looksLikePayment(value)) output.push({ object: value, path });
    for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') collect(child, `${path}.${key}`, output, depth + 1, seen);
    return output;
  }

  function parseRecord(raw, source, recordPath) {
    const fields = Object.fromEntries(Object.entries(aliases).map(([name, keys]) => [name, pickDirect(raw, keys)]));
    const transactionId = text(fields.transactionId.value);
    const settlementId = text(fields.settlementId.value);
    const orderItemId = text(fields.orderItemId.value);
    const shipmentId = text(fields.shipmentId.value);
    const orderId = text(fields.orderId.value);
    const sku = upper(fields.sku.value);
    const chargeType = text(fields.chargeType.value) || 'payment';
    if (!(transactionId || settlementId || orderItemId || shipmentId)) return null;

    const financial = {};
    for (const key of ['amount','settlement','commission','fixedFee','collectionFee','shipping','reverseShipping','gst','tds','tcs','refund','adjustment','penalty']) {
      const value = numberValue(fields[key].value);
      if (value !== null) financial[key] = value;
    }
    if (!Object.keys(financial).length) return null;

    const date = fields.date.value ? new Date(fields.date.value) : null;
    const validDate = date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    const ledgerKey = ['payment', transactionId || settlementId || orderItemId || shipmentId, chargeType, orderItemId || shipmentId || sku || orderId].map(text).join('|');
    return {
      ledgerKey,
      transactionId,
      settlementId,
      orderId,
      orderItemId,
      shipmentId,
      sku,
      chargeType,
      status: text(fields.status.value),
      date: validDate,
      ...financial,
      source: source.label,
      sourceUrl: source.url,
      parser: 'structured-payments-v341',
      confidence: source.confidence,
      apiVerified: true,
      recordPath,
      fieldProvenance: Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, item.path]).filter(([, path]) => path))
    };
  }

  function parseNetwork(network = []) {
    const records = new Map();
    const rejected = new Set();
    for (const response of network) {
      const source = endpointInfo(response?.url);
      for (const candidate of collect(response?.data)) {
        const row = parseRecord(candidate.object, source, candidate.path);
        if (!row) { rejected.add(`${response?.url || ''}|${candidate.path}`); continue; }
        const previous = records.get(row.ledgerKey);
        if (!previous || row.confidence >= previous.confidence) records.set(row.ledgerKey, row);
      }
    }
    return { rows: [...records.values()], rejected: rejected.size };
  }

  function mergeLedger(existing = [], incoming = []) {
    const map = new Map();
    let duplicates = 0;
    const keyFor = row => text(row.ledgerKey || [row.transactionId,row.settlementId,row.chargeType,row.orderItemId,row.shipmentId,row.sku].join('|'));
    const add = row => {
      const key = keyFor(row); if (!key) return;
      const previous = map.get(key);
      if (previous) duplicates++;
      if (!previous || Number(row.confidence || 0) >= Number(previous.confidence || 0)) map.set(key, { ...previous, ...row });
    };
    existing.forEach(add); incoming.forEach(add);
    return { rows: [...map.values()], duplicates };
  }

  function ensurePanel() {
    const section = document.getElementById('settlements');
    if (!section) return null;
    let panel = document.getElementById('paymentsParserCoverage');
    if (!panel) {
      panel = document.createElement('article');
      panel.id = 'paymentsParserCoverage';
      panel.className = 'panel';
      section.querySelector('.kpis')?.insertAdjacentElement('afterend', panel);
    }
    return panel;
  }

  function renderCoverage(parsed, duplicates) {
    const panel = ensurePanel(); if (!panel) return;
    panel.innerHTML = `<div class="panel-head"><div><h3>Payments Data Quality</h3><small>Schema-safe payment/fee parsing</small></div></div><div class="kpis"><div class="kpi"><small>Structured Records</small><strong>${parsed.rows.length.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Rejected Candidates</small><strong>${parsed.rejected.toLocaleString('en-IN')}</strong></div><div class="kpi"><small>Duplicate Records</small><strong>${duplicates.toLocaleString('en-IN')}</strong></div></div>`;
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.source !== 'DC_FK_HOST' || event.data?.token !== CHANNEL_TOKEN || event.data?.type !== 'LIVE_DATA') return;
    queueMicrotask(() => {
      try {
        const parsed = parseNetwork(event.data.payload?.network || []);
        if (!parsed.rows.length) return;
        const merged = mergeLedger(financialLedger || [], parsed.rows);
        financialLedger = merged.rows;
        if (moduleStatus?.payments) {
          moduleStatus.payments.detected = true;
          moduleStatus.payments.mapped = financialLedger.length;
        }
        renderCoverage(parsed, merged.duplicates);
        if (typeof save === 'function') save();
        if (typeof render === 'function') render();
        if (typeof updateConnectionUI === 'function') updateConnectionUI();
      } catch (error) {
        console.warn('[Flipkart Analytics] Structured payments parser failed:', error);
      }
    });
  });
})();