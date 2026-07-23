// lib/reports/parcel-pdf-template.ts
//
// Template HTML para el reporte PDF de una parcela. Función pura:
//   - Recibe ParcelReportData
//   - Devuelve un string HTML self-contained (con estilos inline)
//
// Decisiones (Sprint B — F1.11):
//   - **HTML self-contained, no React.** El PDF lo renderiza Playwright
//     sobre `page.setContent(html)` — no queremos hydration ni CSR.
//     inline styles porque la hoja de estilos del bundle de Next no
//     aplica acá.
//   - **Estilos pensados para print.** Tamaño A4, márgenes de 1.5cm,
//     tabla con `border-collapse: collapse`, fuentes web-safe. El
//     `print-color-adjust: exact` fuerza a Chrome a respetar los
//     colores de fondo de las celdas de status (sin esto, el badge
//     🟢/🟡/🔴 sale en blanco y negro en el PDF).
//   - **Header fijo arriba.** El operador lo ve apenas abre el PDF.
//     Si el reporte se imprime, el header no se repite (eso requeriría
//     `@page` rules + `position: running()` — fuera de scope).
//   - **Total al final.** El "Total" y la "Cobertura del mes" se
//     renderizan DESPUÉS de la tabla para que sea lo último que el
//     operador lee (el patrón estándar de reportes operativos).
//   - **Status visual** (🟢/🟡/🔴) en la card de cadencia Y en la
//     tabla. Decisión del PO: el operador fumigador necesita el
//     "semáforo" a simple vista, no quiere leer "due_soon".
//   - **Escape de strings del usuario.** `land_name`, `owner_name`,
//     `supervisor_notes`, `notes` de fumigación, etc. — todos pasan
//     por `escapeHtml()` para evitar injection (el PDF lo renderiza
//     un browser real, no un parser permisivo).
//
// Out of scope:
//   - Logo del operador (no hay asset todavía — el cliente lo manda
//     en otro sprint).
//   - Multi-idioma (es-CO es el idioma de la operación).
//   - QR de verificación (un "verificá este PDF en /parcels/[id]" —
//     feature de export de auditoría, scope separado).

import type { CadenceStatus, ParcelReportData, ParcelReportEvent } from "./fetch-parcel-report-data";

