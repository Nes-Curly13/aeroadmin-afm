/**
 * AuraBackground — fondo con gradiente atmosférico "Sunrise Drift"
 * (Sprint 2026-08-15).
 *
 * Wrapper de server component. Renderiza 2 capas en `mix-blend-mode: multiply`
 * sobre el body background (`bg-background` = crema). Las capas se
 * componen contra ese fondo, por eso el container NO lleva su propio
 * `background-color` — agregarlo rompería el efecto (las capas se
 * multiplicarían contra el container, no contra el body).
 *
 * Reglas críticas (ver `app/globals.css`):
 *   1. `body` debe tener un fondo claro para que el multiply tenga con qué
 *      componer. En AeroAdmin eso ya está seteado globalmente
 *      (`@layer base body { @apply bg-background … }`).
 *   2. El container tiene `position: relative; overflow: hidden;
 *      min-height: 100vh` y las capas son `position: absolute; inset: 0`.
 *   3. El contenido va en un wrapper con `position: relative; z-index: 1`
 *      para que pinte arriba de las capas.
 *   4. `pointer-events: none` + `aria-hidden` en las capas (decorativas).
 *
 * Uso:
 * ```tsx
 * <AuraBackground>
 *   <main>…</main>
 * </AuraBackground>
 * ```
 */
import type { ReactNode } from "react";

export function AuraBackground({ children }: { children: ReactNode }) {
  return (
    <div className="aura-bg">
      <div className="aura-layer aura-layer-1" aria-hidden="true" />
      <div className="aura-layer aura-layer-2" aria-hidden="true" />
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
