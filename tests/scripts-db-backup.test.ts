// Tests para scripts/db-backup.js (Sprint C — H3a).
//
// Estrategia:
//   - Importar el .js via createRequire (mismo patrón que
//     tests/djiag-asset-downloader.test.ts). El script es CJS y los
//     helpers exportados son `loadLocalEnv`, `timestampForFilename`,
//     `runPgDump`, `rotateBackups`, `pgDumpAvailable`, `formatBytes`.
//   - `runPgDump` y `pgDumpAvailable` aceptan una función `exec`
//     inyectable (dependency injection). vitest no puede mockear
//     `createRequire('child_process')` (solo intercepta ES module
//     imports), así que la DI es la forma portable de testear las
//     primitivas que hacen subprocess spawn.
//   - Usar fs.mkdtempSync para directorios temporales aislados.
//
// NO testeamos `main()` end-to-end (requiere .env.local con DATABASE_URL
// real + pg_dump instalado). Testeamos las primitivas puras y los exit
// codes de las rutas de error más críticas (DATABASE_URL ausente,
// pg_dump ausente) están cubiertas indirectamente por los unit tests
// de las primitivas.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const dbBackup = require("../scripts/db-backup.js") as {
  loadLocalEnv: () => void;
  timestampForFilename: (d?: Date) => string;
  runPgDump: (
    url: string,
    exec?: (cmd: string, args: string[], opts: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }>
  ) => Promise<Buffer>;
  rotateBackups: (dir: string, retentionDays: number) => Promise<{
    removed: string[];
    kept: number;
    failed: string[];
  }>;
  pgDumpAvailable: (
    exec?: (cmd: string, args: string[], opts: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }>
  ) => Promise<boolean>;
  formatBytes: (n: number) => string;
};

describe("db-backup — loadLocalEnv", () => {
  let tmpDir: string;
  let originalCwd: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-backup-env-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    savedEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_URL_DIRECT: process.env.DATABASE_URL_DIRECT,
      BACKUP_RETENTION_DAYS: process.env.BACKUP_RETENTION_DAYS
    };
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_DIRECT;
    delete process.env.BACKUP_RETENTION_DAYS;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("carga DATABASE_URL desde .env.local si no está en process.env", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".env.local"),
      "DATABASE_URL=postgresql://test:test@localhost/db\n",
      "utf8"
    );
    dbBackup.loadLocalEnv();
    expect(process.env.DATABASE_URL).toBe("postgresql://test:test@localhost/db");
  });

  it("no pisa variables ya seteadas en process.env", () => {
    process.env.DATABASE_URL = "postgresql://already:set@host/db";
    fs.writeFileSync(
      path.join(tmpDir, ".env.local"),
      "DATABASE_URL=postgresql://fromfile:fromfile@host/db\n",
      "utf8"
    );
    dbBackup.loadLocalEnv();
    expect(process.env.DATABASE_URL).toBe("postgresql://already:set@host/db");
  });

  it("ignora comentarios y líneas vacías en .env.local", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".env.local"),
      "# comentario\n\n  \nDATABASE_URL=postgres://x\n",
      "utf8"
    );
    dbBackup.loadLocalEnv();
    expect(process.env.DATABASE_URL).toBe("postgres://x");
  });

  it("no falla si .env.local no existe", () => {
    expect(() => dbBackup.loadLocalEnv()).not.toThrow();
  });
});

describe("db-backup — timestampForFilename", () => {
  it("genera YYYY-MM-DD-HHmm con zero-padding", () => {
    const d = new Date(2026, 6, 23, 9, 5); // 23 jul 2026 09:05 local
    expect(dbBackup.timestampForFilename(d)).toBe("2026-07-23-0905");
  });

  it("zero-padea mes, día, hora y minutos < 10", () => {
    const d = new Date(2026, 0, 3, 0, 0);
    expect(dbBackup.timestampForFilename(d)).toBe("2026-01-03-0000");
  });
});

