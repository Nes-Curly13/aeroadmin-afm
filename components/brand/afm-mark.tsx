import Image from "next/image";

/**
 * <AfmMark /> — wrapper del logo de marca de AFM Topografía.
 *
 * Assets (derivados fielmente del logo original `docs/afm_png.svg`):
 *   - /afm-emblem.svg     recorte del círculo amarillo con el paisaje
 *                         (cielo azul + campos verdes), 423x423.
 *   - /afm-logo-full.svg  logo completo: círculo + "AFM" + "TOPOGRAFÍA",
 *                         485x695, fondo transparente.
 *
 * Variants:
 *   - "emblem" → solo el círculo. Sidebar, headers, badges, favicon.
 *   - "full"   → logo completo. Login / splash.
 *
 * `size` = altura en px para ambos variants (el ancho se calcula del
 * aspect). Así no hay que recordar width/height y el logo nunca sale
 * estirado.
 *
 * `unoptimized: true` para ambos: son SVG con paths complejos (el logo
 * original es un traced raster) y dimensiones no-standard para el
 * optimizer de Next.js (histórico: 400 en /_next/image, ver
 * tests/app-shell-logo-unoptimized.test.ts).
 */
export type AfmMarkVariant = "emblem" | "full";

export interface AfmMarkProps {
  /** Altura en px (el ancho se calcula del aspect). */
  size?: number;
  variant?: AfmMarkVariant;
  className?: string;
  /** Override del alt (default ya es descriptivo). */
  alt?: string;
  /** `priority` para el logo above-the-fold (sidebar top, login). */
  priority?: boolean;
}

const ASSET: Record<AfmMarkVariant, string> = {
  emblem: "/afm-emblem.svg",
  full: "/afm-logo-full.svg",
};

const ASPECT = {
  // width / height
  emblem: 423 / 423, // 1.0
  full: 485 / 695, // ≈ 0.698
} as const;

const NEEDS_UNOPTIMIZED: Record<AfmMarkVariant, boolean> = {
  emblem: true,
  full: true,
};

const DEFAULT_ALT: Record<AfmMarkVariant, string> = {
  emblem: "AFM Topografía",
  full: "Logo AFM Topografía",
};

const DEFAULT_SIZE: Record<AfmMarkVariant, number> = {
  emblem: 40,
  full: 96,
};

export function AfmMark({
  variant = "emblem",
  size,
  className,
  alt,
  priority = false,
}: AfmMarkProps) {
  const aspect = ASPECT[variant];
  const baseSize = size ?? DEFAULT_SIZE[variant];
  const height = baseSize;
  const width = Math.round(baseSize * aspect);

  return (
    <Image
      src={ASSET[variant]}
      alt={alt ?? DEFAULT_ALT[variant]}
      width={width}
      height={height}
      className={className}
      priority={priority}
      unoptimized={NEEDS_UNOPTIMIZED[variant]}
    />
  );
}
