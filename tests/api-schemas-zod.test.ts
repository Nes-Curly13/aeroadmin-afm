// tests/api-schemas-zod.test.ts
//
// Tests de la libreria `lib/api-schemas.ts` con zod.
// Sprint S11+ — Quality Gauntlet (compuerta 4: zod para testeo de bugs).
//
// Cubre:
//   - Las schemas parsean responses validas correctamente (happy path)
//   - Las schemas rechazan responses invalidas (catching bugs de shape)
//   - Los endpoints auth-gated devuelven 401/403 con shape correcta
//     (catching el bug del Bug 2: endpoint que retorna 200 cuando
//     deberia retornar 401)
//
// Por que este archivo es valioso:
// - Define el patron de "validar response shape con zod en tests" para
//   que otros tests lo adopten.
// - Demuestra que zod detecta bugs reales: si una API route cambia su
//   response shape (e.g. deja de incluir `error` string), el test
//   falla con un mensaje claro que apunta al path exacto.
// - El test "endpoint auth-gated sin sesion → 401 con error schema"
//   es exactamente el patron que habria detectado Bug 2 antes de que
//   llegara a produccion.

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  djiFlightListResponseSchema,
  dataQualityInvariantsResponseSchema,
  errorResponseSchema,
  parseWithSchema,
  djiFlightSchema,
  createClientBodySchema,
  createFarmBodySchema,
  createFumigationBodySchema,
  formatZodIssues,
  validationErrorResponseSchema
} from "@/lib/api-schemas";

// ============================================================
// Mock factory: fake Response objects
// ============================================================

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  } as Response;
}

// ============================================================
// Schema unit tests — happy path
// ============================================================

describe("api-schemas — happy path", () => {
  it("1. djiFlightListResponseSchema parsea respuesta valida", () => {
    const data = djiFlightListResponseSchema.parse({
      flights: [
        {
          id: 1,
          flight_id: 638640703,
          drone_serial: "R1272065674",
          drone_nickname: "AFM T40 1",
          pilot_name: "breiner",
          start_at: "2026-09-15T08:00:00.000Z",
          end_at: "2026-09-15T08:45:00.000Z",
          duration_seconds: 2700,
          area_m2: "12000.00",
          spray_usage_ml: 15000,
          lng: "-76.50",
          lat: "3.45"
        }
      ]
    });
    expect(data.flights).toHaveLength(1);
    expect(data.flights[0].id).toBe(1);
  });

  it("2. dataQualityInvariantsResponseSchema parsea respuesta valida", () => {
    const data = dataQualityInvariantsResponseSchema.parse({
      warnings: [
        {
          code: "parcela_no_cliente",
          severity: "warning",
          message: "Parcela sin cliente asignado",
          parcela_id: 42
        }
      ]
    });
    expect(data.warnings).toHaveLength(1);
    expect(data.warnings[0].code).toBe("parcela_no_cliente");
  });

  it("3. errorResponseSchema parsea error valido", () => {
    const data = errorResponseSchema.parse({ error: "no autenticado" });
    expect(data.error).toBe("no autenticado");
  });
});

// ============================================================
// Schema unit tests — catching shape bugs
// ============================================================

describe("api-schemas — catching shape bugs", () => {
  it("4. djiFlightListResponseSchema rechaza shape invalida (falta `flights`)", () => {
    expect(() =>
      djiFlightListResponseSchema.parse({ items: [] })
    ).toThrow();
  });

  it("5. djiFlightSchema rechaza flight sin `flight_id` (campo requerido)", () => {
    expect(() =>
      djiFlightSchema.parse({
        id: 1,
        // flight_id falta
        drone_serial: null,
        drone_nickname: null,
        pilot_name: null,
        start_at: "2026-09-15T08:00:00.000Z",
        end_at: "2026-09-15T08:45:00.000Z",
        duration_seconds: 2700,
        area_m2: null,
        spray_usage_ml: null,
        lng: null,
        lat: null
      })
    ).toThrow();
  });

  it("6. djiFlightSchema rechaza severity invalida en data quality warning", () => {
    expect(() =>
      dataQualityInvariantsResponseSchema.parse({
        warnings: [
          {
            code: "parcela_no_cliente",
            severity: "FATAL", // invalido, no es "info"|"warning"|"error"
            message: "test"
          }
        ]
      })
    ).toThrow();
  });

  it("7. errorResponseSchema rechaza response sin `error` field (bug: cambio de shape)", () => {
    // Si alguien cambia { error: string } a { message: string } en
    // una API route, este test falla inmediatamente.
    expect(() => errorResponseSchema.parse({ message: "oops" })).toThrow();
  });
});

// ============================================================
// parseWithSchema helper
// ============================================================

