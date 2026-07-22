// Tests para el fix de race condition en DjiagKoreanClient._captureResponse.
//
// S3 (audit 2026-07-22, docs/DJIAG_AUDIT.md H4).
//
// Bug historico (línea 219 de lib/djiag-korean-client.js antes del fix):
//   `this.page.on('response', listener)` se registraba DESPUES de
//   `await this.login()`. Si el primer fetch disparaba responses antes
//   de que el listener estuviera activo, se perdian (~1 de cada 20
//   corridas fallaba con "_captureResponse: no matching response within
//   30000ms").
//
// Fix: el listener se instala UNA VEZ en launch() via
// _installResponseBuffer(), y _captureResponse() filtra el buffer
// en vez de registrar listener nuevo. Snapshot + slice del buffer
// garantiza que solo se devuelven responses NUEVAS (post-snapshot).
// Buffer se limpia al final de cada captura (no leak entre fetches).
//
// Cobertura:
//   - listener se registra en _installResponseBuffer (no en _captureResponse)
//   - responses se bufferizan cuando se emiten
//   - filter por urlPattern (string y RegExp)
//   - snapshot garantiza que solo se devuelven responses post-trigger
//   - buffer se limpia al final de cada captura
//   - cap de 1000 items en el buffer
//   - integracion con launch() (via _installResponseBuffer)
//
// Patron: createRequire para el .js CJS; mockeamos el page de Playwright
// con un EventEmitter minimalista (sin module mock de 'playwright').

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DjiagKoreanClient } = require("../lib/djiag-korean-client") as {
  DjiagKoreanClient: new (opts?: any) => any;
};

/**
 * Mock minimalista de una Playwright `page`. Soporta `on`/`off` con un
 * event emitter, y expone un helper `_emitResponse(url, body)` para
 * simular responses del browser.
 */
function makeMockPage() {
  const handlers: Record<string, Array<(...args: any[]) => any>> = {};
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
    }),
    goto: vi.fn(async () => undefined),
    waitForResponse: vi.fn(),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    route: vi.fn(async () => undefined),
    waitForURL: vi.fn(async () => undefined),
    getByRole: vi.fn(() => ({ click: vi.fn(async () => undefined) })),
    locator: vi.fn(() => ({
      fill: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      count: vi.fn(async () => 0),
      first: vi.fn(() => ({ click: vi.fn(async () => undefined) }))
    })),
    _handlers: handlers,
    /** Emite un mock response a los listeners de 'response'. */
    async _emitResponse(url: string, body: unknown, status = 200) {
      const response = {
        url: () => url,
        status: () => status,
        json: async () => body
      };
      for (const h of handlers["response"] ?? []) {
        await h(response);
      }
    },
    /** Cuenta listeners activos para 'response'. */
    _responseListenerCount(): number {
      return (handlers["response"] ?? []).length;
    }
  };
}

/**
 * Construye un DjiagKoreanClient con un mock page ya attached y
 * `_installResponseBuffer()` ya ejecutado. `loggedIn = true` para
 * bypassear el flow de login. Devuelve { client, mockPage }.
 */
function makeReadyClient() {
  const client = new DjiagKoreanClient({
    // No hace falta email/password porque vamos a setear loggedIn = true
  });
  const mockPage = makeMockPage();
  (client as any).page = mockPage;
  (client as any).context = { storageState: async () => ({ cookies: [], origins: [] }) };
  (client as any).browser = { close: async () => undefined };
  (client as any).loggedIn = true;
  // Simular lo que launch() hace: instalar el listener
  client._installResponseBuffer();
  return { client, mockPage };
}

describe("DjiagKoreanClient._installResponseBuffer — registro del listener", () => {
  it("registra el listener en page.on('response', handler) UNA vez", () => {
    const { client, mockPage } = makeReadyClient();
    expect(mockPage.on).toHaveBeenCalledWith("response", expect.any(Function));
    expect(mockPage._responseListenerCount()).toBe(1);
    // Cleanup
    void client;
  });

  it("es idempotente: llamar 2 veces registra solo 1 listener", () => {
    const { client, mockPage } = makeReadyClient();
    const onCallsBefore = mockPage.on.mock.calls.length;
    // Llamar 2 veces sobre el MISMO client
    client._installResponseBuffer();
    client._installResponseBuffer();
    const newOnCalls = mockPage.on.mock.calls.length - onCallsBefore;
    expect(newOnCalls).toBe(0);
    expect(mockPage._responseListenerCount()).toBe(1);
  });

  it("el listener se registra en _installResponseBuffer, NO en _captureResponse", async () => {
    const { client, mockPage } = makeReadyClient();
    const onCallsBefore = mockPage.on.mock.calls.length;
    // Llamar _captureResponse con un trigger que SI emite una response
    const trigger = async () => {
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { n: 1 } } });
    };
    await (client as any)._captureResponse({
      urlPattern: "graphql?name=lands",
      triggerPageFn: trigger,
      minResponses: 1
    });
    // mockPage.on no deberia haberse llamado de nuevo durante _captureResponse
    expect(mockPage.on.mock.calls.length).toBe(onCallsBefore);
    // Y mockPage.off tampoco (no desregistramos el listener en _captureResponse)
    expect(mockPage.off).not.toHaveBeenCalled();
  });
});

