/**
 * lib/log-capture.ts — captura de `console.log` scoped por request.
 *
 * Auditoría 2026-09-10 (#56): `app/api/admin/applications/import` capturaba
 * el stdout del script de import con un monkey-patch **global** de
 * `console.log` (`console.log = (...) => logs.push(...)`). Bajo
 * concurrencia eso es frágil: los logs de otros requests que corran en la
 * misma ventana se mezclan en la respuesta, y si el script tira una
 * excepción fuera del `finally` el `console.log` original queda pisado.
 *
 * Este helper usa `AsyncLocalStorage` para scopear la captura al contexto
 * async del caller. `console.log` se parchea una sola vez (lazy): si hay
 * un store activo escribe ahí; si no, delega al original. Cada request ve
 * solo sus propios logs.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const logSink = new AsyncLocalStorage<string[]>();

let patched = false;

function ensurePatched(): void {
  if (patched) return;
  patched = true;
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const sink = logSink.getStore();
    if (sink) {
      sink.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    } else {
      originalLog(...args);
    }
  };
}

/**
 * Corre `fn` con `console.log` capturado. Devuelve el resultado de `fn`
 * y la lista de líneas logueadas durante su ejecución async.
 */
export async function withLogCapture<T>(
  fn: () => Promise<T>
): Promise<{ result: T; logs: string[] }> {
  ensurePatched();
  const logs: string[] = [];
  const result = await logSink.run(logs, fn);
  return { result, logs };
}
