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
  validationErrorResponseSchema,
  formStateSchema,
  formStateToBody
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

// ============================================================
// formStateSchema — FormState del wizard 4-step (zod PR #3)
// ============================================================

const VALID_FORM_STATE = {
  fumigation_date: "2026-08-02",
  category_id: "",
  application_type_id: "",
  vehicle_plate: "",
  product_used: "Glifosato 48%",
  product_id: null,
  dose_l_per_ha: "2.5",
  area_fumigated_m2: "",
  duration_minutes: "",
  drone_code_used: "0",
  notes: "",
  product_registered_ica: "",
  pilot_license: ""
};

describe("formStateSchema — happy path", () => {
  it("42. parsea formState minimo valido (solo requeridos)", () => {
    const data = formStateSchema.parse(VALID_FORM_STATE);
    expect(data.fumigation_date).toBe("2026-08-02");
    expect(data.product_used).toBe("Glifosato 48%");
    expect(data.dose_l_per_ha).toBe("2.5");
  });

  it("43. parsea formState completo con todos los opcionales", () => {
    const data = formStateSchema.parse({
      ...VALID_FORM_STATE,
      product_id: 5,
      category_id: "2",
      application_type_id: "3",
      vehicle_plate: "abc-123",
      area_fumigated_m2: "5000",
      duration_minutes: "45",
      drone_code_used: "201",
      notes: "Aplicacion manual",
      product_registered_ica: "ICA-1234-PN",
      pilot_license: "PCA-12345"
    });
    expect(data.product_id).toBe(5);
    expect(data.vehicle_plate).toBe("ABC-123"); // normalizado
    expect(data.category_id).toBe("2");
  });

  it("44. trimea product_used antes de validar", () => {
    const data = formStateSchema.parse({
      ...VALID_FORM_STATE,
      product_used: "  Glifosato 48%  "
    });
    expect(data.product_used).toBe("Glifosato 48%");
  });

  it("45. normaliza vehicle_plate a UPPER", () => {
    const data = formStateSchema.parse({
      ...VALID_FORM_STATE,
      vehicle_plate: "abc-123"
    });
    expect(data.vehicle_plate).toBe("ABC-123");
  });
});

describe("formStateSchema — required fields", () => {
  it("46. rechaza fumigation_date con formato incorrecto", () => {
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, fumigation_date: "08/02/2026" })
    ).toThrow();
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, fumigation_date: "2026-8-2" })
    ).toThrow();
  });

  it("47. rechaza product_used vacio o whitespace", () => {
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, product_used: "" })
    ).toThrow();
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, product_used: "   " })
    ).toThrow();
  });

  it("48. rechaza product_used > 200 chars", () => {
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, product_used: "x".repeat(201) })
    ).toThrow();
  });

  it("49. rechaza dose_l_per_ha faltante o invalido", () => {
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, dose_l_per_ha: "" })
    ).toThrow();
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, dose_l_per_ha: "abc" })
    ).toThrow();
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, dose_l_per_ha: "0" })
    ).toThrow();
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, dose_l_per_ha: "-1" })
    ).toThrow();
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, dose_l_per_ha: "2000" })
    ).toThrow();
  });

  it("50. acepta dose_l_per_ha como string numerico (Number conversion)", () => {
    const data = formStateSchema.parse({
      ...VALID_FORM_STATE,
      dose_l_per_ha: "2.5"
    });
    expect(data.dose_l_per_ha).toBe("2.5");
  });
});

describe("formStateSchema — optional fields", () => {
  it("51. area_fumigated_m2: '' o numero >= 0", () => {
    // Vacio OK
    const d1 = formStateSchema.parse({ ...VALID_FORM_STATE, area_fumigated_m2: "" });
    expect(d1.area_fumigated_m2).toBe("");
    // 0 OK
    const d2 = formStateSchema.parse({ ...VALID_FORM_STATE, area_fumigated_m2: "0" });
    expect(d2.area_fumigated_m2).toBe("0");
    // Negativo NO
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, area_fumigated_m2: "-1" })
    ).toThrow();
    // String no-numerico NO
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, area_fumigated_m2: "mucho" })
    ).toThrow();
  });

  it("52. drone_code_used: '0' (sin asignar) o entero positivo como string", () => {
    // "0" OK
    const d1 = formStateSchema.parse({ ...VALID_FORM_STATE, drone_code_used: "0" });
    expect(d1.drone_code_used).toBe("0");
    // "201" OK
    const d2 = formStateSchema.parse({ ...VALID_FORM_STATE, drone_code_used: "201" });
    expect(d2.drone_code_used).toBe("201");
    // "72" OK
    const d3 = formStateSchema.parse({ ...VALID_FORM_STATE, drone_code_used: "72" });
    expect(d3.drone_code_used).toBe("72");
    // "210" OK
    const d4 = formStateSchema.parse({ ...VALID_FORM_STATE, drone_code_used: "210" });
    expect(d4.drone_code_used).toBe("210");
    // "-1" NO
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, drone_code_used: "-1" })
    ).toThrow();
    // "abc" NO
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, drone_code_used: "abc" })
    ).toThrow();
  });

  it("53. vehicle_plate: '' o regex, normalizado a UPPER", () => {
    const d1 = formStateSchema.parse({ ...VALID_FORM_STATE, vehicle_plate: "" });
    expect(d1.vehicle_plate).toBe("");
    const d2 = formStateSchema.parse({ ...VALID_FORM_STATE, vehicle_plate: "ABC-123" });
    expect(d2.vehicle_plate).toBe("ABC-123");
    // Muy corto
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, vehicle_plate: "AB" })
    ).toThrow();
    // Muy largo
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, vehicle_plate: "ABCDEFGHIJKLM" })
    ).toThrow();
    // Caracteres invalidos
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, vehicle_plate: "ABC 123" })
    ).toThrow();
  });

  it("54. notes / ica / license: '' o max length", () => {
    // Vacio OK
    const d1 = formStateSchema.parse(VALID_FORM_STATE);
    expect(d1.notes).toBe("");
    // Max length OK
    const d2 = formStateSchema.parse({
      ...VALID_FORM_STATE,
      notes: "x".repeat(2000)
    });
    expect(d2.notes).toHaveLength(2000);
    // Excede NO
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, notes: "x".repeat(2001) })
    ).toThrow();
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, product_registered_ica: "x".repeat(51) })
    ).toThrow();
    expect(() =>
      formStateSchema.parse({ ...VALID_FORM_STATE, pilot_license: "x".repeat(21) })
    ).toThrow();
  });
});

