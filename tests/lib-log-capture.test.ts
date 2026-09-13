import { describe, expect, it } from "vitest";
import { withLogCapture } from "@/lib/log-capture";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tests de captura de logs scoped por contexto async (auditoría #56).
 * Reemplaza el monkey-patch global de console.log del import de Excel.
 */
describe("withLogCapture", () => {
  it("captura console.log durante la ejecución y devuelve el resultado", async () => {
    const { result, logs } = await withLogCapture(async () => {
      console.log("hola", 1);
      await delay(5);
      console.log("mundo");
      return 42;
    });
    expect(result).toBe(42);
    expect(logs).toEqual(["hola 1", "mundo"]);
  });

  it("scopea cada captura concurrente a su propio contexto (sin intercalar)", async () => {
    const a = withLogCapture(async () => {
      await delay(10);
      console.log("A");
      return "A";
    });
    const b = withLogCapture(async () => {
      console.log("B");
      await delay(10);
      return "B";
    });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.logs).toEqual(["A"]);
    expect(rb.logs).toEqual(["B"]);
    expect(ra.result).toBe("A");
    expect(rb.result).toBe("B");
  });

  it("no rompe logs fuera del contexto (delega al console.log original)", () => {
    expect(() => console.log("log sin captura")).not.toThrow();
  });

  it("propaga el error del callback sin dejar el logger capturado", async () => {
    await expect(
      withLogCapture(async () => {
        console.log("antes del throw");
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    // El siguiente capture sigue funcionando normalmente.
    const { logs } = await withLogCapture(async () => {
      console.log("despues");
    });
    expect(logs).toEqual(["despues"]);
  });
});
