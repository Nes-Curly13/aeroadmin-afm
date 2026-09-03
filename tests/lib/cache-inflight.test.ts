// Tests para `cachedFetch` — Sprint S10.5 (issue #35).
//
// Patrón: in-flight request coalescing. N callers concurrentes a la misma
// `key` disparan UNA sola ejecución del `fetcher`; los otros N-1 esperan la
// misma Promise. El `Map<key, Promise>` se limpia en `.finally()` así la
// próxima llamada después del settle re-fetched fresco.
//
// Diferencia clave vs `unstable_cache` (next/cache):
//   - `unstable_cache` deduplica Y persiste (TTL + tags) entre renders.
//   - `cachedFetch` deduplica SOLO durante el in-flight. Después de settle
//     el entry desaparece. Para caching persistente, seguir usando
//     `unstable_cache` (o combinar ambos: wrap con cachedFetch adentro de
//     unstable_cache, o vice-versa, según el caso).
//
// Por qué mockear `next/cache` y `@/lib/db`: el módulo `lib/cache.ts`
// importa `unstable_cache` y `getDb` en top-level. Sin mocks, el import
// falla (no hay runtime de Next ni DB en unit tests). Los mocks son
// passthrough / noop: el comportamiento de `cachedFetch` no depende de
// Next, es lógica pura con `Map`.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks hoisted ────────────────────────────────────────────────────────

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: any[]) => any>(cb: T): T => cb,
  revalidateTag: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    query: vi.fn()
  })
}));

// Importar DESPUÉS de los mocks.
import { cachedFetch, _resetInFlight } from "@/lib/cache";

beforeEach(() => {
  _resetInFlight();
});

// ─── Tests del comportamiento de coalescing ─────────────────────────────

describe("cachedFetch — in-flight coalescing (S10.5, issue #35)", () => {
  it("5 concurrent calls to the same key → fetcher called 1 time, all 5 receive the same value", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      // Simular latencia de backend para forzar el overlap.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { value: 42 };
    });

    const results = await Promise.all([
      cachedFetch("k1", fetcher),
      cachedFetch("k1", fetcher),
      cachedFetch("k1", fetcher),
      cachedFetch("k1", fetcher),
      cachedFetch("k1", fetcher)
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(calls).toBe(1);
    expect(results).toEqual([
      { value: 42 },
      { value: 42 },
      { value: 42 },
      { value: 42 },
      { value: 42 }
    ]);
  });

  it("concurrent calls to DIFFERENT keys → N fetches, all parallel", async () => {
    const f1 = vi.fn(async () => "a");
    const f2 = vi.fn(async () => "b");
    const f3 = vi.fn(async () => "c");

    const [r1, r2, r3] = await Promise.all([
      cachedFetch("k1", f1),
      cachedFetch("k2", f2),
      cachedFetch("k3", f3)
    ]);

    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);
    expect(f3).toHaveBeenCalledTimes(1);
    expect(r1).toBe("a");
    expect(r2).toBe("b");
    expect(r3).toBe("c");
  });

  it("after the promise resolves, the in-flight entry is removed (so a new call after settle will fetch fresh)", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => {
      n += 1;
      return n;
    });

    const first = await cachedFetch("k1", fetcher);
    expect(first).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Segunda llamada DESPUÉS del settle: tiene que re-fetched (no
    // devuelve el valor cacheado, porque cachedFetch no persiste).
    const second = await cachedFetch("k1", fetcher);
    expect(second).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("error in fetcher → the in-flight entry is removed (no poisoned promise)", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("backend down");
      return "ok";
    });

    // Primera llamada: rejects.
    await expect(cachedFetch("k1", fetcher)).rejects.toThrow("backend down");

    // Segunda llamada: tiene que re-fetched (entry eliminado en
    // .finally()), NO devolver la promise rechazada en caché.
    const result = await cachedFetch("k1", fetcher);
    expect(result).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects the SAME error to all coalesced callers", async () => {
    // Bonus: N callers concurrentes al mismo key que falla → todos
    // reciben el mismo error, y el fetcher se llama 1 vez (no N).
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("boom");
    });

    const results = await Promise.allSettled([
      cachedFetch("k1", fetcher),
      cachedFetch("k1", fetcher),
      cachedFetch("k1", fetcher)
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(calls).toBe(1);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") {
        expect((r.reason as Error).message).toBe("boom");
      }
    }
  });

  it("preserves the returned value type (generic T)", async () => {
    // Bonus: test genérico — el caller recibe exactamente el tipo T
    // que devolvió el fetcher, sin coercion ni wrapping.
    const fetcher = vi.fn(async () => ({
      id: 7,
      label: "test"
    }));
    const result = await cachedFetch<{ id: number; label: string }>("k1", fetcher);
    expect(result.id).toBe(7);
    expect(result.label).toBe("test");
  });

  it("does not leak entries across keys (after settle, only that key is cleared)", async () => {
    // Bonus: si keyA settle y keyB sigue in-flight, keyA debe poder
    // re-fetched mientras keyB mantiene su promise original.
    const fA = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "A";
    });
    const fB = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "B";
    });

    const pA1 = cachedFetch("keyA", fA);
    const pB = cachedFetch("keyB", fB);
    await pA1;
    // pA ya settled — keyA fue removido del map.
    const pA2 = cachedFetch("keyA", fA);
    const [, , valB] = await Promise.all([pA1, pA2, pB]);

    expect(fA).toHaveBeenCalledTimes(2);
    expect(fB).toHaveBeenCalledTimes(1);
    expect(valB).toBe("B");
  });
});
