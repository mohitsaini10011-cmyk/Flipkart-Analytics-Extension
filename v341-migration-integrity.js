'use strict';
(() => {
  const BACKUP_SUFFIX = '__migrated_backup';
  const BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const text = value => String(value ?? '').trim();
  const upper = value => text(value).toUpperCase();

  function pick(source, ...keys) {
    const raw = source?.raw || source || {};
    for (const key of keys) {
      const value = raw[key] ?? source?.[key];
      if (value !== undefined && value !== null && text(value)) return text(value);
    }
    return '';
  }

  function rowStableId(row = {}) {
    return [
      'row',
      pick(row, 'recordId'),
      pick(row, 'orderItemId', 'order_item_id', 'orderItemID'),
      pick(row, 'shipmentId', 'shipment_id'),
      pick(row, 'subOrderId', 'suborderId', 'sub_order_id'),
      pick(row, 'orderId', 'order_id', 'customerOrderId'),
      upper(pick(row, 'sku', 'sellerSku', 'seller_sku')),
      pick(row, 'date', 'orderDate', 'createdAt'),
      pick(row, 'qty', 'quantity', 'itemQuantity') || '1'
    ].join('|');
  }

  function inventoryStableId(row = {}) {
    return [
      'inventory',
      pick(row, 'listingId', 'listing_id'),
      pick(row, 'fsn', 'FSN'),
      upper(pick(row, 'sku', 'sellerSku', 'seller_sku')),
      pick(row, 'warehouseId', 'warehouse_id'),
      pick(row, 'variantId', 'variant_id')
    ].join('|');
  }

  function financialStableId(row = {}) {
    const chargeType = text(pick(row, 'chargeType', 'charge_type', 'feeType', 'financialType', 'type')).toLowerCase();
    return [
      'financial',
      pick(row, 'ledgerId'),
      pick(row, 'transactionId', 'transaction_id', 'paymentId'),
      pick(row, 'settlementReference', 'settlementRef', 'settlement_id', 'remittanceId'),
      pick(row, 'refundId', 'refund_id'),
      pick(row, 'returnId', 'return_id'),
      pick(row, 'orderItemId', 'order_item_id', 'orderItemID'),
      pick(row, 'shipmentId', 'shipment_id'),
      pick(row, 'subOrderId', 'suborderId', 'sub_order_id'),
      pick(row, 'orderId', 'order_id', 'customerOrderId'),
      upper(pick(row, 'sku', 'sellerSku', 'seller_sku')),
      chargeType,
      pick(row, 'sourceRowReference', 'rowNumber', 'recordId')
    ].join('|');
  }

  function mergeByStableId(first = [], second = [], stableId) {
    const map = new Map();
    for (const item of [...first, ...second]) {
      const key = stableId(item);
      map.set(key, { ...(map.get(key) || {}), ...item });
    }
    return [...map.values()];
  }

  async function digestIds(items = [], stableId) {
    const canonical = [...new Set(items.map(stableId))].sort().join('\n');
    const bytes = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function verifyCollection(expected, actual, stableId, field) {
    const expectedIds = new Set(expected.map(stableId));
    const actualIds = new Set(actual.map(stableId));
    if (expectedIds.size !== actualIds.size) throw new Error(`${field} identity count mismatch`);
    for (const id of expectedIds) if (!actualIds.has(id)) throw new Error(`${field} missing stable identity`);
    const [expectedHash, actualHash] = await Promise.all([
      digestIds(expected, stableId),
      digestIds(actual, stableId)
    ]);
    if (expectedHash !== actualHash) throw new Error(`${field} identity hash mismatch`);
    return expectedHash;
  }

  async function cleanupExpiredMigrationBackups(now = Date.now()) {
    const all = await chrome.storage.local.get(null);
    const expired = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.endsWith(BACKUP_SUFFIX)) continue;
      const migratedAt = Number(value?.migratedAt || 0);
      if (!migratedAt || now - migratedAt > BACKUP_RETENTION_MS) expired.push(key);
    }
    if (expired.length) await chrome.storage.local.remove(expired);
    return expired.length;
  }

  globalThis.cleanupExpiredMigrationBackups = cleanupExpiredMigrationBackups;
  cleanupExpiredMigrationBackups().catch(() => {});

  if (typeof migrateSellerNamespace !== 'function') return;

  let migrationPromise = null;
  migrateSellerNamespace = async function migrateSellerNamespaceWithIntegrity(oldSeller, newSeller) {
    if (migrationPromise) return migrationPromise;

    migrationPromise = (async () => {
      await cleanupExpiredMigrationBackups();

      const oldKey = sellerKeyFor(oldSeller);
      const newKey = sellerKeyFor(newSeller);
      if (oldKey === newKey) return;

      const backupKey = `${oldKey}${BACKUP_SUFFIX}`;
      const data = await chrome.storage.local.get([oldKey, newKey, STORAGE_INDEX_KEY, backupKey]);
      const oldData = data[oldKey] || {};
      const newData = data[newKey] || {};

      const merged = {
        ...oldData,
        ...newData,
        rows: mergeByStableId(oldData.rows, newData.rows, rowStableId),
        inventoryRows: mergeByStableId(oldData.inventoryRows, newData.inventoryRows, inventoryStableId),
        financialLedger: mergeByStableId(oldData.financialLedger, newData.financialLedger, financialStableId),
        unmatchedReturns: mergeByStableId(oldData.unmatchedReturns, newData.unmatchedReturns, financialStableId),
        unmatchedFinancials: mergeByStableId(oldData.unmatchedFinancials, newData.unmatchedFinancials, financialStableId),
        syncHistory: [...(oldData.syncHistory || []), ...(newData.syncHistory || [])].slice(-500),
        skuCosts: { ...(oldData.skuCosts || {}), ...(newData.skuCosts || {}) }
      };

      await chrome.storage.local.set({ [newKey]: merged });
      const stored = (await chrome.storage.local.get(newKey))[newKey];
      if (!stored) throw new Error('Seller migration destination missing');

      const integrity = {
        rows: await verifyCollection(merged.rows || [], stored.rows || [], rowStableId, 'rows'),
        inventoryRows: await verifyCollection(merged.inventoryRows || [], stored.inventoryRows || [], inventoryStableId, 'inventoryRows'),
        financialLedger: await verifyCollection(merged.financialLedger || [], stored.financialLedger || [], financialStableId, 'financialLedger'),
        unmatchedReturns: await verifyCollection(merged.unmatchedReturns || [], stored.unmatchedReturns || [], financialStableId, 'unmatchedReturns'),
        unmatchedFinancials: await verifyCollection(merged.unmatchedFinancials || [], stored.unmatchedFinancials || [], financialStableId, 'unmatchedFinancials')
      };

      const index = data[STORAGE_INDEX_KEY] || {};
      index[sellerIdentityKey(newSeller)] = {
        name: newSeller?.name || '',
        id: newSeller?.id || '',
        storageKey: newKey,
        updatedAt: Date.now(),
        verified: true,
        verificationMode: 'stable-id-sha256',
        integrity
      };

      const migratedAt = Date.now();
      await chrome.storage.local.set({
        [STORAGE_INDEX_KEY]: index,
        [backupKey]: {
          ...oldData,
          migratedAt,
          expiresAt: migratedAt + BACKUP_RETENTION_MS,
          retentionDays: 7,
          destinationKey: newKey,
          integrity
        }
      });

      if (data[oldKey]) await chrome.storage.local.remove(oldKey);
      await cleanupExpiredMigrationBackups(migratedAt);
    })();

    try {
      return await migrationPromise;
    } finally {
      migrationPromise = null;
    }
  };
})();