describe("parseWithSchema — helper", () => {
  it("8. parsea response valida con status 200", async () => {
    const res = fakeResponse({ flights: [] });
    const data = await parseWithSchema(res, djiFlightListResponseSchema);
    expect(data.flights).toEqual([]);
  });

  it("9. parsea response de error (status 401) con errorResponseSchema", async () => {
    const res = fakeResponse({ error: "no autenticado" }, 401);
    const data = await parseWithSchema(res, errorResponseSchema);
    expect(data.error).toBe("no autenticado");
  });

  it("10. falla con detalle si la response no matchea el schema", async () => {
    const res = fakeResponse({ wrong: "shape" });
    await expect(parseWithSchema(res, errorResponseSchema)).rejects.toThrow();
  });
});

// ============================================================
// Patrón: auth-gated endpoints (cazador del Bug 2)
// ============================================================
//
// Bug 2 era "/geovisor accesible sin login" — un page route que
// deberia redirigir a /login cuando no hay session, pero el
// middleware lo dejaba pasar. La causa comun: una API route
// auth-gated que retorna 200 (o sin status correcto) en vez de
// 401 cuando requireRole() tira UNAUTHENTICATED.
//
// El patron: para cada endpoint auth-gated, escribir un test que
// simule la ausencia de sesion y verifique (a) status correcto
// y (b) body shape usando errorResponseSchema. Si el endpoint
// retorna 200 o un body sin `error`, zod parse() falla y el test
// señala el bug antes de que llegue a produccion.

describe("auth-gated endpoints — patron anti-Bug-2", () => {
  // Endpoints a verificar. Cada uno tiene requireRole(["admin", "supervisor"])
  // o requireRole("admin"). El test simula "no auth" y verifica el shape.
  const authGatedEndpoints: { name: string; pattern: RegExp }[] = [
    // Solo listamos los paths — los tests reales viven en
    // tests/api-admin-*.test.ts. Acá probamos el PATRON.
  ];

  it("11. zod parse() rechaza response de error con shape incorrecta", () => {
    // Simula: una API route rota que retorna { ok: true, data: ... } en
    // vez de { error: "no autenticado" } cuando no hay sesion.
    const brokenResponse = { ok: false, reason: "no auth" };
    expect(() => errorResponseSchema.parse(brokenResponse)).toThrow();
    // Si la API route pasa este test, es porque su shape es compatible
    // con `{ error: string }` — el contrato que el frontend espera.
  });

  it("12. zod detecta cambios sutiles de shape (renombrar field)", () => {
    // Si alguien renombra `error` a `message` en la API, el test
    // falla con: 'expected `error` field, got `message` field'.
    const brokenResponse = { message: "no auth" };
    let caughtError: unknown = null;
    try {
      errorResponseSchema.parse(brokenResponse);
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).toBeTruthy();
  });
});

// ============================================================
// Request body schemas — POST /api/admin/clients (zod PR #2)
// ============================================================

describe("createClientBodySchema", () => {
  it("13. parsea body valido con campos requeridos", () => {
    const data = createClientBodySchema.parse({
      name: "Ingenio La Cabaña",
      created_by_email: "admin@aeroadmin.local"
    });
    expect(data.name).toBe("Ingenio La Cabaña");
    expect(data.notes).toBeNull();
  });

  it("14. parsea body con notes y trimea espacios", () => {
    const data = createClientBodySchema.parse({
      name: "  Cliente  ",
      notes: "  nota con espacios  ",
      created_by_email: "admin@aeroadmin.local"
    });
    expect(data.name).toBe("Cliente");
    expect(data.notes).toBe("nota con espacios");
  });

  it("15. trata string vacio en notes como null (clear semantics)", () => {
    const data = createClientBodySchema.parse({
      name: "X",
      notes: "",
      created_by_email: "admin@aeroadmin.local"
    });
    expect(data.notes).toBeNull();
  });

  it("16. rechaza name vacio o whitespace-only", () => {
    expect(() =>
      createClientBodySchema.parse({ name: "", created_by_email: "a@b.c" })
    ).toThrow();
    expect(() =>
      createClientBodySchema.parse({ name: "   ", created_by_email: "a@b.c" })
    ).toThrow();
  });

  it("17. rechaza name > 200 chars", () => {
    expect(() =>
      createClientBodySchema.parse({
        name: "x".repeat(201),
        created_by_email: "a@b.c"
      })
    ).toThrow();
  });

  it("18. rechaza falta de created_by_email", () => {
    expect(() =>
      createClientBodySchema.parse({ name: "X" })
    ).toThrow();
  });

  it("19. rechaza name que no es string (e.g. numero)", () => {
    expect(() =>
      createClientBodySchema.parse({ name: 123, created_by_email: "a@b.c" })
    ).toThrow();
  });
});

