// tests/components/parcels/parcels-list.test.tsx
//
// Tests TDD para el listado de parcelas en /parcels (BUG 1 del audit
// ui-ux-2026-07). Cubre el client island `ParcelsList` que renderiza
// la tabla + paginación client-side, y el server wrapper `app/parcels/page.tsx`
// que orquesta data fetching + AppShell.
//
// El server page se cubre con un test ligero que mockea el repository:
// lo que importa de él es el contrato de la UI (empty state, link a detalle,
// AppShell con activeSection correcto), no la integración con la BD — eso
// ya lo cubren los tests de repositories y user-story-dashboard-e2e.

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// Hoist para que los vi.mock() del describe "ParcelsPage" puedan
// referenciar el mock state antes de que se ejecute el factory.
const mockGetParcelsNormalized = vi.hoisted(() => vi.fn());

// Track B v1.2: app-shell renderiza <MobileSidebarDrawer> que usa useRouter.
// Mockeamos next/navigation porque estos tests renderizan la ParcelsPage
// (que envuelve AppShell) en jsdom sin App Router montado.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams()
}));

import type { DjiParcelRecord } from "@/lib/types";

function makeParcel(over: Partial<DjiParcelRecord> = {}): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Porvenir STE 3",
    field_type: "Farmland",
    declared_area_ha: 5.78,
    spray_area_m2: 4075,
    drone_model_code: 201,
    drone_model_name: "Agras T40 / T50",
    spray_width_m: 5.5,
    work_speed_mps: 5.3,
    optimal_heading_deg: 115.2,
    radar_height_m: 2.8,
    edge_offset_m: 1.5,
    obstacle_offset_m: 1.5,
    climb_height_m: 2,
    no_spray_zone_m2: 0,
    droplet_size: 1,
    sweep_direction: 1,
    is_orchard: false,
    uses_side_spray: true,
    spray_geometry: null,
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 0,
    source_url_geometry: "",
    source_url_parameter: "",
    source_url_waypoint: "",
    fetched_at: "2026-06-10T17:35:40.925Z",
    ...over
  };
}

import { ParcelsList } from "@/components/parcels/parcels-list";

describe("ParcelsList", () => {
  it("renderiza una fila por parcela con sus columnas", () => {
    const parcels = [
      makeParcel({ id: 1, land_name: "Porvenir", field_type: "Farmland", declared_area_ha: 5.78, drone_model_name: "Agras T40 / T50" }),
      makeParcel({ id: 2, land_name: "El Carmen", field_type: "Orchards", is_orchard: true, declared_area_ha: 3.2, drone_model_name: "Agras T16 / T20" })
    ];
    render(<ParcelsList parcels={parcels} />);
    expect(screen.getByText("Porvenir")).toBeInTheDocument();
    expect(screen.getByText("El Carmen")).toBeInTheDocument();
    expect(screen.getByText("Farmland")).toBeInTheDocument();
    expect(screen.getByText("Orchards")).toBeInTheDocument();
    expect(screen.getByText("5.78 ha")).toBeInTheDocument();
    expect(screen.getByText("3.20 ha")).toBeInTheDocument();
  });

  it("el link a detalle apunta a /parcels/[id] correcto", () => {
    const parcels = [
      makeParcel({ id: 42, land_name: "Parcela 42" }),
      makeParcel({ id: 99, land_name: "Parcela 99" })
    ];
    render(<ParcelsList parcels={parcels} />);
    // Usamos testid porque el link es genérico ("Ver detalle →") — el id
    // no está en el accessible name.
    const link42 = screen.getByTestId("parcels-list-detail-link-42");
    expect(link42.getAttribute("href")).toBe("/parcels/42");
    const link99 = screen.getByTestId("parcels-list-detail-link-99");
    expect(link99.getAttribute("href")).toBe("/parcels/99");
  });

  it("muestra empty state cuando no hay parcelas", () => {
    render(<ParcelsList parcels={[]} />);
    // Mismo copy (intencional) que el empty state del map-view para
    // coherencia visual cuando el operador llega por el CTA "Ver listado de parcelas".
    expect(screen.getByTestId("parcels-list-empty")).toBeInTheDocument();
    expect(screen.getByText(/aún no hay parcelas para mostrar/i)).toBeInTheDocument();
  });

  it("muestra dash cuando el área declarada es null", () => {
    const parcels = [makeParcel({ id: 1, land_name: "Sin area", declared_area_ha: null })];
    render(<ParcelsList parcels={parcels} />);
    const row = screen.getByText("Sin area").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("—")).toBeInTheDocument();
  });

  it("muestra el estado 'Sin plan' cuando no hay cadencia configurada (indicador heurístico)", () => {
    // El listado no puede saber si hay cadencia sin otra query. Marcamos todas
    // como "Pendiente" y dejamos nota en el helper text. Este test documenta
    // el contrato actual — si en el futuro se cruza con dji_fumigation_schedule,
    // se actualiza este test junto con la implementación.
    const parcels = [makeParcel({ id: 1, land_name: "X" })];
    render(<ParcelsList parcels={parcels} />);
    // El chip de estado debe ser visible (texto exacto: "Sin plan" o similar)
    const row = screen.getByText("X").closest("tr");
    expect(row).not.toBeNull();
    // La columna de estado muestra siempre algo (nunca queda vacía)
    expect(within(row as HTMLElement).getByText(/pendiente|sin plan|en fecha/i)).toBeInTheDocument();
  });

  it("pagina client-side: muestra 20 por página por default", () => {
    // Zero-pad los nombres para que el sort alfabético coincida con el
    // orden numérico ("Lote 002" < "Lote 020" — con "Lote 2" no se cumple
    // porque "Lote 2" < "Lote 20" pero "Lote 21" también < "Lote 3").
    const parcels = Array.from({ length: 45 }, (_, i) =>
      makeParcel({ id: i + 1, land_name: `Lote ${String(i + 1).padStart(3, "0")}` })
    );
    render(<ParcelsList parcels={parcels} />);
    // 20 visibles en página 1
    expect(screen.getByText("Lote 001")).toBeInTheDocument();
    expect(screen.getByText("Lote 020")).toBeInTheDocument();
    // 21+ no están en página 1
    expect(screen.queryByText("Lote 021")).toBeNull();
    // Texto de paginación
    expect(screen.getByText(/página 1 de 3/i)).toBeInTheDocument();
  });
});

