// Tests del primitive Table.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

describe("Table", () => {
  it("renderiza HTML semantico (table, thead, tbody, tr, th, td)", () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Col 1</TableHead>
            <TableHead>Col 2</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>A1</TableCell>
            <TableCell>A2</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("thead")).not.toBeNull();
    expect(container.querySelector("tbody")).not.toBeNull();
    expect(container.querySelector("th")).not.toBeNull();
    expect(container.querySelector("td")).not.toBeNull();
  });

  it("envuelve la tabla en un div data-slot=table-container con overflow-x-auto", () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const wrapper = container.querySelector('[data-slot="table-container"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toMatch(/overflow-x-auto/);
  });

  it("TableCaption se renderiza como <caption>", () => {
    const { container } = render(
      <Table>
        <TableCaption>Leyenda</TableCaption>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const caption = container.querySelector("caption");
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toBe("Leyenda");
  });

  it("data-slot en cada subcomponente", () => {
    const { container } = render(
      <Table>
        <TableHeader data-testid="hdr">
          <TableRow>
            <TableHead>Col</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>ft</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    );
    expect(container.querySelector('[data-slot="table-header"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="table-body"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="table-footer"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="table-row"]').length).toBe(3);
    expect(container.querySelectorAll('[data-slot="table-head"]').length).toBe(1);
    expect(container.querySelectorAll('[data-slot="table-cell"]').length).toBe(2);
  });

  it("textos visibles al usuario", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>2026-07-28</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(screen.getByText("Fecha")).toBeInTheDocument();
    expect(screen.getByText("2026-07-28")).toBeInTheDocument();
  });

  it("className del caller se mergea en Table", () => {
    const { container } = render(
      <Table className="border-collapse">
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const table = container.querySelector("table") as HTMLElement;
    expect(table.className).toMatch(/border-collapse/);
  });
});
