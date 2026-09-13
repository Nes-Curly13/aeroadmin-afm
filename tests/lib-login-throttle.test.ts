import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetAllLoginThrottle,
  isLoginBlocked,
  recordLoginFailure,
  resetLoginAttempts
} from "@/lib/login-throttle";

const T0 = 1_700_000_000_000;
const MIN = 60 * 1000;

/**
 * Tests del throttle de login (auditoría #57). Usa el param `now` para
 * ser determinístico (sin fake timers).
 */
describe("login-throttle", () => {
  beforeEach(() => _resetAllLoginThrottle());

  it("no bloquea al inicio", () => {
    expect(isLoginBlocked("a@b.com", T0)).toBe(false);
  });

  it("NO bloquea con 7 fallos", () => {
    const key = "a@b.com";
    for (let i = 0; i < 7; i++) recordLoginFailure(key, T0 + i);
    expect(isLoginBlocked(key, T0 + 7)).toBe(false);
  });

  it("bloquea tras 8 fallos dentro de la ventana", () => {
    const key = "a@b.com";
    for (let i = 0; i < 8; i++) recordLoginFailure(key, T0 + i);
    expect(isLoginBlocked(key, T0 + 8)).toBe(true);
  });

  it("se libera después de BLOCK_MS (15 min)", () => {
    const key = "a@b.com";
    for (let i = 0; i < 8; i++) recordLoginFailure(key, T0 + i);
    expect(isLoginBlocked(key, T0 + MIN)).toBe(true);
    expect(isLoginBlocked(key, T0 + 16 * MIN)).toBe(false);
  });

  it("la ventana expira y reinicia el conteo", () => {
    const key = "a@b.com";
    for (let i = 0; i < 7; i++) recordLoginFailure(key, T0 + i);
    recordLoginFailure(key, T0 + 16 * MIN);
    expect(isLoginBlocked(key, T0 + 16 * MIN)).toBe(false);
  });

  it("resetLoginAttempts limpia el contador (login exitoso)", () => {
    const key = "a@b.com";
    for (let i = 0; i < 8; i++) recordLoginFailure(key, T0 + i);
    expect(isLoginBlocked(key, T0 + 9)).toBe(true);
    resetLoginAttempts(key);
    expect(isLoginBlocked(key, T0 + 10)).toBe(false);
  });

  it("emails distintos no comparten contador", () => {
    for (let i = 0; i < 8; i++) recordLoginFailure("a@b.com", T0 + i);
    expect(isLoginBlocked("a@b.com", T0 + 8)).toBe(true);
    expect(isLoginBlocked("otro@b.com", T0 + 8)).toBe(false);
  });
});
