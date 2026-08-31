import { fetchSpreadsheet, saveSpreadsheet } from '../services/spreadsheetService.js';
import { isMobileView } from '../utils/helpers.js';
import { evaluateSheet } from './spreadsheetFormula.js';
import { isMessageBoxOpen, showMessageBox } from './messageBox.js';

const DEFAULT_ROWS = 50;
const DEFAULT_COLUMNS = 20;
const DEFAULT_COLUMN_WIDTH = 120;
const DEFAULT_ROW_HEIGHT = 28;
const MAX_ROWS = 200;
const MAX_COLUMNS = 100;
const MAX_SHEETS = 100;
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 400;
const MIN_ROW_HEIGHT = 22;
const MAX_ROW_HEIGHT = 160;
const HISTORY_LIMIT = 100;
const CUSTOM_COLOR_COUNT = 8;
const DEFAULT_CUSTOM_COLOR = '#ffffff';
const COMMON_COLORS = [
  '#000000',
  '#ffffff',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#a855f7'
];

let elements;
let workbook;
let loaded = false;
let loading = false;
let loadFailed = false;
let dirty = false;
let revision = 0;
let saving = false;
let closing = false;
let editing = false;
let editOriginal = '';
let selection = { anchor: { row: 0, column: 0 }, end: { row: 0, column: 0 } };
let selecting = false;
let resizeState = null;
let calculatedValues = new Map();
let themeColorCache = null;
let initialized = false;
let undoStack = [];
let redoStack = [];
let historyState = null;
let savedWorkbookState = null;
let colorPalettes = [];

function createSheet(id = 'sheet-1', name = 'Sheet 1') {
  return {
    id,
    name,
    rowCount: DEFAULT_ROWS,
    columnCount: DEFAULT_COLUMNS,
    cells: {},
    columnWidths: {},
    rowHeights: {}
  };
}

