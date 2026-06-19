import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Importación del módulo CJS — vitest la hace interop correctamente.
import {
  BUILTIN_DEFAULTS,
  defaultCropTypeFor,
  loadCadenceConfig,
  normalizeCropKey,
  resolveCadence
} from "@/lib/fumigation-cadence-config";

describe("fumigation-cadence-config — normalizeCropKey", () => {
  it("lowercase + trim", () => {
    expect(normalizeCropKey("  Caña de azúcar  ")).toBe("cana de azucar");
    expect(normalizeCropKey("CAÑA DE AZÚCAR")).toBe("cana de azucar");
  });

  it("strip de acentos (NFD + remove combining marks)", () => {
    expect(normalizeCropKey("Café")).toBe("cafe");
    expect(normalizeCropKey("Maíz")).toBe("maiz");
    expect(normalizeCropKey("Frutales")).toBe("frutales");
  });

  it("idempotente", () => {
    const a = normalizeCropKey("Caña de azúcar");
    const b = normalizeCropKey(a);
    expect(b).toBe("cana de azucar");
  });

  it("null/undefined/empty → ''", () => {
    expect(normalizeCropKey(null)).toBe("");
    expect(normalizeCropKey(undefined)).toBe("");
    expect(normalizeCropKey("")).toBe("");
  });
});

describe("fumigation-cadence-config — defaultCropTypeFor", () => {
  it("Orchards → Frutales", () => {
    expect(defaultCropTypeFor("Orchards")).toBe("Frutales");
  });

  it("cualquier otro (incluido null/undefined) → Caña de azúcar", () => {
    expect(defaultCropTypeFor("Farmland")).toBe("Caña de azúcar");
    expect(defaultCropTypeFor(null)).toBe("Caña de azúcar");
    expect(defaultCropTypeFor(undefined)).toBe("Caña de azúcar");
    expect(defaultCropTypeFor("Desconocido")).toBe("Caña de azúcar");
  });
});

