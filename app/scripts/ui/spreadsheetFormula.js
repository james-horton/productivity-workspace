/**
 * Safe formula parsing and evaluation for a single spreadsheet sheet.
 */

export const FORMULA_ERRORS = Object.freeze({
  VALUE: '#VALUE!',
  REF: '#REF!',
  DIV_ZERO: '#DIV/0!',
  CIRCULAR: '#CIRC!'
});

const CELL_PATTERN = /^([A-Z]+)([1-9]\d*)$/;
const NUMBER_TEXT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const AGGREGATES = new Set(['SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'COUNT']);

class FormulaError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

class FormulaParser {
  constructor(source) {
    this.source = source;
    this.position = 0;
    this.current = this.readToken();
  }

  parse() {
    const expression = this.parseAdditive();
    if (this.current.type !== 'end') this.fail();
    return expression;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.current.type === '+' || this.current.type === '-') {
      const operator = this.current.type;
      this.advance();
      left = { type: 'binary', operator, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.current.type === '*' || this.current.type === '/') {
      const operator = this.current.type;
      this.advance();
      left = { type: 'binary', operator, left, right: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.current.type === '-') {
      this.advance();
      return { type: 'unary', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    if (this.current.type === 'number') {
      const value = this.current.value;
      this.advance();
      return { type: 'number', value };
    }

    if (this.current.type === 'cell') {
      const start = this.current.value;
      this.advance();
      if (this.current.type !== ':') return { type: 'cell', address: start };
      this.advance();
      if (this.current.type !== 'cell') this.fail();
      const end = this.current.value;
      this.advance();
      return { type: 'range', start, end };
    }

    if (this.current.type === 'identifier') {
      const name = this.current.value;
      this.advance();
      if (this.current.type !== '(') this.fail();
      this.advance();

      const args = [];
      if (this.current.type !== ')') {
        while (true) {
          args.push(this.parseAdditive());
          if (this.current.type !== ',') break;
          this.advance();
        }
      }
      if (this.current.type !== ')') this.fail();
      this.advance();
      return { type: 'call', name, args };
    }

    if (this.current.type === '(') {
      this.advance();
      const expression = this.parseAdditive();
      if (this.current.type !== ')') this.fail();
      this.advance();
      return expression;
    }

    this.fail();
  }

  advance() {
    this.current = this.readToken();
  }

  readToken() {
    while (/\s/.test(this.source[this.position] || '')) this.position += 1;
    if (this.position >= this.source.length) return { type: 'end' };

    const rest = this.source.slice(this.position);
    const numberMatch = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (numberMatch) {
      this.position += numberMatch[0].length;
      const value = Number(numberMatch[0]);
      if (!Number.isFinite(value)) this.fail();
      return { type: 'number', value };
    }

    if (/[A-Za-z]/.test(rest[0])) {
      const wordMatch = /^[A-Za-z]+\d*/.exec(rest);
      const word = wordMatch[0];
      this.position += word.length;
      if (/^[A-Za-z]+[1-9]\d*$/.test(word)) {
        return { type: 'cell', value: word.toUpperCase() };
      }
      if (/^[A-Za-z]+$/.test(word)) {
        return { type: 'identifier', value: word.toUpperCase() };
      }
      this.fail();
    }

    const character = rest[0];
    if ('+-*/(),:'.includes(character)) {
      this.position += 1;
      return { type: character };
    }
    this.fail();
  }

  fail() {
    throw new FormulaError(FORMULA_ERRORS.VALUE);
  }
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function columnLabelToIndex(label) {
  let index = 0;
  for (const character of label) {
    index = (index * 26) + character.charCodeAt(0) - 64;
  }
  return index - 1;
}

function columnIndexToLabel(index) {
  let label = '';
  let remaining = index + 1;
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    label = String.fromCharCode(65 + digit) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return label;
}

function rawCellValue(cell) {
  if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return '';
  return cell.value == null ? '' : cell.value;
}

function isFormula(value) {
  return typeof value === 'string' && value.startsWith('=');
}

function createEngine(sheet) {
  const rowCount = finiteInteger(sheet && sheet.rowCount);
  const columnCount = finiteInteger(sheet && sheet.columnCount);
  const sourceCells = sheet && sheet.cells;
  const cells = new Map();
  const entries = sourceCells instanceof Map
    ? sourceCells.entries()
    : Object.entries(sourceCells && typeof sourceCells === 'object' ? sourceCells : {});

  for (const [key, cell] of entries) {
    const address = String(key).trim().toUpperCase();
    if (CELL_PATTERN.test(address)) cells.set(address, cell);
  }

  const cache = new Map();
  const states = new Map();

  function parseAddress(address) {
    const normalized = String(address == null ? '' : address).trim().toUpperCase();
    const match = CELL_PATTERN.exec(normalized);
    if (!match) return null;
    return {
      address: normalized,
      column: columnLabelToIndex(match[1]),
      row: Number(match[2]) - 1
    };
  }

  function checkedAddress(address) {
    const parsed = parseAddress(address);
    if (
      !parsed
      || !Number.isSafeInteger(parsed.column)
      || !Number.isSafeInteger(parsed.row)
      || parsed.column < 0
      || parsed.row < 0
      || parsed.column >= columnCount
      || parsed.row >= rowCount
    ) {
      throw new FormulaError(FORMULA_ERRORS.REF);
    }
    return parsed;
  }

  function classifyRaw(value) {
    if (value == null) return { kind: 'empty', value: 0 };
    if (typeof value === 'number') {
      return Number.isFinite(value)
        ? { kind: 'number', value }
        : { kind: 'text', value };
    }
    if (typeof value !== 'string') return { kind: 'text', value };

    const trimmed = value.trim();
    if (trimmed === '') return { kind: 'empty', value: 0 };
    if (NUMBER_TEXT_PATTERN.test(trimmed)) {
      const number = Number(trimmed);
      if (Number.isFinite(number)) return { kind: 'number', value: number };
    }
    return { kind: 'text', value };
  }

  function throwCachedError(result) {
    if (result.kind === 'error') throw new FormulaError(result.value);
    return result;
  }

  function resolveCell(address) {
    const parsed = checkedAddress(address);
    const normalized = parsed.address;
    if (states.get(normalized) === 'evaluating') {
      throw new FormulaError(FORMULA_ERRORS.CIRCULAR);
    }
    if (cache.has(normalized)) return throwCachedError(cache.get(normalized));

    const raw = rawCellValue(cells.get(normalized));
    if (!isFormula(raw)) {
      const result = classifyRaw(raw);
      cache.set(normalized, result);
      states.set(normalized, 'done');
      return result;
    }

    states.set(normalized, 'evaluating');
    try {
      const expression = new FormulaParser(raw.slice(1)).parse();
      const value = evaluateNode(expression);
      if (!Number.isFinite(value)) throw new FormulaError(FORMULA_ERRORS.VALUE);
      const result = { kind: 'number', value: Object.is(value, -0) ? 0 : value };
      cache.set(normalized, result);
      states.set(normalized, 'done');
      return result;
    } catch (error) {
      const code = error instanceof FormulaError ? error.code : FORMULA_ERRORS.VALUE;
      const result = { kind: 'error', value: code };
      cache.set(normalized, result);
      states.set(normalized, 'done');
      throw new FormulaError(code);
    }
  }

  function arithmeticValue(result) {
    if (result.kind === 'number') return result.value;
    if (result.kind === 'empty') return 0;
    throw new FormulaError(FORMULA_ERRORS.VALUE);
  }

  function checkedResult(value) {
    if (!Number.isFinite(value)) throw new FormulaError(FORMULA_ERRORS.VALUE);
    return value;
  }

  function evaluateNode(node) {
    if (node.type === 'number') return node.value;
    if (node.type === 'cell') return arithmeticValue(resolveCell(node.address));
    if (node.type === 'range') throw new FormulaError(FORMULA_ERRORS.VALUE);
    if (node.type === 'unary') return checkedResult(-evaluateNode(node.operand));
    if (node.type === 'call') return evaluateAggregate(node);

    const left = evaluateNode(node.left);
    const right = evaluateNode(node.right);
    if (node.operator === '+') return checkedResult(left + right);
    if (node.operator === '-') return checkedResult(left - right);
    if (node.operator === '*') return checkedResult(left * right);
    if (right === 0) throw new FormulaError(FORMULA_ERRORS.DIV_ZERO);
    return checkedResult(left / right);
  }

  function addAggregateCell(values, address) {
    const result = resolveCell(address);
    if (result.kind === 'number') values.push(result.value);
  }

  function addRangeValues(values, range) {
    const start = checkedAddress(range.start);
    const end = checkedAddress(range.end);
    const firstRow = Math.min(start.row, end.row);
    const lastRow = Math.max(start.row, end.row);
    const firstColumn = Math.min(start.column, end.column);
    const lastColumn = Math.max(start.column, end.column);

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        addAggregateCell(values, `${columnIndexToLabel(column)}${row + 1}`);
      }
    }
  }

  function evaluateAggregate(node) {
    if (!AGGREGATES.has(node.name)) throw new FormulaError(FORMULA_ERRORS.VALUE);

    const values = [];
    for (const argument of node.args) {
      if (argument.type === 'range') {
        addRangeValues(values, argument);
      } else if (argument.type === 'cell') {
        addAggregateCell(values, argument.address);
      } else {
        values.push(evaluateNode(argument));
      }
    }

    if (node.name === 'COUNT') return values.length;
    if (node.name === 'SUM') return checkedResult(values.reduce((sum, value) => sum + value, 0));
    if (node.name === 'AVERAGE' || node.name === 'AVG') {
      if (values.length === 0) throw new FormulaError(FORMULA_ERRORS.DIV_ZERO);
      return checkedResult(values.reduce((sum, value) => sum + value, 0) / values.length);
    }
    if (values.length === 0) return 0;

    let result = values[0];
    for (let index = 1; index < values.length; index += 1) {
      result = node.name === 'MIN'
        ? Math.min(result, values[index])
        : Math.max(result, values[index]);
    }
    return result;
  }

  function evaluateCellDisplay(address) {
    let parsed;
    try {
      parsed = checkedAddress(address);
    } catch (error) {
      return error instanceof FormulaError ? error.code : FORMULA_ERRORS.VALUE;
    }

    const raw = rawCellValue(cells.get(parsed.address));
    if (!isFormula(raw)) return raw;
    try {
      return resolveCell(parsed.address).value;
    } catch (error) {
      return error instanceof FormulaError ? error.code : FORMULA_ERRORS.VALUE;
    }
  }

  function evaluateFormulaCells() {
    const results = new Map();
    for (const [address, cell] of cells) {
      if (isFormula(rawCellValue(cell))) results.set(address, evaluateCellDisplay(address));
    }
    return results;
  }

  return Object.freeze({
    evaluateCell: evaluateCellDisplay,
    evaluateSheet: evaluateFormulaCells
  });
}

/**
 * Creates a reusable evaluator whose dependency cache is shared across UI reads.
 */
export function createFormulaEvaluator(sheet) {
  return createEngine(sheet);
}

/**
 * Returns a Map containing the display value of every formula cell.
 */
export function evaluateSheet(sheet) {
  return createEngine(sheet).evaluateSheet();
}

/**
 * Returns one cell's formula result, error, or unchanged non-formula value.
 */
export function evaluateCell(sheet, address) {
  return createEngine(sheet).evaluateCell(address);
}