describe("DjiagKoreanClient._installResponseBuffer — bufferizado de responses", () => {
  it("las responses 200 con body JSON no vacio se agregan al buffer", async () => {
    const { client, mockPage } = makeReadyClient();
    await mockPage._emitResponse("https://example.com/api/foo", { data: { foo: 1 } });
    expect(client._responseBuffer).toHaveLength(1);
    expect(client._responseBuffer[0]).toEqual({
      url: "https://example.com/api/foo",
      body: { data: { foo: 1 } }
    });
  });

  it("las responses con status != 200 NO se agregan al buffer", async () => {
    const { client, mockPage } = makeReadyClient();
    await mockPage._emitResponse("https://example.com/api/foo", { data: { foo: 1 } }, 404);
    await mockPage._emitResponse("https://example.com/api/bar", { data: { bar: 2 } }, 500);
    expect(client._responseBuffer).toHaveLength(0);
  });

  it("las responses con body vacio {} NO se agregan al buffer", async () => {
    const { client, mockPage } = makeReadyClient();
    await mockPage._emitResponse("https://example.com/api/foo", {});
    expect(client._responseBuffer).toHaveLength(0);
  });

  it("las responses con body que no es JSON NO se agregan al buffer", async () => {
    const { client, mockPage } = makeReadyClient();
    // json() tira error
    const mockResponse = {
      url: () => "https://example.com/api/foo",
      status: () => 200,
      json: async () => {
        throw new Error("not JSON");
      }
    };
    for (const h of mockPage._handlers["response"] ?? []) {
      await h(mockResponse);
    }
    expect(client._responseBuffer).toHaveLength(0);
  });

  it("cap de 1000 items: dropea los mas viejos al exceder", async () => {
    const { client, mockPage } = makeReadyClient();
    for (let i = 0; i < 1005; i++) {
      await mockPage._emitResponse(`https://example.com/api/r${i}`, { data: { i } });
    }
    expect(client._responseBuffer.length).toBe(1000);
    // Los primeros 5 se dropearon; el primero deberia ser r5
    expect(client._responseBuffer[0].body.data.i).toBe(5);
  });
});

describe("DjiagKoreanClient._captureResponse — filtro por urlPattern", () => {
  it("filtra por urlPattern string", async () => {
    const { client, mockPage } = makeReadyClient();
    const trigger = vi.fn(async () => {
      await mockPage._emitResponse("https://example.com/graphql?name=userProfile", { data: { user: { id: 1 } } });
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { totalCount: 100 } } });
    });
    const result = await (client as any)._captureResponse({
      urlPattern: "graphql?name=lands",
      triggerPageFn: trigger,
      minResponses: 1
    });
    expect(result.data.lands.totalCount).toBe(100);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("filtra por urlPattern RegExp", async () => {
    const { client, mockPage } = makeReadyClient();
    const trigger = vi.fn(async () => {
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { totalCount: 50 } } });
    });
    const result = await (client as any)._captureResponse({
      urlPattern: /graphql\?name=lands/,
      triggerPageFn: trigger,
      minResponses: 1
    });
    expect(result.data.lands.totalCount).toBe(50);
  });

  it("prefiere response con data.lands sobre data generico", async () => {
    const { client, mockPage } = makeReadyClient();
    const trigger = vi.fn(async () => {
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { other: 1 } });
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { totalCount: 99 } } });
    });
    const result = await (client as any)._captureResponse({
      urlPattern: "graphql?name=lands",
      triggerPageFn: trigger,
      minResponses: 2
    });
    expect(result.data.lands.totalCount).toBe(99);
  });

  it("lanza error si no hay matching response dentro de timeoutMs", async () => {
    const { client } = makeReadyClient();
    (client as any).timeoutMs = 200; // acortar para test rapido
    const trigger = vi.fn(async () => {
      // no emite nada
    });
    await expect(
      (client as any)._captureResponse({
        urlPattern: "graphql?name=lands",
        triggerPageFn: trigger,
        minResponses: 1
      })
    ).rejects.toThrow(/no matching response/);
  });
});

