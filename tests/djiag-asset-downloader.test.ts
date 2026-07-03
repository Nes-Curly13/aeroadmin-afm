// Tests para lib/djiag-asset-downloader.js — helper puro.
//
// Estrategia:
//   - Mockear fetch con una función que devuelve respuestas controladas.
//   - Usar fs.mkdtempSync para directorios temporales aislados.
//   - Sin red, sin Playwright, sin DB.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DEFAULT_KINDS,
  sanitizeExternalId,
  buildAssetPath,
  buildAssetIndex,
  pLimit,
  backoffMs,
  fetchWithRetry,
  runDownload
} from '../lib/djiag-asset-downloader';

describe('sanitizeExternalId', () => {
  it('preserva letras, dígitos, guion, guion bajo y punto', () => {
    expect(sanitizeExternalId('abc-123_xyz.v1')).toBe('abc-123_xyz.v1');
  });

  it('reemplaza caracteres no permitidos con guion bajo', () => {
    expect(sanitizeExternalId('foo/bar baz.json')).toBe('foo_bar_baz.json');
  });

  it('maneja null/undefined devolviendo string vacío', () => {
    expect(sanitizeExternalId(null)).toBe('');
    expect(sanitizeExternalId(undefined)).toBe('');
  });

  it('replica el patrón de externalId de DJI', () => {
    const dj = '1268692918907510784-flyer-8c9bf480-7eb8-4e2b-b060-220a6046a0de';
    expect(sanitizeExternalId(dj)).toBe(dj); // sin cambios — todos válidos
  });
});

describe('buildAssetPath', () => {
  it('compone path con externalId + kind + .json', () => {
    expect(buildAssetPath('/tmp/x', 'abc-uuid', 'geometry'))
      .toBe(path.join('/tmp/x', 'abc-uuid_geometry.json'));
  });

  it('sanea externalId antes de componer', () => {
    expect(buildAssetPath('/tmp/x', 'foo/bar', 'parameter'))
      .toBe(path.join('/tmp/x', 'foo_bar_parameter.json'));
  });
});

describe('buildAssetIndex', () => {
  const sampleLands = [
    {
      externalId: 'aaa-uuid-1',
      name: 'Parcel A',
      geometryUrl: 'https://example.com/geom1',
      parameterUrl: 'https://example.com/param1',
      waypointUrl: 'https://example.com/wp1'
    },
    {
      externalId: 'bbb-uuid-2',
      name: 'Parcel B',
      geometryUrl: 'https://example.com/geom2',
      // sin parameterUrl ni waypointUrl
    },
    {
      // sin externalId → skip
      name: 'orphan',
      geometryUrl: 'https://example.com/geom3'
    }
  ];

  it('genera 3 tasks por land cuando tiene todas las URLs', () => {
    const tasks = buildAssetIndex(sampleLands);
    // Parcel A: 3 URLs (geometry+parameter+waypoint)
    // Parcel B: 1 URL (solo geometry)
    // Orphan: sin externalId → skip
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({
      externalId: 'aaa-uuid-1',
      kind: 'geometry',
      url: 'https://example.com/geom1'
    });
  });

  it('omite tasks para URLs faltantes', () => {
    const tasks = buildAssetIndex(sampleLands);
    const parcelB = tasks.filter((t) => t.externalId === 'bbb-uuid-2');
    expect(parcelB).toHaveLength(1);
    expect(parcelB[0].kind).toBe('geometry');
  });

  it('filtra por kinds cuando se especifica', () => {
    const tasks = buildAssetIndex(sampleLands, ['geometry']);
    expect(tasks.every((t) => t.kind === 'geometry')).toBe(true);
    expect(tasks).toHaveLength(2);
  });

  it('omite lands sin externalId', () => {
    const tasks = buildAssetIndex(sampleLands);
    expect(tasks.some((t) => t.url === 'https://example.com/geom3')).toBe(false);
  });

  it('devuelve array vacío si no hay lands', () => {
    expect(buildAssetIndex([])).toEqual([]);
  });
});

describe('pLimit', () => {
  it('limita la concurrencia al número especificado', async () => {
    const limit = pLimit(2);
    let active = 0;
    let maxActive = 0;
    const work = Array.from({ length: 6 }, () => limit(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
    }));
    await Promise.all(work);
    expect(maxActive).toBe(2);
  });

  it('propaga errores sin bloquear la cola', async () => {
    const limit = pLimit(1);
    const ok = limit(async () => 'ok');
    const bad = limit(async () => { throw new Error('boom'); });
    const after = limit(async () => 'after');
    await expect(ok).resolves.toBe('ok');
    await expect(bad).rejects.toThrow('boom');
    await expect(after).resolves.toBe('after');
  });
});