/** Formato es-CO para números (separador de miles con punto, decimales con coma). */
function fmtNum(value: number, decimals: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

/** Escapa caracteres peligrosos para inyectar HTML. */
function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Mapea el status de cadencia a un emoji + label humano. */
function statusVisual(status: CadenceStatus): { emoji: string; label: string; color: string } {
  switch (status) {
    case "ok":
      return { emoji: "🟢", label: "Al día", color: "#0b5f2d" };
    case "due_soon":
      return { emoji: "🟡", label: "Por vencer", color: "#a37200" };
    case "overdue":
      return { emoji: "🔴", label: "Vencida", color: "#a93232" };
    case "no_history":
    default:
      return { emoji: "⚪", label: "Sin historial", color: "#587064" };
  }
}

/** Render de una fila de la tabla de fumigaciones. */
function renderEventRow(e: ParcelReportEvent): string {
  const area = e.area_fumigated_ha === null ? "—" : `${fmtNum(e.area_fumigated_ha, 2)} ha`;
  const duration = e.duration_minutes === null ? "—" : `${e.duration_minutes} min`;
  const volume =
    e.dose_l_per_ha !== null && e.area_fumigated_ha !== null
      ? `${fmtNum(e.dose_l_per_ha * e.area_fumigated_ha, 2)} L`
      : "—";
  return `<tr>
    <td style="padding:6px 8px;border-bottom:1px solid #e3e8e3;font-variant-numeric:tabular-nums;">${escapeHtml(e.fumigation_date)}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e3e8e3;">${escapeHtml(e.drone_nickname ?? "—")}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e3e8e3;">${escapeHtml(e.pilot_name ?? e.recorded_by ?? "—")}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e3e8e3;text-align:right;font-variant-numeric:tabular-nums;">${area}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e3e8e3;text-align:right;font-variant-numeric:tabular-nums;">${duration}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e3e8e3;text-align:right;font-variant-numeric:tabular-nums;">${volume}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e3e8e3;">${escapeHtml(e.product_used ?? "—")}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e3e8e3;color:#4a5b50;">${escapeHtml(e.notes ?? "")}</td>
  </tr>`;
}

/** Estilos CSS del PDF (todo inline porque la página no carga Tailwind). */
const STYLES = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 11px;
    color: #1c2a23;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { padding: 18mm 14mm; }
  h1 { font-size: 18px; margin: 0 0 4px 0; color: #0b5f2d; }
  h2 { font-size: 13px; margin: 16px 0 8px 0; color: #0b5f2d; text-transform: uppercase; letter-spacing: 0.06em; }
  .header { border-bottom: 2px solid #0b5f2d; padding-bottom: 10px; margin-bottom: 14px; }
  .header .meta { font-size: 10px; color: #587064; }
  .header .meta .strong { color: #1c2a23; font-weight: 600; }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 11px; }
  .kv dt { color: #587064; font-weight: 500; }
  .kv dd { margin: 0; color: #1c2a23; }
  .card {
    border: 1px solid #d2ddd6;
    border-radius: 6px;
    padding: 10px 12px;
    background: #f7f9fb;
    margin-bottom: 12px;
  }
  .card .status-line { font-size: 14px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th {
    text-align: left;
    padding: 6px 8px;
    background: #0b5f2d;
    color: #ffffff;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 9.5px;
    letter-spacing: 0.04em;
  }
  th.num, td.num { text-align: right; }
  .totals { margin-top: 10px; font-size: 11px; }
  .totals .row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dotted #d2ddd6; }
  .totals .row .label { color: #587064; }
  .totals .row .value { font-weight: 600; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 18px; font-size: 9px; color: #587064; text-align: center; border-top: 1px solid #d2ddd6; padding-top: 8px; }
  .empty { color: #587064; font-style: italic; padding: 8px 0; }
  .cap-warning { color: #a37200; font-size: 10px; margin-top: 4px; }
`;

/**
 * Construye el HTML self-contained del reporte de una parcela.
 * El resultado se pasa a `page.setContent()` de Playwright.
 */
export function buildParcelReportHtml(data: ParcelReportData): string {
  const status = statusVisual(data.cadence.status);

  const parcelFields: Array<[string, string | null | undefined]> = [
    ["ID interno", String(data.parcel.id)],
    ["ID externo", data.parcel.external_id],
    ["Nombre", data.parcel.land_name],
    ["Tipo", data.parcel.field_type],
    ["Área declarada", data.parcel.declared_area_ha === null ? null : `${fmtNum(data.parcel.declared_area_ha, 2)} ha`],
    ["Área fumigable", data.parcel.spray_area_m2 === null ? null : `${fmtNum(data.parcel.spray_area_m2 / 10000, 2)} ha`],
    ["Cultivo", data.parcel.crop_type],
    ["Fecha de siembra", data.parcel.planting_date],
    ["Propietario", data.parcel.owner_name]
  ];

  const eventRows = data.events.map(renderEventRow).join("");

  const totalsRows = [
    ["Fumigaciones en el rango", String(data.totals.count)],
    ["Área fumigada total", `${fmtNum(data.totals.totalAreaHa, 2)} ha`],
    ["Volumen aplicado total", `${fmtNum(data.totals.totalLiters, 2)} L`],
    [
      "Área promedio por fumigación",
      data.totals.count > 0 ? `${fmtNum(data.totals.averageAreaHa, 2)} ha` : "—"
    ],
    [
      "Última fumigación",
      data.totals.lastFumigationDate ?? "—"
    ],
    [
      "Cobertura del mes",
      data.coverage.coveragePct === null
        ? "—"
        : `${fmtNum(data.coverage.areaFumigadaHa, 2)} ha de ${fmtNum(data.coverage.areaFumigableHa ?? 0, 2)} ha (${fmtNum(data.coverage.coveragePct, 1)}%)`
    ]
  ];

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Reporte de parcela — ${escapeHtml(data.parcel.land_name ?? data.parcel.external_id)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>${escapeHtml(data.operatorName)}</h1>
      <div class="meta">
        <span class="strong">${escapeHtml(data.parcel.land_name ?? data.parcel.external_id)}</span>
        · ${escapeHtml(data.parcel.field_type ?? "—")}
        · ${escapeHtml(data.operatorRegion)}
      </div>
      <div class="meta">
        Reporte generado el <span class="strong">${escapeHtml(data.generatedAt)}</span>
        · Ventana: <span class="strong">${escapeHtml(data.window.from)} → ${escapeHtml(data.window.to)}</span>
      </div>
    </div>

    <h2>Resumen</h2>
    <div class="card">
      <div class="status-line" style="color:${status.color};">
        ${status.emoji} Cadencia: ${escapeHtml(status.label)}
        ${
          data.cadence.recommended_cadence_days !== null
            ? `· ${data.cadence.recommended_cadence_days} días`
            : ""
        }
      </div>
      <dl class="kv" style="margin-top:8px;">
        ${parcelFields
          .map(
            ([k, v]) =>
              `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v ?? "—")}</dd>`
          )
          .join("")}
      </dl>
      ${
        data.parcel.supervisor_notes
          ? `<div style="margin-top:8px;font-size:10.5px;color:#4a5b50;"><strong>Notas del supervisor:</strong> ${escapeHtml(data.parcel.supervisor_notes)}</div>`
          : ""
      }
    </div>

    <h2>Fumigaciones (${data.totals.count})</h2>
    ${
      data.events.length === 0
        ? `<div class="empty">Sin fumigaciones registradas en el rango.</div>`
        : `
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Dron</th>
              <th>Piloto</th>
              <th class="num">Área</th>
              <th class="num">Duración</th>
              <th class="num">Volumen</th>
              <th>Producto</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            ${eventRows}
          </tbody>
        </table>
        ${
          data.totals.capReached
            ? `<div class="cap-warning">Mostrando las primeras ${data.events.length} fumigaciones. Total real: ${data.totals.count}.</div>`
            : ""
        }
      `
    }

    <h2>Total</h2>
    <div class="totals">
      ${totalsRows
        .map(
          ([label, value]) =>
            `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`
        )
        .join("")}
    </div>

    <div class="footer">
      Reporte generado automáticamente por AeroAdmin AFM · Parcela #${data.parcel.id}
    </div>
  </div>
</body>
</html>`;
}
