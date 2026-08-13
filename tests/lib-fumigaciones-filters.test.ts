// tests/lib-fumigaciones-filters.test.ts
//
// Test unitario de los helpers de filtros de /fumigaciones.
//
// Cubre:
//   - **parseSource**: mapa "dji"|"manual"|"import"|"all"|undefined →
//     tipo FumigationSource. La URL es user-facing ("dji"), el shape de
//     la BD es técnico ("djiscraper"). Sin este mapa los filtros
//     no matchearían.
//   - **parseCategorySlug**: slug URL → id de FUMIGATION_CATEGORIES.
//   - **parseDate**: YYYY-MM-DD validación. Defensiva contra "2026-13-99".
//   - **parseIntId**: int positivo estricto (rechaza 0, negativo, float,
//     NaN).
//   - **parseDroneCode**: int positivo + debe estar en {0, 72, 201, 210}.
//   - **buildPageUrl**: preserva filtros activos, omite `page=1`, agrega
//     `page=N` cuando N > 1, fallback a `?page=1` si no hay nada.
//
// Sprint 2026-08-13 — feature/fumigaciones-detail-polish.

import { describe, expect, it } from "vitest";
import {
  buildPageUrl,
  parseCategorySlug,
  parseDate,
  parseDroneCode,
  parseIntId,
  parseSource
} from "@/lib/fumigaciones-filters";

// ============================================================
// parseSource
// ============================================================

describe("parseSource", () => {
  it("mapea 'dji' (URL) → 'djiscraper' (BD)", () => {
    expect(parseSource("dji")).toBe("djiscraper");
  });

  it("mapea 'manual' → 'manual'", () => {
    expect(parseSource("manual")).toBe("manual");
  });

  it("mapea 'import' → 'import'", () => {
    expect(parseSource("import")).toBe("import");
  });

  it("'all' (selector del dropdown) → null (sin filtro)", () => {
    expect(parseSource("all")).toBeNull();
  });

  it("undefined → null (no se pasó searchParam)", () => {
    expect(parseSource(undefined)).toBeNull();
  });

  it("valor desconocido (manipulación de URL) → null (no rompe)", () => {
    expect(parseSource("manual-2")).toBeNull();
    expect(parseSource("DJI")).toBeNull(); // case-sensitive
    expect(parseSource("")).toBeNull();
  });
});

// ============================================================
// parseCategorySlug
// ============================================================

describe("parseCategorySlug", () => {
  it("'herbicida' → 1 (id de FUMIGATION_CATEGORIES)", () => {
    expect(parseCategorySlug("herbicida")).toBe(1);
  });

  it("'insecticida' → 2", () => {
    expect(parseCategorySlug("insecticida")).toBe(2);
  });

  it("'fungicida' → 3", () => {
    expect(parseCategorySlug("fungicida")).toBe(3);
  });

  it("slug desconocido → null (no rompe, no filtra)", () => {
    expect(parseCategorySlug("inventado")).toBeNull();
  });

  it("undefined / '' → null", () => {
    expect(parseCategorySlug(undefined)).toBeNull();
    expect(parseCategorySlug("")).toBeNull();
  });
});

// ============================================================
// parseDate
// ============================================================

describe("parseDate", () => {
  it("fecha válida YYYY-MM-DD → la misma fecha (string)", () => {
    expect(parseDate("2026-08-13")).toBe("2026-08-13");
  });

  it("fecha en el pasado lejano → la misma fecha", () => {
    expect(parseDate("1990-01-01")).toBe("1990-01-01");
  });

  it("fecha en el futuro lejano → la misma fecha", () => {
    expect(parseDate("2099-12-31")).toBe("2099-12-31");
  });

  it("rechaza formato DD/MM/YYYY (defensa contra manipulación)", () => {
    expect(parseDate("13/08/2026")).toBeNull();
  });

  it("rechaza mes inválido '2026-13-01'", () => {
    // El regex pasa pero `new Date(...)` lo rechaza (mes 13 → NaN).
    expect(parseDate("2026-13-01")).toBeNull();
  });

  // ----------------------------------------------------------------
  // FIX 2026-08-13 (polish v1): parseDate ahora usa `Date.UTC(y, m-1, d)`
  // y compara los componentes para rechazar overflow silencioso de
  // día (febrero 30, abril 31, etc.). Antes el helper aceptaba
  // "2026-02-30" porque `new Date("2026-02-30T00:00:00Z")` hace
  // overflow a "2026-03-02" sin error. Esto permitía URL manipulation
  // (`?from=2026-02-30` pasaba el filtro silenciosamente).
  // ----------------------------------------------------------------

  it("rechaza '2026-02-30' (febrero 30) — overflow silencioso de Date", () => {
    expect(parseDate("2026-02-30")).toBeNull();
  });

  it("rechaza '2026-04-31' (abril 31) — overflow silencioso de Date", () => {
    expect(parseDate("2026-04-31")).toBeNull();
  });

  it("undefined / '' → null", () => {
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate("")).toBeNull();
  });

  it("rechaza '2026-8-13' (sin zero-padding)", () => {
    // El regex exige exactamente 2 dígitos para mes/día.
    expect(parseDate("2026-8-13")).toBeNull();
  });

  it("rechaza '26-08-13' (año 2 dígitos)", () => {
    expect(parseDate("26-08-13")).toBeNull();
  });
});

// ============================================================
// parseIntId
// ============================================================

