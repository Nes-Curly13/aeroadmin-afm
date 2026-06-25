// Tests para lib/djiag-flights-fetcher.js — parser puro de perflight_records.
//
// Usa fixture real capturado el 2026-06-23 (5 flights sample).
// Casos cubiertos:
//   - parsePerFlightFile: shape completo, errores, fixture real
//   - normalizeFlight: campos derivados correctos (Date, modeName, manualMode)
//   - createDateFromYYYYMMDD: 20260623 → '2026-06-23', null safety
//   - paramsToPgArray: orden exacto de 24 placeholders
//   - UPSERT_SQL: structural checks (24 placeholders, ON CONFLICT clause)
//   - notes JSON: contiene payload crudo + metadata del importer

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parsePerFlightFile,
  normalizeFlight,
  paramsToPgArray,
  UPSERT_SQL,
  MS_PER_SEC,
} from "@/lib/djiag-flights-fetcher";

function loadFixture(): { flights: any[]; meta: any } {
  const p = join(process.cwd(), "tests", "fixtures", "djiag-live", "perflight-records-sample.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("djiag-flights-fetcher — createDateFromYYYYMMDD", () => {
  it("convierte 20260623 → '2026-06-23'", async () => {
    const { normalizeFlight: norm } = await import("@/lib/djiag-flights-fetcher");
    const f = norm({ id: 1, create_date: 20260623, start_timestamp: 1782222338, end_timestamp: 1782222719, work_time_seconds: 381 });
    expect(f.createDate).toBe("2026-06-23");
  });

  it("acepta create_date como string numérico '20260623'", async () => {
    const { normalizeFlight: norm } = await import("@/lib/djiag-flights-fetcher");
    const f = norm({ id: 1, create_date: "20260623", start_timestamp: 1782222338, end_timestamp: 1782222719, work_time_seconds: 381 });
    expect(f.createDate).toBe("2026-06-23");
  });

  it("null safety: null, undefined, 0, 'invalid' → null", async () => {
    const { normalizeFlight: norm } = await import("@/lib/djiag-flights-fetcher");
    expect(norm({ id: 1, create_date: null }).createDate).toBeNull();
    expect(norm({ id: 1, create_date: undefined }).createDate).toBeNull();
    expect(norm({ id: 1, create_date: 0 }).createDate).toBeNull();
    expect(norm({ id: 1, create_date: "invalid" }).createDate).toBeNull();
    expect(norm({ id: 1, create_date: 2026 }).createDate).toBeNull(); // 4 dígitos, no 8
  });
});

