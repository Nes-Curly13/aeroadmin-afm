import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "@/components/error-state";

/**
 * ErrorState — UI de los error boundaries (auditoría #42).
 */
describe("ErrorState", () => {
  it("renderiza título y descripción por default en español", () => {
    render(<ErrorState />);
    expect(screen.getByText("Algo salió mal")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("llama a onRetry cuando el usuario toca Reintentar", async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("muestra el digest como referencia si se provee", () => {
    render(<ErrorState digest="abc123" />);
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("no muestra botón si no hay onRetry", () => {
    render(<ErrorState />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