describe('backoffMs', () => {
  it('crece exponencialmente', () => {
    const a0 = backoffMs(0, 500, 15000);
    const a1 = backoffMs(1, 500, 15000);
    const a2 = backoffMs(2, 500, 15000);
    // Permitir jitter, pero a0 debe ser ~500, a1 ~1000, a2 ~2000
    expect(a0).toBeGreaterThanOrEqual(375);
    expect(a0).toBeLessThanOrEqual(625);
    expect(a1).toBeGreaterThanOrEqual(750);
    expect(a1).toBeLessThanOrEqual(1250);
    expect(a2).toBeGreaterThanOrEqual(1500);
    expect(a2).toBeLessThanOrEqual(2500);
  });

  it('respeta maxDelayMs como cap', () => {
    expect(backoffMs(10, 500, 15000)).toBeLessThanOrEqual(15000 + 15000 * 0.25);
  });

  it('no devuelve valores negativos', () => {
    for (let i = 0; i < 100; i++) {
      expect(backoffMs(i, 500, 15000)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('fetchWithRetry', () => {
  function makeOk(body = '{"ok":true}', status = 200) {
    const fn = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body
    }));
    // Cast: vitest infiere `Mock<...>` muy estricto; fetchWithRetry acepta
    // `typeof globalThis.fetch`. El shim .d.ts declara `fetchImpl?: typeof fetch`,
    // y este cast mantiene el contrato sin envenenar a otros tests.
    return fn as unknown as typeof globalThis.fetch;
  }

  it('devuelve el response al primer intento si es 2xx', async () => {
    const fetchImpl = makeOk();
    const res = await fetchWithRetry('https://x/y', { fetchImpl, retries: 3 });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reintenta en 5xx y termina con éxito', async () => {
    let n = 0;
    const fetchImpl = (vi.fn(async () => {
      n += 1;
      return {
        ok: n >= 2,
        status: n >= 2 ? 200 : 503,
        text: async () => '{"ok":true}'
      };
    }) as unknown as typeof globalThis.fetch);
    const res = await fetchWithRetry('https://x/y', { fetchImpl, retries: 3, baseDelayMs: 1, maxDelayMs: 5 });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reintenta en 429', async () => {
    let n = 0;
    const fetchImpl = (vi.fn(async () => {
      n += 1;
      return {
        ok: n >= 3,
        status: n >= 3 ? 200 : 429,
        text: async () => '{}'
      };
    }) as unknown as typeof globalThis.fetch);
    const res = await fetchWithRetry('https://x/y', { fetchImpl, retries: 3, baseDelayMs: 1, maxDelayMs: 5 });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('NO reintenta en 4xx no-retryable (ej. 404)', async () => {
    const fetchImpl = makeOk('not found', 404);
    const res = await fetchWithRetry('https://x/y', { fetchImpl, retries: 3 });
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throw tras agotar retries en network error', async () => {
    const fetchImpl = (vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof globalThis.fetch);
    await expect(
      fetchWithRetry('https://x/y', { fetchImpl, retries: 2, baseDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow('ECONNRESET');
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('devuelve el Response 503 al caller tras agotar retries (responsabilidad del caller detectar !ok)', async () => {
    const fetchImpl = (vi.fn(async () => ({ ok: false, status: 503, text: async () => '' })) as unknown as typeof globalThis.fetch);
    const res = await fetchWithRetry('https://x/y', { fetchImpl, retries: 2, baseDelayMs: 1, maxDelayMs: 5 });
    expect(res.status).toBe(503);
    expect(res.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe('runDownload', () => {
  let tmpDir: string;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dji-dl-'));
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeLands = () => ([
    {
      externalId: 'aaa-uuid-1',
      name: 'Parcel A',
      geometryUrl: 'https://example.com/geom1.json',
      parameterUrl: 'https://example.com/param1.json',
      waypointUrl: 'https://example.com/wp1.json'
    },
    {
      externalId: 'bbb-uuid-2',
      name: 'Parcel B',
      geometryUrl: 'https://example.com/geom2.json',
      // parameter/waypoint null
    }
  ]);

  it('descarga todos los assets cuando fetch es 200', async () => {
    const fetchImpl = (vi.fn(async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ url, type: 'FeatureCollection' })
    })) as unknown as typeof globalThis.fetch);

    const stats = await runDownload({
      lands: makeLands(),
      outDir: tmpDir,
      fetchImpl,
      retries: 0
    });

    expect(stats.total).toBe(4); // 3 + 1
    expect(stats.downloaded).toBe(4);
    expect(stats.failed).toBe(0);
    expect(fs.readdirSync(tmpDir).sort()).toEqual([
      'aaa-uuid-1_geometry.json',
      'aaa-uuid-1_parameter.json',
      'aaa-uuid-1_waypoint.json',
      'bbb-uuid-2_geometry.json'
    ]);
  });

  it('omite archivos ya existentes (idempotencia)', async () => {
    // Pre-poblar un archivo
    fs.writeFileSync(path.join(tmpDir, 'aaa-uuid-1_geometry.json'), '{"pre":true}');
    const fetchImpl = (vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' })) as unknown as typeof globalThis.fetch);

    const stats = await runDownload({
      lands: makeLands(),
      outDir: tmpDir,
      fetchImpl,
      retries: 0
    });

    expect(stats.skipped).toBe(1);
    expect(stats.downloaded).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // solo los 3 que no existían
    expect(JSON.parse(fs.readFileSync(path.join(tmpDir, 'aaa-uuid-1_geometry.json'), 'utf8')))
      .toEqual({ pre: true }); // intacto
  });

  it('re-descarga con --force', async () => {
    fs.writeFileSync(path.join(tmpDir, 'aaa-uuid-1_geometry.json'), '{"pre":true}');
    const fetchImpl = (vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"new":true}' })) as unknown as typeof globalThis.fetch);

    const stats = await runDownload({
      lands: makeLands(),
      outDir: tmpDir,
      fetchImpl,
      retries: 0,
      force: true
    });

    expect(stats.skipped).toBe(0);
    expect(stats.downloaded).toBe(4);
    expect(JSON.parse(fs.readFileSync(path.join(tmpDir, 'aaa-uuid-1_geometry.json'), 'utf8')))
      .toEqual({ new: true });
  });

  it('cuenta como failed si la response no es JSON válido', async () => {
    const fetchImpl = (vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>not json</html>' })) as unknown as typeof globalThis.fetch);
    const stats = await runDownload({
      lands: makeLands(),
      outDir: tmpDir,
      fetchImpl,
      retries: 0
    });
    expect(stats.failed).toBe(4);
    expect(stats.errors[0].error).toMatch(/not valid JSON/);
  });

  it('cuenta como failed si la response es 5xx y agota retries', async () => {
    const fetchImpl = (vi.fn(async () => ({ ok: false, status: 503, text: async () => '' })) as unknown as typeof globalThis.fetch);
    const stats = await runDownload({
      lands: makeLands(),
      outDir: tmpDir,
      fetchImpl,
      retries: 1,
      baseDelayMs: 1,
      maxDelayMs: 5
    });
    expect(stats.failed).toBe(4);
    expect(stats.errors.every((e) => e.error.includes('HTTP 503'))).toBe(true);
  });

  it('respeta concurrency (no excede)', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = (vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return { ok: true, status: 200, text: async () => '{}' };
    }) as unknown as typeof globalThis.fetch);

    await runDownload({
      lands: makeLands(),
      outDir: tmpDir,
      fetchImpl,
      retries: 0,
      concurrency: 2
    });

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('filtra por kinds cuando se especifica', async () => {
    const fetchImpl = (vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' })) as unknown as typeof globalThis.fetch);
    const stats = await runDownload({
      lands: makeLands(),
      outDir: tmpDir,
      fetchImpl,
      retries: 0,
      kinds: ['geometry']
    });
    expect(stats.total).toBe(2);
    expect(stats.downloaded).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('cuenta bytes descargados', async () => {
    const payload = '{"a":1,"b":2}'; // 13 chars → 13 bytes UTF-8
    const expected = Buffer.byteLength(payload, 'utf8');
    const fetchImpl = (vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => payload
    })) as unknown as typeof globalThis.fetch);
    const stats = await runDownload({
      lands: makeLands(),
      outDir: tmpDir,
      fetchImpl,
      retries: 0
    });
    expect(stats.downloaded).toBe(4);
    expect(stats.bytes).toBe(expected * 4); // 4 downloads del mismo payload
  });
});