describe("djiag-flights-fetcher — normalizeFlight (fixture real)", () => {
  it("parsea el primer flight del fixture con todos los campos esperados", () => {
    const fixture = loadFixture();
    const raw = fixture.flights[0];
    const f = normalizeFlight(raw);

    // Identidad
    expect(f.flightId).toBe(raw.id);
    expect(f.parcelId).toBeNull(); // siempre null en esta etapa

    // Drone
    expect(f.droneSerial).toBe(raw.serial_number);
    expect(f.droneNickname).toBe(raw.nickname);

    // Piloto
    expect(f.pilotName).toBe(raw.team_name);
    expect(f.flyerName).toBe(raw.flyer_name);

    // Location
    expect(f.district).toBe(raw.district);
    expect(f.location).toBe(raw.location);

    // Timestamps (segundos → Date)
    expect(f.startAt).toBeInstanceOf(Date);
    expect(f.endAt).toBeInstanceOf(Date);
    expect(f.startAt!.getTime()).toBe(raw.start_timestamp * MS_PER_SEC);
    expect(f.endAt!.getTime()).toBe(raw.end_timestamp * MS_PER_SEC);

    // Métricas
    expect(f.durationSeconds).toBe(raw.work_time_seconds);
    expect(f.areaM2).toBe(raw.new_work_area);
    expect(f.sprayUsageMl).toBe(raw.spray_usage);
    expect(f.workSpeedMS).toBe(raw.work_speed);
    expect(f.sprayWidthM).toBe(raw.spray_width);
    expect(f.radarHeightM).toBe(raw.radar_height);

    // Booleans
    expect(typeof f.manualMode).toBe("boolean");
    expect(f.manualMode).toBe(raw.manual_mode);
    expect(f.modeName).toBe(raw.mode_name);

    // Geo
    expect(f.lng).toBe(raw.lng);
    expect(f.lat).toBe(raw.lat);
    expect(f.createDate).toBe("2026-06-23");
  });

  it("tolerancia a missing fields (no crash, null/0 donde corresponde)", () => {
    const partial = {
      id: 999,
      start_timestamp: 1782222338,
      end_timestamp: 1782222719,
      work_time_seconds: 100,
    };
    const f = normalizeFlight(partial);
    expect(f.flightId).toBe(999);
    expect(f.droneSerial).toBeNull();
    expect(f.pilotName).toBeNull();
    expect(f.areaM2).toBeNull();
    expect(f.sprayUsageMl).toBeNull();
    expect(f.lng).toBeNull();
    expect(f.lat).toBeNull();
    expect(f.durationSeconds).toBe(100);
  });

  it("notes JSON incluye source tag + payload crudo del DJI (per-flight list)", () => {
    const fixture = loadFixture();
    const f = normalizeFlight(fixture.flights[0]);
    expect(f.notes.source).toBe("djiscraper-perflight");
    expect(f.notes.raw.id).toBe(fixture.flights[0].id);
    // El per-flight list endpoint expone estos campos (NO hardware_id —
    // ese solo viene del detail endpoint flight_records/{id}).
    expect(f.notes.raw.usage_type).toBeDefined();
    expect(f.notes.raw.plot_name).toBeNull(); // siempre null en este endpoint
    expect("plot_name" in f.notes.raw).toBe(true); // key siempre presente
    expect("is_weight" in f.notes.raw).toBe(true);
    expect(f.notes.raw.created_at).toBeDefined();
  });

  it("start_at/end_at faltantes → startAt/endAt son null (no lanza)", () => {
    // normalizeFlight es tolerante: devuelve null para timestamps faltantes.
    // El caller (upsertFlights) es quien decide si tirar error o skip.
    const partial = { id: 1, work_time_seconds: 100 };
    const f = normalizeFlight(partial);
    expect(f.startAt).toBeNull();
    expect(f.endAt).toBeNull();
    // durationSeconds tiene fallback 0 cuando falta
    expect(f.durationSeconds).toBe(100);
  });

  it("lanza si flight no es objeto", () => {
    expect(() => normalizeFlight(null as unknown as object)).toThrow();
    expect(() => normalizeFlight("string" as unknown as object)).toThrow();
  });
});

describe("djiag-flights-fetcher — parsePerFlightFile (fixture real)", () => {
  it("parsea el archivo perflight_records.json correctamente", () => {
    const fixture = loadFixture();
    const parsed = parsePerFlightFile(fixture);

    expect(parsed.flights).toHaveLength(5);
    expect(parsed.meta.totalCount).toBe(7059); // del archivo completo
    expect(parsed.meta.totalPages).toBe(236);
    expect(parsed.meta.days).toBe(30);
    expect(parsed.meta.pageSize).toBe(50);
  });

  it("todos los flights normalizados tienen flightId válido", () => {
    const fixture = loadFixture();
    const parsed = parsePerFlightFile(fixture);
    for (const f of parsed.flights) {
      expect(f.flightId).toBeGreaterThan(0);
      expect(typeof f.flightId).toBe("number");
    }
  });

  it("todos los flights tienen al menos 1 drone asociado y start/end timestamp", () => {
    const fixture = loadFixture();
    const parsed = parsePerFlightFile(fixture);
    for (const f of parsed.flights) {
      expect(f.droneNickname).toBeTruthy();
      expect(f.startAt).toBeInstanceOf(Date);
      expect(f.endAt).toBeInstanceOf(Date);
    }
  });

  it("errores: file no es objeto", () => {
    expect(() => parsePerFlightFile(null as unknown as object)).toThrow(/not an object/);
    expect(() => parsePerFlightFile({} as unknown as object)).toThrow(/flights/);
  });
});

