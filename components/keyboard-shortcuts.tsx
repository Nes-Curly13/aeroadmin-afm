"use client";

/**
 * KeyboardShortcuts — atajos de teclado globales.
 *
 * Track B (perf/ux v1.1) — MEJORA 3.
 *
 * Convenciones:
 *   - Estilo vim-style: `g` + letra (1s timeout) para navegación.
 *   - `?` (shift+/) abre modal de ayuda.
 *   - `Escape` cierra el modal.
 *   - NO se dispara si el foco está en un input/textarea/contenteditable
 *     (mismo patrón que `components/map/parcel-search.tsx`).
 *
 * Sin librerías externas (no react-hotkeys-hook) — implementación a mano
 * con useEffect + addEventListener, y un useRef para el timeout de la
 * secuencia `g` → letra.
 *
 * Mount: `app/layout.tsx` lo incluye una vez como client component global.
 *
 * Atajos:
 *   g + p → /parcels
 *   g + m → /map
 *   g + t → /task-history
 *   g + d → / (dashboard)
 *   ?     → modal de ayuda
 *   Esc   → cerrar modal
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const SEQUENCE_TIMEOUT_MS = 1000;

const G_SEQUENCES: Record<string, string> = {
  p: "/parcels",
  m: "/map",
  t: "/task-history",
  d: "/"
};

interface ShortcutEntry {
  readonly keys: string;
  readonly description: string;
}

const SHORTCUTS: readonly ShortcutEntry[] = [
  { keys: "g  p", description: "Ir a /parcels" },
  { keys: "g  m", description: "Ir a /map" },
  { keys: "g  t", description: "Ir a /task-history" },
  { keys: "g  d", description: "Ir al Panel principal (/)" },
  { keys: "?", description: "Mostrar este modal de ayuda" }
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  // `isContentEditable` es un getter derivado del atributo `contenteditable`.
  // En navegadores reales funciona; en jsdom hay un fallback adicional basado
  // en el atributo HTML (jsdom no implementa el getter en todas las versiones).
  if (target.isContentEditable) return true;
  if (target.getAttribute("contenteditable") !== null) return true;
  return false;
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  // Ref para el timeout de la secuencia `g → letra`. Usar ref en vez de
  // state evita re-renders innecesarios y stale-closure issues.
  const pendingGTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearPending() {
      if (pendingGTimeoutRef.current !== null) {
        clearTimeout(pendingGTimeoutRef.current);
        pendingGTimeoutRef.current = null;
      }
    }

    function handler(event: KeyboardEvent) {
      // 1. Si el foco está en un input/textarea/contenteditable, no actuar.
      //    El usuario está tipeando — no queremos robarle las teclas.
      //    Usamos `document.activeElement` (no `event.target`) porque cuando
      //    el listener está en `document`, el target puede ser el body o
      //    document mismo. Mismo patrón que `components/map/parcel-search.tsx`.
      if (isTypingTarget(document.activeElement)) return;

      // 2. Escape cierra el modal (prioridad sobre la secuencia g+)
      if (event.key === "Escape") {
        if (helpOpen) {
          event.preventDefault();
          setHelpOpen(false);
        }
        return;
      }

      // 3. ? abre el modal de ayuda
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

      // 4. Si hay un 'g' pendiente, esta es la segunda tecla.
      if (pendingGTimeoutRef.current !== null) {
        const target = G_SEQUENCES[event.key];
        clearPending();
        if (target) {
          event.preventDefault();
          router.push(target);
        }
        // Cualquier segunda tecla (válida o no) cancela la secuencia.
        return;
      }

      // 5. g inicia la secuencia (con timeout 1s)
      if (event.key === "g") {
        pendingGTimeoutRef.current = setTimeout(() => {
          pendingGTimeoutRef.current = null;
        }, SEQUENCE_TIMEOUT_MS);
        return;
      }

      // 6. Cualquier otra tecla sin secuencia pendiente: no hacer nada.
    }

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      clearPending();
    };
  }, [router, helpOpen]);

  if (!helpOpen) return null;

  return <HelpModal onClose={() => setHelpOpen(false)} />;
}

function HelpModal({ onClose }: { onClose: () => void }) {
  // Cerrar al hacer click en el backdrop
  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      aria-label="Cerrar modal de atajos"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        aria-labelledby="keyboard-shortcuts-title"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-[#d2ddd6] bg-white p-6 shadow-[0px_24px_60px_rgba(15,23,42,0.18)]"
        role="dialog"
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]"
              id="keyboard-shortcuts-title"
            >
              Atajos de teclado
            </h2>
            <p className="mt-1 text-sm text-[#4a5b50]">
              Navegación sin mouse, estilo vim.
            </p>
          </div>
          <button
            aria-label="Cerrar"
            className="rounded-full p-1 text-[#587064] transition hover:bg-[#f4f7f4] hover:text-[#121815]"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true" className="text-xl leading-none">×</span>
          </button>
        </header>

        <ul className="space-y-2">
          {SHORTCUTS.map((entry) => (
            <li
              className="flex items-center justify-between gap-3 rounded-lg border border-[#eef2ee] bg-[#f7f9fb] px-3 py-2"
              key={entry.keys}
            >
              <kbd className="rounded border border-[#cfd8d3] bg-white px-2 py-0.5 font-mono text-xs font-semibold text-[#121815]">
                {entry.keys}
              </kbd>
              <span className="flex-1 text-right text-sm text-[#4a5b50]">
                {entry.description}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[11px] text-[#587064]">
          Presioná <kbd className="rounded border border-[#cfd8d3] bg-white px-1.5 font-mono text-[10px]">Esc</kbd>{" "}
          para cerrar.
        </p>
      </div>
    </div>
  );
}
