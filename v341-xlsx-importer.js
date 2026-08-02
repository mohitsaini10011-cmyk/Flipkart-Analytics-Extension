'use strict';
(() => {
  const MAX_FILE_BYTES = 30 * 1024 * 1024;
  const MAX_ROWS_PER_FILE = 250000;
  const MAX_SHEETS = 40;
  const HEADER_SCAN_ROWS = 30;
  const REQUIRED_HINTS = ['orderid','orderitemid','shipmentid','sku','sellersku','status','quantity','sellingprice','settlementamount'];
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const yieldUi = () => new Promise(resolve => setTimeout(resolve, 0));

  function xml(bytes) {
    return new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'text/xml');
  }

  async function unzipWorkbook(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid XLSX/XLSM archive');
    const count = view.getUint16(eocd + 10, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    const files = {};
    let pointer = centralOffset;
    for (let index = 0; index < count; index++) {
      if (view.getUint32(pointer, true) !== 0x02014b50) break;
      const method = view.getUint16(pointer + 10, true);
      const compressedSize = view.getUint32(pointer + 20, true);
      const nameLength = view.getUint16(pointer + 28, true);
      const extraLength = view.getUint16(pointer + 30, true);
      const commentLength = view.getUint16(pointer + 32, true);
      const localOffset = view.getUint32(pointer + 42, true);
      const name = new TextDecoder().decode(bytes.slice(pointer + 46, pointer + 46 + nameLength));
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = bytes.slice(start, start + compressedSize);
      let output;
      if (method === 0) output = data;
      else if (method === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        output = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      if (output) files[name.replace(/^\//, '')] = output;
      pointer += 46 + nameLength + extraLength + commentLength;
      if (index % 100 === 0) await yieldUi();
    }
    return files;
  }

  function sharedStrings(files) {
    const out = [];
    const source = files['xl/sharedStrings.xml'];
    if (!source) return out;
    xml(source).querySelectorAll('si').forEach(item => {
      out.push([...item.querySelectorAll('t')].map(node => node.textContent || '').join(''));
    });
    return out;
  }

  function workbookSheets(files) {
    const workbook = files['xl/workbook.xml'];
    const relationships = files['xl/_rels/workbook.xml.rels'];
    if (!workbook) throw new Error('Workbook metadata missing');
    const relationMap = {};
    if (relationships) {
      xml(relationships).querySelectorAll('Relationship').forEach(node => {
        relationMap[node.getAttribute('Id')] = node.getAttribute('Target');
      });
    }
    return [...xml(workbook).querySelectorAll('sheet')].slice(0, MAX_SHEETS).map((sheet, index) => {
      const relId = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const target = relationMap[relId] || `worksheets/sheet${index + 1}.xml`;
      const path = target.startsWith('xl/') ? target : `xl/${target.replace(/^\//, '')}`;
      return { name: sheet.getAttribute('name') || `Sheet ${index + 1}`, path };
    });
  }

  function columnIndex(reference) {
    const letters = String(reference || 'A1').match(/[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
    let result = 0;
    for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
    return result - 1;
  }

  function sheetGrid(bytes, strings) {
    const document = xml(bytes);
    const grid = [];
    document.querySelectorAll('sheetData > row, worksheet row').forEach(rowNode => {
      const rowNumber = Math.max(0, Number(rowNode.getAttribute('r') || grid.length + 1) - 1);
      const row = grid[rowNumber] || [];
      rowNode.querySelectorAll(':scope > c').forEach(cell => {
        const index = columnIndex(cell.getAttribute('r'));
        const type = cell.getAttribute('t');
        const raw = cell.querySelector('v')?.textContent ?? '';
        const inline = [...cell.querySelectorAll('is t')].map(node => node.textContent || '').join('');
        row[index] = type === 's' ? (strings[Number(raw)] ?? '') : type === 'inlineStr' ? inline : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : raw;
      });
      grid[rowNumber] = row;
    });
    return grid;
  }

  function headerScore(row) {
    const cells = row.map(norm).filter(Boolean);
    if (cells.length < 2) return -1;
    const unique = new Set(cells).size;
    const hits = cells.filter(cell => REQUIRED_HINTS.some(hint => cell.includes(hint) || hint.includes(cell))).length;
    const textCells = cells.filter(cell => !/^\d+(\.\d+)?$/.test(cell)).length;
    return hits * 12 + unique + textCells * 0.25;
  }

  function detectHeader(grid) {
    let best = { index: -1, score: -1 };
    for (let index = 0; index < Math.min(HEADER_SCAN_ROWS, grid.length); index++) {
      const score = headerScore(grid[index] || []);
      if (score > best.score) best = { index, score };
    }
    if (best.index < 0 || best.score < 5) return null;
    return best.index;
  }

  function buildHeaders(grid, headerIndex) {
    const primary = grid[headerIndex] || [];
    const previous = headerIndex > 0 ? grid[headerIndex - 1] || [] : [];
    let lastParent = '';
    return primary.map((value, index) => {
      const current = text(value);
      const parentRaw = text(previous[index]);
      if (parentRaw) lastParent = parentRaw;
      const parent = parentRaw || lastParent;
      const combined = current && parent && norm(current) !== norm(parent) ? `${parent} ${current}` : current || parent;
      return combined || `Column${index + 1}`;
    });
  }

  function rowsToObjects(grid, headerIndex) {
    const headers = buildHeaders(grid, headerIndex);
    const output = [];
    for (let index = headerIndex + 1; index < grid.length && output.length < MAX_ROWS_PER_FILE; index++) {
      const row = grid[index] || [];
      if (!row.some(value => text(value))) continue;
      const object = {};
      headers.forEach((header, column) => { object[header] = row[column] ?? ''; });
      output.push(object);
    }
    return output;
  }

  function parseCsvGrid(source) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let index = 0; index < source.length; index++) {
      const char = source[index], next = source[index + 1];
      if (char === '"' && quoted && next === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') index++;
        row.push(cell); if (row.some(value => text(value))) rows.push(row);
        row = []; cell = '';
      } else cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.slice(0, MAX_ROWS_PER_FILE + HEADER_SCAN_ROWS);
  }

  async function parseWorkbook(file) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: file exceeds 30 MB safety limit`);
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'csv') {
      const grid = parseCsvGrid(await file.text());
      const header = detectHeader(grid);
      if (header === null) return [];
      return [{ sheet: 'CSV', raw: rowsToObjects(grid, header), headerRow: header + 1 }];
    }
    if (!['xlsx', 'xlsm'].includes(extension)) throw new Error(`${file.name}: only CSV, XLSX and XLSM are supported`);
    const files = await unzipWorkbook(await file.arrayBuffer());
    const strings = sharedStrings(files);
    const results = [];
    for (const sheet of workbookSheets(files)) {
      const bytes = files[sheet.path];
      if (!bytes) continue;
      const grid = sheetGrid(bytes, strings);
      const header = detectHeader(grid);
      if (header === null) continue;
      const raw = rowsToObjects(grid, header);
      if (raw.length) results.push({ sheet: sheet.name, raw, headerRow: header + 1 });
      await yieldUi();
    }
    return results;
  }

  function mergeImported(existing, incoming) {
    const map = new Map();
    const add = row => {
      const key = typeof rowKey === 'function' ? rowKey(row) : String(row.recordId || `${row.orderId}|${row.sku}|${row.qty || 1}`);
      if (!key) return;
      const previous = map.get(key);
      map.set(key, previous ? { ...previous, ...row, date: row.date || previous.date || null } : row);
    };
    existing.forEach(add); incoming.forEach(add);
    return [...map.values()];
  }

  function showImportSummary(summary) {
    let panel = document.getElementById('xlsxImporterV2Summary');
    const section = document.getElementById('import') || document.getElementById('settings') || document.querySelector('main');
    if (!section) return;
    if (!panel) {
      panel = document.createElement('article');
      panel.id = 'xlsxImporterV2Summary';
      panel.className = 'panel';
      section.prepend(panel);
    }
    const sheetList = summary.sheets.map(item => `<div class="kpi"><small>${String(item.file)} · ${String(item.sheet)}</small><strong>${Number(item.mapped).toLocaleString('en-IN')}</strong><small>Header row ${item.headerRow}</small></div>`).join('');
    panel.innerHTML = `<div class="panel-head"><div><h3>Import Report</h3><small>Multi-sheet XLSX Importer v2</small></div><small>${summary.files} file(s), ${summary.totalMapped.toLocaleString('en-IN')} mapped</small></div><div class="kpis">${sheetList || '<div class="kpi"><small>No compatible sheets found</small><strong>0</strong></div>'}</div>`;
  }

  async function importFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const imported = [];
    const summary = { files: files.length, totalMapped: 0, sheets: [] };
    for (const file of files) {
      const sheets = await parseWorkbook(file);
      for (const sheet of sheets) {
        const mapped = typeof mapRows === 'function' ? mapRows(sheet.raw) : [];
        imported.push(...mapped);
        summary.totalMapped += mapped.length;
        summary.sheets.push({ file: file.name, sheet: sheet.sheet, mapped: mapped.length, headerRow: sheet.headerRow });
        await yieldUi();
      }
    }
    rows = mergeImported(rows || [], imported);
    syncHistory = Array.isArray(syncHistory) ? syncHistory : [];
    syncHistory.unshift({ type: 'import-v2', at: Date.now(), files: files.map(file => file.name), rows: imported.length, sheets: summary.sheets.length });
    syncHistory = syncHistory.slice(0, 100);
    if (typeof save === 'function') await save();
    if (typeof render === 'function') render();
    if (typeof updateConnectionUI === 'function') updateConnectionUI();
    showImportSummary(summary);
    if (typeof show === 'function') show(`${summary.totalMapped.toLocaleString('en-IN')} rows imported from ${summary.sheets.length} sheet(s).`);
  }

  function bind() {
    const input = document.getElementById('fileInput');
    if (!input || input.dataset.xlsxImporterV2 === '1') return;
    input.dataset.xlsxImporterV2 = '1';
    input.setAttribute('accept', '.csv,.xlsx,.xlsm');
    input.addEventListener('change', async event => {
      event.stopImmediatePropagation();
      try { await importFiles(event.target.files || []); }
      catch (error) {
        console.error('[Flipkart Analytics] Importer v2 failed', error);
        if (typeof show === 'function') show(`Import failed: ${error.message || error}`, true);
      } finally { event.target.value = ''; }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();