describe("ParcelsPage (server wrapper)", () => {
  it("llama a getParcelsNormalized y renderiza la lista dentro de AppShell con activeSection='parcels'", async () => {
    mockGetParcelsNormalized.mockResolvedValueOnce({
      data: [makeParcel({ id: 7, land_name: "Lote 7" })],
      total: 1,
      page: 1,
      limit: 1000,
      totalPages: 1
    });

    vi.doMock("@/api/repositories", () => ({
      getParcelsNormalized: mockGetParcelsNormalized
    }));
    // v1.5: getViewerRole() en la page llama auth() de next-auth.
    // Mockeamos para no requerir sesion real en este test de contrato
    // de la UI (la cobertura del RBAC vive en tests/lib/auth/role.test.ts).
    vi.doMock("@/lib/auth/role", () => ({
      getViewerRole: vi.fn().mockResolvedValue(null)
    }));

    // Importar DESPUÉS de los mocks (importante para module isolation).
    const { default: ParcelsPage } = await import("@/app/parcels/page");

    const element = await ParcelsPage();
    render(element);

    // Verificar que el repository fue llamado con paginación amplia
    expect(mockGetParcelsNormalized).toHaveBeenCalled();
    const [pageArg, limitArg] = mockGetParcelsNormalized.mock.calls[0];
    expect(pageArg).toBe(1);
    expect(limitArg).toBeGreaterThanOrEqual(200);

    // AppShell presente (heading en lugar de getByText porque el status
    // block del sidebar también dice "Parcelas").
    expect(screen.getByRole("heading", { name: "Parcelas", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Vista agregada")).toBeInTheDocument();

    // Link a detalle dentro del listado (usamos el testid que pone el
    // componente en la última columna para evitar ambigüedad de a11y name).
    const link = screen.getByTestId("parcels-list-detail-link-7");
    expect(link.getAttribute("href")).toBe("/parcels/7");

    vi.doUnmock("@/api/repositories");
  });

  it("renderiza empty state cuando el repository devuelve lista vacía", async () => {
    mockGetParcelsNormalized.mockResolvedValueOnce({
      data: [],
      total: 0,
      page: 1,
      limit: 1000,
      totalPages: 0
    });

    vi.doMock("@/api/repositories", () => ({
      getParcelsNormalized: mockGetParcelsNormalized
    }));
    // v1.5: ver nota en el test anterior.
    vi.doMock("@/lib/auth/role", () => ({
      getViewerRole: vi.fn().mockResolvedValue(null)
    }));

    const { default: ParcelsPage } = await import("@/app/parcels/page");
    const element = await ParcelsPage();
    render(element);

    expect(screen.getByTestId("parcels-list-empty")).toBeInTheDocument();

    vi.doUnmock("@/api/repositories");
  });
});