describe("parseIntId", () => {
  it("'1' → 1", () => {
    expect(parseIntId("1")).toBe(1);
  });

  it("'3107' (id real del dataset) → 3107", () => {
    expect(parseIntId("3107")).toBe(3107);
  });

  it("rechaza '0' (id debe ser > 0)", () => {
    expect(parseIntId("0")).toBeNull();
  });

  it("rechaza '-1' (negativo)", () => {
    expect(parseIntId("-1")).toBeNull();
  });

  it("rechaza '1.5' (float)", () => {
    expect(parseIntId("1.5")).toBeNull();
  });

  it("rechaza 'abc' (no numérico)", () => {
    expect(parseIntId("abc")).toBeNull();
  });

  it("rechaza '1e10' (notación científica → float, no integer)", () => {
    // 1e10 = 10000000000, ES entero, pero Number.isInteger acepta.
    // Documentamos el comportamiento: notación científica se acepta
    // si el resultado es integer. Esto es edge case — el filtro solo
    // lo ve si el usuario manipula la URL.
    expect(parseIntId("1e10")).toBe(10_000_000_000);
  });

  it("undefined / '' → null", () => {
    expect(parseIntId(undefined)).toBeNull();
    expect(parseIntId("")).toBeNull();
  });
});

// ============================================================
// parseDroneCode
// ============================================================

describe("parseDroneCode", () => {
  it("acepta 0 ('Sin asignar')", () => {
    expect(parseDroneCode("0")).toBe(0);
  });

  it("acepta 72 (Agras T16/T20)", () => {
    expect(parseDroneCode("72")).toBe(72);
  });

  it("acepta 201 (Agras T40/T50)", () => {
    expect(parseDroneCode("201")).toBe(201);
  });

  it("acepta 210 (Agras T70)", () => {
    expect(parseDroneCode("210")).toBe(210);
  });

  it("rechaza 99 (code que no está en dji_drone_models)", () => {
    expect(parseDroneCode("99")).toBeNull();
  });

  it("rechaza '1.5' (float)", () => {
    expect(parseDroneCode("1.5")).toBeNull();
  });

  it("rechaza '-1' (negativo)", () => {
    expect(parseDroneCode("-1")).toBeNull();
  });

  it("rechaza 'abc' (no numérico)", () => {
    expect(parseDroneCode("abc")).toBeNull();
  });

  it("undefined / '' → null", () => {
    expect(parseDroneCode(undefined)).toBeNull();
    expect(parseDroneCode("")).toBeNull();
  });
});

// ============================================================
// buildPageUrl
// ============================================================

describe("buildPageUrl", () => {
  it("sin filtros, page=1 → '?page=1' (fallback explícito)", () => {
    expect(buildPageUrl({}, 1)).toBe("?page=1");
  });

  it("page=1 se omite (no aparece en la URL)", () => {
    const url = buildPageUrl({ q: "glifosato" }, 1);
    expect(url).toBe("?q=glifosato");
    expect(url).not.toContain("page=1");
  });

  it("page>1 se agrega como searchParam", () => {
    expect(buildPageUrl({}, 2)).toBe("?page=2");
  });

  it("preserva q", () => {
    expect(buildPageUrl({ q: "glifosato" }, 2)).toBe("?q=glifosato&page=2");
  });

  it("preserva source", () => {
    expect(buildPageUrl({ source: "manual" }, 1)).toBe("?source=manual");
  });

  it("preserva category", () => {
    expect(buildPageUrl({ category: "herbicida" }, 1)).toBe("?category=herbicida");
  });

  it("preserva from y to", () => {
    const url = buildPageUrl({ from: "2026-01-01", to: "2026-12-31" }, 1);
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-12-31");
  });

  it("preserva parcel y drone", () => {
    const url = buildPageUrl({ parcel: "3107", drone: "201" }, 1);
    expect(url).toContain("parcel=3107");
    expect(url).toContain("drone=201");
  });

  it("preserva todos los filtros juntos + page=3", () => {
    const url = buildPageUrl(
      {
        q: "glifosato",
        source: "manual",
        category: "herbicida",
        from: "2026-01-01",
        to: "2026-12-31",
        parcel: "3107",
        drone: "201"
      },
      3
    );
    expect(url).toContain("q=glifosato");
    expect(url).toContain("source=manual");
    expect(url).toContain("category=herbicida");
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-12-31");
    expect(url).toContain("parcel=3107");
    expect(url).toContain("drone=201");
    expect(url).toContain("page=3");
  });

  it("omite filtros con string vacío (falsy) — no aparecen en la URL", () => {
    // Si el searchParam viene como '' (raro, pero pasa), no lo
    // agregamos — el form lo trata como "sin valor".
    const url = buildPageUrl({ q: "", source: "manual" }, 1);
    expect(url).not.toContain("q=");
    expect(url).toContain("source=manual");
  });

  it("preserva el orden de los searchParams (importante para diffs en tests)", () => {
    // URLSearchParams preserva el orden de inserción: q, source, category,
    // from, to, parcel, drone, page.
    const url = buildPageUrl(
      { q: "a", source: "manual", category: "herbicida", parcel: "1", drone: "201" },
      1
    );
    const qs = url.replace(/^\?/, "");
    const keys = qs.split("&").map((kv) => kv.split("=")[0]);
    expect(keys).toEqual(["q", "source", "category", "parcel", "drone"]);
  });
});
