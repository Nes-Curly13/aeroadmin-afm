import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { DeviceGrid } from "@/components/devices/device-grid";
import type { Device } from "@/lib/devices";

const DEVICES: Device[] = [
  {
    name: "Drone 1",
    model: "T40",
    status: "active",
    kind: "drone",
    detailA: "85%",
    detailB: "100 h"
  },
  {
    name: "Sensor 1",
    model: "Davis",
    status: "connected",
    kind: "sensor",
    detailA: "28°C",
    detailB: "65%"
  },
  {
    name: "GPS 1",
    model: "Emlid",
    status: "rtk_fix",
    kind: "gps",
    detailA: "18 sat",
    detailB: "±1 cm"
  }
];

describe("DeviceGrid", () => {
  it("renderiza una card por cada device", () => {
    render(<DeviceGrid devices={DEVICES} />);
    expect(screen.getByText("Drone 1")).toBeInTheDocument();
    expect(screen.getByText("Sensor 1")).toBeInTheDocument();
    expect(screen.getByText("GPS 1")).toBeInTheDocument();
  });

  it("muestra el modelo del device", () => {
    render(<DeviceGrid devices={DEVICES} />);
    expect(screen.getByText("T40")).toBeInTheDocument();
    expect(screen.getByText("Davis")).toBeInTheDocument();
  });

  it("muestra el status como badge con color", () => {
    render(<DeviceGrid devices={DEVICES} />);
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("Conectado")).toBeInTheDocument();
    expect(screen.getByText("Fix RTK")).toBeInTheDocument();
  });

  it("muestra el icono Material correcto según el kind", () => {
    const { container } = render(<DeviceGrid devices={DEVICES} />);
    // Material Symbols
    const icons = container.querySelectorAll(".material-symbols-outlined");
    expect(icons.length).toBeGreaterThanOrEqual(3);
  });

  it("muestra el label de las métricas según el kind", () => {
    render(<DeviceGrid devices={DEVICES} />);
    expect(screen.getByText("Batería")).toBeInTheDocument();
    expect(screen.getByText("Temperatura")).toBeInTheDocument();
    expect(screen.getByText("Satélites")).toBeInTheDocument();
  });

  it("muestra el valor de las métricas", () => {
    render(<DeviceGrid devices={DEVICES} />);
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("100 h")).toBeInTheDocument();
    expect(screen.getByText("28°C")).toBeInTheDocument();
    expect(screen.getByText("65%")).toBeInTheDocument();
    expect(screen.getByText("18 sat")).toBeInTheDocument();
    expect(screen.getByText("±1 cm")).toBeInTheDocument();
  });

  it("muestra estado vacío si no hay devices", () => {
    render(<DeviceGrid devices={[]} />);
    expect(screen.getByText(/no hay dispositivos/i)).toBeInTheDocument();
  });

  it("muestra el placeholder '+ Agregar dispositivo' si showAddPlaceholder es true", () => {
    render(<DeviceGrid devices={DEVICES} showAddPlaceholder />);
    expect(screen.getByText(/\+ agregar dispositivo/i)).toBeInTheDocument();
  });

  it("no muestra el placeholder si showAddPlaceholder es false (default)", () => {
    render(<DeviceGrid devices={DEVICES} />);
    expect(screen.queryByText(/\+ agregar dispositivo/i)).not.toBeInTheDocument();
  });
});