describe("djiag-flights-fetcher — UPSERT_SQL (estructura)", () => {
  it("tiene 24 placeholders ($1..$24)", () => {
    const matches = UPSERT_SQL.match(/\$\d+/g) ?? [];
    expect(matches.length).toBe(24);
    for (let i = 1; i <= 24; i++) {
      expect(matches).toContain(`$${i}`);
    }
  });

  it("usa ON CONFLICT (flight_id, source) DO UPDATE", () => {
    expect(UPSERT_SQL).toMatch(/ON CONFLICT \(flight_id, source\) DO UPDATE/);
  });

  it("el DO UPDATE incluye todos los campos modificables (drone, pilot, parcel, etc.)", () => {
    // Parcel_id se actualiza (esto es lo que hace el spatial join)
    expect(UPSERT_SQL).toMatch(/parcel_id\s*=\s*EXCLUDED\.parcel_id/);
    expect(UPSERT_SQL).toMatch(/drone_serial\s*=\s*EXCLUDED\.drone_serial/);
    expect(UPSERT_SQL).toMatch(/drone_nickname\s*=\s*EXCLUDED\.drone_nickname/);
    expect(UPSERT_SQL).toMatch(/pilot_name\s*=\s*EXCLUDED\.pilot_name/);
    expect(UPSERT_SQL).toMatch(/start_at\s*=\s*EXCLUDED\.start_at/);
    expect(UPSERT_SQL).toMatch(/area_m2\s*=\s*EXCLUDED\.area_m2/);
    expect(UPSERT_SQL).toMatch(/spray_usage_ml\s*=\s*EXCLUDED\.spray_usage_ml/);
    expect(UPSERT_SQL).toMatch(/notes\s*=\s*EXCLUDED\.notes/);
  });
});

describe("djiag-flights-fetcher — paramsToPgArray", () => {
  it("orden exacto de 24 valores", () => {
    const fixture = loadFixture();
    const f = normalizeFlight(fixture.flights[0]);
    const arr = paramsToPgArray(f);

    expect(arr).toHaveLength(24);
    expect(arr[0]).toBe(f.flightId);          // $1 flight_id
    expect(arr[1]).toBeNull();               // $2 parcel_id (null hasta spatial join)
    expect(arr[2]).toBe(f.droneSerial);      // $3 drone_serial
    expect(arr[3]).toBe(f.droneNickname);    // $4 drone_nickname
    expect(arr[4]).toBe(f.pilotName);        // $5 pilot_name
    expect(arr[5]).toBe(f.flyerName);        // $6 flyer_name
    expect(arr[6]).toBe(f.district);         // $7 district
    expect(arr[7]).toBe(f.location);         // $8 location
    expect(arr[8]).toBe(f.startAt);          // $9 start_at
    expect(arr[9]).toBe(f.endAt);            // $10 end_at
    expect(arr[10]).toBe(f.durationSeconds); // $11 duration_seconds
    expect(arr[11]).toBe(f.areaM2);          // $12 area_m2
    expect(arr[12]).toBe(f.sprayUsageMl);    // $13 spray_usage_ml
    expect(arr[13]).toBe(f.workSpeedMS);     // $14 work_speed_m_s
    expect(arr[14]).toBe(f.sprayWidthM);     // $15 spray_width_m
    expect(arr[15]).toBe(f.radarHeightM);    // $16 radar_height_m
    expect(arr[16]).toBe(f.manualMode);      // $17 manual_mode
    expect(arr[17]).toBe(f.modeName);        // $18 mode_name
    expect(arr[18]).toBe(f.createDate);      // $19 create_date
    expect(arr[19]).toBe(f.lng);             // $20 lng
    expect(arr[20]).toBe(f.lat);             // $21 lat
    expect(typeof arr[21]).toBe("string");   // $22 notes (jsonb como string)
    expect(JSON.parse(arr[21] as string).source).toBe("djiscraper-perflight");
    expect(arr[22]).toBeInstanceOf(Date);    // $23 captured_at = now()
    expect(arr[23]).toBe("djiag");           // $24 source
  });
});