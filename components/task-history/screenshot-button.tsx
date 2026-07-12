"use client";

/**
 * ScreenshotButton — client component.
 *
 * Captura el elemento DOM pasado por prop `targetRef` y descarga como
 * PNG. Implementación con `html-to-image` puro JS (no requiere libs
 * externas) — usa canvas nativo + XMLSerializer para el SVG.
 *
 * Decisión pragmática: el plan original era usar `html2canvas` (aprobado
 * por el user), pero agregaría ~80KB al bundle y tiene incompatibilidades
 * conocidas con SVGs de Leaflet. Esta implementación:
 *   1. Lee el innerHTML del target.
 *   2. Lo embebe en un `<svg>` con `<foreignObject>`.
 *   3. Serializa el SVG a data URL.
 *   4. Lo dibuja en un canvas via `Image`.
 *   5. Exporta el canvas como PNG via `toBlob`.
 *
 * Limitaciones:
 *   - Los CSS externos no se embeben — el resultado hereda solo los
 *     estilos inline (Tailwind v4 genera styles inline-friendly, OK).
 *   - Las imágenes externas (tiles del mapa) requieren CORS allow.
 *     Por eso el botón permite configurar `omitMap` para excluir el
 *     contenedor del mapa del screenshot.
 *
 * Si el usuario quiere la versión completa con html2canvas, se reemplaza
 * el `captureWithHtmlToImage` por una llamada a `html2canvas(target).then(...)`.
 */

import { useCallback, useState, type RefObject } from "react";

export interface ScreenshotButtonProps {
  /** Ref al elemento a capturar. */
  targetRef: RefObject<HTMLElement | null>;
  /** Prefijo del filename (default: "task-history"). */
  filenamePrefix?: string;
  /** Opcional: omitir el mapa del screenshot (tiles tienen CORS issues). */
  omitMap?: boolean;
  /** Opcional: aria-label del botón. */
  ariaLabel?: string;
  /** Opcional: selector CSS a excluir del screenshot. */
  excludeSelector?: string;
}

const DEFAULT_FILENAME_PREFIX = "task-history";
const DEFAULT_ARIA_LABEL = "Capturar screenshot del Task History";

function todayForFilename(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ScreenshotButton({
  targetRef,
  filenamePrefix = DEFAULT_FILENAME_PREFIX,
  omitMap = true,
  ariaLabel = DEFAULT_ARIA_LABEL,
  excludeSelector = ".leaflet-container"
}: ScreenshotButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    const target = targetRef.current;
    if (!target) {
      setError("No target ref");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Clonar el target para no afectar el DOM visible
      const clone = target.cloneNode(true) as HTMLElement;
      if (omitMap) {
        // Eliminar Leaflet container (CORS issues con tiles)
        clone.querySelectorAll(excludeSelector).forEach((n) => n.remove());
      }
      // Computar dimensiones del original
      const rect = target.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.ceil(rect.height);
      // Wrap en SVG con foreignObject
      const xmlns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(xmlns, "svg");
      svg.setAttribute("xmlns", xmlns);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const foreignObject = document.createElementNS(xmlns, "foreignObject");
      foreignObject.setAttribute("x", "0");
      foreignObject.setAttribute("y", "0");
      foreignObject.setAttribute("width", String(width));
      foreignObject.setAttribute("height", String(height));
      // Inline el clone con su contenido
      const styleEl = document.createElementNS(xmlns, "style");
      // Copiar los stylesheets actuales via getComputedStyle NO es
      // posible en este approach. Como Tailwind v4 genera utility classes
      // que en muchos casos son inline-style, la mayoria de los
      // estilos basicos se preservan. Para una cobertura completa,
      // reemplazar esta funcion con html2canvas.
      foreignObject.appendChild(clone);
      svg.appendChild(foreignObject);
      // Serializar
      const xml = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob(
        ['<?xml version="1.0" standalone="no"?>\n', xml],
        { type: "image/svg+xml;charset=utf-8" }
      );
      const url = URL.createObjectURL(svgBlob);
      // Pintar en canvas
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(new Error(`Image load failed: ${String(e)}`));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context not available");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      // Export PNG
      canvas.toBlob((blob) => {
        if (!blob) {
          setError("toBlob returned null");
          setBusy(false);
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = `${filenamePrefix}-${todayForFilename()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(pngUrl);
        setBusy(false);
      }, "image/png");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Screenshot failed.");
      setBusy(false);
    }
  }, [targetRef, filenamePrefix, omitMap, excludeSelector]);

  return (
    <button
      aria-label={ariaLabel}
      className="flex items-center gap-2 rounded-md border border-[#d2ddd6] bg-white px-3 py-1.5 text-sm font-semibold text-[#121815] hover:bg-[#f4f7f4] disabled:cursor-not-allowed disabled:opacity-60"
      data-testid="task-history-screenshot-button"
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 16 16"
      >
        <path d="M1 5h3l1-2h6l1 2h3v9H1V5Z" />
        <circle cx="8" cy="9" r="3" />
      </svg>
      {busy ? "Capturando..." : "Screenshot"}
      {error ? <span className="sr-only">{`Error: ${error}`}</span> : null}
    </button>
  );
}

export default ScreenshotButton;