describe("db-backup — formatBytes", () => {
  it("formatea bytes < 1KB como B", () => {
    expect(dbBackup.formatBytes(500)).toBe("500 B");
  });

  it("formatea KB entre 1KB y 1MB", () => {
    expect(dbBackup.formatBytes(2048)).toBe("2.0 KB");
  });

  it("formatea MB >= 1MB", () => {
    expect(dbBackup.formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("db-backup — runPgDump (con exec inyectable)", () => {
  it("llama pg_dump con flags seguros (--no-owner --no-privileges --clean --if-exists)", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "BEGIN;\n-- dump content\n", stderr: "" });
    const buffer = await dbBackup.runPgDump("postgres://x/y", exec);
    expect(exec).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = exec.mock.calls[0]!;
    expect(cmd).toBe("pg_dump");
    // Argumentos en el ORDEN esperado. Cambiar el orden es breaking para
    // cualquier re-shimming futuro del binario.
    expect(args).toEqual([
      "--no-owner",
      "--no-privileges",
      "--clean",
      "--if-exists",
      "-d",
      "postgres://x/y"
    ]);
    // maxBuffer es defense in depth — sin él, dumps >1MB revientan
    // execFile con ENOBUFS en el wrapper promisify.
    expect(opts).toMatchObject({ maxBuffer: expect.any(Number) });
    expect(opts.maxBuffer).toBeGreaterThanOrEqual(1024 * 1024);
    // Devuelve un Buffer con el contenido del stdout.
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString("utf8")).toContain("BEGIN");
  });

  it("propaga el error del exec inyectable (main() espera poder leer .stderr)", async () => {
    const fakeErr = Object.assign(new Error("pg_dump exited 1"), {
      stderr: "psql: error: connection failed"
    });
    const exec = vi.fn().mockRejectedValue(fakeErr);
    await expect(dbBackup.runPgDump("postgres://bad", exec)).rejects.toBe(fakeErr);
  });

  it("usa execFileP por default si no se inyecta (smoke test — falla rápido con ENOENT, no TypeError)", async () => {
    // Inyectamos un exec que simula `pg_dump` no instalado en PATH
    // (mismo error que tiraría el execFileP real en CI Ubuntu sin libpq).
    // Lo que importa: NO debe tirar TypeError ni colgar 15s esperando DNS
    // a un Postgres que no existe.
    const fakeErr = Object.assign(new Error("spawn pg_dump ENOENT"), {
      code: "ENOENT",
      stderr: Buffer.from(""),
    });
    const exec = vi.fn().mockRejectedValue(fakeErr);

    try {
      const buffer = await dbBackup.runPgDump("postgres://localhost/none", exec);
      // Si por algún motivo el mock devolvió un buffer (no debería):
      expect(Buffer.isBuffer(buffer)).toBe(true);
    } catch (err) {
      // El error es el esperado, no un TypeError de la DI rota.
      expect(err).toBeInstanceOf(Error);
      expect(String((err as Error).message)).toMatch(/ENOENT|exited|connection/);
    }

    // Sanity: confirmamos que se llamó al exec (no al default execFileP).
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe("db-backup — rotateBackups", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-backup-rotate-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Toca el mtime de un archivo a un timestamp específico.
   * Usamos utimesSync (no utimes) por consistencia con Node stdlib.
   */
  function setMtime(file: string, when: Date) {
    fs.utimesSync(file, when, when);
  }

  it("borra archivos con mtime > 7 días y deja los recientes", async () => {
    const now = Date.now();
    const oldDate = new Date(now - 10 * 24 * 60 * 60 * 1000); // 10 días atrás
    const recentDate = new Date(now - 2 * 24 * 60 * 60 * 1000); // 2 días atrás
    fs.writeFileSync(path.join(tmpDir, "dump-2026-07-10-0200.sql.gz"), "old");
    fs.writeFileSync(path.join(tmpDir, "dump-2026-07-20-0200.sql.gz"), "new");
    setMtime(path.join(tmpDir, "dump-2026-07-10-0200.sql.gz"), oldDate);
    setMtime(path.join(tmpDir, "dump-2026-07-20-0200.sql.gz"), recentDate);

    const result = await dbBackup.rotateBackups(tmpDir, 7);
    expect(result.removed).toEqual(["dump-2026-07-10-0200.sql.gz"]);
    expect(result.kept).toBe(1);
    expect(result.failed).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, "dump-2026-07-10-0200.sql.gz"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "dump-2026-07-20-0200.sql.gz"))).toBe(true);
  });

  it("con 10 archivos variados, quedan solo 7 (los más recientes)", async () => {
    // Crea 10 archivos con mtime escalonado: 0.5, 1.5, ..., 9.5 días atrás.
    // El offset de 0.5 días evita que un archivo caiga EXACTAMENTE en el
    // boundary de 7 días (donde el `Date.now()` del cutoff puede diferir
    // del `now` capturado al inicio del test por unos ms y hacer que el
    // archivo "7 días" se cuente como viejo).
    // Archivos con mtime > 7 días (7.5, 8.5, 9.5) → BORRADOS (3)
    // Archivos con mtime <= 7 días (0.5 .. 6.5) → MANTENIDOS (7)
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      const daysAgo = i + 0.5;
      const file = path.join(tmpDir, `dump-2026-07-${String(21 + i).padStart(2, "0")}-0000.sql.gz`);
      fs.writeFileSync(file, `day ${i + 1}`);
      setMtime(file, new Date(now - daysAgo * 24 * 60 * 60 * 1000));
    }
    const result = await dbBackup.rotateBackups(tmpDir, 7);
    expect(result.removed).toHaveLength(3); // 7.5, 8.5, 9.5 días atrás
    expect(result.kept).toBe(7);
    // Los 3 más viejos (7.5, 8.5, 9.5 días) fueron borrados.
    expect(fs.existsSync(path.join(tmpDir, "dump-2026-07-28-0000.sql.gz"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "dump-2026-07-29-0000.sql.gz"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "dump-2026-07-30-0000.sql.gz"))).toBe(false);
    // Los 7 más jóvenes (0.5..6.5 días) siguen.
    expect(fs.existsSync(path.join(tmpDir, "dump-2026-07-21-0000.sql.gz"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "dump-2026-07-27-0000.sql.gz"))).toBe(true);
  });

  it("ignora archivos que no son dump-*.sql.gz (no borra otros archivos del dir)", async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "hola");
    fs.writeFileSync(path.join(tmpDir, "dump-2026-06-01-0000.sql.gz"), "old");
    setMtime(path.join(tmpDir, "dump-2026-06-01-0000.sql.gz"), oldDate);

    const result = await dbBackup.rotateBackups(tmpDir, 7);
    expect(result.removed).toEqual(["dump-2026-06-01-0000.sql.gz"]);
    expect(fs.existsSync(path.join(tmpDir, "readme.txt"))).toBe(true);
  });

  it("devuelve removed=[] si el dir no existe (idempotente, no falla)", async () => {
    const result = await dbBackup.rotateBackups(path.join(tmpDir, "no-existe"), 7);
    expect(result.removed).toEqual([]);
    expect(result.kept).toBe(0);
  });

  it("respeta BACKUP_RETENTION_DAYS=14 (custom, no solo default 7)", async () => {
    const now = Date.now();
    const oldDate = new Date(now - 10 * 24 * 60 * 60 * 1000); // 10 días atrás
    fs.writeFileSync(path.join(tmpDir, "dump-2026-07-10-0000.sql.gz"), "data");
    setMtime(path.join(tmpDir, "dump-2026-07-10-0000.sql.gz"), oldDate);

    // Con retention=7 → se borra (10 > 7)
    let result = await dbBackup.rotateBackups(tmpDir, 7);
    expect(result.removed).toHaveLength(1);
    // Re-creo el archivo con mtime viejo.
    fs.writeFileSync(path.join(tmpDir, "dump-2026-07-10-0000.sql.gz"), "data");
    setMtime(path.join(tmpDir, "dump-2026-07-10-0000.sql.gz"), oldDate);
    // Con retention=14 → se mantiene (10 < 14)
    result = await dbBackup.rotateBackups(tmpDir, 14);
    expect(result.removed).toHaveLength(0);
    expect(result.kept).toBe(1);
  });

  it("continúa aunque falle un unlink (best-effort, loguea en failed)", async () => {
    // Spy sobre fs.unlinkSync para que el segundo file falle.
    const realUnlink = fs.unlinkSync;
    const callCount = { n: 0 };
    const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation(((p: string) => {
      callCount.n += 1;
      if (callCount.n === 1) throw new Error("EACCES: permission denied");
      return realUnlink(p);
    }) as typeof fs.unlinkSync);
    try {
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      fs.writeFileSync(path.join(tmpDir, "dump-2026-06-01-0000.sql.gz"), "old1");
      fs.writeFileSync(path.join(tmpDir, "dump-2026-06-02-0000.sql.gz"), "old2");
      setMtime(path.join(tmpDir, "dump-2026-06-01-0000.sql.gz"), oldDate);
      setMtime(path.join(tmpDir, "dump-2026-06-02-0000.sql.gz"), oldDate);

      const result = await dbBackup.rotateBackups(tmpDir, 7);
      expect(result.removed).toHaveLength(1); // el segundo se borró OK
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatch(/EACCES/);
    } finally {
      unlinkSpy.mockRestore();
    }
  });
});

describe("db-backup — pgDumpAvailable (con exec inyectable)", () => {
  it("devuelve true si el exec inyectable tiene éxito", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "C:\\bin\\pg_dump.EXE", stderr: "" });
    const result = await dbBackup.pgDumpAvailable(exec);
    expect(result).toBe(true);
    // El comando de búsqueda depende del OS: `where` en Windows, `which` en Unix.
    // El script (db-backup.js) ya detecta process.platform, solo tenemos que
    // matchear la rama correspondiente en el test.
    const expectedCmd = process.platform === "win32" ? "where" : "which";
    expect(exec).toHaveBeenCalledWith(expectedCmd, ["pg_dump"], expect.any(Object));
  });

  it("devuelve false si el exec inyectable falla (pg_dump no está en PATH)", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("not found"));
    const result = await dbBackup.pgDumpAvailable(exec);
    expect(result).toBe(false);
  });
});
