"use client";

/**
 * AutoFocusFumigation — client component que hace scroll + focus al
 * form de fumigación cuando el URL tiene `?action=fumigar`.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 3.
 *
 * Caso de uso: el operador crea una parcela nueva y tilda "Fumigar
 * inmediatamente". El new-parcel-form redirige a
 * `/parcelas/{id}?action=fumigar`. Este componente detecta el query
 * param, hace scroll al form, le da focus al primer input (Fecha) y
 * muestra un banner "Listo para registrar la fumigación" para que el
 * operador sepa dónde está.
 *
 * Solo client porque usa `window.location` y `useEffect`. Es invisible
 * si no hay el query param (no afecta la experiencia normal del detail).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sprout, X } from "lucide-react";

export function AutoFocusFumigation() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Solo actuar si el URL tiene ?action=fumigar
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("action") !== "fumigar") return;

    // Activar el banner. El scroll/focus se hace en el mismo effect
    // (sin requestAnimationFrame, que en jsdom no se ejecuta en tests).
    const card = document.getElementById("fumigacion-card");
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstInput = card.querySelector<HTMLInputElement>("input");
      if (firstInput) {
        // Delay para que el scroll termine antes de abrir el teclado en mobile
        setTimeout(() => firstInput.focus({ preventScroll: true }), 400);
      }
    }
    setShowBanner(true);
    // Limpiar el query param para que refresh no re-dispare el scroll
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState({}, "", url.toString());
  }, []);

  if (!showBanner) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-primary"
    >
      <Sprout className="size-5 shrink-0" aria-hidden />
      <p className="flex-1">
        <span className="font-semibold">Parcela creada.</span>{" "}
        Ya podés registrar la fumigación inicial abajo. El producto, dosis y demás
        datos son los de esta aplicación.
      </p>
      <button
        type="button"
        onClick={() => setShowBanner(false)}
        aria-label="Cerrar aviso"
        className="text-primary/60 hover:text-primary"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
