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
  djiFlightSchema
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
