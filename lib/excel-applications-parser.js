/**
 * lib/excel-applications-parser.js
 *
 * Parser del Excel que el operador fumigador lleva con el registro
 * manual de aplicaciones de fumigacion. Lee el .xlsx y devuelve una
 * lista normalizada de filas.
 *
 * Sprint: feature/excel-applications-import / Nivel 1.
 *
 * Mismo shape que tendria la version TS, pero CJS para que el script
 * `scripts/import-applications-from-excel.js` lo pueda importar
 * directamente (mismo patron que `lib/djiag-fumigations-fetcher.js`).
 *
 * Para el tipado: los tests en TS usan `// @ts-check` + declaraciones
 * en `tests/fixtures/excel-applications-types.d.ts`. Para uso desde
 * .ts via `import`, el bundler de Next.js resuelve el .js.
 *
 * @typedef {Object} ExcelApplicationRow
 * @property {{sheet: string, row_idx: number}} source
 * @property {Date | null} fecha
 * @property {string | null} hacienda
 * @property {string | null} suerte
 * @property {string | null} piloto
 * @property {string | null} drone
 * @property {string | null} transporte
 * @property {string | null} tipo_aplicacion
 * @property {number | null} altura_m
 * @property {number | null} velocidad_m_s
 * @property {number | null} area_aplicada
 * @property {"ha" | "m2"} unidad_area
 * @property {number | null} area_ot
 * @property {number | null} ancho_franja_m
 * @property {number | null} dosis_l_ha
 * @property {number | null} volumen_l
 * @property {string | null} zona
 * @property {string | null} cliente
 * @property {string | null} numero_factura
 * @property {Date | null} fecha_facturacion
 * @property {number | null} valor_factura_cop
 * @property {string | null} cancelada
 * @property {number | null} horas_planta
 */

const XLSX = require('xlsx');

const HEADER_KEYWORDS = {
  fecha: ['FECHA'],
  hacienda: ['HACIENDA'],
  suerte: ['SUERTE'],
  piloto: ['PILOTO'],
  drone: ['DRONE'],
  transporte: ['TRANSPORTE'],
  tipo_aplicacion: ['TIPO APLICACION', 'TIPO APLICACI'],
  altura_m: ['ALTURA'],
  velocidad_m_s: ['VELOCIDAD'],
  area_aplicada: ['AREA APLICADA', 'AREA APLICACI'],
  area_ot: ['AREA OT', 'AREA_OT'],
  ancho_franja_m: ['ANCHO FRANJA', 'ANCHO'],
  dosis_l_ha: ['DOSIS'],
  volumen_l: ['VOLUMEN TOTAL', 'VOLUMEN'],
  zona: ['ZONA', 'LOCALIZACION', 'LOCALIZACI'],
  cliente: ['CLIENTE'],
  numero_factura: ['Nº DE FACTURA', 'N DE FACTURA', 'NUMERO DE FACTURA'],
  fecha_facturacion: ['FECHA DE FACTURACION', 'FECHA FACT'],
  valor_factura_cop: ['VALOR DE LA FACTURA', 'VALOR FACT'],
  cancelada: ['CANCELADA'],
  horas_planta: ['HORAS PLANTA'],
  ignore: ['Columna', 'AÑO', 'MES', 'A']
};

/**
 * Encuentra la fila de headers: la primera con >= 5 celdas no-vacias.
 */
function findHeaderRow(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
    let nonEmpty = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = ws[XLSX.utils.encode_cell({ r, c })]?.v;
      if (v != null && String(v).trim() !== '') nonEmpty++;
    }
    if (nonEmpty >= 5) return r;
  }
  return range.s.r;
}

/**
 * Mapea un header del Excel a un campo, usando estrategia longest-match-first.
 * Asi "FECHA DE FACTURACION" no matchea como "FECHA".
 */
function mapHeaderToField(header) {
  const normalized = header.toUpperCase().trim().replace(/\s+/g, ' ');
  if (normalized === '') return null;

  let bestField = null;
  let bestLen = 0;
  for (const [field, keywords] of Object.entries(HEADER_KEYWORDS)) {
    for (const kw of keywords) {
      const upperKw = kw.toUpperCase().replace(/\s+/g, ' ');
      if (normalized.startsWith(upperKw) && upperKw.length > bestLen) {
        bestField = field;
        bestLen = upperKw.length;
      }
    }
  }
  if (bestField === null || bestField === 'ignore') return null;
  return bestField;
}

function normalizeCell(value, field) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (field === 'tipo_aplicacion' || field === 'cancelada') return trimmed.toUpperCase();
    return trimmed;
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) {
    // Truncar al dia para campos fecha (XLSX puede devolver con precision sub-second)
    if (field === 'fecha' || field === 'fecha_facturacion') {
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }
    return value;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return String(value).trim() || null;
}

function detectAreaUnit(rows) {
  const areas = rows.map(r => r.area_aplicada).filter(v => v != null && v > 0);
  if (areas.length === 0) return 'ha';
  const max = Math.max(...areas);
  return max >= 1000 ? 'm2' : 'ha';
}

function emptyRow(sheetName, rowIdx) {
  return {
    source: { sheet: sheetName, row_idx: rowIdx },
    fecha: null,
    hacienda: null,
    suerte: null,
    piloto: null,
    drone: null,
    transporte: null,
    tipo_aplicacion: null,
    altura_m: null,
    velocidad_m_s: null,
    area_aplicada: null,
    unidad_area: 'ha',
    area_ot: null,
    ancho_franja_m: null,
    dosis_l_ha: null,
    volumen_l: null,
    zona: null,
    cliente: null,
    numero_factura: null,
    fecha_facturacion: null,
    valor_factura_cop: null,
    cancelada: null,
    horas_planta: null
  };
}

/**
 * Parsea un .xlsx y devuelve las filas normalizadas.
 * @param {string} xlsxPath
 * @param {{areaUnit?: "ha" | "m2", sheets?: string[]}} options
 * @returns {ExcelApplicationRow[]}
 */
function parseExcelApplications(xlsxPath, options) {
  options = options || {};
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const result = [];

  const sheetsToProcess = options.sheets
    || wb.SheetNames.filter(name => /^\d{4}$/.test(name));

  for (const sheetName of sheetsToProcess) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const headerRowIdx = findHeaderRow(ws);
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');

    const headerMap = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const headerCell = ws[XLSX.utils.encode_cell({ r: headerRowIdx, c })]?.v;
      const headerStr = headerCell != null ? String(headerCell) : '';
      headerMap.push(mapHeaderToField(headerStr));
    }

    for (let r = headerRowIdx + 1; r <= range.e.r; r++) {
      const row = emptyRow(sheetName, r - headerRowIdx);
      let hasData = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const field = headerMap[c - range.s.c];
        if (!field || field === 'source') continue;
        const cell = ws[XLSX.utils.encode_cell({ r, c })]?.v;
        const value = normalizeCell(cell, field);
        if (value != null && value !== '') hasData = true;
        row[field] = value;
      }
      if (hasData) result.push(row);
    }
  }

  const unit = options.areaUnit || detectAreaUnit(result);
  for (const row of result) {
    row.unidad_area = unit;
  }

  return result;
}

module.exports = { parseExcelApplications };
