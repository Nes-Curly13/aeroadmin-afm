/**
 * tests/scripts-import-applications-from-excel.test.ts
 *
 * Test del CLI parseArgs. El resto del script (parser, matcher, DB inserts)
 * se cubre con tests/lib-excel-applications-{parser,matcher}.test.ts.
 * Sprint feature/excel-applications-import.
 */

import { describe, expect, it } from "vitest";
import { parseArgs } from "../scripts/import-applications-from-excel.js";

describe("parseArgs", () => {
  it("default: dryRun false, minScore 0.5, areaUnit null, limit null", () => {
    const opts = parseArgs(["C:/path/to/file.xlsx"]);
    expect(opts.xlsxPath).toBe("C:/path/to/file.xlsx");
    expect(opts.dryRun).toBe(false);
    expect(opts.minScore).toBe(0.5);
    expect(opts.areaUnit).toBe(null);
    expect(opts.limit).toBe(null);
  });

  it("acepta --dry-run", () => {
    const opts = parseArgs(["--dry-run", "C:/path/file.xlsx"]);
    expect(opts.dryRun).toBe(true);
  });

  it("acepta --area-unit=ha|m2", () => {
    expect(parseArgs(["--area-unit=ha", "f.xlsx"]).areaUnit).toBe("ha");
    expect(parseArgs(["--area-unit=m2", "f.xlsx"]).areaUnit).toBe("m2");
  });

  it("acepta --min-score=N", () => {
    expect(parseArgs(["--min-score=0.8", "f.xlsx"]).minScore).toBe(0.8);
  });

  it("acepta --limit=N", () => {
    expect(parseArgs(["--limit=100", "f.xlsx"]).limit).toBe(100);
  });

  it("acepta --actor-email=foo@bar", () => {
    expect(parseArgs(["--actor-email=test@afm.local", "f.xlsx"]).actorEmail).toBe("test@afm.local");
  });

  it("rechaza si falta el path", () => {
    expect(() => parseArgs([])).toThrow();
  });

  it("rechaza si hay flag desconocido", () => {
    // --unknown flag se trata como posicional → falla con "Uso:" message
    expect(() => parseArgs(["--foo", "f.xlsx"])).toThrow();
  });
});
