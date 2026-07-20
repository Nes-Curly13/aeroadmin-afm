/**
 * keyboard-shortcuts.test.tsx
 *
 * Track B (perf/ux v1.1) — MEJORA 3: atajos de teclado globales.
 *
 * Cobertura:
 *   1. `g` + `p` → navega a /parcels (vim-style sequence).
 *   2. `g` + `m` → /map, `g` + `t` → /task-history, `g` + `d` → / (dashboard).
 *   3. No se dispara si el foco está en un input/textarea/contenteditable.
 *   4. `?` abre el modal de ayuda; Escape lo cierra.
 *   5. El modal lista los atajos disponibles (accesibilidad).
 *   6. El listener se limpia al desmontar (no leak).
 *
 * Mockeamos next/navigation (useRouter) y jsdom provee document.activeElement.
 * Sin libs externas (no react-hotkeys-hook) — implementación a mano con
 * useEffect + addEventListener.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// Mock mutable state via vi.hoisted (mismo patrón que tab-switcher.test.tsx)
const mockState = vi.hoisted(() => ({
  pushMock: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockState.pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams()
}));

import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";

beforeEach(() => {
  mockState.pushMock.mockClear();
  // Aseguramos que el body esté limpio entre tests (el modal se renderiza
  // en portal-style overlay, no dentro del componente, pero por las dudas).
  document.body.innerHTML = "";
});

afterEach(() => {
  // Resetear activeElement entre tests
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
});

describe("KeyboardShortcuts — atajos de teclado globales (Track B v1.1)", () => {
  it("g + p navega a /parcels (vim-style sequence)", () => {
    render(<KeyboardShortcuts />);
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "p" });
    });
    expect(mockState.pushMock).toHaveBeenCalledWith("/parcels");
  });

  it("g + m navega a /map", () => {
    render(<KeyboardShortcuts />);
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "m" });
    });
    expect(mockState.pushMock).toHaveBeenCalledWith("/map");
  });

  it("g + t navega a /task-history", () => {
    render(<KeyboardShortcuts />);
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "t" });
    });
    expect(mockState.pushMock).toHaveBeenCalledWith("/task-history");
  });

  it("g + d navega a / (dashboard)", () => {
    render(<KeyboardShortcuts />);
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "d" });
    });
    expect(mockState.pushMock).toHaveBeenCalledWith("/");
  });

  it("g + tecla desconocida NO navega a nada", () => {
    render(<KeyboardShortcuts />);
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "x" });
    });
    expect(mockState.pushMock).not.toHaveBeenCalled();
  });

  it("NO dispara cuando el foco está en un input (supervisor tipeando)", () => {
    render(
      <div>
        <input aria-label="búsqueda" type="text" />
        <KeyboardShortcuts />
      </div>
    );
    const input = screen.getByLabelText("búsqueda");
    input.focus();
    expect(document.activeElement).toBe(input);
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "p" });
    });
    expect(mockState.pushMock).not.toHaveBeenCalled();
  });

  it("NO dispara cuando el foco está en un textarea", () => {
    render(
      <div>
        <textarea aria-label="notas" />
        <KeyboardShortcuts />
      </div>
    );
    const textarea = screen.getByLabelText("notas");
    textarea.focus();
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "m" });
    });
    expect(mockState.pushMock).not.toHaveBeenCalled();
  });

  it("NO dispara cuando el foco está en un elemento contenteditable", () => {
    render(
      <div>
        <div
          aria-label="editor"
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
        >
          editame
        </div>
        <KeyboardShortcuts />
      </div>
    );
    const editable = screen.getByLabelText("editor") as HTMLElement;
    editable.focus();
    expect(document.activeElement).toBe(editable);
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "p" });
    });
    expect(mockState.pushMock).not.toHaveBeenCalled();
  });

  it("? abre el modal de ayuda", () => {
    render(<KeyboardShortcuts />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape cierra el modal de ayuda", () => {
    render(<KeyboardShortcuts />);
    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("el modal lista los atajos disponibles (accesibilidad)", () => {
    render(<KeyboardShortcuts />);
    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });
    const dialog = screen.getByRole("dialog");
    // El modal debe mencionar los atajos principales para que el usuario
    // descubra cómo navegar. (No aserto cada combinación para no atar
    // el test a la copy exacta, pero sí los headings clave.)
    expect(dialog).toHaveTextContent(/parcels/i);
    expect(dialog).toHaveTextContent(/map/i);
    expect(dialog).toHaveTextContent(/task.?history|historial/i);
    expect(dialog).toHaveTextContent(/dashboard|panel/i);
    expect(dialog).toHaveTextContent(/ayuda|atajos|shortcuts/i);
  });

  it("el modal se puede cerrar con un botón explícito", () => {
    render(<KeyboardShortcuts />);
    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const closeButton = screen.getByRole("button", { name: /cerrar/i });
    act(() => {
      closeButton.click();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("limpia el listener de keydown al desmontar (no memory leak)", () => {
    const { unmount } = render(<KeyboardShortcuts />);
    unmount();
    // Después de desmontar, los keydown no deben disparar navegación.
    // Si quedara registrado, pushMock recibiría una llamada.
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "p" });
    });
    expect(mockState.pushMock).not.toHaveBeenCalled();
  });

  it("tecla 'g' huérfana (sin segunda tecla) no navega y se descarta", async () => {
    // Caso: usuario aprieta 'g' y se arrepiente. Después del timeout
    // (~1s), la secuencia se descarta. No debe navegar a nada.
    render(<KeyboardShortcuts />);
    act(() => {
      fireEvent.keyDown(document, { key: "g" });
    });
    // Esperamos a que pase el timeout interno (default 1000ms en la impl)
    await new Promise((resolve) => setTimeout(resolve, 1100));
    act(() => {
      fireEvent.keyDown(document, { key: "p" });
    });
    expect(mockState.pushMock).not.toHaveBeenCalled();
  }, 5000);

  it("? también se ignora si el foco está en un input (case de uso real: chat/search)", () => {
    render(
      <div>
        <input aria-label="búsqueda global" type="text" />
        <KeyboardShortcuts />
      </div>
    );
    const input = screen.getByLabelText("búsqueda global");
    input.focus();
    act(() => {
      // Usuario tipea "?" en el input → NO debe abrir el modal
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
