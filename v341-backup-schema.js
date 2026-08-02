'use strict';
(() => {
  const BACKUP_VERSION = '3.4.1';
  const BACKUP_SCHEMA = 'dc-fk-backup-v3.4.1';
  const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
  const arrays = ['rows','inventoryRows','unmatchedReturns','unmatchedFinancials','financialLedger','syncHistory'];
  const finite = value => Number.isFinite(Number(value));
  const serialDate = value => value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : value || null;
  const clone = value => structuredClone(value);

  function sanitizeRows(list = []) {
    return list.map(item => ({ ...item, date: serialDate(item?.date) }));
  }

  function validateObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  }

  function validateBackup(data) {
    validateObject(data, 'Backup');
    const supported = data.schema === BACKUP_SCHEMA || data.schema === 'dc-fk-backup-v3.2';
    if (!supported) throw new Error('Unsupported backup schema');
    for (const key of arrays) if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`${key} must be an array`);
    if (data.skuCosts !== undefined) {
      validateObject(data.skuCosts, 'skuCosts');
      for (const [sku, value] of Object.entries(data.skuCosts)) {
        if (!String(sku).trim() || !finite(value) || Number(value) < 0) throw new Error('Invalid SKU cost entry');
      }
    }
    if (data.settings !== undefined) {
      validateObject(data.settings, 'settings');
      for (const key of ['costPct','packCost','adSpend','otherExpense']) {
        if (data.settings[key] !== undefined && (!finite(data.settings[key]) || Number(data.settings[key]) < 0)) throw new Error(`Invalid setting: ${key}`);
      }
    }
    return true;
  }

  function buildBackup() {
    return {
      version: BACKUP_VERSION,
      schema: BACKUP_SCHEMA,
      exportedAt: new Date().toISOString(),
      seller: connectedSeller || null,
      rows: sanitizeRows(rows || []),
      inventoryRows: inventoryRows || [],
      unmatchedReturns: unmatchedReturns || [],
      unmatchedFinancials: unmatchedFinancials || [],
      financialLedger: financialLedger || [],
      syncHistory: syncHistory || [],
      skuCosts: skuCosts || {},
      settings: { costPct, packCost, adSpend, otherExpense },
      mapping: mapping || {},
      lastLiveSync: lastLiveSync || null,
      moduleStatus: moduleStatus || {},
      metadata: {
        recordCounts: {
          rows: (rows || []).length,
          inventoryRows: (inventoryRows || []).length,
          unmatchedReturns: (unmatchedReturns || []).length,
          unmatchedFinancials: (unmatchedFinancials || []).length,
          financialLedger: (financialLedger || []).length
        }
      }
    };
  }

  function downloadBackup() {
    const payload = JSON.stringify(buildBackup(), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    chrome.downloads.download({ url, filename: `flipkart-analytics-backup-v${BACKUP_VERSION}.json`, saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (typeof show === 'function') show('Backup v3.4.1 downloaded.');
  }

  function makeCandidate(data) {
    const restoredSeller = data.seller
      ? { ...data.seller, stableKey: data.seller.stableKey || sellerIdentityKey(data.seller) }
      : connectedSeller;
    const candidateRows = (data.rows || []).map(item => ({ ...item, date: item.date ? new Date(item.date) : null }));
    if (candidateRows.some(item => item.date && Number.isNaN(item.date.getTime()))) throw new Error('Backup contains an invalid order date');
    return {
      seller: restoredSeller,
      rows: candidateRows,
      inventoryRows: clone(data.inventoryRows || []),
      unmatchedReturns: clone(data.unmatchedReturns || []),
      unmatchedFinancials: clone(data.unmatchedFinancials || []),
      financialLedger: clone(data.financialLedger || []),
      syncHistory: clone(data.syncHistory || []),
      skuCosts: clone(data.skuCosts || {}),
      mapping: clone(data.mapping || {}),
      lastLiveSync: data.lastLiveSync || null,
      moduleStatus: clone(data.moduleStatus || moduleStatus),
      settings: {
        costPct: Number(data.settings?.costPct ?? costPct),
        packCost: Number(data.settings?.packCost ?? packCost),
        adSpend: Number(data.settings?.adSpend ?? adSpend),
        otherExpense: Number(data.settings?.otherExpense ?? otherExpense)
      }
    };
  }

  function serialCandidate(candidate) {
    return {
      rows: sanitizeRows(candidate.rows),
      inventoryRows: candidate.inventoryRows,
      unmatchedReturns: candidate.unmatchedReturns,
      unmatchedFinancials: candidate.unmatchedFinancials,
      financialLedger: candidate.financialLedger,
      syncHistory: candidate.syncHistory,
      skuCosts: candidate.skuCosts,
      settings: candidate.settings,
      mapping: candidate.mapping,
      lastLiveSync: candidate.lastLiveSync,
      moduleStatus: candidate.moduleStatus,
      restoredFromBackup: { version: BACKUP_VERSION, restoredAt: Date.now() }
    };
  }

  function verifyStored(candidate, stored) {
    if (!stored || typeof stored !== 'object') throw new Error('Temporary restore verification failed');
    const expected = serialCandidate(candidate);
    for (const key of ['rows','inventoryRows','unmatchedReturns','unmatchedFinancials','financialLedger','syncHistory']) {
      if (!Array.isArray(stored[key]) || stored[key].length !== expected[key].length) throw new Error(`${key} verification failed`);
    }
    if (JSON.stringify(stored.skuCosts || {}) !== JSON.stringify(expected.skuCosts || {})) throw new Error('SKU cost verification failed');
    if (JSON.stringify(stored.settings || {}) !== JSON.stringify(expected.settings || {})) throw new Error('Settings verification failed');
    return true;
  }

  function snapshotGlobals() {
    return {
      connectedSeller: clone(connectedSeller), rows: clone(rows), inventoryRows: clone(inventoryRows),
      unmatchedReturns: clone(unmatchedReturns), unmatchedFinancials: clone(unmatchedFinancials),
      financialLedger: clone(financialLedger), syncHistory: clone(syncHistory), skuCosts: clone(skuCosts),
      mapping: clone(mapping), lastLiveSync, moduleStatus: clone(moduleStatus),
      costPct, packCost, adSpend, otherExpense
    };
  }

  function applyGlobals(candidate) {
    connectedSeller = candidate.seller;
    rows = candidate.rows;
    inventoryRows = candidate.inventoryRows;
    unmatchedReturns = candidate.unmatchedReturns;
    unmatchedFinancials = candidate.unmatchedFinancials;
    financialLedger = candidate.financialLedger;
    syncHistory = candidate.syncHistory;
    skuCosts = candidate.skuCosts;
    mapping = candidate.mapping;
    lastLiveSync = candidate.lastLiveSync;
    moduleStatus = candidate.moduleStatus;
    ({ costPct, packCost, adSpend, otherExpense } = candidate.settings);
  }

  function restoreGlobals(snapshot) {
    connectedSeller = snapshot.connectedSeller;
    rows = snapshot.rows;
    inventoryRows = snapshot.inventoryRows;
    unmatchedReturns = snapshot.unmatchedReturns;
    unmatchedFinancials = snapshot.unmatchedFinancials;
    financialLedger = snapshot.financialLedger;
    syncHistory = snapshot.syncHistory;
    skuCosts = snapshot.skuCosts;
    mapping = snapshot.mapping;
    lastLiveSync = snapshot.lastLiveSync;
    moduleStatus = snapshot.moduleStatus;
    ({ costPct, packCost, adSpend, otherExpense } = snapshot);
  }

  async function restoreBackup(file) {
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup file exceeds 25 MB limit');
    const data = JSON.parse(await file.text());
    validateBackup(data);
    const candidate = makeCandidate(data);
    if (!candidate.seller) throw new Error('Backup seller identity is missing');

    const snapshot = snapshotGlobals();
    const oldSeller = snapshot.connectedSeller;
    const oldKey = sellerKeyFor(oldSeller || candidate.seller);
    const newKey = sellerKeyFor(candidate.seller);
    const tempKey = `${newKey}__restore_tmp_${crypto.randomUUID()}`;
    const storageBefore = await chrome.storage.local.get([oldKey, newKey, 'connectedSeller']);
    const serialized = serialCandidate(candidate);

    try {
      await chrome.storage.local.set({ [tempKey]: serialized });
      const tempStored = (await chrome.storage.local.get(tempKey))[tempKey];
      verifyStored(candidate, tempStored);

      await chrome.storage.local.set({ [newKey]: serialized, connectedSeller: candidate.seller });
      const committed = await chrome.storage.local.get([newKey, 'connectedSeller']);
      verifyStored(candidate, committed[newKey]);
      if (sellerIdentityKey(committed.connectedSeller) !== sellerIdentityKey(candidate.seller)) throw new Error('Seller identity verification failed');

      applyGlobals(candidate);
      if (typeof render === 'function') render();
      if (typeof updateConnectionUI === 'function') updateConnectionUI();
      await chrome.storage.local.remove(tempKey);
      if (typeof show === 'function') show(`Backup ${data.version || 'legacy'} restored successfully.`);
    } catch (error) {
      restoreGlobals(snapshot);
      const rollback = {};
      if (storageBefore[oldKey] !== undefined) rollback[oldKey] = storageBefore[oldKey];
      if (newKey !== oldKey && storageBefore[newKey] !== undefined) rollback[newKey] = storageBefore[newKey];
      if (storageBefore.connectedSeller !== undefined) rollback.connectedSeller = storageBefore.connectedSeller;
      if (Object.keys(rollback).length) await chrome.storage.local.set(rollback);
      if (newKey !== oldKey && storageBefore[newKey] === undefined) await chrome.storage.local.remove(newKey);
      await chrome.storage.local.remove(tempKey);
      if (typeof render === 'function') render();
      if (typeof updateConnectionUI === 'function') updateConnectionUI();
      throw error;
    }
  }

  function bind() {
    const download = document.getElementById('downloadBackup');
    if (download) {
      const replacement = download.cloneNode(true);
      download.replaceWith(replacement);
      replacement.addEventListener('click', downloadBackup);
    }
    const restore = document.getElementById('restoreBackup');
    if (restore) {
      const replacement = restore.cloneNode(true);
      restore.replaceWith(replacement);
      replacement.addEventListener('change', async event => {
        try { await restoreBackup(event.target.files?.[0]); }
        catch (error) { if (typeof show === 'function') show(`Backup restore failed: ${error.message}`, true); }
        finally { event.target.value = ''; }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();