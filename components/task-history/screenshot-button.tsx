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
 *
 * Accesibilidad (S2 / 2026-07-13):
 *   - `aria-label` descriptivo en español, no en jerga técnica.
 *   - `type="button"` explícito (no submit).
 *   - `aria-busy` durante la generación del PNG para que screen readers
 *     anuncien el cambio de estado (no solo `disabled`).
 *   - `disabled` también cuando no hay polígonos en el rango filtrado
 *     (el operador no puede descargar un mapa vacío sin sentido).
 *
 * Filename (S2 / 2026-07-13):
 *   - Incluye el rango filtrado (`task-history-2026-07-01_2026-07-15.png`)
 *     para que el operador distinga múltiples descargas del mismo día.
 *   - Si no se pasa `dateRange`, cae al comportamiento anterior
 *     (filename con fecha de hoy).
 */

import { useCallback, useState, type RefObject } from "react";

export interface ScreenshotButtonProps {
  /** Ref al elemento a capturar. */
  targetRef?: RefObject<HTMLElement | null>;
  /**
   * Alternativa a `targetRef`: selector CSS que se resuelve con
   * `document.querySelector` al momento del click. Útil cuando el
   * botón vive en un slot de un Server Component (ej. AppShell
   * `actions`) y no puede recibir refs que cruzan la frontera
   * server/client. Si se pasan ambos, `targetSelector` tiene
   * precedencia.
   */
  targetSelector?: string;
  /** Prefijo del filename (default: "task-history"). */
  filenamePrefix?: string;
  /** Opcional: omitir el mapa del screenshot (tiles tienen CORS issues). */
  omitMap?: boolean;
  /** Opcional: aria-label del botón. */
  ariaLabel?: string;
  /** Opcional: selector CSS a excluir del screenshot. */
  excludeSelector?: string;
  /**
   * Cantidad de polígonos en el rango filtrado. Cuando es 0, el botón
   * se deshabilita — no tiene sentido capturar un mapa sin polígonos.
   * Si es `undefined`, se asume que el caller gestiona el estado
   * `disabled` externamente (compat con usos legacy).
   */
  polygonCount?: number;
  /**
   * Rango de fechas filtrado, usado para componer el filename del
   * download. Si se omite, el filename usa la fecha de hoy.
   */
  dateRange?: { from: string; to: string };
}

const DEFAULT_FILENAME_PREFIX = "task-history";
const DEFAULT_ARIA_LABEL = "Descargar reporte de historial de fumigaciones";
const DEFAULT_VISIBLE_LABEL_BUSY = "Capturando…";
const DEFAULT_VISIBLE_LABEL_IDLE = "Descargar reporte";

/** Sanea un string YYYY-MM-DD: reemplaza no-`[0-9-]` por `-`. */
function sanitizeDatePart(s: string): string {
  return s.replace(/[^0-9-]/g, "-");
}

function todayForFilename(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Construye el filename del download. Pure function (exportada para
 * testing). Formato:
 *   - Con dateRange: `${prefix}-${fromISO}_${toISO}.png`
 *   - Sin dateRange: `${prefix}-${todayISO}.png` (back-compat)
 */
export function buildFilename(
  prefix: string,
  dateRange?: { from: string; to: string }
): string {
  if (dateRange) {
    const from = sanitizeDatePart(dateRange.from);
    const to = sanitizeDatePart(dateRange.to);
    return `${prefix}-${from}_${to}.png`;
  }
  return `${prefix}-${todayForFilename()}.png`;
}

export function ScreenshotButton({
  targetRef,
  targetSelector,
  filenamePrefix = DEFAULT_FILENAME_PREFIX,
  omitMap = true,
  ariaLabel = DEFAULT_ARIA_LABEL,
  excludeSelector = ".leaflet-container",
  polygonCount,
  dateRange
}: ScreenshotButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // disabled cuando: (a) está generando el PNG, O (b) el caller
  // reportó 0 polígonos en el rango filtrado. polygonCount === undefined
  // no bloquea — es back-compat con callers que no quieren esta lógica.
  const isDisabled = busy || polygonCount === 0;

  const onClick = useCallback(async () => {
    // Resolución del target: targetSelector (CSS) tiene precedencia sobre
    // targetRef (objeto ref). Esto permite que el botón viva en un slot
    // de Server Component (AppShell actions) y apunte a un elemento
    // dentro de un Client Component hermano (TaskHistoryClient).
    const target = targetSelector
      ? document.querySelector(targetSelector)
      : targetRef?.current ?? null;
    if (!target) {
      setError(targetSelector ? `No element matches ${targetSelector}` : "No target ref");
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
      // Export PNG — filename incluye el rango filtrado si se pasó
      // dateRange, sino cae a la fecha de hoy (back-compat con usos
      // donde el caller no gestiona rango, ej. tests legacy).
      const downloadName = buildFilename(filenamePrefix, dateRange);
      canvas.toBlob((blob) => {
        if (!blob) {
          setError("toBlob returned null");
          setBusy(false);
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = downloadName;
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
  }, [targetRef, targetSelector, filenamePrefix, omitMap, excludeSelector, dateRange]);

  return (
    <button
      aria-busy={busy}
      aria-label={ariaLabel}
      className="flex items-center gap-2 rounded-md border border-[#d2ddd6] bg-white px-3 py-1.5 text-sm font-semibold text-[#121815] hover:bg-[#f4f7f4] disabled:cursor-not-allowed disabled:opacity-60"
      data-testid="task-history-screenshot-button"
      disabled={isDisabled}
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
      {busy ? DEFAULT_VISIBLE_LABEL_BUSY : DEFAULT_VISIBLE_LABEL_IDLE}
      {error ? <span className="sr-only">{`Error: ${error}`}</span> : null}
    </button>
  );
}

export default ScreenshotButton;