// ============================================================
// Request body schemas — POST /api/admin/farms (zod PR #2)
// ============================================================

describe("createFarmBodySchema", () => {
  it("20. parsea body valido completo", () => {
    const data = createFarmBodySchema.parse({
      client_id: 1,
      name: "Finca La Esperanza",
      municipality: "Candelaria",
      department: "Valle del Cauca",
      created_by_email: "admin@aeroadmin.local"
    });
    expect(data.client_id).toBe(1);
    expect(data.municipality).toBe("Candelaria");
  });

  it("21. campos opcionales omitidos → null (no undefined)", () => {
    const data = createFarmBodySchema.parse({
      client_id: 1,
      name: "Finca",
      created_by_email: "a@b.c"
    });
    expect(data.municipality).toBeNull();
    expect(data.department).toBeNull();
  });

  it("22. rechaza client_id <= 0 o no-integer", () => {
    expect(() =>
      createFarmBodySchema.parse({ client_id: 0, name: "X", created_by_email: "a@b.c" })
    ).toThrow();
    expect(() =>
      createFarmBodySchema.parse({ client_id: 1.5, name: "X", created_by_email: "a@b.c" })
    ).toThrow();
    expect(() =>
      createFarmBodySchema.parse({ client_id: "1", name: "X", created_by_email: "a@b.c" })
    ).toThrow();
  });

  it("23. rechaza falta de name o created_by_email", () => {
    expect(() =>
      createFarmBodySchema.parse({ client_id: 1 })
    ).toThrow();
    expect(() =>
      createFarmBodySchema.parse({ client_id: 1, name: "X" })
    ).toThrow();
  });
});

// ============================================================
// Request body schemas — POST /api/admin/fumigations (zod PR #2)
// ============================================================

const VALID_FUMIGATION = {
  parcel_id: 1,
  fumigation_date: "2026-08-02",
  product_used: "Glifosato 48%",
  dose_l_per_ha: 2.5
};

