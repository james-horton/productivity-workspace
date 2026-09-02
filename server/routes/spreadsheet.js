/**
 * Project-local Micro Spreadsheet workbook persistence.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const SPREADSHEET_PATH = path.resolve(__dirname, '..', '..', 'spreadsheet.json');
const MAX_SHEETS = 100;
const MAX_ROWS = 200;
const MAX_COLUMNS = 100;
const MAX_CELL_VALUE_LENGTH = 2000;
const MAX_SHEET_NAME_LENGTH = 80;
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 400;
const MIN_ROW_HEIGHT = 22;
const MAX_ROW_HEIGHT = 160;
const DEFAULT_ROWS = 50;
const DEFAULT_COLUMNS = 20;
const DEFAULT_COLUMN_WIDTH = 120;
const DEFAULT_ROW_HEIGHT = 28;
const CUSTOM_COLOR_COUNT = 8;
const DEFAULT_CUSTOM_COLOR = '#ffffff';

function createDefaultWorkbook() {
  return {
    version: 1,
    activeSheetId: 'sheet-1',
    preferences: { customColors: Array(CUSTOM_COLOR_COUNT).fill(DEFAULT_CUSTOM_COLOR) },
    sheets: [{
      id: 'sheet-1',
      name: 'Sheet 1',
      rowCount: DEFAULT_ROWS,
      columnCount: DEFAULT_COLUMNS,
      cells: {},
      columnWidths: {},
      rowHeights: {}
    }]
  };
}

function clampInteger(value, fallback, min, max) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function columnLabelToIndex(label) {
  let index = 0;
  for (const character of label) {
    index = (index * 26) + character.charCodeAt(0) - 64;
  }
  return index - 1;
}

function normalizeColor(value) {
  const color = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

function normalizeStyle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const style = {};
  if (value.bold === true) style.bold = true;
  if (value.italic === true) style.italic = true;
  if (value.underline === true) style.underline = true;
  if (value.borderTop === true) style.borderTop = true;
  if (value.borderRight === true) style.borderRight = true;
  if (value.borderBottom === true) style.borderBottom = true;
  if (value.borderLeft === true) style.borderLeft = true;

  const textColor = normalizeColor(value.textColor);
  const backgroundColor = normalizeColor(value.backgroundColor);
  if (textColor) style.textColor = textColor;
  if (backgroundColor) style.backgroundColor = backgroundColor;
  if (['left', 'center', 'right'].includes(value.align)) style.align = value.align;
  if (value.wrap === 'wrap' || value.wrap === true) style.wrap = 'wrap';

  return style;
}

function normalizeCustomColors(value) {
  const colors = Array.isArray(value) ? value : [];
  return Array.from(
    { length: CUSTOM_COLOR_COUNT },
    (_, index) => normalizeColor(colors[index]) || DEFAULT_CUSTOM_COLOR
  );
}

function normalizeCells(value, rowCount, columnCount) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const cells = {};
  for (const [rawAddress, rawCell] of Object.entries(value)) {
    const address = String(rawAddress).trim().toUpperCase();
    const match = /^([A-Z]+)([1-9]\d*)$/.exec(address);
    if (!match || columnLabelToIndex(match[1]) >= columnCount || Number(match[2]) > rowCount) continue;
    if (!rawCell || typeof rawCell !== 'object' || Array.isArray(rawCell)) continue;

    const rawValue = rawCell.value;
    const cellValue = ['string', 'number', 'boolean'].includes(typeof rawValue)
      ? String(rawValue).slice(0, MAX_CELL_VALUE_LENGTH)
      : '';
    const style = normalizeStyle(rawCell.style);
    if (cellValue !== '' || Object.keys(style).length > 0) {
      cells[address] = { value: cellValue, style };
    }
  }
  return cells;
}

function normalizeDimensions(value, count, fallback, min, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const dimensions = {};
  for (const [rawIndex, rawSize] of Object.entries(value)) {
    if (!/^\d+$/.test(rawIndex)) continue;
    const index = Number(rawIndex);
    if (index >= count) continue;
    const size = clampInteger(rawSize, fallback, min, max);
    if (size !== fallback) dimensions[index] = size;
  }
  return dimensions;
}

function uniqueSheetId(rawId, index, usedIds) {
  const candidate = String(rawId == null ? '' : rawId)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 80);
  const base = candidate || `sheet-${index + 1}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base.slice(0, 72)}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function uniqueSheetName(rawName, index, usedNames) {
  const candidate = String(rawName == null ? '' : rawName).trim().slice(0, MAX_SHEET_NAME_LENGTH);
  const base = candidate || `Sheet ${index + 1}`;
  let name = base;
  let suffix = 2;
  while (usedNames.has(name.toLocaleLowerCase())) {
    const suffixText = ` (${suffix})`;
    name = `${base.slice(0, MAX_SHEET_NAME_LENGTH - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  usedNames.add(name.toLocaleLowerCase());
  return name;
}

function normalizeWorkbook(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.sheets)) {
    return createDefaultWorkbook();
  }

  const inputSheets = value.sheets
    .filter(sheet => sheet && typeof sheet === 'object' && !Array.isArray(sheet))
    .slice(0, MAX_SHEETS);
  if (inputSheets.length === 0) return createDefaultWorkbook();

  const usedIds = new Set();
  const usedNames = new Set();
  const sourceIds = [];
  const sheets = inputSheets.map((inputSheet, index) => {
    const rowCount = clampInteger(inputSheet.rowCount, DEFAULT_ROWS, 1, MAX_ROWS);
    const columnCount = clampInteger(inputSheet.columnCount, DEFAULT_COLUMNS, 1, MAX_COLUMNS);
    const id = uniqueSheetId(inputSheet.id, index, usedIds);
    sourceIds.push({ source: String(inputSheet.id == null ? '' : inputSheet.id), id });
    return {
      id,
      name: uniqueSheetName(inputSheet.name, index, usedNames),
      rowCount,
      columnCount,
      cells: normalizeCells(inputSheet.cells, rowCount, columnCount),
      columnWidths: normalizeDimensions(
        inputSheet.columnWidths,
        columnCount,
        DEFAULT_COLUMN_WIDTH,
        MIN_COLUMN_WIDTH,
        MAX_COLUMN_WIDTH
      ),
      rowHeights: normalizeDimensions(
        inputSheet.rowHeights,
        rowCount,
        DEFAULT_ROW_HEIGHT,
        MIN_ROW_HEIGHT,
        MAX_ROW_HEIGHT
      )
    };
  });

  const requestedActiveId = String(value.activeSheetId == null ? '' : value.activeSheetId);
  const activeMapping = sourceIds.find(item => item.source === requestedActiveId);
  return {
    version: 1,
    activeSheetId: activeMapping ? activeMapping.id : sheets[0].id,
    preferences: { customColors: normalizeCustomColors(value.preferences?.customColors) },
    sheets
  };
}

function isValidWorkbookShape(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray(value.sheets)
    && value.sheets.length > 0
    && value.sheets.every(sheet => sheet && typeof sheet === 'object' && !Array.isArray(sheet))
  );
}

function readWorkbook() {
  try {
    return normalizeWorkbook(JSON.parse(fs.readFileSync(SPREADSHEET_PATH, 'utf8')));
  } catch (err) {
    if (err.code === 'ENOENT') {
      const directory = path.dirname(SPREADSHEET_PATH);
      const backupName = fs.readdirSync(directory)
        .filter(name => /^\.spreadsheet\.\d+\.\d+\.bak$/.test(name))
        .sort()
        .pop();
      if (backupName) {
        const backupPath = path.join(directory, backupName);
        const recovered = normalizeWorkbook(JSON.parse(fs.readFileSync(backupPath, 'utf8')));
        fs.copyFileSync(backupPath, SPREADSHEET_PATH);
        console.warn('[spreadsheet] Recovered spreadsheet.json from an interrupted replacement.');
        return recovered;
      }
      return createDefaultWorkbook();
    }
    if (!(err instanceof SyntaxError)) throw err;
    console.warn('[spreadsheet] Invalid spreadsheet.json; using a fresh workbook.');
    return createDefaultWorkbook();
  }
}

function writeWorkbook(workbook) {
  const directory = path.dirname(SPREADSHEET_PATH);
  const tempPath = path.join(directory, `.spreadsheet.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(workbook, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(tempPath, SPREADSHEET_PATH);
  } catch (err) {
    if (!['EEXIST', 'EPERM'].includes(err.code)) throw err;
    const backupPath = path.join(directory, `.spreadsheet.${process.pid}.${Date.now()}.bak`);
    let backupCreated = false;
    try {
      if (fs.existsSync(SPREADSHEET_PATH)) {
        fs.renameSync(SPREADSHEET_PATH, backupPath);
        backupCreated = true;
      }
      fs.renameSync(tempPath, SPREADSHEET_PATH);
    } catch (replaceError) {
      if (backupCreated && !fs.existsSync(SPREADSHEET_PATH)) {
        try {
          fs.renameSync(backupPath, SPREADSHEET_PATH);
        } catch {
          fs.copyFileSync(backupPath, SPREADSHEET_PATH);
        }
      }
      throw replaceError;
    }
    if (backupCreated) {
      try { fs.unlinkSync(backupPath); } catch {}
    }
  }
}

router.get('/', (req, res, next) => {
  try {
    res.json(readWorkbook());
  } catch (err) {
    next(err);
  }
});

router.put('/', (req, res, next) => {
  try {
    if (!isValidWorkbookShape(req.body)) {
      return res.status(400).json({ error: { message: 'Invalid spreadsheet workbook.' } });
    }
    const workbook = normalizeWorkbook(req.body);
    writeWorkbook(workbook);
    return res.json(workbook);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.createDefaultWorkbook = createDefaultWorkbook;
module.exports.normalizeWorkbook = normalizeWorkbook;
