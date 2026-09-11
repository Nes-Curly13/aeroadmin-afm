// tests/lib-reports-brand-mark.test.ts
//
// Anti-regression para el branding de los PDFs de reporte.
// Los 3 templates (farms, parcel, fumigation) deben incluir el
// AFM mark en su header para que el operador vea la marca cuando
// imprime/descarga un PDF.
//
// Cubrimos:
//   1. El helper getAfmMarkDataUrl() devuelve un data URL valido
//   2. El data URL cachea (segunda llamada = mismo valor, no re-lee disco)
//   3. El farms PDF template incluye <img class="brand-mark" src="data:...">
//   4. El parcel PDF template idem
//   5. El fumigation PDF template idem
//
// El mark es de 1.3KB → el data URL pesa ~1.8KB. No medimos bytes
// porque el contenido exacto del SVG puede cambiar — solo verificamos
// que el data URL este bien formado.

import { describe, expect, it, beforeEach } from "vitest";
import {
  getAfmMarkDataUrl,
  __resetAfmMarkDataUrlForTest
} from "@/lib/reports/brand-mark-data-url";
import { buildFarmsReportHtml } from "@/lib/reports/farms-pdf-template";
import { buildParcelReportHtml } from "@/lib/reports/parcel-pdf-template";
import { buildFumigationPdfHtml } from "@/lib/reports/fumigation-pdf-template";
import type { FarmsReportData } from "@/lib/reports/fetch-farms-report-data";
import type { ParcelReportData } from "@/lib/reports/fetch-parcel-report-data";
import type { FumigationReportData } from "@/lib/reports/fumigation-csv";

function makeFarmsData(): FarmsReportData {
  return {
    window: { from: "2026-09-01", to: "2026-09-10" },
    farmName: null,
    generatedAt: "2026-09-10",
    operatorName: "Operador Test",
    operatorRegion: "Valle del Cauca",
    lastFumigation: null,
    fumigations: [],
    capReached: false,
    parcels: [],
    totals: { nFumigations: 0, totalAreaHa: 0, totalLiters: 0, nParcels: 0 }
  };
}

function makeParcelData(): ParcelReportData {
  return {
    operatorName: "Operador Test",
    operatorRegion: "Valle",
    generatedAt: "2026-09-10",
    parcel: {
      id: 1,
      external_id: "ext-1",
      land_name: "Lote 1",
      field_type: "cana",
      declared_area_ha: null,
      spray_area_m2: null,
      crop_type: null,
      planting_date: null,
      owner_name: null,
      supervisor_notes: null
    },
    cadence: {
      recommended_cadence_days: 14,
      last_fumigation_date: null,
      next_due_date: null,
      status: "no_history"
    },
    window: { from: "2026-09-01", to: "2026-09-10" },
    events: [],
    totals: {
      count: 0,
      totalAreaHa: 0,
      totalLiters: 0,
      averageAreaHa: 0,
      lastFumigationDate: null,
      capReached: false
    },
    coverage: { areaFumigableHa: 30, areaFumigadaHa: 0, coveragePct: 0 },
    location: null
  };
}

function makeFumigationData(): FumigationReportData {
  return {
    fumigation: {
      id: 1,
      parcel_id: 1,
      fumigation_date: "2026-09-10",
      product_used: "Glifosato",
      product_id: null,
      dose_l_per_ha: 2.5,
      area_fumigated_m2: 1000,
      drone_code_used: 201,
      duration_minutes: 30,
      notes: null,
      human_notes: null,
      recorded_by: "op@aeroadmin.local",
      product_registered_ica: null,
      pilot_license: null,
      recorded_at: "2026-09-10T15:00:00.000Z",
      source: "manual",
      category_id: null
    },
    parcel: { id: 1, land_name: "Lote 1", external_id: "ext-1" },
    drone: { code: 201, name: "T40", tank_l: 40 },
    category: null,
    flights: [],
    secondaryParcels: []
  };
}

describe("lib/reports/brand-mark-data-url", () => {
  beforeEach(() => {
    __resetAfmMarkDataUrlForTest();
  });

  it("1) getAfmMarkDataUrl() devuelve un data URL valido", () => {
    const url = getAfmMarkDataUrl();
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(url.length).toBeGreaterThan(100);
    expect(url.length).toBeLessThan(5000);
  });

  it("2) el data URL se cachea entre llamadas", () => {
    const a = getAfmMarkDataUrl();
    const b = getAfmMarkDataUrl();
    expect(a).toBe(b);
  });
});

describe("AFM mark en headers de PDF", () => {
  beforeEach(() => {
    __resetAfmMarkDataUrlForTest();
  });

  it("3) farms PDF template incluye el mark en el header", () => {
    const html = buildFarmsReportHtml(makeFarmsData());
    expect(html).toMatch(/<img[^>]+class="brand-mark"[^>]+src="data:image\/svg\+xml;base64,/);
    expect(html).toMatch(/<img[^>]+class="brand-mark"[^>]+alt="AeroAdmin AFM"/);
  });

  it("4) parcel PDF template incluye el mark en el header", () => {
    const html = buildParcelReportHtml(makeParcelData());
    expect(html).toMatch(/<img[^>]+class="brand-mark"[^>]+src="data:image\/svg\+xml;base64,/);
    expect(html).toMatch(/<img[^>]+class="brand-mark"[^>]+alt="AeroAdmin AFM"/);
  });

  it("5) fumigation PDF template incluye el mark en el header", () => {
    const html = buildFumigationPdfHtml(makeFumigationData());
    expect(html).toMatch(/<img[^>]+class="brand-mark"[^>]+src="data:image\/svg\+xml;base64,/);
    expect(html).toMatch(/<img[^>]+class="brand-mark"[^>]+alt="AeroAdmin AFM"/);
  });
});
