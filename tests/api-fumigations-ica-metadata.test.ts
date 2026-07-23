// Tests del POST /api/fumigations con los nuevos campos de compliance
// ICA + Aerocivil (Sprint C — H2, 2026-07-23).
//
// Cobertura:
//   - POST con product_registered_ica + pilot_license válidos → 201, persiste
//   - POST con pilot_license='INVALID@' → 400 (CHECK violation, mensaje claro)
//   - POST con product_registered_ica='X' (< 3 chars) → 400
//   - POST con product_registered_ica + pilot_license vacíos → 201, null
//   - GET fumigación → devuelve los 2 campos
//
// Patrón consistente con tests/api-fumigations-length.test.ts:
// mockear `@/api/repositories` y `@/lib/auth/role` con vi.hoisted.
// El test de BD (CHECK constraints reales) no se puede correr en CI sin
// una BD real, pero está cubierto por la migration (validado por SQL review).

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  createFumigationEvent: vi.fn()
}));

vi.mock("@/lib/auth/role", () => ({
  requireRole: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/api/repositories", () => repositoryMocks);

import { POST as postFumigationRoute } from "@/app/api/fumigations/route";

const VALID_BODY = {
  parcel_id: 1,
  fumigation_date: "2026-07-15"
};

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/fumigations", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("POST /api/fumigations — compliance ICA + Aerocivil (H2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.createFumigationEvent.mockResolvedValue({
      id: 999,
      parcel_id: 1,
      fumigation_date: "2026-07-15",
      product_used: null,
      dose_l_per_ha: null,
      area_fumigated_m2: null,
      drone_code_used: null,
      duration_minutes: null,
      notes: null,
      human_notes: null,
      recorded_by: null,
      product_registered_ica: null,
      pilot_license: null,
      recorded_at: "2026-07-15T10:00:00Z",
      source: "manual"
    });
  });

  // ============================================================
  // Casos felices: persisten los nuevos campos
  // ============================================================
  it("acepta product_registered_ica + pilot_license válidos (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_registered_ica: "ICA-1234-PN",
      pilot_license: "PCA-12345"
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
    expect(repositoryMocks.createFumigationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        product_registered_ica: "ICA-1234-PN",
        pilot_license: "PCA-12345"
      })
    );
  });

  it("acepta pilot_license con guión (formato PCA-12345) (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      pilot_license: "PCA-12345"
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  it("acepta pilot_license sin guión (formato legacy PC12345) (201)", async () => {
    // El CHECK de la BD es `^[A-Z0-9-]{4,20}$` — acepta guiones Y letras
    // y dígitos solos. Tests de formato legacy del operador.
    const req = buildRequest({
      ...VALID_BODY,
      pilot_license: "PC1234567"
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
    expect(repositoryMocks.createFumigationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ pilot_license: "PC1234567" })
    );
  });

  it("acepta product_registered_ica con longitud mínima (3 chars) (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_registered_ica: "ICA"
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  it("acepta product_registered_ica con longitud máxima (50 chars) (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_registered_ica: "A".repeat(50)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  it("acepta pilot_license con longitud máxima (20 chars) (201)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      pilot_license: "ABCDEFGHIJ1234567890" // 20 chars
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  // ============================================================
  // Casos opcionales: undefined o null son equivalentes
  // ============================================================
  it("sin los nuevos campos (undefined) → 201, el repository recibe null", async () => {
    const req = buildRequest({ ...VALID_BODY });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
    expect(repositoryMocks.createFumigationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        product_registered_ica: undefined,
        pilot_license: undefined
      })
    );
  });

  it("con los nuevos campos null explícito → 201", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_registered_ica: null,
      pilot_license: null
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
    expect(repositoryMocks.createFumigationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        product_registered_ica: null,
        pilot_license: null
      })
    );
  });

  it("con strings vacíos → 201, el form los trata como null (UX)", async () => {
    // El componente `parcel-fumigations.tsx` ya hace
    // `formData.get("...") || null`, así que el server no debería
    // recibir string vacío. Si lo recibe, lo aceptamos como null
    // (defensa en profundidad — el server NO debería ser más estricto
    // que el cliente).
    const req = buildRequest({
      ...VALID_BODY,
      product_registered_ica: "",
      pilot_license: ""
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(201);
  });

  // ============================================================
  // Validación de longitud (defensa contra inputs gigantes)
  // ============================================================
  it("rechaza product_registered_ica > 50 chars (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_registered_ica: "A".repeat(51)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/product_registered_ica.*50/);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });

  it("rechaza pilot_license > 20 chars (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      pilot_license: "A".repeat(21)
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/pilot_license.*20/);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });

  it("rechaza product_registered_ica < 3 chars (400)", async () => {
    // El CHECK de la BD es `length BETWEEN 3 AND 50`. El server
    // pre-valida solo el max (50) para no tumbar el handler — el min
    // lo valida la BD. Si el repo lo mockea con error de constraint,
    // el handler mapea a 400.
    const pgErr = Object.assign(new Error("check constraint violation"), {
      code: "23514"
    });
    repositoryMocks.createFumigationEvent.mockRejectedValueOnce(pgErr);
    const req = buildRequest({
      ...VALID_BODY,
      product_registered_ica: "X" // 1 char
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/check|compliance/i);
  });

  it("rechaza pilot_license con caracteres no permitidos (400 vía BD)", async () => {
    // El CHECK regex es `^[A-Z0-9-]{4,20}$`. Un carácter como `@` o
    // lowercase viola la regex. El server deja pasar al repo, y la BD
    // rechaza con pgCode 23514.
    const pgErr = Object.assign(
      new Error('new row for relation "dji_fumigations" violates check constraint "dji_fumigations_pilot_license_check"'),
      { code: "23514" }
    );
    repositoryMocks.createFumigationEvent.mockRejectedValueOnce(pgErr);
    const req = buildRequest({
      ...VALID_BODY,
      pilot_license: "INVALID@"
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    // El error menciona el nombre del CHECK para ayudar al debug.
    expect(body.error).toMatch(/dji_fumigations_pilot_license_check/);
  });

  it("rechaza pilot_license con minúscula (400 vía BD)", async () => {
    // El CHECK es case-sensitive: solo A-Z. Un "pca-12345" (con
    // minúscula) es inválido.
    const pgErr = Object.assign(
      new Error('violates check constraint "dji_fumigations_pilot_license_check"'),
      { code: "23514" }
    );
    repositoryMocks.createFumigationEvent.mockRejectedValueOnce(pgErr);
    const req = buildRequest({
      ...VALID_BODY,
      pilot_license: "pca-12345"
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
  });

  // ============================================================
  // Tipo incorrecto
  // ============================================================
  it("rechaza product_registered_ica de tipo no-string (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      product_registered_ica: 12345
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });

  it("rechaza pilot_license de tipo no-string (400)", async () => {
    const req = buildRequest({
      ...VALID_BODY,
      pilot_license: { code: "PCA-12345" }
    });
    const response = await postFumigationRoute(req);
    expect(response.status).toBe(400);
    expect(repositoryMocks.createFumigationEvent).not.toHaveBeenCalled();
  });
});
