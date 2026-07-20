import type { ReactNode } from "react";

/**
 * Estado vacío reutilizable para listas y secciones del panel.
 *
 * Patrón consistente:
 *   - Eyebrow opcional (categoría / contexto)
 *   - Título claro
 *   - Descripción (qué pasó y por qué)
 *   - CTA opcional (link/botón)
 *
 * Reglas de copy:
 *   - NUNCA incluir comandos (`npm run …`, `node scripts/...`).
 *     Esos son developer-facing, no operador.
 *   - NUNCA pedirle al usuario que corra algo técnico. Si necesita
 *     datos, el siguiente paso lo dispara el supervisor o el dev.
 *   - Lenguaje positivo cuando aplica ("¡Buen trabajo!") y
 *     neutral cuando el motivo es incertidumbre.
 *
 * Estilo: hereda tokens del AFM (verde olivo, beige cálido, tipografía
 * bold-display). No usar colores azules ni grises genéricos.
 */
export interface EmptyStateProps {
  title: string;
  description: string;
  /** Eyebrow de categoría (ej. "Faltan por fumigar"). */
  eyebrow?: string;
  /** CTA opcional. `href` la convierte en Link, sin href es <button>. */
  cta?: { label: string; href?: string; onClick?: () => void };
  /** Icono SVG opcional. Se renderiza arriba del título. */
  icon?: ReactNode;
  /** Test id para tests E2E. */
  testId?: string;
  /** Variante de tamaño — la mayoría de empty states usan "default". */
  size?: "default" | "sm";
}

export function EmptyState({
  title,
  description,
  eyebrow,
  cta,
  icon,
  testId,
  size = "default"
}: EmptyStateProps) {
  const padding = size === "sm" ? "p-6" : "p-8";
  return (
    <div
      className={`rounded-2xl border border-[#d2ddd6] bg-white ${padding} text-center shadow-[0px_18px_40px_rgba(15,23,42,0.08)]`}
      data-testid={testId}
    >
      {icon ? <div className="mb-4 flex justify-center text-[#587064]">{icon}</div> : null}
      {eyebrow ? (
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">{eyebrow}</p>
      ) : null}
      <h3 className={`mt-2 font-black text-[#121815] ${size === "sm" ? "text-lg" : "text-2xl"}`}>
        {title}
      </h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[#4a5b50]">{description}</p>
      {cta ? (
        <div className="mt-5 flex justify-center">
          {cta.href ? (
            <a
              className="inline-flex items-center gap-2 rounded-full bg-[#0b5f2d] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#0a4f25]"
              href={cta.href}
            >
              {cta.label}
            </a>
          ) : (
            <button
              className="inline-flex items-center gap-2 rounded-full bg-[#0b5f2d] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#0a4f25]"
              onClick={cta.onClick}
              type="button"
            >
              {cta.label}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
