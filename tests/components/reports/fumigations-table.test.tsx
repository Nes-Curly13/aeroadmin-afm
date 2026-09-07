// tests/components/reports/fumigations-table.test.tsx
//
// Tests del componente FumigationsTable (QA-14, extraido de
// app/(auth)/reportes/page.tsx, 2026-09-06).
//
// Cubre:
//   - Empty state cuando fumigations=[]
//   - Render con filas: muestra link a parcela + calculado de Vol
//   - Banner capReached cuando hay cap

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FumigationsTable } from "@/components/reports/fumigations-table";
import type { FarmsFumigationRow } from "@/lib/reports/fetch-farms-report-data";

const baseRow: FarmsFumigationRow = {
  id: 1,
  fumigation_date: "2026-09-01",
  parcel_id: 42,
  parcel_name: "Lote 12",
  farm_name: "Hacienda El Edén",
  land_name: "Suerte 3",
  pilot_name: "Juan Pérez",
  drone_nickname: "DJI-001",
  area_fumigated_ha: 8.5,
  dose_l_per_ha: 1.2,
  product_used: "Glifosato",
  recorded_by: "admin@afm.co",
  notes: null
};

describe("FumigationsTable", () => {
  it("empty state cuando fumigations está vacío", () => {
    render(<FumigationsTable fumigations={[]} totalCount={0} capReached={false} />);
    expect(screen.getByText(/Sin fumigaciones/i)).toBeInTheDocument();
  });

  it("renderiza una fila por fumigación con link a la parcela", () => {
    render(
      <FumigationsTable
        fumigations={[baseRow]}
        totalCount={1}
        capReached={false}
      />
    );
    const link = screen.getByRole("link", { name: /Lote 12/ });
    expect(link).toHaveAttribute("href", "/parcelas/42");
    expect(screen.getByText("Hacienda El Edén")).toBeInTheDocument();
    expect(screen.getByText("Glifosato")).toBeInTheDocument();
  });

  it("calcula Vol (L) = dose_l_per_ha * area_fumigated_ha", () => {
    render(
      <FumigationsTable
        fumigations={[baseRow]}
        totalCount={1}
        capReached={false}
      />
    );
    // 1.2 * 8.5 = 10.2
    expect(screen.getByText("10,20")).toBeInTheDocument();
  });

  it("muestra — para Vol cuando dose o area son null", () => {
    render(
      <FumigationsTable
        fumigations={[{ ...baseRow, dose_l_per_ha: null }]}
        totalCount={1}
        capReached={false}
      />
    );
    const cells = screen.getAllByText("—");
    // Al menos 2: Vol (L) y Dosis (no se muestra Dosis en la tabla,
    // pero el area se muestra si no es null). Verificamos que
    // hay al menos un "—" (el de Vol).
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it("muestra el banner 'cap del PDF' cuando capReached=true", () => {
    render(
      <FumigationsTable
        fumigations={[baseRow]}
        totalCount={300}
        capReached={true}
      />
    );
    expect(screen.getByText(/200 fumigaciones/)).toBeInTheDocument();
  });

  it("no muestra el banner de cap cuando capReached=false", () => {
    render(
      <FumigationsTable
        fumigations={[baseRow]}
        totalCount={1}
        capReached={false}
      />
    );
    expect(screen.queryByText(/200 fumigaciones/)).not.toBeInTheDocument();
  });

  it("muestra el contador 'N de M' en el header", () => {
    render(
      <FumigationsTable
        fumigations={[baseRow, { ...baseRow, id: 2, parcel_id: 43 }]}
        totalCount={300}
        capReached={true}
      />
    );
    expect(screen.getByText("2 de 300")).toBeInTheDocument();
  });
});
