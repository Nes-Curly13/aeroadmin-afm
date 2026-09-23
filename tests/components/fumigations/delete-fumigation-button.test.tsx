// tests/components/fumigations/delete-fumigation-button.test.tsx
//
// Test unitario del componente `DeleteFumigationButton`
// (feature/fumigacion-detail-v2 / sub-4).
//
// UI-O1 (auditoría UI 2026-09-21): la confirmación migró de
// `window.confirm()` al primitivo `AlertDialog` (role="alertdialog").
// Los tests ahora abren el diálogo y confirman/cancelan con sus botones.
//
// Cubre:
//   - Render: aria-label incluye el id
//   - Click abre el AlertDialog con id + descripción + soft-delete
//   - Cancelar: no hace fetch
//   - Confirmar: hace DELETE al endpoint correcto
//   - Fetch OK: redirige a /fumigaciones (mockear useRouter)
//   - Fetch error: muestra error inline
//   - Durante el fetch: botón disabled con spinner

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    refresh: () => mockRefresh()
  })
}));

const { DeleteFumigationButton } = await import(
  "@/components/fumigations/delete-fumigation-button"
);

const mockFetch = vi.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

const FUMIGATION_ID = 1234;
const DESCRIPTION = "Lote 12 · Glifosato 48%";
const TRIGGER_NAME = `Eliminar fumigación #${FUMIGATION_ID} (${DESCRIPTION})`;

function getTrigger() {
  return screen.getByRole("button", { name: TRIGGER_NAME });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getTrigger());
  return await screen.findByRole("alertdialog");
}

async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openDialog(user);
  await user.click(within(dialog).getByRole("button", { name: "Eliminar fumigación" }));
}

describe("DeleteFumigationButton — render", () => {
  it("renderiza el botón con aria-label que incluye el id y la descripción", () => {
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    expect(getTrigger()).toHaveAttribute("aria-label", TRIGGER_NAME);
  });

  it("el botón muestra el texto 'Eliminar fumigación' cuando no está pending", () => {
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    expect(getTrigger()).toHaveTextContent(/Eliminar fumigación/);
  });

  it("el botón no está disabled al inicio", () => {
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    expect(getTrigger()).not.toBeDisabled();
  });
});

describe("DeleteFumigationButton — confirmación (AlertDialog)", () => {
  it("click abre el alertdialog con el id, la descripción y el aviso de soft-delete", async () => {
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    const dialog = await openDialog(user);
    expect(dialog).toHaveTextContent(`#${FUMIGATION_ID}`);
    expect(dialog).toHaveTextContent(DESCRIPTION);
    expect(dialog).toHaveTextContent(/soft-delete/i);
  });

  it("Cancelar cierra el diálogo y NO hace fetch", async () => {
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("Confirmar hace DELETE al endpoint correcto", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ fumigation: { id: FUMIGATION_ID } })
    } as Response);
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    await confirmDelete(user);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`/api/admin/fumigations/${FUMIGATION_ID}`);
    expect(init.method).toBe("DELETE");
  });
});

describe("DeleteFumigationButton — fetch OK", () => {
  it("fetch OK: redirige a /fumigaciones y hace router.refresh", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ fumigation: { id: FUMIGATION_ID } })
    } as Response);
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    await confirmDelete(user);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/fumigaciones");
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("fetch OK: limpia cualquier error previo", async () => {
    // Primer fetch error → muestra error
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "BD caída" })
    } as Response);
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    await confirmDelete(user);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/BD caída/);
    });

    // Segundo fetch OK → limpia el error
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ fumigation: { id: FUMIGATION_ID } })
    } as Response);
    await confirmDelete(user);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/fumigaciones");
    });
  });
});

describe("DeleteFumigationButton — fetch error", () => {
  it("muestra el mensaje del server (data.error) cuando el fetch devuelve 4xx/5xx con JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "rol insuficiente" })
    } as Response);
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    await confirmDelete(user);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/rol insuficiente/);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("si el body del error no es JSON, muestra 'HTTP <status>' como fallback", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("parse fail");
      }
    } as unknown as Response);
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    await confirmDelete(user);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/HTTP 500/);
    });
  });

  it("si la red falla (fetch tira), muestra el error de red", async () => {
    mockFetch.mockRejectedValueOnce(new Error("NetworkError when attempting to fetch resource"));
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    await confirmDelete(user);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/NetworkError/);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("después de un error, el botón vuelve a estar enabled (isPending = false)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "fail" })
    } as Response);
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    await confirmDelete(user);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(getTrigger()).not.toBeDisabled();
  });
});

describe("DeleteFumigationButton — estado pending durante el fetch", () => {
  it("mientras el fetch está en curso, el botón está disabled con texto 'Eliminando…'", async () => {
    // Mock que nunca resuelve para mantener el estado pending.
    let resolveFn: (value: Response) => void = () => {};
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFn = resolve;
        })
    );
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    await confirmDelete(user);
    await waitFor(() => {
      expect(getTrigger()).toBeDisabled();
    });
    expect(getTrigger()).toHaveTextContent(/Eliminando/);
    // Cleanup: resolvemos el fetch para no dejar promise pendiente.
    resolveFn({
      ok: true,
      status: 200,
      json: async () => ({ fumigation: { id: FUMIGATION_ID } })
    } as Response);
  });
});

describe("DeleteFumigationButton — no renderiza error si no hay error", () => {
  it("inicial: no hay alert visible", () => {
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("después de un fetch OK: no queda alert residual", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ fumigation: { id: FUMIGATION_ID } })
    } as Response);
    const user = userEvent.setup();
    render(
      <DeleteFumigationButton
        fumigationId={FUMIGATION_ID}
        description={DESCRIPTION}
      />
    );
    await confirmDelete(user);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
