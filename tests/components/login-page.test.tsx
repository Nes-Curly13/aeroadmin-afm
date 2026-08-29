/**
 * tests/components/login-page.test.tsx
 *
 * Tests del login page reescrito en Sprint S8 (v2.7.5) — usa
 * `fetch` contra el endpoint estándar de NextAuth en vez de un
 * server action (que fallaba en producción con 303 sin error).
 *
 * Verificamos:
 *   1. Render del form con campos email + password + boton "Ingresar"
 *   2. Submit con credenciales invalidas → fetch CSRF + fetch callback
 *      + show "Email o password incorrectos"
 *   3. Submit con credenciales validas → fetch CSRF + fetch callback +
 *      verify session + router.push("/")
 *   4. Submit vacio → no fetchea nada + show error
 *
 * v2.7.5 — 2026-08-29 — login form reescrito para client-side flow.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { useRouter } from "next/navigation";
import LoginPage from "@/app/login/page";

// Mock next/navigation
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: (...args: unknown[]) => mockPush(...args),
    refresh: () => mockRefresh(),
  })),
}));

// Mock window.location
const mockLocationAssign = vi.fn();
const originalFetch = global.fetch;
const originalLocation = window.location;

// Mock fetch
const mockFetch = vi.fn();
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockLocationAssign.mockReset();
  // Mock window.location.href setter
  Object.defineProperty(window, "location", {
    value: { href: "", assign: mockLocationAssign },
    writable: true,
    configurable: true,
  });
});
afterEach(() => {
  global.fetch = originalFetch;
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
  cleanup();
});

describe("LoginPage (S8 v2.7.5 — client-side fetch flow)", () => {
  it("1. renderiza el form con email, password y boton Ingresar", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /ingresar/i })).toBeTruthy();
  });

  it("2. submit con campos vacíos → muestra error sin fetchar", async () => {
    render(<LoginPage />);
    // No tenemos los inputs requeridos (required attribute), asique
    // los limpiamos y submiteamos via submit programático.
    const form = document.querySelector("form")!;
    // Bypass HTML required by removing attributes
    form.querySelectorAll("input[required]").forEach((i) => i.removeAttribute("required"));
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/obligatorios/i);
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("3. submit con credenciales invalidas → CSRF + callback + error 'incorrectos'", async () => {
    // Mock CSRF
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: "test-csrf-token" }),
    } as Response);
    // Mock callback que redirige a /login?error=CredentialsSignin
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: "https://aeroadmin-afm.vercel.app/login?error=CredentialsSignin&code=credentials",
    } as Response);

    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "wrong@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "badpass" } });
    fireEvent.click(screen.getByRole("button", { name: /ingresar/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/incorrectos/i);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("4. submit con credenciales validas → CSRF + callback + session + window.location.href = /", async () => {
    // Mock CSRF
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: "valid-csrf-token" }),
    } as Response);
    // Mock callback que redirige a /
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: "https://aeroadmin-afm.vercel.app/",
    } as Response);
    // Mock session check
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { email: "admin@aeroadmin.local", role: "admin" } }),
    } as Response);

    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "admin@aeroadmin.local" } });
    fireEvent.change(passwordInput, { target: { value: "ynJPvPXjqjQXhJst@v" } });
    fireEvent.click(screen.getByRole("button", { name: /ingresar/i }));

    await waitFor(() => {
      expect(window.location.href).toBe("/");
    });
    expect(mockFetch).toHaveBeenCalledTimes(3); // csrf + callback + session
  });

  it("5. CSRF fetch falla → muestra error sin llamar callback", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as Response);

    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "a@b.com" } });
    fireEvent.change(passwordInput, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /ingresar/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/csrf/i);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("6. callback OK pero session vacia → error 'no se pudo iniciar'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: "test" }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      url: "https://aeroadmin-afm.vercel.app/",
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}), // no user
    } as Response);

    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /ingresar/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/intentá de nuevo/i);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