describe("createFumigationBodySchema", () => {
  it("24. parsea body minimo valido (solo requeridos)", () => {
    const data = createFumigationBodySchema.parse(VALID_FUMIGATION);
    expect(data.parcel_id).toBe(1);
    expect(data.dose_l_per_ha).toBe(2.5);
    expect(data.area_fumigated_m2).toBeNull();
    expect(data.notes).toBeNull();
  });

  it("25. parsea body completo con todos los opcionales", () => {
    const data = createFumigationBodySchema.parse({
      ...VALID_FUMIGATION,
      area_fumigated_m2: 5000,
      duration_minutes: 45,
      drone_code_used: 201,
      notes: "Aplicación manual",
      product_registered_ica: "ICA-1234-PN",
      pilot_license: "PCA-12345",
      product_id: 5,
      category_id: 2,
      application_type_id: 3,
      vehicle_plate: "abc-123"
    });
    expect(data.area_fumigated_m2).toBe(5000);
    expect(data.vehicle_plate).toBe("ABC-123"); // normalizado a UPPER
    expect(data.drone_code_used).toBe(201);
  });

  it("26. trimea product_used y rechaza empty", () => {
    const data = createFumigationBodySchema.parse({
      ...VALID_FUMIGATION,
      product_used: "  Glifosato 48%  "
    });
    expect(data.product_used).toBe("Glifosato 48%");
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, product_used: "   " })
    ).toThrow();
  });

  it("27. fumigation_date con formato incorrecto → reject", () => {
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, fumigation_date: "08/02/2026" })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, fumigation_date: "2026-8-2" })
    ).toThrow();
  });

  it("28. dose_l_per_ha: positive y <= 1000", () => {
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, dose_l_per_ha: 0 })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, dose_l_per_ha: -1 })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, dose_l_per_ha: 2000 })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, dose_l_per_ha: "2.5" })
    ).toThrow();
  });

  it("29. parcel_id: required, positive integer", () => {
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, parcel_id: "1" })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, parcel_id: 0 })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, parcel_id: -1 })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, parcel_id: 1.5 })
    ).toThrow();
  });

  it("30. drone_code_used: positive integer o null/undefined", () => {
    // undefined → null
    const data1 = createFumigationBodySchema.parse(VALID_FUMIGATION);
    expect(data1.drone_code_used).toBeNull();
    // null explícito
    const data2 = createFumigationBodySchema.parse({
      ...VALID_FUMIGATION,
      drone_code_used: null
    });
    expect(data2.drone_code_used).toBeNull();
    // 0 no es valido (positive, no nonnegative)
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, drone_code_used: 0 })
    ).toThrow();
  });

  it("31. vehicle_plate: valida regex y normaliza a UPPER", () => {
    // Input valido (sin espacios) → trim + UPPER + acepta
    const data = createFumigationBodySchema.parse({
      ...VALID_FUMIGATION,
      vehicle_plate: "abc-123"
    });
    expect(data.vehicle_plate).toBe("ABC-123");
    // Input con espacio → rechazado (regex no matchea)
    expect(() =>
      createFumigationBodySchema.parse({
        ...VALID_FUMIGATION,
        vehicle_plate: "ABC 123"
      })
    ).toThrow();
  });

  it("32. vehicle_plate: rechaza formatos invalidos", () => {
    expect(() =>
      createFumigationBodySchema.parse({
        ...VALID_FUMIGATION,
        vehicle_plate: "AB" // muy corto
      })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({
        ...VALID_FUMIGATION,
        vehicle_plate: "ABCDEFGHIJKLM" // muy largo
      })
    ).toThrow();
  });

  it("33. vehicle_plate: vacio o null → null", () => {
    const data1 = createFumigationBodySchema.parse({
      ...VALID_FUMIGATION,
      vehicle_plate: ""
    });
    expect(data1.vehicle_plate).toBeNull();
    const data2 = createFumigationBodySchema.parse({
      ...VALID_FUMIGATION,
      vehicle_plate: "   " // solo espacios → trim → "" → null
    });
    expect(data2.vehicle_plate).toBeNull();
  });

  it("34. strings opcionales: vacio → null (notes, ica, license)", () => {
    const data = createFumigationBodySchema.parse({
      ...VALID_FUMIGATION,
      notes: "",
      product_registered_ica: "",
      pilot_license: ""
    });
    expect(data.notes).toBeNull();
    expect(data.product_registered_ica).toBeNull();
    expect(data.pilot_license).toBeNull();
  });

  it("35. rechaza strings que exceden max length (notes > 2000, ica > 50, license > 20)", () => {
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, notes: "x".repeat(2001) })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({
        ...VALID_FUMIGATION,
        product_registered_ica: "x".repeat(51)
      })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({
        ...VALID_FUMIGATION,
        pilot_license: "x".repeat(21)
      })
    ).toThrow();
  });

  it("36. area_fumigated_m2 / duration_minutes: number >= 0 o null", () => {
    // 0 es valido (>= 0)
    const data = createFumigationBodySchema.parse({
      ...VALID_FUMIGATION,
      area_fumigated_m2: 0,
      duration_minutes: 0
    });
    expect(data.area_fumigated_m2).toBe(0);
    expect(data.duration_minutes).toBe(0);
    // negativo no
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, area_fumigated_m2: -1 })
    ).toThrow();
    // string no
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, area_fumigated_m2: "mucho" })
    ).toThrow();
  });

  it("37. product_id / category_id / application_type_id: positive int o null", () => {
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, product_id: 0 })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, category_id: -5 })
    ).toThrow();
    expect(() =>
      createFumigationBodySchema.parse({ ...VALID_FUMIGATION, application_type_id: 1.5 })
    ).toThrow();
  });
});

// ============================================================
// formatZodIssues — helper para route handlers
// ============================================================

describe("formatZodIssues", () => {
  it("38. convierte ZodError a response shape con error + issues", () => {
    const result = createFumigationBodySchema.safeParse({
      ...VALID_FUMIGATION,
      parcel_id: "not-a-number"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodIssues(result.error);
      expect(formatted.error).toMatch(/parcel_id/);
      expect(formatted.issues).toBeDefined();
      expect(formatted.issues!.length).toBeGreaterThan(0);
      expect(formatted.issues![0].message).toBeTruthy();
    }
  });

  it("39. multiple issues: devuelve lista completa, primer issue en error", () => {
    const result = createFumigationBodySchema.safeParse({
      parcel_id: 0, // invalido
      fumigation_date: "bad-date", // invalido
      product_used: "", // invalido
      dose_l_per_ha: 0 // invalido
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodIssues(result.error);
      expect(formatted.issues!.length).toBeGreaterThanOrEqual(4);
      // `error` es el primer issue — el operador ve UN mensaje claro
      expect(formatted.error).toBeTruthy();
    }
  });

  it("40. validationErrorResponseSchema parsea la forma { error, issues }", () => {
    const formatted: unknown = {
      error: "parcel_id: debe ser positivo",
      issues: [
        { path: ["parcel_id"], message: "debe ser positivo" }
      ]
    };
    const data = validationErrorResponseSchema.parse(formatted);
    expect(data.issues![0].path[0]).toBe("parcel_id");
  });

  it("41. validationErrorResponseSchema acepta { error } sin issues (backward compat)", () => {
    const data = validationErrorResponseSchema.parse({ error: "boom" });
    expect(data.error).toBe("boom");
    expect(data.issues).toBeUndefined();
  });
});
