/**
 * tests/api-repositories-s7-extensions.test.ts
 *
 * Test unitario de los helpers del sprint S7 (feature/s7-schema-extension
 * / Fase 0):
 *   - getApplicationTypes
 *   - findDjiVehicleByPlate
 *   - createDjiVehicle
 *   - listFumigationInvoices
 *   - createFumigationInvoice
 *   - cancelFumigationInvoice
 *
 * Sprint: feature/s7-schema-extension (2026-08-24) / Fase 0.
 *
 * Cubre:
 *   - getApplicationTypes: devuelve rows ordenados por sort_order
 *   - findDjiVehicleByPlate: match case-insensitive, null si no existe
 *   - createDjiVehicle: INSERT + return row, normalize plate a UPPER
 *   - listFumigationInvoices: valida fumigationId > 0, normaliza invoiced_at
 *   - listFumigationInvoices: devuelve [] si no hay facturas
 *   - createFumigationInvoice: validación de inputs (4 ramas de error)
 *   - createFumigationInvoice: INSERT + return row
 *   - cancelFumigationInvoice: UPDATE si no estaba cancelada
 *   - cancelFumigationInvoice: no-op si ya estaba cancelada (idempotente)
 *   - cancelFumigationInvoice: null si no existe
 *
 * Mockeamos `getDb` (de @/lib/db) para no tocar la BD real. Mismo patrón
 * que `tests/api-repositories-fumigation-audit.test.ts`.
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockQuery = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    query: (...args: unknown[]) => mockQuery(...args)
  })
}));

vi.mock("@/lib/cache", () => ({
  invalidateAfterFumigationMutation: () => mockInvalidate()
}));

const repos = await import("@/api/repositories");
const {
  getApplicationTypes,
  findDjiVehicleByPlate,
  createDjiVehicle,
  listFumigationInvoices,
  createFumigationInvoice,
  cancelFumigationInvoice
} = repos;

// ============================================================
// Helpers
// ============================================================

beforeEach(() => {
  mockQuery.mockReset();
  mockInvalidate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// getApplicationTypes
// ============================================================

describe("getApplicationTypes", () => {
  it("devuelve el catálogo de application_types ordenado por sort_order", async () => {
    const rows = [
      { id: 1, slug: "pre_emergente", label: "Pre emergente", color: "amber", sort_order: 10, is_active: true },
      { id: 2, slug: "post_emergente", label: "Post emergente", color: "orange", sort_order: 20, is_active: true },
      { id: 3, slug: "bioestimulante", label: "Bioestimulante", color: "green", sort_order: 30, is_active: true }
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const out = await getApplicationTypes();

    expect(out).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM application_types")
    );
  });

  it("devuelve [] si la query devuelve []", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getApplicationTypes()).toEqual([]);
  });
});

// ============================================================
// findDjiVehicleByPlate
// ============================================================

describe("findDjiVehicleByPlate", () => {
  it("devuelve el row si la placa existe (case-insensitive)", async () => {
    const row = {
      id: 7,
      plate: "ABC-123",
      description: "Toyota Hilux",
      is_active: true,
      created_at: "2026-08-24T10:00:00.000Z"
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const out = await findDjiVehicleByPlate("abc-123");

    expect(out).toEqual(row);
    // Verifica que el query usa UPPER() y la versión normalizada del input.
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPPER(plate) = UPPER($1)"),
      ["abc-123"]
    );
  });

  it("devuelve null si no hay match", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await findDjiVehicleByPlate("XYZ-999")).toBeNull();
  });
});

// ============================================================
// createDjiVehicle
// ============================================================

describe("createDjiVehicle", () => {
  it("inserta el vehículo y normaliza la placa a UPPER", async () => {
    const inserted = {
      id: 12,
      plate: "ABC-123",
      description: "Toyota Hilux blanca",
      is_active: true,
      created_at: "2026-08-24T11:00:00.000Z"
    };
    mockQuery.mockResolvedValueOnce({ rows: [inserted] });

    const out = await createDjiVehicle({
      plate: "abc-123",
      description: "Toyota Hilux blanca"
    });

    expect(out).toEqual(inserted);
    // El INSERT debe usar UPPER($1) — la BD lo enforza, pero
    // el server normaliza el trim() antes.
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (UPPER($1)"),
      ["abc-123", "Toyota Hilux blanca"]
    );
  });

  it("acepta description null", async () => {
    const inserted = {
      id: 13,
      plate: "DEF-456",
      description: null,
      is_active: true,
      created_at: "2026-08-24T11:01:00.000Z"
    };
    mockQuery.mockResolvedValueOnce({ rows: [inserted] });

    const out = await createDjiVehicle({ plate: "def-456" });

    expect(out).toEqual(inserted);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      ["def-456", null]
    );
  });
});

// ============================================================
// listFumigationInvoices
// ============================================================

describe("listFumigationInvoices", () => {
  it("tira error si fumigationId no es entero positivo", async () => {
    await expect(listFumigationInvoices(0)).rejects.toThrow(
      /fumigationId requerido/
    );
    await expect(listFumigationInvoices(-1)).rejects.toThrow(
      /fumigationId requerido/
    );
    await expect(listFumigationInvoices(1.5)).rejects.toThrow(
      /fumigationId requerido/
    );
  });

  it("devuelve las facturas con invoiced_at normalizado a YYYY-MM-DD", async () => {
    const rows = [
      {
        id: 1,
        fumigation_id: 100,
        invoice_number: "FVE-2051",
        invoiced_at: new Date("2026-07-15T00:00:00.000Z"), // pg devuelve Date
        amount_cop: "1500000.00",
        cancelled: false,
        cancelled_at: null,
        cancelled_by: null,
        created_at: "2026-08-24T10:00:00.000Z",
        updated_at: "2026-08-24T10:00:00.000Z"
      }
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const out = await listFumigationInvoices(100);

    expect(out).toHaveLength(1);
    expect(out[0].invoiced_at).toBe("2026-07-15");
  });

  it("devuelve [] si no hay facturas", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await listFumigationInvoices(100)).toEqual([]);
  });
});

// ============================================================
// createFumigationInvoice
// ============================================================

describe("createFumigationInvoice", () => {
  const validInput = {
    fumigation_id: 100,
    invoice_number: "FVE-2051",
    invoiced_at: "2026-07-15",
    amount_cop: 1500000
  };

  it("inserta la factura y normaliza invoiced_at", async () => {
    const inserted = {
      id: 1,
      fumigation_id: 100,
      invoice_number: "FVE-2051",
      invoiced_at: new Date("2026-07-15T00:00:00.000Z"),
      amount_cop: "1500000.00",
      cancelled: false,
      cancelled_at: null,
      cancelled_by: null,
      created_at: "2026-08-24T10:00:00.000Z",
      updated_at: "2026-08-24T10:00:00.000Z"
    };
    mockQuery.mockResolvedValueOnce({ rows: [inserted] });

    const out = await createFumigationInvoice(validInput);

    expect(out.invoiced_at).toBe("2026-07-15");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO fumigation_invoices"),
      [100, "FVE-2051", "2026-07-15", 1500000]
    );
  });

  it("rechaza fumigation_id inválido", async () => {
    await expect(
      createFumigationInvoice({ ...validInput, fumigation_id: 0 })
    ).rejects.toThrow(/fumigation_id inválido/);
    await expect(
      createFumigationInvoice({ ...validInput, fumigation_id: -5 })
    ).rejects.toThrow(/fumigation_id inválido/);
  });

  it("rechaza invoice_number vacío o > 50 chars", async () => {
    await expect(
      createFumigationInvoice({ ...validInput, invoice_number: "" })
    ).rejects.toThrow(/invoice_number requerido/);
    await expect(
      createFumigationInvoice({
        ...validInput,
        invoice_number: "X".repeat(51)
      })
    ).rejects.toThrow(/invoice_number max 50/);
  });

  it("rechaza amount_cop < 0", async () => {
    await expect(
      createFumigationInvoice({ ...validInput, amount_cop: -100 })
    ).rejects.toThrow(/amount_cop debe ser >= 0/);
  });

  it("rechaza invoiced_at con formato inválido", async () => {
    await expect(
      createFumigationInvoice({ ...validInput, invoiced_at: "2026/07/15" })
    ).rejects.toThrow(/invoiced_at debe ser YYYY-MM-DD/);
  });
});

// ============================================================
// cancelFumigationInvoice
// ============================================================

describe("cancelFumigationInvoice", () => {
  it("tira error si id no es entero positivo o cancelledBy vacío", async () => {
    await expect(cancelFumigationInvoice(0, "user@x")).rejects.toThrow(
      /id inválido/
    );
    await expect(cancelFumigationInvoice(1, "")).rejects.toThrow(
      /cancelledBy requerido/
    );
    await expect(cancelFumigationInvoice(1, "  ")).rejects.toThrow(
      /cancelledBy requerido/
    );
  });

  it("marca la factura como cancelada si no estaba cancelada", async () => {
    const cancelled = {
      id: 1,
      fumigation_id: 100,
      invoice_number: "FVE-2051",
      invoiced_at: new Date("2026-07-15T00:00:00.000Z"),
      amount_cop: "1500000.00",
      cancelled: true,
      cancelled_at: "2026-08-24T11:00:00.000Z",
      cancelled_by: "admin@aeroadmin.local",
      created_at: "2026-08-24T10:00:00.000Z",
      updated_at: "2026-08-24T11:00:00.000Z"
    };
    mockQuery.mockResolvedValueOnce({ rows: [cancelled] });

    const out = await cancelFumigationInvoice(1, "admin@aeroadmin.local");

    expect(out?.cancelled).toBe(true);
    expect(out?.cancelled_by).toBe("admin@aeroadmin.local");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET cancelled = TRUE"),
      [1, "admin@aeroadmin.local"]
    );
  });

  it("es idempotente: si ya estaba cancelada, devuelve el row sin UPDATE", async () => {
    const existing = {
      id: 1,
      fumigation_id: 100,
      invoice_number: "FVE-2051",
      invoiced_at: new Date("2026-07-15T00:00:00.000Z"),
      amount_cop: "1500000.00",
      cancelled: true,
      cancelled_at: "2026-08-24T10:00:00.000Z",
      cancelled_by: "admin@aeroadmin.local",
      created_at: "2026-08-24T10:00:00.000Z",
      updated_at: "2026-08-24T10:00:00.000Z"
    };
    // Primer query: UPDATE que no afecta rows (ya cancelada) → []
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Segundo query: SELECT del row existente
    mockQuery.mockResolvedValueOnce({ rows: [existing] });

    const out = await cancelFumigationInvoice(1, "other@aeroadmin.local");

    expect(out).toEqual(expect.objectContaining({ cancelled: true }));
    // El cancelled_by NO se sobreescribe (permanece el del primer cancel).
    expect(out?.cancelled_by).toBe("admin@aeroadmin.local");
    // El segundo mockQuery es el SELECT (no un UPDATE).
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("devuelve null si la factura no existe", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE: nada
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT: nada

    const out = await cancelFumigationInvoice(999, "admin@aeroadmin.local");
    expect(out).toBeNull();
  });
});