function createDefaultWorkbook() {
  return {
    version: 1,
    activeSheetId: 'sheet-1',
    preferences: { customColors: Array(CUSTOM_COLOR_COUNT).fill(DEFAULT_CUSTOM_COLOR) },
    sheets: [createSheet()]
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function columnLabel(column) {
  let value = column + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function cellAddress(row, column) {
  return `${columnLabel(column)}${row + 1}`;
}

function activeSheet() {
  return workbook?.sheets.find(sheet => sheet.id === workbook.activeSheetId) || workbook?.sheets[0];
}

function activePosition() {
  return selection.end;
}

function activeAddress() {
  const position = activePosition();
  return cellAddress(position.row, position.column);
}

function styleIsEmpty(style) {
  return !style || Object.keys(style).length === 0;
}

function normalizeColor(value, fallback = DEFAULT_CUSTOM_COLOR) {
  const color = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
}

function normalizeCustomColors(value) {
  const colors = Array.isArray(value) ? value : [];
  return Array.from(
    { length: CUSTOM_COLOR_COUNT },
    (_, index) => normalizeColor(colors[index])
  );
}

function normalizeWorkbook(value) {
  if (!value || !Array.isArray(value.sheets) || value.sheets.length === 0) return createDefaultWorkbook();
  const usedIds = new Set();
  const usedNames = new Set();
  const sheets = value.sheets.slice(0, MAX_SHEETS).map((rawSheet, index) => {
    const source = rawSheet && typeof rawSheet === 'object' ? rawSheet : {};
    let id = String(source.id || `sheet-${index + 1}`).slice(0, 80);
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    let name = String(source.name || `Sheet ${index + 1}`).trim().slice(0, 80) || `Sheet ${index + 1}`;
    while (usedNames.has(name.toLowerCase())) name = `${name.slice(0, 72)} ${index + 1}`;
    usedNames.add(name.toLowerCase());
    const rowCount = clamp(Math.round(Number(source.rowCount)) || DEFAULT_ROWS, 1, MAX_ROWS);
    const columnCount = clamp(Math.round(Number(source.columnCount)) || DEFAULT_COLUMNS, 1, MAX_COLUMNS);
    return {
      id,
      name,
      rowCount,
      columnCount,
      cells: source.cells && typeof source.cells === 'object' && !Array.isArray(source.cells) ? source.cells : {},
      columnWidths: source.columnWidths && typeof source.columnWidths === 'object' ? source.columnWidths : {},
      rowHeights: source.rowHeights && typeof source.rowHeights === 'object' ? source.rowHeights : {}
    };
  });
  const activeSheetId = sheets.some(sheet => sheet.id === value.activeSheetId) ? value.activeSheetId : sheets[0].id;
  const customColors = normalizeCustomColors(value.preferences?.customColors);
  return { version: 1, activeSheetId, preferences: { customColors }, sheets };
}

function setStatus(message, kind = '') {
  elements.status.textContent = message;
  elements.status.classList.toggle('is-error', kind === 'error');
  elements.status.classList.toggle('is-dirty', kind === 'dirty');
}

function selectionSnapshot() {
  return {
    anchor: { ...selection.anchor },
    end: { ...selection.end }
  };
}

function workbookSnapshot() {
  return JSON.stringify(workbook);
}

function captureHistoryState() {
  return { workbook: workbookSnapshot(), selection: selectionSnapshot() };
}

function updateHistoryControls() {
  if (!elements?.undo || !elements?.redo) return;
  const unavailable = !workbook || loading || loadFailed || saving;
  elements.undo.disabled = unavailable || undoStack.length === 0;
  elements.redo.disabled = unavailable || redoStack.length === 0;
}

function resetHistory() {
  undoStack = [];
  redoStack = [];
  historyState = workbook ? captureHistoryState() : null;
  savedWorkbookState = historyState?.workbook || null;
  updateHistoryControls();
}

function updateDirtyState(message) {
  dirty = Boolean(workbook && savedWorkbookState !== workbookSnapshot());
  setStatus(dirty ? message : 'No unsaved changes', dirty ? 'dirty' : '');
}

function markDirty(message = 'Unsaved changes') {
  const nextState = captureHistoryState();
  if (historyState?.workbook === nextState.workbook) {
    historyState.selection = nextState.selection;
    updateDirtyState(message);
    updateHistoryControls();
    return false;
  }
  if (historyState) {
    undoStack.push(historyState);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }
  historyState = nextState;
  redoStack = [];
  revision += 1;
  updateDirtyState(message);
  updateHistoryControls();
  return true;
}

function restoreHistory(state, action) {
  workbook = JSON.parse(state.workbook);
  const sheet = activeSheet();
  const restorePosition = position => ({
    row: clamp(position?.row ?? 0, 0, sheet.rowCount - 1),
    column: clamp(position?.column ?? 0, 0, sheet.columnCount - 1)
  });
  selection = {
    anchor: restorePosition(state.selection?.anchor),
    end: restorePosition(state.selection?.end)
  };
  historyState = { workbook: state.workbook, selection: selectionSnapshot() };
  editing = false;
  editOriginal = '';
  revision += 1;
  updateDirtyState(`${action} applied`);
  renderWorkbook();
  updateHistoryControls();
}

function undo() {
  if (!workbook || loading || saving || isMessageBoxOpen()) return;
  commitFormula();
  const previousState = undoStack.pop();
  if (!previousState) return updateHistoryControls();
  redoStack.push(historyState || captureHistoryState());
  if (redoStack.length > HISTORY_LIMIT) redoStack.shift();
  restoreHistory(previousState, 'Undo');
}

function redo() {
  if (!workbook || loading || saving || isMessageBoxOpen()) return;
  commitFormula();
  const nextState = redoStack.pop();
  if (!nextState) return updateHistoryControls();
  undoStack.push(historyState || captureHistoryState());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  restoreHistory(nextState, 'Redo');
}

function selectedBounds() {
  return {
    startRow: Math.min(selection.anchor.row, selection.end.row),
    endRow: Math.max(selection.anchor.row, selection.end.row),
    startColumn: Math.min(selection.anchor.column, selection.end.column),
    endColumn: Math.max(selection.anchor.column, selection.end.column)
  };
}

function eachSelectedCell(callback) {
  const bounds = selectedBounds();
  for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
    for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
      callback(cellAddress(row, column), row, column);
    }
  }
}

function setSelection(row, column, extend = false) {
  const sheet = activeSheet();
  if (!sheet) return;
  const next = {
    row: clamp(row, 0, sheet.rowCount - 1),
    column: clamp(column, 0, sheet.columnCount - 1)
  };
  if (!extend) selection.anchor = next;
  selection.end = next;
  if (historyState) historyState.selection = selectionSnapshot();
  syncSelectionUI();
}

function cellDisplayValue(address) {
  const raw = activeSheet().cells[address]?.value ?? '';
  if (String(raw).startsWith('=')) return calculatedValues.get(address) ?? '#VALUE!';
  return String(raw);
}

function syncSelectionUI() {
  if (!workbook) return;
  const bounds = selectedBounds();
  elements.grid.querySelectorAll('.spreadsheet-cell').forEach(cell => {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    const selected = row >= bounds.startRow && row <= bounds.endRow
      && column >= bounds.startColumn && column <= bounds.endColumn;
    const active = row === selection.end.row && column === selection.end.column;
    cell.classList.toggle('is-selected', selected);
    cell.classList.toggle('is-active', active);
    cell.setAttribute('aria-selected', selected ? 'true' : 'false');
    cell.tabIndex = active ? 0 : -1;
  });
  const address = activeAddress();
  elements.address.textContent = address;
  if (!editing) {
    elements.formula.value = String(activeSheet().cells[address]?.value ?? '');
    editOriginal = elements.formula.value;
  }
  syncToolbarState();
}

function syncToolbarState() {
  const style = activeSheet()?.cells[activeAddress()]?.style || {};
  elements.bold.setAttribute('aria-pressed', style.bold === true ? 'true' : 'false');
  elements.italic.setAttribute('aria-pressed', style.italic === true ? 'true' : 'false');
  elements.underline.setAttribute('aria-pressed', style.underline === true ? 'true' : 'false');
  elements.wrap.setAttribute('aria-pressed', style.wrap === 'wrap' ? 'true' : 'false');
  elements.alignButtons.forEach(button => {
    button.setAttribute('aria-pressed', style.align === button.dataset.align ? 'true' : 'false');
  });
  const themeColors = resolvedThemeColors();
  colorPalettes.forEach(palette => {
    const fallback = palette.property === 'textColor' ? themeColors.text : themeColors.background;
    palette.sync(style[palette.property] || fallback, workbook.preferences.customColors);
  });
}

function renderGrid() {
  const sheet = activeSheet();
  if (!sheet) return;
  calculatedValues = evaluateSheet(sheet);
  const columns = Array.from({ length: sheet.columnCount }, (_, index) => `${sheet.columnWidths[index] || DEFAULT_COLUMN_WIDTH}px`);
  const rows = Array.from({ length: sheet.rowCount }, (_, index) => `${sheet.rowHeights[index] || DEFAULT_ROW_HEIGHT}px`);
  elements.grid.style.gridTemplateColumns = `54px ${columns.join(' ')}`;
  elements.grid.style.gridTemplateRows = `30px ${rows.join(' ')}`;
  elements.grid.replaceChildren();
  const fragment = document.createDocumentFragment();
  const headerRow = document.createElement('div');
  headerRow.setAttribute('role', 'row');
  headerRow.style.display = 'contents';
  fragment.appendChild(headerRow);

  const corner = document.createElement('div');
  corner.className = 'spreadsheet-corner';
  corner.style.gridColumn = '1';
  corner.style.gridRow = '1';
  corner.setAttribute('aria-hidden', 'true');
  headerRow.appendChild(corner);

  for (let column = 0; column < sheet.columnCount; column += 1) {
    const header = document.createElement('div');
    header.className = 'spreadsheet-column-header';
    header.setAttribute('role', 'columnheader');
    header.setAttribute('aria-colindex', String(column + 1));
    header.style.gridColumn = String(column + 2);
    header.style.gridRow = '1';
    header.textContent = columnLabel(column);
    const handle = document.createElement('span');
    handle.className = 'spreadsheet-resize-handle';
    handle.dataset.resizeColumn = String(column);
    handle.setAttribute('aria-hidden', 'true');
    header.appendChild(handle);
    headerRow.appendChild(header);
  }

  const rowElements = Array.from({ length: sheet.rowCount }, () => {
    const rowElement = document.createElement('div');
    rowElement.setAttribute('role', 'row');
    rowElement.style.display = 'contents';
    fragment.appendChild(rowElement);
    return rowElement;
  });

  for (let row = 0; row < sheet.rowCount; row += 1) {
    const rowElement = rowElements[row];
    const header = document.createElement('div');
    header.className = 'spreadsheet-row-header';
    header.setAttribute('role', 'rowheader');
    header.setAttribute('aria-rowindex', String(row + 1));
    header.style.gridColumn = '1';
    header.style.gridRow = String(row + 2);
    header.textContent = String(row + 1);
    const handle = document.createElement('span');
    handle.className = 'spreadsheet-resize-handle';
    handle.dataset.resizeRow = String(row);
    handle.setAttribute('aria-hidden', 'true');
    header.appendChild(handle);
    rowElement.appendChild(header);

    for (let column = 0; column < sheet.columnCount; column += 1) {
      const address = cellAddress(row, column);
      const storedCell = sheet.cells[address] || {};
      const style = storedCell.style || {};
      const cell = document.createElement('div');
      cell.className = 'spreadsheet-cell';
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.dataset.address = address;
      cell.style.gridColumn = String(column + 2);
      cell.style.gridRow = String(row + 2);
      cell.textContent = cellDisplayValue(address);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-rowindex', String(row + 1));
      cell.setAttribute('aria-colindex', String(column + 1));
      cell.setAttribute('aria-label', `${address}: ${cell.textContent || 'blank'}`);
      if (style.bold) cell.style.fontWeight = '700';
      if (style.italic) cell.style.fontStyle = 'italic';
      if (style.underline) cell.style.textDecoration = 'underline';
      if (style.textColor) cell.style.color = style.textColor;
      if (style.backgroundColor) cell.style.backgroundColor = style.backgroundColor;
      if (style.align) cell.style.justifyContent = style.align === 'left' ? 'flex-start' : style.align === 'right' ? 'flex-end' : 'center';
      if (style.wrap === 'wrap') cell.classList.add('is-wrapped');
      rowElement.appendChild(cell);
    }
  }
  elements.grid.appendChild(fragment);
  elements.grid.setAttribute('aria-rowcount', String(sheet.rowCount));
  elements.grid.setAttribute('aria-colcount', String(sheet.columnCount));
  syncSelectionUI();
}

function renderSheetTabs() {
  elements.sheetTabs.replaceChildren();
  const fragment = document.createDocumentFragment();
  workbook.sheets.forEach(sheet => {
    const button = document.createElement('button');
    const active = sheet.id === workbook.activeSheetId;
    button.type = 'button';
    button.className = `tab${active ? ' active' : ''}`;
    button.dataset.sheetId = sheet.id;
    button.textContent = sheet.name;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    fragment.appendChild(button);
  });
  elements.sheetTabs.appendChild(fragment);
}

function renderWorkbook() {
  renderSheetTabs();
  renderGrid();
}

function commitFormula() {
  if (!editing || !workbook) return false;
  const sheet = activeSheet();
  const address = activeAddress();
  const value = elements.formula.value.slice(0, 2000);
  const current = sheet.cells[address] || { value: '', style: {} };
  if (value === '') {
    if (styleIsEmpty(current.style)) delete sheet.cells[address];
    else sheet.cells[address] = { value: '', style: current.style };
  } else {
    sheet.cells[address] = { value, style: current.style || {} };
  }
  const changed = value !== editOriginal;
  editing = false;
  if (changed) markDirty();
  editOriginal = value;
  renderGrid();
  return changed;
}

function cancelFormulaEdit() {
  elements.formula.value = editOriginal;
  editing = false;
  elements.gridViewport.focus();
}

function moveSelection(rowDelta, columnDelta) {
  commitFormula();
  const current = activePosition();
  setSelection(current.row + rowDelta, current.column + columnDelta);
  elements.grid.querySelector('.spreadsheet-cell.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function ensureCell(address) {
  const sheet = activeSheet();
  if (!sheet.cells[address]) sheet.cells[address] = { value: '', style: {} };
  if (!sheet.cells[address].style) sheet.cells[address].style = {};
  return sheet.cells[address];
}

function applyStyle(mutator) {
  commitFormula();
  eachSelectedCell(address => {
    const cell = ensureCell(address);
    mutator(cell.style);
    if (cell.value === '' && styleIsEmpty(cell.style)) delete activeSheet().cells[address];
  });
  markDirty();
  renderGrid();
}

function closeColorPalettes(except = null) {
  colorPalettes.forEach(palette => {
    if (palette !== except) palette.close();
  });
}

function createColorPalette({ trigger, panel, property, label }) {
  const preview = trigger.querySelector('.spreadsheet-color-preview');
  const commonRow = document.createElement('div');
  const customRow = document.createElement('div');
  const editButton = document.createElement('button');
  commonRow.className = 'spreadsheet-color-row';
  customRow.className = 'spreadsheet-color-row';
  editButton.type = 'button';
  editButton.className = 'spreadsheet-color-edit';
  editButton.textContent = 'Edit custom colors';
  editButton.setAttribute('aria-pressed', 'false');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', `${label} palette`);
  commonRow.setAttribute('aria-label', 'Common colors');
  customRow.setAttribute('aria-label', 'Custom colors');

  const commonSwatches = COMMON_COLORS.map(color => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'spreadsheet-color-swatch';
    swatch.style.setProperty('--swatch-color', color);
    swatch.dataset.color = color;
    swatch.setAttribute('aria-label', `${label} ${color}`);
    swatch.title = color;
    commonRow.appendChild(swatch);
    return swatch;
  });
  const customSwatches = Array.from({ length: CUSTOM_COLOR_COUNT }, (_, index) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'spreadsheet-color-swatch spreadsheet-custom-color-swatch';
    swatch.dataset.customColorIndex = String(index);
    customRow.appendChild(swatch);
    return swatch;
  });
  const customInputs = Array.from({ length: CUSTOM_COLOR_COUNT }, (_, index) => {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'spreadsheet-custom-color';
    input.setAttribute('aria-label', `Change custom color ${index + 1}`);
    input.title = `Change custom color ${index + 1}`;
    input.hidden = true;
    customRow.appendChild(input);
    return input;
  });
  panel.append(commonRow, customRow, editButton);

  const palette = {
    trigger,
    panel,
    property,
    editingCustomColors: false,
    setEditMode(editing) {
      palette.editingCustomColors = editing;
      customSwatches.forEach(swatch => { swatch.hidden = editing; });
      customInputs.forEach(input => { input.hidden = !editing; });
      editButton.textContent = editing ? 'Done' : 'Edit custom colors';
      editButton.setAttribute('aria-pressed', editing ? 'true' : 'false');
    },
    close(returnFocus = false) {
      if (panel.hidden) return;
      palette.setEditMode(false);
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus) trigger.focus();
    },
    open() {
      closeColorPalettes(palette);
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    },
    sync(activeColor, customColors) {
      const color = normalizeColor(activeColor);
      const customMatch = COMMON_COLORS.includes(color) ? -1 : customColors.indexOf(color);
      preview.style.backgroundColor = color;
      commonSwatches.forEach(swatch => {
        const selected = swatch.dataset.color === color;
        swatch.classList.toggle('is-selected', selected);
        swatch.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      customInputs.forEach((input, index) => {
        const customColor = normalizeColor(customColors[index]);
        input.value = customColor;
        customSwatches[index].style.setProperty('--swatch-color', customColor);
        customSwatches[index].dataset.color = customColor;
        customSwatches[index].setAttribute('aria-label', `${label} custom color ${index + 1}, ${customColor}`);
        customSwatches[index].title = `Apply ${customColor}`;
        const selected = index === customMatch;
        customSwatches[index].classList.toggle('is-selected', selected);
        customSwatches[index].setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }
  };

  commonSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      applyStyle(style => { style[property] = swatch.dataset.color; });
      palette.close(true);
    });
  });
  customSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      applyStyle(style => { style[property] = swatch.dataset.color; });
      palette.close(true);
    });
  });
  customInputs.forEach((input, index) => {
    input.addEventListener('change', event => {
      commitFormula();
      const color = normalizeColor(event.target.value);
      workbook.preferences.customColors[index] = color;
      markDirty('Unsaved custom color change');
      colorPalettes.forEach(item => item.sync(
        activeSheet()?.cells[activeAddress()]?.style?.[item.property]
          || (item.property === 'textColor' ? resolvedThemeColors().text : resolvedThemeColors().background),
        workbook.preferences.customColors
      ));
    });
  });
  editButton.addEventListener('click', async () => {
    if (!palette.editingCustomColors) {
      palette.setEditMode(true);
      customInputs[0].focus();
      return;
    }

    editButton.disabled = true;
    editButton.textContent = 'Saving...';
    const saved = await save();
    editButton.disabled = false;
    if (saved) {
      palette.setEditMode(false);
      customSwatches[0].focus();
    } else {
      editButton.textContent = 'Done';
    }
  });
  trigger.addEventListener('click', () => {
    if (panel.hidden) palette.open();
    else palette.close();
  });
  return palette;
}

