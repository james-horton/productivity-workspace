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
  return { version: 1, activeSheetId: 'sheet-1', sheets: [createSheet()] };
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
  return { version: 1, activeSheetId, sheets };
}

function setStatus(message, kind = '') {
  elements.status.textContent = message;
  elements.status.classList.toggle('is-error', kind === 'error');
  elements.status.classList.toggle('is-dirty', kind === 'dirty');
}

function markDirty(message = 'Unsaved changes') {
  revision += 1;
  dirty = true;
  setStatus(message, 'dirty');
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
  elements.textColor.value = style.textColor || themeColors.text;
  elements.backgroundColor.value = style.backgroundColor || themeColors.background;
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
  setStatus('Saving...');
  try {
    const savedWorkbook = normalizeWorkbook(await saveSpreadsheet(workbook));
    if (revision === savingRevision) workbook = savedWorkbook;
    dirty = revision !== savingRevision;
    setStatus(dirty ? 'Saved, with newer unsaved changes' : 'Saved', dirty ? 'dirty' : '');
    return !dirty;
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, 'error');
    elements.status.focus();
    return false;
  } finally {
    saving = false;
    elements.save.disabled = false;
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
      setStatus('Loaded');
    } catch (error) {
      workbook = createDefaultWorkbook();
      loaded = false;
      loadFailed = true;
      dirty = false;
      setStatus(`Load failed: ${error.message}. Close and reopen to retry.`, 'error');
    } finally {
      loading = false;
      elements.loading.hidden = true;
      elements.gridViewport.hidden = false;
      setControlsDisabled(loadFailed);
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
    target: event.currentTarget
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function resizePointer(event) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const sheet = activeSheet();
  const delta = (resizeState.type === 'column' ? event.clientX : event.clientY) - resizeState.start;
  if (resizeState.type === 'column') {
    sheet.columnWidths[resizeState.index] = clamp(Math.round(resizeState.size + delta), MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  } else {
    sheet.rowHeights[resizeState.index] = clamp(Math.round(resizeState.size + delta), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  }
  const columns = Array.from({ length: sheet.columnCount }, (_, index) => `${sheet.columnWidths[index] || DEFAULT_COLUMN_WIDTH}px`);
  const rows = Array.from({ length: sheet.rowCount }, (_, index) => `${sheet.rowHeights[index] || DEFAULT_ROW_HEIGHT}px`);
  elements.grid.style.gridTemplateColumns = `54px ${columns.join(' ')}`;
  elements.grid.style.gridTemplateRows = `30px ${rows.join(' ')}`;
  markDirty('Unsaved size change');
}

function stopPointerActions() {
  selecting = false;
  if (resizeState) {
    try { resizeState.target.releasePointerCapture?.(resizeState.pointerId); } catch {}
    resizeState = null;
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
    bold: document.querySelector('#spreadsheetBold'),
    italic: document.querySelector('#spreadsheetItalic'),
    underline: document.querySelector('#spreadsheetUnderline'),
    wrap: document.querySelector('#spreadsheetWrap'),
    alignButtons: [...document.querySelectorAll('[data-align]')],
    textColor: document.querySelector('#spreadsheetTextColor'),
    backgroundColor: document.querySelector('#spreadsheetBackgroundColor'),
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
  elements.textColor.addEventListener('input', event => applyStyle(style => { style.textColor = event.target.value; }));
  elements.backgroundColor.addEventListener('input', event => applyStyle(style => { style.backgroundColor = event.target.value; }));
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
    if (event.key === 'Escape' && modalIsOpen() && !isMessageBoxOpen() && document.activeElement !== elements.formula) {
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
  window.addEventListener('resize', () => {
    stopPointerActions();
    if (isMobileView() && modalIsOpen()) void requestClose();
  });
}

export function initSpreadsheetUI() {
  if (initialized || isMobileView() || !cacheElements()) return;
  initialized = true;
  const themeColors = resolvedThemeColors();
  elements.textColor.value = themeColors.text;
  elements.backgroundColor.value = themeColors.background;
  wireEvents();
}
