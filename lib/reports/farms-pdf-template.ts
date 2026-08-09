// lib/reports/farms-pdf-template.ts
//
// Template HTML para el reporte de fumigaciones por hacienda / multi-hacienda
// (nivel 2 de feature/reports-level, 2026-08-08).
//
// Mismo patrón que `parcel-pdf-template.ts`:
//   - HTML self-contained, estilos inline
//   - Pensado para print (A4, márgenes de 1.5cm, fuentes web-safe)
//   - Escaping de strings del usuario (XSS defense)
//   - Status visual con emojis cuando aplica
//
// Layout:
//   - Header: Operador + título + ventana
//   - Resumen: totales del rango (1 fila)
//   - Última fumigación destacada (1 card grande arriba)
//   - Por parcela: tabla agregada (1 fila por parcela, cap 50)
//   - Fumigaciones: lista detallada (1 fila por fumigación, cap 200)
//
// Out of scope:
//   - Imagen satelital (no aplica — el mapa es por parcela, nivel 1).
//   - Por piloto / por producto (nivel 3 si el operador lo pide).

import type {
  FarmsFumigationRow,
  FarmsLastFumigation,
  FarmsParcelAgg,
  FarmsReportData
} from "./fetch-farms-report-data";

/** Formato es-CO para números. */
function fmtNum(value: number, decimals: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

/** Escapa caracteres peligrosos para inyectar HTML. */
function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render de una fila de la tabla de fumigaciones. */
function renderFumigationRow(e: FarmsFumigationRow): string {
  const area =
    e.area_fumigated_ha === null ? "—" : `${fmtNum(e.area_fumigated_ha, 2)} ha`;
  const volume =
    e.dose_l_per_ha !== null && e.area_fumigated_ha !== null
      ? `${fmtNum(e.dose_l_per_ha * e.area_fumigated_ha, 2)} L`
      : "—";
  return `<tr>
    <td style="${cellBase}">${escapeHtml(e.fumigation_date)}</td>
    <td style="${cellBase}">${escapeHtml(e.parcel_name)}</td>
    <td style="${cellBase}">${escapeHtml(e.pilot_name ?? "—")}</td>
    <td style="${cellBase}">${escapeHtml(e.drone_nickname ?? "—")}</td>
    <td style="${cellBaseNum}">${area}</td>
    <td style="${cellBaseNum}">${volume}</td>
    <td style="${cellBase}">${escapeHtml(e.product_used ?? "—")}</td>
  </tr>`;
}

/** Render de una fila de la tabla de parcelas agregadas. */
function renderParcelRow(p: FarmsParcelAgg): string {
  return `<tr>
    <td style="${cellBase}">${escapeHtml(p.parcel_name)}</td>
    <td style="${cellBase}">${escapeHtml(p.farm_name ?? "—")}</td>
    <td style="${cellBaseNum}">${fmtInt(p.n_fumigations)}</td>
    <td style="${cellBaseNum}">${fmtNum(p.total_area_ha, 2)} ha</td>
    <td style="${cellBaseNum}">${fmtNum(p.total_liters, 2)} L</td>
    <td style="${cellBase}">${escapeHtml(p.last_fumigation_date ?? "—")}</td>
  </tr>`;
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat("de-DE").format(n);
}

const cellBase =
  "padding:5px 7px;border-bottom:1px solid #e3e8e3;font-size:9.5px;";
const cellBaseNum =
  "padding:5px 7px;border-bottom:1px solid #e3e8e3;text-align:right;font-variant-numeric:tabular-nums;font-size:9.5px;";

const STYLES = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 11px;
    color: #1c2a23;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { padding: 16mm 12mm; }
  h1 { font-size: 18px; margin: 0 0 4px 0; color: #0b5f2d; }
  h2 { font-size: 12px; margin: 14px 0 6px 0; color: #0b5f2d; text-transform: uppercase; letter-spacing: 0.06em; }
  .header { border-bottom: 2px solid #0b5f2d; padding-bottom: 8px; margin-bottom: 12px; }
  .header .meta { font-size: 10px; color: #587064; }
  .header .meta .strong { color: #1c2a23; font-weight: 600; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .summary .cell { background: #f7f9fb; border: 1px solid #d2ddd6; border-radius: 6px; padding: 8px 10px; }
  .summary .cell .label { font-size: 9px; color: #587064; text-transform: uppercase; letter-spacing: 0.05em; }
  .summary .cell .value { font-size: 16px; font-weight: 700; color: #0b5f2d; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .last-card { background: #f7f9fb; border: 1px solid #d2ddd6; border-left: 4px solid #0b5f2d; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; }
  .last-card .title { font-size: 10px; color: #587064; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .last-card .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; font-size: 10.5px; }
  .last-card dt { color: #587064; }
  .last-card dd { margin: 0; color: #1c2a23; }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; padding: 6px 7px;
    background: #0b5f2d; color: #ffffff;
    font-weight: 600; text-transform: uppercase;
    font-size: 9px; letter-spacing: 0.04em;
  }
  th.num { text-align: right; }
  .empty { color: #587064; font-style: italic; padding: 8px 0; }
  .cap-warning { color: #a37200; font-size: 9.5px; margin-top: 4px; font-style: italic; }
  .footer { margin-top: 14px; font-size: 9px; color: #587064; text-align: center; border-top: 1px solid #d2ddd6; padding-top: 6px; }
`;

function renderLastCard(last: FarmsLastFumigation | null): string {
  if (!last) {
    return `<div class="last-card">
      <div class="title">Última fumigación del rango</div>
      <div class="empty">Sin fumigaciones registradas en el rango.</div>
    </div>`;
  }
  const area =
    last.area_fumigated_ha === null
      ? "—"
      : `${fmtNum(last.area_fumigated_ha, 2)} ha`;
  const volume =
    last.dose_l_per_ha !== null && last.area_fumigated_ha !== null
      ? `${fmtNum(last.dose_l_per_ha * last.area_fumigated_ha, 2)} L`
      : "—";
  return `<div class="last-card">
    <div class="title">Última fumigación del rango</div>
    <dl class="grid">
      <dt>Fecha</dt><dd>${escapeHtml(last.fumigation_date)}</dd>
      <dt>Hacienda</dt><dd>${escapeHtml(last.farm_name ?? "—")}</dd>
      <dt>Parcela</dt><dd>${escapeHtml(last.parcel_name)}</dd>
      <dt>Piloto</dt><dd>${escapeHtml(last.pilot_name ?? "—")}</dd>
      <dt>Dron</dt><dd>${escapeHtml(last.drone_nickname ?? "—")}</dd>
      <dt>Producto</dt><dd>${escapeHtml(last.product_used ?? "—")}</dd>
      <dt>Área fumigada</dt><dd>${area}</dd>
      <dt>Volumen aplicado</dt><dd>${volume}</dd>
    </dl>
  </div>`;
}

/**
 * Construye el HTML self-contained del reporte por hacienda.
 * El resultado se pasa a `page.setContent()` de Playwright.
 */
export function buildFarmsReportHtml(data: FarmsReportData): string {
  const title = data.farmName
    ? `Reporte por hacienda — ${data.farmName}`
    : "Reporte general — todas las haciendas";

  const fumigationRows = data.fumigations.map(renderFumigationRow).join("");
  const parcelRows = data.parcels.map(renderParcelRow).join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>${escapeHtml(data.operatorName)}</h1>
      <div class="meta">
        <span class="strong">${escapeHtml(title)}</span>
        · ${escapeHtml(data.operatorRegion)}
      </div>
      <div class="meta">
        Reporte generado el <span class="strong">${escapeHtml(data.generatedAt)}</span>
        · Ventana: <span class="strong">${escapeHtml(data.window.from)} → ${escapeHtml(data.window.to)}</span>
      </div>
    </div>

    <h2>Resumen</h2>
    <div class="summary">
      <div class="cell">
        <div class="label">Fumigaciones</div>
        <div class="value">${fmtInt(data.totals.nFumigations)}</div>
      </div>
      <div class="cell">
        <div class="label">Área total</div>
        <div class="value">${fmtNum(data.totals.totalAreaHa, 2)} ha</div>
      </div>
      <div class="cell">
        <div class="label">Volumen total</div>
        <div class="value">${fmtNum(data.totals.totalLiters, 2)} L</div>
      </div>
      <div class="cell">
        <div class="label">Parcelas activas</div>
        <div class="value">${fmtInt(data.totals.nParcels)}</div>
      </div>
    </div>

    ${renderLastCard(data.lastFumigation)}

    <h2>Por parcela (${data.totals.nParcels})</h2>
    ${
      data.parcels.length === 0
        ? `<div class="empty">Sin fumigaciones registradas en el rango.</div>`
        : `
        <table>
          <thead>
            <tr>
              <th>Parcela</th>
              <th>Hacienda</th>
              <th class="num">#</th>
              <th class="num">Área (ha)</th>
              <th class="num">Litros (L)</th>
              <th>Última</th>
            </tr>
          </thead>
          <tbody>
            ${parcelRows}
          </tbody>
        </table>
      `
    }

    <h2>Fumigaciones (${data.totals.nFumigations})</h2>
    ${
      data.fumigations.length === 0
        ? `<div class="empty">Sin fumigaciones registradas en el rango.</div>`
        : `
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Parcela</th>
              <th>Piloto</th>
              <th>Dron</th>
              <th class="num">Área</th>
              <th class="num">Volumen</th>
              <th>Producto</th>
            </tr>
          </thead>
          <tbody>
            ${fumigationRows}
          </tbody>
        </table>
        ${
          data.capReached
            ? `<div class="cap-warning">Mostrando las primeras ${data.fumigations.length} fumigaciones (cap de 200).</div>`
            : ""
        }
      `
    }

    <div class="footer">
      Reporte generado automáticamente por AeroAdmin AFM
      ${data.farmName ? `· Hacienda: ${escapeHtml(data.farmName)}` : "· Todas las haciendas"}
    </div>
  </div>
</body>
</html>`;
}