describe("fumigation-cadence-config — loadCadenceConfig", () => {
  it("devuelve builtin defaults si configPath es null", () => {
    const c = loadCadenceConfig(null);
    expect(c._source).toBe("builtin-defaults");
    expect(c.defaults).toEqual({ Farmland: 14, Orchards: 10 });
    expect(c.by_crop).toEqual({});
    expect(c.by_drone).toEqual({});
    expect(c.by_parcel).toEqual({});
  });

  it("devuelve builtin defaults si el archivo no existe", () => {
    const c = loadCadenceConfig("/tmp/this-file-does-not-exist-12345.json");
    expect(c._source).toBe("builtin-defaults");
  });

  it("lee un JSON válido y aplica defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-"));
    const cfgPath = join(dir, "cfg.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({
        defaults: { Farmland: 21 },
        by_crop: { "Caña de azúcar": 7 },
        by_drone: { 201: 10 },
        by_parcel_external_id: { "abc-123": 5 }
      })
    );
    try {
      const c = loadCadenceConfig(cfgPath);
      expect(c._source).toBe(cfgPath);
      expect(c.defaults).toEqual({ Farmland: 21, Orchards: 10 }); // Orchards del builtin
      expect(c.by_crop).toEqual({ "cana de azucar": 7 });
      expect(c.by_drone).toEqual({ "201": 10 });
      expect(c.by_parcel).toEqual({ "abc-123": 5 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignora entries no numéricos (comments, _source, etc)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-"));
    const cfgPath = join(dir, "cfg.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({
        _comment: "no numeric",
        defaults: { Farmland: 12, BadKey: "not a number" },
        by_crop: { "Café": 21, "Invalid": "12 días" },
        by_drone: { 201: 10, BadDrone: null }
      })
    );
    try {
      const c = loadCadenceConfig(cfgPath);
      expect(c.defaults).toEqual({ Farmland: 12, Orchards: 10 });
      expect(c.by_crop).toEqual({ cafe: 21 });
      expect(c.by_drone).toEqual({ "201": 10 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("JSON inválido → builtin defaults + warning, NO throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-"));
    const cfgPath = join(dir, "cfg.json");
    writeFileSync(cfgPath, "{ esto no es json válido");
    try {
      const c = loadCadenceConfig(cfgPath);
      expect(c._source).toBe("builtin-defaults");
      expect(c.defaults).toEqual({ Farmland: 14, Orchards: 10 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("fumigation-cadence-config — resolveCadence (precedencia)", () => {
  // "Config vacío" significa SIN defaults del config — fuerza al resolver
  // a caer hasta el builtin default. Para los tests que sí quieren defaults,
  // usamos un config con defaults explícitos.
  const emptyConfig = {
    defaults: {},
    by_crop: {},
    by_drone: {},
    by_parcel: {},
    _source: "test-empty"
  };

  // Config con defaults iguales al builtin — útil para tests que NO quieren
  // ejercer el path de builtin pero sí los demás niveles.
  const builtinLikeConfig = {
    defaults: { ...BUILTIN_DEFAULTS.cadence },
    by_crop: {},
    by_drone: {},
    by_parcel: {},
    _source: "test-builtin-like"
  };

  it("level 5: builtin default cuando config no tiene defaults ni overrides", () => {
    const r = resolveCadence(
      { externalId: "x", droneModelCode: 0, fieldType: "Farmland", currentCropType: null },
      emptyConfig
    );
    expect(r.cadence_days).toBe(14);
    expect(r.crop_type).toBe("Caña de azúcar");
    expect(r.reason).toBe("builtin default (Farmland)");
  });

  it("level 4: builtin default Orchards → 10d Frutales", () => {
    const r = resolveCadence(
      { externalId: "x", droneModelCode: 0, fieldType: "Orchards", currentCropType: null },
      emptyConfig
    );
    expect(r.cadence_days).toBe(10);
    expect(r.crop_type).toBe("Frutales");
  });

  it("level 3: by_crop override (match normalizado) gana sobre builtin default", () => {
    const r = resolveCadence(
      { externalId: "x", droneModelCode: 0, fieldType: "Farmland", currentCropType: null },
      { ...emptyConfig, by_crop: { "cana de azucar": 7 } }
    );
    expect(r.cadence_days).toBe(7);
    expect(r.reason).toBe('crop_type "Caña de azúcar" override');
  });

  it("level 3: by_crop matchea variantes con/sin acentos", () => {
    const r = resolveCadence(
      { externalId: "x", droneModelCode: 0, fieldType: "Farmland", currentCropType: "CAÑA DE AZÚCAR" },
      { ...emptyConfig, by_crop: { "cana de azucar": 7 } }
    );
    expect(r.cadence_days).toBe(7);
  });

  it("level 2: by_drone override gana sobre by_crop", () => {
    const r = resolveCadence(
      { externalId: "x", droneModelCode: 201, fieldType: "Farmland", currentCropType: "Caña de azúcar" },
      {
        ...emptyConfig,
        by_crop: { "cana de azucar": 7 },
        by_drone: { "201": 5 }
      }
    );
    expect(r.cadence_days).toBe(5);
    expect(r.reason).toBe("drone_code 201 override");
  });

  it("level 1: by_parcel override gana sobre todo (caso más específico)", () => {
    const r = resolveCadence(
      {
        externalId: "abc-123",
        droneModelCode: 201,
        fieldType: "Farmland",
        currentCropType: "Caña de azúcar"
      },
      {
        ...emptyConfig,
        by_crop: { "cana de azucar": 7 },
        by_drone: { "201": 5 },
        by_parcel: { "abc-123": 3 }
      }
    );
    expect(r.cadence_days).toBe(3);
    expect(r.reason).toBe("parcel_id override (abc-123)");
  });

  it("by_drone: número 0 es válido (drone sin asignar)", () => {
    const r = resolveCadence(
      { externalId: "x", droneModelCode: 0, fieldType: "Farmland", currentCropType: null },
      { ...emptyConfig, by_drone: { "0": 21 } }
    );
    expect(r.cadence_days).toBe(21);
  });

  it("droneModelCode null → ignora by_drone, cae al siguiente nivel", () => {
    const r = resolveCadence(
      { externalId: "x", droneModelCode: null, fieldType: "Farmland", currentCropType: null },
      { ...emptyConfig, by_drone: { "201": 5 } }
    );
    expect(r.cadence_days).toBe(14); // builtin default
  });

  it("currentCropType null + by_crop del default crop_type", () => {
    // Si no hay current pero el config tiene by_crop del default crop,
    // aún así debe matchear (sintetiza el default de fieldType)
    const r = resolveCadence(
      { externalId: "x", droneModelCode: 0, fieldType: "Farmland", currentCropType: null },
      { ...emptyConfig, by_crop: { "cana de azucar": 21 } }
    );
    expect(r.cadence_days).toBe(21);
    expect(r.crop_type).toBe("Caña de azúcar");
  });

  it("config defaults override builtin (level 3.5: por field_type desde config)", () => {
    const r = resolveCadence(
      { externalId: "x", droneModelCode: 0, fieldType: "Farmland", currentCropType: null },
      { ...emptyConfig, defaults: { Farmland: 21, Orchards: 8 } }
    );
    expect(r.cadence_days).toBe(21);
    expect(r.reason).toBe("config defaults[Farmland]");
  });

  it("preserva currentCropType cuando no hay by_crop", () => {
    // Si ya hay un crop_type (de una corrida previa) y no hay by_crop match,
    // el crop_type se preserva en el resultado (no se sobreescribe con el default)
    const r = resolveCadence(
      { externalId: "x", droneModelCode: 0, fieldType: "Farmland", currentCropType: "Café Premium" },
      emptyConfig
    );
    expect(r.crop_type).toBe("Café Premium");
    expect(r.cadence_days).toBe(14);
  });
});

describe("fumigation-cadence-config — contrato del config real", () => {
  it("el config del repo parsea sin errores", () => {
    // Carga el config real que está en el repo
    const c = loadCadenceConfig("config/fumigation-cadences.json");
    expect(c._source).toContain("fumigation-cadences.json");
    expect(c.defaults).toEqual({ Farmland: 14, Orchards: 10 });
    expect(c.by_crop["cana de azucar"]).toBe(14);
    expect(c.by_crop["frutales"]).toBe(10);
    expect(c.by_drone["201"]).toBe(10);
    expect(c.by_parcel["1268692918907510784-flyer-0047243d-610e-4d2e-84a4-198ac9ac31db"]).toBe(7);
  });
});