function toggleStyle(property, enabledValue = true) {
  const activeStyle = activeSheet().cells[activeAddress()]?.style || {};
  const enable = activeStyle[property] !== enabledValue;
  applyStyle(style => {
    if (enable) style[property] = enabledValue;
    else delete style[property];
  });
}

function setAlignment(alignment) {
  const activeStyle = activeSheet().cells[activeAddress()]?.style || {};
  const next = activeStyle.align === alignment ? null : alignment;
  applyStyle(style => {
    if (next) style.align = next;
    else delete style.align;
  });
}

function clearFormatting() {
  applyStyle(style => Object.keys(style).forEach(key => delete style[key]));
}

function numericCell(row, column) {
  const address = cellAddress(row, column);
  const raw = activeSheet().cells[address]?.value;
  if (raw == null || raw === '') return false;
  const value = String(raw).startsWith('=') ? calculatedValues.get(address) : Number(raw);
  return typeof value === 'number' && Number.isFinite(value);
}

function autoSum() {
  commitFormula();
  const position = activePosition();
  let start = position.row - 1;
  while (start >= 0 && numericCell(start, position.column)) start -= 1;
  const verticalStart = start + 1;
  let formula = '';
  if (verticalStart < position.row) {
    formula = `=SUM(${cellAddress(verticalStart, position.column)}:${cellAddress(position.row - 1, position.column)})`;
  } else {
    start = position.column - 1;
    while (start >= 0 && numericCell(position.row, start)) start -= 1;
    const horizontalStart = start + 1;
    if (horizontalStart < position.column) {
      formula = `=SUM(${cellAddress(position.row, horizontalStart)}:${cellAddress(position.row, position.column - 1)})`;
    }
  }
  if (!formula) {
    setStatus('Auto-Sum found no contiguous numeric cells above or to the left.', 'error');
    return;
  }
  const cell = ensureCell(activeAddress());
  cell.value = formula;
  markDirty();
  renderGrid();
}

