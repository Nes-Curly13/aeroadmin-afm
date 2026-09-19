// tests/components/geovisor/parcel-panel.test.tsx
//
// Panel de datos de parcela del geovisor (opción A, 2026-09-19).
//
// Regresión clave: `last_fumigation_at` llega como objeto `Date` (pg
// serializa las columnas `date` como Date vía RSC), no como string.
// El primer build crasheaba con `v.match is not a function` porque el
// formateador asumía string. Este test fija ese contrato.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParcelPanel } from "@/components/geovisor/parcel-panel";
import type { GeovisorPayload } from "@/lib/types";

type P = GeovisorPayload["parcels"][number];

const base = {
  id: "1086",
  name: "Borinquen · 02",
  farm_name: "Borinquen",
  client_name: "Sin asignar",
  municipality: "Sin asignar",
  variety: "CC 05-430",
  area_ha: 3.9,
  drone_model_id: 72,
  centroid_lng: -76.1,
  centroid_lat: 4.24,
  geom: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  status: "ok",
  last_fumigation_at: null,
  next_due_at: null,
  cadence_days: 14,
  fumigations_count: 0,
  dji_land_id: "0050002",
  planting_date: "2019-10-11",
  shape_attrs: {
    TENENCIA: "PR",
    Topografia: "PLA",
    NC: 6,
    Edad: 9.31,
    Sacarosa: 12.3,
    "ULT.TCH": 142.88,
    DISTANCIA: 10,
    "Z.AGRO": "2C0",
    "F.SIEMBRA": "11/10/2019 12:00?AM",
    "F.COSECHA": "31/01/2025 12:00?AM"
  }
} as unknown as P;

describe("ParcelPanel", () => {
  it("renderiza identificación, agronomía y operación", () => {
    render(<ParcelPanel parcel={base} />);
    expect(screen.getByText("Borinquen · 02")).toBeDefined();
    expect(screen.getByText("3,90 ha")).toBeDefined();
    expect(screen.getByText("CC 05-430")).toBeDefined();
    // mapeos de códigos del shape
    expect(screen.getByText("Propia")).toBeDefined();
    expect(screen.getByText("Plana")).toBeDefined();
    // fechas y números formateados
    expect(screen.getByText("11/10/2019")).toBeDefined();
    expect(screen.getByText("142,88")).toBeDefined();
    expect(screen.getByText("6")).toBeDefined();
  });

  it("no rompe si last_fumigation_at viene como Date (regresión)", () => {
    const withDate = {
      ...base,
      last_fumigation_at: new Date(2026, 2, 10)
    } as unknown as P;
    render(<ParcelPanel parcel={withDate} />);
    expect(screen.getByText("10/03/2026")).toBeDefined();
  });

  it("degrada a '—' sin shape_attrs ni fumigaciones", () => {
    const bare = {
      ...base,
      shape_attrs: null,
      planting_date: null,
      last_fumigation_at: null,
      variety: "Sin asignar"
    } as unknown as P;
    render(<ParcelPanel parcel={bare} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(3);
  });
});
