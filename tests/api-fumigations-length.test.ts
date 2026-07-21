// Tests de validación de longitud de inputs en POST /api/fumigations.
//
// Por que este test existe (sprint Q4 / track C, mejora 3):
//   - El handler POST /api/fumigations no validaba longitud de
//     `product_used`, `notes` ni `recorded_by`. Un usuario que pega
//     un dump de 1GB en `notes` rompe la BD (la columna `notes` es
//     `text` sin límite, pero el body parsing + JSON serialization
//     revientan antes de llegar ahí en casos extremos).
//   - Contrato: max 200 chars para product_used, max 2000 para notes,
//     max 100 para recorded_by (alineado con la convención de otros
//     handlers del proyecto: PUT /api/parcels/[id] usa 200 para
//     land_name, 64 para field_type).
//   - La validación es del SERVER, no del cliente. El `maxLength` en
//     el form es solo UX (el browser bloquea tipeo extra), la
//     defensa real es el 400 del server.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  createFumigationEvent: vi.fn()
}));

vi.mock("@/api/repositories", () => repositoryMocks);

import { POST as postFumigationRoute } from "@/app/api/fumigations/route";

const VALID_BODY = {
  parcel_id: 1,
  fumigation_date: "2026-07-15",
  product_used: "Glifosato 1L/ha",
  notes: "OK",
  recorded_by: "Juan Pérez"
};

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/fumigations", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("POST /api/fumigations — validación de longitud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.createFumigationEvent.mockResolvedValue({
      id: 999,
      ...VALID_BODY
    });
  });

  // ============================================================
  // product_used — max 200 chars
  // ============================================================
  it("rechaza product_used > 200 chars (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_used: "x".repeat(201)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/product_used.*200/);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });

  it("acepta product_used con exactamente 200 chars (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_used: "x".repeat(200)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  // ============================================================
  // notes — max 2000 chars
  // ============================================================
  it("rechaza notes > 2000 chars (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      notes: "n".repeat(2001)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/notes.*2000/);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });

  it("acepta notes con exactamente 2000 chars (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      notes: "n".repeat(2000)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  // ============================================================
  // recorded_by — max 100 chars
  // ============================================================
  it("rechaza recorded_by > 100 chars (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      recorded_by: "o".repeat(101)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/recorded_by.*100/);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });

  it("acepta recorded_by con exactamente 100 chars (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      recorded_by: "o".repeat(100)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  // ============================================================
  // Casos límite: campos opcionales omitidos o null
  // ============================================================
  it("acepta body sin los campos opcionales (201)", async () => {
    const req = buildRequest({
      parcel_id: 1,
      fumigation_date: "2026-07-15"
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  it("acepta null en los campos opcionales (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_used: null,
      notes: null,
      recorded_by: null
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  // ============================================================
  // Tipo incorrecto: el handler debe rechazar antes de medir longitud
  // ============================================================
  it("rechaza product_used de tipo no-string (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_used: 12345
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });

  // ============================================================
  // human_notes — Track C v1.4 (audit ui-ux-2026-07 #11)
  // Separado de `notes` (que es provenance del backfill) para que el
  // operador fumigador pueda dejar contexto libre sin pisar metadata
  // técnica. Mismo límite de 2000 chars (alineado con CHECK del schema
  // `20260721010000_add_fumigation_human_notes.sql`).
  // ============================================================
  it("rechaza human_notes > 2000 chars (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      human_notes: "h".repeat(2001)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/human_notes.*2000/);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });

  it("acepta human_notes con exactamente 2000 chars (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      human_notes: "h".repeat(2000)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  it("acepta human_notes null y lo pasa al repository como null", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      human_notes: null
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
    expect(repositoryMocks.createFumigationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ human_notes: null })
    );
  });

  it("pasa human_notes al repository cuando está presente", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      human_notes: "Lluvia matinal retrasó el vuelo"
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
    expect(repositoryMocks.createFumigationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        human_notes: "Lluvia matinal retrasó el vuelo"
      })
    );
  });

  it("rechaza human_notes de tipo no-string (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      human_notes: 12345
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });

  it("human_notes es independiente de notes (provenance) — ambos pueden coexistir", async () => {
    // Regresión: la nota humana no debe pisar la metadata técnica.
    // El body puede traer ambos campos con valores distintos.
    const req = buildRequest({
      ...VALID_BODY,
      notes: JSON.stringify({ backfilled_from: "dji_flights" }),
      human_notes: "Contexto del operador"
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
    expect(repositoryMocks.createFumigationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: JSON.stringify({ backfilled_from: "dji_flights" }),
        human_notes: "Contexto del operador"
      })
    );
  });
});
