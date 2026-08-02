'use strict';
(() => {
  const BACKUP_VERSION = '3.4.1';
  const BACKUP_SCHEMA = 'dc-fk-backup-v3.4.1';
  const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
  const arrays = ['rows','inventoryRows','unmatchedReturns','unmatchedFinancials','financialLedger','syncHistory'];
  const finite = value => Number.isFinite(Number(value));
  const serialDate = value => value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : value || null;

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

  async function restoreBackup(file) {
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup file exceeds 25 MB limit');
    const data = JSON.parse(await file.text());
    validateBackup(data);

    const restoredSeller = data.seller ? { ...data.seller, stableKey: data.seller.stableKey || sellerIdentityKey(data.seller) } : connectedSeller;
    if (restoredSeller) connectedSeller = restoredSeller;
    rows = (data.rows || []).map(item => ({ ...item, date: item.date ? new Date(item.date) : null }));
    inventoryRows = data.inventoryRows || [];
    unmatchedReturns = data.unmatchedReturns || [];
    unmatchedFinancials = data.unmatchedFinancials || [];
    financialLedger = data.financialLedger || [];
    syncHistory = data.syncHistory || [];
    skuCosts = data.skuCosts || {};
    mapping = data.mapping || {};
    lastLiveSync = data.lastLiveSync || null;
    moduleStatus = data.moduleStatus || moduleStatus;
    if (data.settings) {
      costPct = Number(data.settings.costPct ?? costPct);
      packCost = Number(data.settings.packCost ?? packCost);
      adSpend = Number(data.settings.adSpend ?? adSpend);
      otherExpense = Number(data.settings.otherExpense ?? otherExpense);
    }

    await chrome.storage.local.set({ connectedSeller });
    if (typeof save === 'function') save();
    if (typeof render === 'function') render();
    if (typeof updateConnectionUI === 'function') updateConnectionUI();
    if (typeof show === 'function') show(`Backup ${data.version || 'legacy'} restored successfully.`);
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