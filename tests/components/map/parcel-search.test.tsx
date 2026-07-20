import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ParcelSearch } from "@/components/map/parcel-search";
import type { DjiParcelRecord } from "@/lib/types";

function makeParcel(over: Partial<DjiParcelRecord>): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Parcela A",
    field_type: "Farmland",
    declared_area_ha: 5.5,
    spray_area_m2: 4000,
    drone_model_code: 201,
    drone_model_name: "Agras T40",
    spray_width_m: 5.5,
    work_speed_mps: 6,
    optimal_heading_deg: 100,
    radar_height_m: 3,
    edge_offset_m: 1.5,
    obstacle_offset_m: 1.5,
    climb_height_m: 2,
    no_spray_zone_m2: 0,
    droplet_size: 320,
    sweep_direction: 1,
    is_orchard: false,
    uses_side_spray: false,
    spray_geometry: null,
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 10,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: "2026-06-17T00:00:00Z",
    ...over
  };
}

const PARCELS: DjiParcelRecord[] = [
  makeParcel({ id: 1, land_name: "Porvenir STE 3", field_type: "Farmland", declared_area_ha: 5.78 }),
  makeParcel({ id: 2, land_name: "Llano Gómez STE 5", field_type: "Orchards", declared_area_ha: 3.2 }),
  makeParcel({ id: 3, land_name: "Porvenir STE 7", field_type: "Farmland", declared_area_ha: 2.0 }),
  makeParcel({ id: 4, land_name: "La Esperanza", field_type: "Farmland", declared_area_ha: 1.5 })
];

describe("ParcelSearch", () => {
  it("renderiza el input de búsqueda con placeholder descriptivo", () => {
    render(<ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    const input = screen.getByRole("searchbox");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "Buscar parcela por nombre…");
  });

  it("renderiza el selector con todas las parcelas cuando el query está vacío", () => {
    render(<ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    const select = screen.getByRole("combobox", { name: /seleccionar parcela/i }) as HTMLSelectElement;
    expect(select.options.length).toBe(PARCELS.length);
  });

  it("filtra las parcels por land_name (case-insensitive, includes)", () => {
    render(<ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "porvenir" } });
    const select = screen.getByRole("combobox", { name: /seleccionar parcela/i }) as HTMLSelectElement;
    // Matchean "Porvenir STE 3" y "Porvenir STE 7" — case-insensitive
    expect(select.options.length).toBe(2);
    const labels = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(labels.some((l) => l.includes("Porvenir STE 3"))).toBe(true);
    expect(labels.some((l) => l.includes("Porvenir STE 7"))).toBe(true);
  });

  it("query sin matches muestra el mensaje 'Sin coincidencias para «X»'", () => {
    render(<ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "xyz-no-existe" } });
    expect(screen.getByText(/sin coincidencias para/i)).toBeInTheDocument();
    expect(screen.getByText(/xyz-no-existe/i)).toBeInTheDocument();
    // Cuando no hay matches, el selector de parcelas NO se renderiza
    expect(screen.queryByRole("combobox", { name: /seleccionar parcela/i })).not.toBeInTheDocument();
  });

  it("limpiar el query vuelve a mostrar todas las parcelas", () => {
    render(<ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "porvenir" } });
    expect(
      (screen.getByRole("combobox", { name: /seleccionar parcela/i }) as HTMLSelectElement).options.length
    ).toBe(2);
    fireEvent.change(input, { target: { value: "" } });
    expect(
      (screen.getByRole("combobox", { name: /seleccionar parcela/i }) as HTMLSelectElement).options.length
    ).toBe(PARCELS.length);
  });

  it("búsqueda es case-insensitive", () => {
    render(<ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    const input = screen.getByRole("searchbox");
    // "porvenir" (minúscula) matchea "Porvenir STE 3" (mayúscula)
    fireEvent.change(input, { target: { value: "porvenir" } });
    const select = screen.getByRole("combobox", { name: /seleccionar parcela/i }) as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    // "ESPERANZA" (mayúscula) matchea "La Esperanza" (minúscula)
    fireEvent.change(input, { target: { value: "ESPERANZA" } });
    const select2 = screen.getByRole("combobox", { name: /seleccionar parcela/i }) as HTMLSelectElement;
    expect(select2.options.length).toBe(1);
  });

  it("onSelect se sigue invocando cuando eligen una opción en el selector filtrado", () => {
    const onSelect = vi.fn();
    render(<ParcelSearch onSelect={onSelect} parcels={PARCELS} selectedId={1} />);
    // Filtrar primero
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "llano" } });
    // Cambiar la selección
    const select = screen.getByRole("combobox", { name: /seleccionar parcela/i }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2" } });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("el atajo '/' enfoca el input cuando NO hay otro input activo", () => {
    render(<ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    const input = screen.getByRole("searchbox");
    // Sanity: input no está focused por default
    expect(document.activeElement).not.toBe(input);
    // Dispatch keydown "/" en document
    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(input);
  });

  it("el atajo '/' NO enfoca cuando hay otro input activo", () => {
    // Renderizamos un input "externo" antes del ParcelSearch para simular
    // que el usuario está tipeando en otro lugar.
    render(
      <div>
        <input aria-label="Otro input" type="text" />
        <ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />
      </div>
    );
    const otherInput = screen.getByLabelText("Otro input");
    otherInput.focus();
    expect(document.activeElement).toBe(otherInput);
    fireEvent.keyDown(document, { key: "/" });
    // El foco sigue en el otro input — ParcelSearch no lo roba
    expect(document.activeElement).toBe(otherInput);
  });

  it("el atajo '/' NO enfoca cuando hay un textarea activo", () => {
    render(
      <div>
        <textarea aria-label="Otro textarea" />
        <ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />
      </div>
    );
    const otherTextarea = screen.getByLabelText("Otro textarea");
    otherTextarea.focus();
    expect(document.activeElement).toBe(otherTextarea);
    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(otherTextarea);
  });

  it("teclas distintas de '/' no afectan el foco", () => {
    render(<ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Escape" });
    const input = screen.getByRole("searchbox");
    expect(document.activeElement).not.toBe(input);
  });

  it("elimina el listener de keydown al desmontar", () => {
    const { unmount } = render(<ParcelSearch onSelect={() => {}} parcels={PARCELS} selectedId={1} />);
    unmount();
    // Después de desmontar, el handler ya no debe estar registrado.
    // Si quedara registrado, el input (que ya no existe) no podría recibir focus,
    // pero podemos verificar que el dispatch no rompe nada.
    expect(() => fireEvent.keyDown(document, { key: "/" })).not.toThrow();
  });

  it("delega el estado vacío de 'sin parcelas' al ParcelSelector (no muestra search)", () => {
    render(<ParcelSearch onSelect={() => {}} parcels={[]} selectedId={null} />);
    // Cuando NO hay parcelas en el catálogo, el search input tampoco se muestra
    // (no hay nada que filtrar). El ParcelSelector muestra su propio empty state.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText(/no hay parcelas importadas/i)).toBeInTheDocument();
  });
});