function newSheetName() {
  let number = workbook.sheets.length + 1;
  const names = new Set(workbook.sheets.map(sheet => sheet.name.toLowerCase()));
  while (names.has(`sheet ${number}`)) number += 1;
  return `Sheet ${number}`;
}

function uniqueSheetId() {
  const ids = new Set(workbook.sheets.map(sheet => sheet.id));
  let id;
  do { id = `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; } while (ids.has(id));
  return id;
}

function addSheet() {
  commitFormula();
  if (workbook.sheets.length >= MAX_SHEETS) return setStatus(`Workbook is limited to ${MAX_SHEETS} sheets.`, 'error');
  const sheet = createSheet(uniqueSheetId(), newSheetName());
  workbook.sheets.push(sheet);
  workbook.activeSheetId = sheet.id;
  selection = { anchor: { row: 0, column: 0 }, end: { row: 0, column: 0 } };
  markDirty();
  renderWorkbook();
}

function renameSheet(sheetId = workbook.activeSheetId) {
  commitFormula();
  const sheet = workbook.sheets.find(item => item.id === sheetId);
  if (!sheet) return;
  const proposed = window.prompt('Sheet name:', sheet.name);
  if (proposed == null) return;
  const name = proposed.trim().slice(0, 80);
  if (!name) return setStatus('Sheet name cannot be blank.', 'error');
  if (workbook.sheets.some(item => item.id !== sheet.id && item.name.toLowerCase() === name.toLowerCase())) {
    return setStatus('Sheet names must be unique.', 'error');
  }
  if (name === sheet.name) return;
  sheet.name = name;
  markDirty();
  renderSheetTabs();
}

async function clearSheet() {
  commitFormula();
  const sheet = activeSheet();
  const confirmed = await showMessageBox({
    title: 'Clear sheet?',
    message: `Clear all contents and formatting from "${sheet.name}"?`,
    confirmLabel: 'Clear Sheet',
    cancelLabel: 'Cancel'
  });
  if (!confirmed) return;
  sheet.cells = {};
  markDirty();
  renderGrid();
}

function switchSheet(id) {
  if (id === workbook.activeSheetId) return;
  commitFormula();
  workbook.activeSheetId = id;
  selection = { anchor: { row: 0, column: 0 }, end: { row: 0, column: 0 } };
  editing = false;
  markDirty('Active sheet changed');
  renderWorkbook();
}

function addRow() {
  commitFormula();
  const sheet = activeSheet();
  if (sheet.rowCount >= MAX_ROWS) return setStatus(`Sheets are limited to ${MAX_ROWS} rows.`, 'error');
  sheet.rowCount += 1;
  selection = { anchor: { row: sheet.rowCount - 1, column: 0 }, end: { row: sheet.rowCount - 1, column: sheet.columnCount - 1 } };
  markDirty();
  renderGrid();
  elements.gridViewport.scrollTop = elements.gridViewport.scrollHeight;
}

function addColumn() {
  commitFormula();
  const sheet = activeSheet();
  if (sheet.columnCount >= MAX_COLUMNS) return setStatus(`Sheets are limited to ${MAX_COLUMNS} columns.`, 'error');
  sheet.columnCount += 1;
  selection = { anchor: { row: 0, column: sheet.columnCount - 1 }, end: { row: sheet.rowCount - 1, column: sheet.columnCount - 1 } };
  markDirty();
  renderGrid();
  elements.gridViewport.scrollLeft = elements.gridViewport.scrollWidth;
}

async function save() {
  commitFormula();
  if (loadFailed) {
    setStatus('Save unavailable because the disk workbook was not loaded. Close and reopen to retry.', 'error');
    elements.status.focus();
    return false;
  }
  if (!workbook || saving) return !dirty;
  saving = true;
  const savingRevision = revision;
  elements.save.disabled = true;
  updateHistoryControls();
  setStatus('Saving...');
  try {
    const requestedCustomColors = [...workbook.preferences.customColors];
    const response = await saveSpreadsheet(workbook);
    const responseCustomColors = response?.preferences?.customColors;
    const customColorsPersisted = Array.isArray(responseCustomColors)
      && responseCustomColors.length === CUSTOM_COLOR_COUNT
      && requestedCustomColors.every((color, index) => normalizeColor(responseCustomColors[index]) === color);
    if (!customColorsPersisted) {
      throw new Error('The server did not preserve custom colors. Restart the server and try again.');
    }
    const savedWorkbook = normalizeWorkbook(response);
    savedWorkbookState = JSON.stringify(savedWorkbook);
    if (revision === savingRevision) {
      workbook = savedWorkbook;
      historyState = captureHistoryState();
    }
    dirty = workbookSnapshot() !== savedWorkbookState;
    setStatus(dirty ? 'Saved, with newer unsaved changes' : 'Saved', dirty ? 'dirty' : '');
    return !dirty;
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, 'error');
    elements.status.focus();
    return false;
  } finally {
    saving = false;
    elements.save.disabled = false;
    updateHistoryControls();
  }
}

function modalIsOpen() {
  return elements.modal.getAttribute('aria-hidden') === 'false';
}

async function open() {
  if (isMobileView() || modalIsOpen()) return;
  const otherModal = document.querySelector('.modal[aria-hidden="false"]');
  if (otherModal) return;
  elements.modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  elements.close.focus();
  if (!loaded && !loading) {
    loading = true;
    setControlsDisabled(true);
    elements.loading.hidden = false;
    elements.gridViewport.hidden = true;
    setStatus('Loading workbook...');
    try {
      workbook = normalizeWorkbook(await fetchSpreadsheet());
      loaded = true;
      loadFailed = false;
      dirty = false;
      resetHistory();
      setStatus('Loaded');
    } catch (error) {
      workbook = createDefaultWorkbook();
      loaded = false;
      loadFailed = true;
      dirty = false;
      resetHistory();
      setStatus(`Load failed: ${error.message}. Close and reopen to retry.`, 'error');
    } finally {
      loading = false;
      elements.loading.hidden = true;
      elements.gridViewport.hidden = false;
      setControlsDisabled(loadFailed);
      updateHistoryControls();
    }
  }
  renderWorkbook();
  elements.gridViewport.focus();
}

function setControlsDisabled(disabled) {
  elements.modal.querySelectorAll('button, input').forEach(control => {
    if (control === elements.close || control === elements.closeAction) return;
    control.disabled = disabled;
  });
}

async function requestClose() {
  if (!modalIsOpen() || closing || loading || saving) return;
  closing = true;
  closeColorPalettes();
  stopPointerActions();
  commitFormula();
  const canClose = !dirty || await showMessageBox({
    title: 'Discard unsaved changes?',
    message: 'Your unsaved spreadsheet changes will be lost.',
    confirmLabel: 'Discard Changes',
    cancelLabel: 'Keep Editing'
  });
  if (canClose) {
    stopPointerActions();
    if (dirty) {
      loaded = false;
      loadFailed = false;
      workbook = null;
      dirty = false;
      editing = false;
      resetHistory();
    }
    elements.modal.setAttribute('aria-hidden', 'true');
    const visibleModal = document.querySelector('.modal[aria-hidden="false"]');
    document.body.classList.toggle('modal-open', Boolean(visibleModal));
    elements.trigger.focus();
  }
  closing = false;
}

function beginResize(event, type, index) {
  event.preventDefault();
  event.stopPropagation();
  commitFormula();
  const sheet = activeSheet();
  resizeState = {
    type,
    index,
    start: type === 'column' ? event.clientX : event.clientY,
    size: type === 'column'
      ? sheet.columnWidths[index] || DEFAULT_COLUMN_WIDTH
      : sheet.rowHeights[index] || DEFAULT_ROW_HEIGHT,
    pointerId: event.pointerId,
    target: event.currentTarget,
    changed: false
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function resizePointer(event) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const sheet = activeSheet();
  const delta = (resizeState.type === 'column' ? event.clientX : event.clientY) - resizeState.start;
  if (resizeState.type === 'column') {
    const size = clamp(Math.round(resizeState.size + delta), MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
    resizeState.changed ||= size !== resizeState.size;
    sheet.columnWidths[resizeState.index] = size;
  } else {
    const size = clamp(Math.round(resizeState.size + delta), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
    resizeState.changed ||= size !== resizeState.size;
    sheet.rowHeights[resizeState.index] = size;
  }
  const columns = Array.from({ length: sheet.columnCount }, (_, index) => `${sheet.columnWidths[index] || DEFAULT_COLUMN_WIDTH}px`);
  const rows = Array.from({ length: sheet.rowCount }, (_, index) => `${sheet.rowHeights[index] || DEFAULT_ROW_HEIGHT}px`);
  elements.grid.style.gridTemplateColumns = `54px ${columns.join(' ')}`;
  elements.grid.style.gridTemplateRows = `30px ${rows.join(' ')}`;
  if (resizeState.changed) setStatus('Unsaved size change', 'dirty');
}

function stopPointerActions() {
  selecting = false;
  if (resizeState) {
    const changed = resizeState.changed;
    try { resizeState.target.releasePointerCapture?.(resizeState.pointerId); } catch {}
    resizeState = null;
    if (changed) markDirty('Unsaved size change');
  }
}

function resolvedThemeColor(property, fallback) {
  const value = getComputedStyle(document.body).getPropertyValue(property).trim();
  const probe = document.createElement('span');
  probe.style.color = value || fallback;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+(?:\.\d+)?/g);
  probe.remove();
  if (!rgb || rgb.length < 3) return fallback;
  return `#${rgb.slice(0, 3).map(part => clamp(Math.round(Number(part)), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function resolvedThemeColors() {
  const theme = document.body.dataset.theme || '';
  if (!themeColorCache || themeColorCache.theme !== theme) {
    themeColorCache = {
      theme,
      text: resolvedThemeColor('--text', '#000000'),
      background: resolvedThemeColor('--surface', '#ffffff')
    };
  }
  return themeColorCache;
}

function cacheElements() {
  elements = {
    trigger: document.querySelector('#spreadsheetTrigger'),
    modal: document.querySelector('#spreadsheetModal'),
    close: document.querySelector('#spreadsheetClose'),
    closeAction: document.querySelector('#spreadsheetCloseAction'),
    toolbar: document.querySelector('#spreadsheetToolbar'),
    undo: document.querySelector('#spreadsheetUndo'),
    redo: document.querySelector('#spreadsheetRedo'),
    bold: document.querySelector('#spreadsheetBold'),
    italic: document.querySelector('#spreadsheetItalic'),
    underline: document.querySelector('#spreadsheetUnderline'),
    wrap: document.querySelector('#spreadsheetWrap'),
    alignButtons: [...document.querySelectorAll('[data-align]')],
    textColor: document.querySelector('#spreadsheetTextColor'),
    textColorPanel: document.querySelector('#spreadsheetTextColorPanel'),
    backgroundColor: document.querySelector('#spreadsheetBackgroundColor'),
    backgroundColorPanel: document.querySelector('#spreadsheetBackgroundColorPanel'),
    autoSum: document.querySelector('#spreadsheetAutoSum'),
    clearFormatting: document.querySelector('#spreadsheetClearFormatting'),
    address: document.querySelector('#spreadsheetAddress'),
    formula: document.querySelector('#spreadsheetFormula'),
    addRow: document.querySelector('#spreadsheetAddRow'),
    addColumn: document.querySelector('#spreadsheetAddColumn'),
    loading: document.querySelector('#spreadsheetLoading'),
    gridViewport: document.querySelector('#spreadsheetGridViewport'),
    grid: document.querySelector('#spreadsheetGrid'),
    sheetTabs: document.querySelector('#spreadsheetSheetTabs'),
    addSheet: document.querySelector('#spreadsheetAddSheet'),
    renameSheet: document.querySelector('#spreadsheetRenameSheet'),
    clearSheet: document.querySelector('#spreadsheetClearSheet'),
    status: document.querySelector('#spreadsheetStatus'),
    save: document.querySelector('#spreadsheetSave')
  };
  return elements.trigger && elements.modal;
}

function wireEvents() {
  elements.trigger.addEventListener('click', () => { void open(); });
  elements.close.addEventListener('click', () => { void requestClose(); });
  elements.closeAction.addEventListener('click', () => { void requestClose(); });
  elements.modal.querySelector('.modal-backdrop').addEventListener('click', () => { void requestClose(); });
  elements.save.addEventListener('click', () => { void save(); });
  elements.undo.addEventListener('click', undo);
  elements.redo.addEventListener('click', redo);

  elements.formula.addEventListener('focus', () => {
    if (!editing) editOriginal = String(activeSheet()?.cells[activeAddress()]?.value ?? '');
  });
  elements.formula.addEventListener('input', () => { editing = true; });
  elements.formula.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelFormulaEdit();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      moveSelection(1, 0);
      elements.gridViewport.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      moveSelection(0, event.shiftKey ? -1 : 1);
      elements.gridViewport.focus();
    }
  });

  elements.grid.addEventListener('pointerdown', event => {
    const columnHandle = event.target.closest('[data-resize-column]');
    const rowHandle = event.target.closest('[data-resize-row]');
    if (columnHandle) return beginResize(event, 'column', Number(columnHandle.dataset.resizeColumn));
    if (rowHandle) return beginResize(event, 'row', Number(rowHandle.dataset.resizeRow));
    const cell = event.target.closest('.spreadsheet-cell');
    if (!cell) return;
    event.preventDefault();
    commitFormula();
    selecting = true;
    if (event.shiftKey) selection.anchor = { ...selection.end };
    setSelection(Number(cell.dataset.row), Number(cell.dataset.column), event.shiftKey);
    elements.gridViewport.focus();
  });
  elements.grid.addEventListener('pointerover', event => {
    if (!selecting) return;
    const cell = event.target.closest('.spreadsheet-cell');
    if (cell) setSelection(Number(cell.dataset.row), Number(cell.dataset.column), true);
  });
  elements.grid.addEventListener('dblclick', event => {
    const cell = event.target.closest('.spreadsheet-cell');
    if (!cell) return;
    elements.formula.focus();
    elements.formula.select();
  });
  window.addEventListener('pointermove', resizePointer);
  window.addEventListener('pointerup', stopPointerActions);
  window.addEventListener('pointercancel', stopPointerActions);

  elements.gridViewport.addEventListener('keydown', event => {
    if (!modalIsOpen() || editing) return;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[event.key]) {
      event.preventDefault();
      moveSelection(...moves[event.key]);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      elements.formula.focus();
      elements.formula.select();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      editOriginal = String(activeSheet().cells[activeAddress()]?.value ?? '');
      elements.formula.value = event.key;
      editing = true;
      elements.formula.focus();
      elements.formula.setSelectionRange(1, 1);
    }
  });

  elements.bold.addEventListener('click', () => toggleStyle('bold'));
  elements.italic.addEventListener('click', () => toggleStyle('italic'));
  elements.underline.addEventListener('click', () => toggleStyle('underline'));
  elements.wrap.addEventListener('click', () => toggleStyle('wrap', 'wrap'));
  elements.alignButtons.forEach(button => button.addEventListener('click', () => setAlignment(button.dataset.align)));
  elements.clearFormatting.addEventListener('click', clearFormatting);
  elements.autoSum.addEventListener('click', autoSum);
  elements.addRow.addEventListener('click', addRow);
  elements.addColumn.addEventListener('click', addColumn);
  elements.addSheet.addEventListener('click', addSheet);
  elements.renameSheet.addEventListener('click', () => renameSheet());
  elements.clearSheet.addEventListener('click', clearSheet);
  elements.sheetTabs.addEventListener('click', event => {
    const tab = event.target.closest('[data-sheet-id]');
    if (tab) switchSheet(tab.dataset.sheetId);
  });
  elements.sheetTabs.addEventListener('dblclick', event => {
    const tab = event.target.closest('[data-sheet-id]');
    if (tab) renameSheet(tab.dataset.sheetId);
  });
  elements.sheetTabs.addEventListener('keydown', event => {
    const tabs = [...elements.sheetTabs.querySelectorAll('[data-sheet-id]')];
    const currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    switchSheet(tabs[nextIndex].dataset.sheetId);
    elements.sheetTabs.querySelector(`[data-sheet-id="${CSS.escape(workbook.activeSheetId)}"]`)?.focus();
  });
  document.addEventListener('keydown', event => {
    const historyShortcut = (event.ctrlKey || event.metaKey) && !event.altKey && document.activeElement !== elements.formula;
    const key = event.key.toLowerCase();
    if (modalIsOpen() && !isMessageBoxOpen() && historyShortcut && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) redo();
      else undo();
    } else if (event.key === 'Escape' && modalIsOpen() && !isMessageBoxOpen() && colorPalettes.some(palette => !palette.panel.hidden)) {
      event.preventDefault();
      colorPalettes.find(palette => !palette.panel.hidden)?.close(true);
    } else if (event.key === 'Escape' && modalIsOpen() && !isMessageBoxOpen() && document.activeElement !== elements.formula) {
      event.preventDefault();
      void requestClose();
    } else if (event.key === 'Tab' && modalIsOpen() && !isMessageBoxOpen()) {
      const focusable = [...elements.modal.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(item => !item.hidden && item.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!modalIsOpen()) return;
    colorPalettes.forEach(palette => {
      if (!palette.trigger.contains(event.target) && !palette.panel.contains(event.target)) palette.close();
    });
  });
  window.addEventListener('resize', () => {
    stopPointerActions();
    if (isMobileView() && modalIsOpen()) void requestClose();
  });
}

export function initSpreadsheetUI() {
  if (initialized || isMobileView() || !cacheElements()) return;
  initialized = true;
  colorPalettes = [
    createColorPalette({
      trigger: elements.textColor,
      panel: elements.textColorPanel,
      property: 'textColor',
      label: 'Text color'
    }),
    createColorPalette({
      trigger: elements.backgroundColor,
      panel: elements.backgroundColorPanel,
      property: 'backgroundColor',
      label: 'Background color'
    })
  ];
  const themeColors = resolvedThemeColors();
  colorPalettes[0].sync(themeColors.text, normalizeCustomColors());
  colorPalettes[1].sync(themeColors.background, normalizeCustomColors());
  wireEvents();
}