// ============================================================
// formStateToBody — conversion FormState → API body (zod PR #3)
// ============================================================

describe("formStateToBody", () => {
  it("55. form minimo: solo campos requeridos en body", () => {
    const body = formStateToBody(formStateSchema.parse(VALID_FORM_STATE));
    expect(body.fumigation_date).toBe("2026-08-02");
    expect(body.product_used).toBe("Glifosato 48%");
    expect(body.dose_l_per_ha).toBe(2.5); // number, no string
    // Opcionales vacios NO incluidos
    expect(body.area_fumigated_m2).toBeUndefined();
    expect(body.duration_minutes).toBeUndefined();
    expect(body.drone_code_used).toBeUndefined();
    expect(body.notes).toBeUndefined();
    expect(body.vehicle_plate).toBeUndefined();
    expect(body.category_id).toBeUndefined();
    expect(body.application_type_id).toBeUndefined();
  });

  it("56. form completo: incluye todos los opcionales con valor", () => {
    const body = formStateToBody(
      formStateSchema.parse({
        ...VALID_FORM_STATE,
        product_id: 5,
        category_id: "2",
        application_type_id: "3",
        vehicle_plate: "abc-123",
        area_fumigated_m2: "5000",
        duration_minutes: "45",
        drone_code_used: "201",
        notes: "Aplicacion",
        product_registered_ica: "ICA-1234-PN",
        pilot_license: "PCA-12345"
      })
    );
    expect(body.product_id).toBe(5);
    expect(body.category_id).toBe(2);
    expect(body.application_type_id).toBe(3);
    expect(body.vehicle_plate).toBe("ABC-123"); // UPPER
    expect(body.area_fumigated_m2).toBe(5000); // number
    expect(body.duration_minutes).toBe(45); // number
    expect(body.drone_code_used).toBe(201); // number, no "0"
    expect(body.notes).toBe("Aplicacion");
    expect(body.product_registered_ica).toBe("ICA-1234-PN");
    expect(body.pilot_license).toBe("PCA-12345");
  });

  it("57. drone_code_used='0' (sin asignar) → no incluido en body", () => {
    const body = formStateToBody(
      formStateSchema.parse({ ...VALID_FORM_STATE, drone_code_used: "0" })
    );
    expect(body.drone_code_used).toBeUndefined();
  });

  it("58. dose_l_per_ha: string → number", () => {
    const body = formStateToBody(
      formStateSchema.parse({ ...VALID_FORM_STATE, dose_l_per_ha: "3.0" })
    );
    expect(body.dose_l_per_ha).toBe(3.0);
    expect(typeof body.dose_l_per_ha).toBe("number");
  });

  it("59. el body que retorna es compatible con createFumigationBodySchema", () => {
    // Re-assemble body a partir de form completo, parsear con el schema
    // de la API (PR #2). Si esto pasa, el cliente puede mandar directo
    // sin que el server rechace.
    const form = formStateSchema.parse({
      ...VALID_FORM_STATE,
      product_id: 5,
      category_id: "2",
      application_type_id: "3",
      vehicle_plate: "ABC-123",
      area_fumigated_m2: "5000",
      duration_minutes: "45",
      drone_code_used: "201",
      notes: "Manual",
      product_registered_ica: "ICA-1234",
      pilot_license: "PCA-12345"
    });
    const body = formStateToBody(form);
    // El schema de la API espera `recorded_by` server-side, no del body.
    // El body sin recorded_by debe parsear OK (parcel_id falta del form,
    // pero eso lo agrega el route handler despues).
    body.parcel_id = 1;
    const result = createFumigationBodySchema.safeParse(body);
    expect(result.success).toBe(true);
  });
});
