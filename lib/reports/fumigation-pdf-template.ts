// lib/reports/fumigation-pdf-template.ts
//
// Template HTML para el reporte PDF de UNA fumigación individual.
// Función pura, self-contained, print-ready.
//
// Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-4.
//
// Decisiones:
//   - Mismo patrón que parcel-pdf-template.ts (HTML self-contained,
//     estilos inline, escape de user input).
//   - Más compacto: 1 fumigación, no necesita secciones largas.
//   - SIN imagen satelital (reuso del parcel report sería scope creep).
//     Si el operador quiere ver el mapa, lo ve en /fumigacion/[id].
//   - SIN SVG del polígono (idem).
//   - Tabla de vuelos asociados al final (si hay).

import type { FumigationReportData } from "./fumigation-csv";

function fmtNum(value: number | string | null, decimals: number): string {
  if (value === null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n);
}

function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  djiscraper: "DJI (scrape)",
  import: "Import GIS"
};

const SOURCE_COLOR: Record<string, string> = {
  manual: "#16847e",
  djiscraper: "#3f8f5d",
  import: "#a37200"
};

/**
 * Genera el HTML self-contained para el PDF. El caller (route handler)
 * lo pasa a Playwright `page.setContent()` + `page.pdf()`.
 */
export function buildFumigationPdfHtml(data: FumigationReportData): string {
  const f = data.fumigation;
  const p = data.parcel;
  const d = data.drone;
  const c = data.category;
  const sourceLabel = SOURCE_LABEL[f.source] ?? f.source;
  const sourceColor = SOURCE_COLOR[f.source] ?? "#333";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Fumigación #${f.id} — AFM</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 24px 32px;
    color: #1a1a1a;
    font-size: 11px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #555;
    border-bottom: 1px solid #ccc;
    padding-bottom: 4px;
    margin: 18px 0 8px;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #e5e5e5; }
  th { background: #f5f5f5; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: white; }
  .kv { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; }
  .kv dt { color: #777; font-size: 10px; }
  .kv dd { margin: 0; font-weight: 500; }
  .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 9px; color: #888; text-align: center; }
  .empty { padding: 12px; text-align: center; color: #999; font-style: italic; }
  .notes { white-space: pre-wrap; padding: 8px 12px; background: #f9f9f9; border-radius: 4px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Fumigación #${f.id}</h1>
      <div style="color:#555;font-size:11px;">
        ${escapeHtml(f.fumigation_date)} · ${escapeHtml(p?.land_name ?? `Parcela #${f.parcel_id}`)}
      </div>
    </div>
    <span class="badge" style="background:${sourceColor}">${escapeHtml(sourceLabel)}</span>
  </div>

  ${c ? `<p style="margin:8px 0 0;"><strong>Tipo:</strong> ${escapeHtml(c.label)}</p>` : ""}

  <h2>Aplicación</h2>
  <dl class="kv">
    <dt>Producto comercial</dt><dd>${escapeHtml(f.product_used)}</dd>
    <dt>Dosis</dt><dd>${f.dose_l_per_ha !== null ? `${fmtNum(f.dose_l_per_ha, 2)} L/ha` : "—"}</dd>
    <dt>Área fumigada</dt><dd>${f.area_fumigated_m2 !== null ? `${fmtNum(f.area_fumigated_m2 / 10000, 2)} ha` : "—"}</dd>
    <dt>Duración</dt><dd>${f.duration_minutes !== null ? `${f.duration_minutes} min` : "—"}</dd>
    <dt>Dron</dt><dd>${d ? `${escapeHtml(d.name)} (${d.tank_l} L)` : "Sin asignar"}</dd>
    <dt>Operador</dt><dd>${escapeHtml(f.recorded_by)}</dd>
  </dl>

  <h2>Compliance</h2>
  <dl class="kv">
    <dt>Registro ICA del producto</dt><dd>${escapeHtml(f.product_registered_ica) || "—"}</dd>
    <dt>Licencia del piloto (Aerocivil)</dt><dd>${escapeHtml(f.pilot_license) || "—"}</dd>
  </dl>

  <h2>Parcela</h2>
  <dl class="kv">
    <dt>ID de parcela</dt><dd>#${p?.id ?? f.parcel_id}</dd>
    <dt>Nombre del lote</dt><dd>${escapeHtml(p?.land_name) || "—"}</dd>
    <dt>External ID</dt><dd>${escapeHtml(p?.external_id) || "—"}</dd>
  </dl>

  <h2>${data.flights.length > 0 ? `Vuelos asociados (${data.flights.length})` : "Vuelos asociados"}</h2>
  ${
    data.flights.length === 0
      ? `<p class="empty">${f.source === "manual" ? "Fumigación manual — sin vuelos asociados (es normal)." : "No hay vuelos asociados en dji_flights."}</p>`
      : `<table>
          <thead>
            <tr>
              <th>Flight ID</th>
              <th>Inicio</th>
              <th>Piloto</th>
              <th>Dron</th>
              <th class="num">Área (ha)</th>
              <th class="num">Duración (min)</th>
              <th class="num">Volumen (L)</th>
            </tr>
          </thead>
          <tbody>
            ${data.flights
              .map(
                (fl) => `<tr>
                <td>#${fl.flight_id}</td>
                <td>${escapeHtml(fl.start_at)}</td>
                <td>${escapeHtml(fl.pilot_name) || "—"}</td>
                <td>${escapeHtml(fl.drone_nickname) || "—"}</td>
                <td class="num">${fl.area_m2 !== null ? fmtNum(Number(fl.area_m2) / 10000, 2) : "—"}</td>
                <td class="num">${fl.duration_min !== null ? fmtNum(fl.duration_min, 1) : "—"}</td>
                <td class="num">${fl.spray_usage_ml !== null ? fmtNum(fl.spray_usage_ml / 1000, 2) : "—"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`
  }

  <h2>Notas operativas</h2>
  ${
    f.human_notes
      ? `<div class="notes">${escapeHtml(f.human_notes)}</div>`
      : `<p class="empty">Sin notas del operador.</p>`
  }

  <div class="footer">
    Generado el ${escapeHtml(new Date().toISOString())} · AFM Geovisor · Fuente: ${escapeHtml(sourceLabel)}
  </div>
</body>
</html>`;
}