describe("DjiagKoreanClient._captureResponse — snapshot + cleanup", () => {
  it("solo devuelve responses NUEVAS (post-snapshot), no las pre-existentes", async () => {
    const { client, mockPage } = makeReadyClient();
    // Emitir una response ANTES de _captureResponse (simula el bug fix:
    // el listener YA esta activo, asi que la response cae en el buffer).
    await mockPage._emitResponse("https://example.com/graphql?name=lands", {
      data: { lands: { totalCount: 1, _label: "pre-snapshot" } }
    });
    expect(client._responseBuffer).toHaveLength(1);

    const trigger = vi.fn(async () => {
      // Emitir una response NUEVA durante el trigger
      await mockPage._emitResponse("https://example.com/graphql?name=lands", {
        data: { lands: { totalCount: 200, _label: "post-snapshot" } }
      });
    });
    const result = await (client as any)._captureResponse({
      urlPattern: "graphql?name=lands",
      triggerPageFn: trigger,
      minResponses: 1
    });
    // Devuelve la POST-snapshot, no la pre-snapshot
    expect(result.data.lands._label).toBe("post-snapshot");
    expect(result.data.lands.totalCount).toBe(200);
  });

  it("limpia el buffer al final de cada captura (no leak entre fetches)", async () => {
    const { client, mockPage } = makeReadyClient();
    // Llenar el buffer
    await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { n: 1 } } });
    expect(client._responseBuffer.length).toBeGreaterThan(0);

    const trigger = vi.fn(async () => {
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { n: 2 } } });
    });
    await (client as any)._captureResponse({
      urlPattern: "graphql?name=lands",
      triggerPageFn: trigger,
      minResponses: 1
    });
    expect(client._responseBuffer).toHaveLength(0);
  });

  it("el listener sigue activo despues de la captura (no se desregistra)", async () => {
    const { client, mockPage } = makeReadyClient();
    const initialListenerCount = mockPage._responseListenerCount();
    expect(initialListenerCount).toBe(1);

    const trigger = vi.fn(async () => {
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { n: 1 } } });
    });
    await (client as any)._captureResponse({
      urlPattern: "graphql?name=lands",
      triggerPageFn: trigger,
      minResponses: 1
    });

    // El listener sigue activo (no se llamo page.off)
    expect(mockPage._responseListenerCount()).toBe(1);
    expect(mockPage.off).not.toHaveBeenCalled();
  });

  it("dos capturas consecutivas funcionan (listener reutilizado, no leak)", async () => {
    const { client, mockPage } = makeReadyClient();

    // Primera captura
    const trigger1 = vi.fn(async () => {
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { n: 1 } } });
    });
    const r1 = await (client as any)._captureResponse({
      urlPattern: "graphql?name=lands",
      triggerPageFn: trigger1,
      minResponses: 1
    });
    expect(r1.data.lands.n).toBe(1);
    expect(client._responseBuffer).toHaveLength(0);

    // Segunda captura (el listener sigue activo)
    const trigger2 = vi.fn(async () => {
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { n: 2 } } });
    });
    const r2 = await (client as any)._captureResponse({
      urlPattern: "graphql?name=lands",
      triggerPageFn: trigger2,
      minResponses: 1
    });
    expect(r2.data.lands.n).toBe(2);
    expect(client._responseBuffer).toHaveLength(0);
    // Solo se llamo on('response') una vez en total
    expect(mockPage._responseListenerCount()).toBe(1);
  });
});

describe("DjiagKoreanClient._captureResponse — integracion con login", () => {
  it("llama await login() al inicio (y respeta loggedIn)", async () => {
    const client = new DjiagKoreanClient();
    const mockPage = makeMockPage();
    (client as any).page = mockPage;
    (client as any).loggedIn = false; // forzar que login() corra
    (client as any).circuitBreaker = { guard: () => undefined, recordSuccess: () => undefined, recordFailure: () => undefined };
    // Mock del launch (no-op)
    (client as any).launch = vi.fn(async () => undefined);
    // No email/password → tira "DJIAG_EMAIL and DJIAG_PASSWORD required"
    // (que NO es recuperable, asi que NO se reintenta por backoff).
    // Para este test, seteamos email/password para que login() avance.
    (client as any).email = "test@example.com";
    (client as any).password = "pwd";
    // _attemptLogin va a fallar porque la page es un mock vacio.
    // Pero _installResponseBuffer no se llamo, asi que _captureResponse
    // tirara un error. Mejor: instalar el buffer primero.
    client._installResponseBuffer();
    // Mockear _attemptLogin para que sea un no-op
    (client as any)._attemptLogin = vi.fn(async () => undefined);

    const trigger = vi.fn(async () => {
      await mockPage._emitResponse("https://example.com/graphql?name=lands", { data: { lands: { n: 1 } } });
    });
    const r = await (client as any)._captureResponse({
      urlPattern: "graphql?name=lands",
      triggerPageFn: trigger,
      minResponses: 1
    });
    expect(r.data.lands.n).toBe(1);
    expect((client as any)._attemptLogin).toHaveBeenCalledTimes(1);
  });
});
