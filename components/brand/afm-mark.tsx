import Image from "next/image";

/**
 * <AfmMark /> — wrapper unificado del branding de AeroAdmin AFM.
 *
 * Por que existe:
 *   La app tiene 2 SVG de marca:
 *     - /afm-logo-mark.svg   (1.3KB, 120x40 horizontal, texto "AFM"
 *                              + subtitulo "Fumigación". Usa currentColor
 *                              y acento lime en la F. Adaptable a tema.)
 *     - /afm-logo.svg        (57KB, 485x695 vertical, monograma
 *                              complejo con fills hardcoded. El logo
 *                              original entregado por el operador.)
 *
 *   Antes cada lugar (sidebar, login, etc.) repetia la decision de
 *   cual usar y como dimensionarlo. Este componente centraliza:
 *     - la eleccion del archivo segun `variant`
 *     - el aspect ratio correcto
 *     - la decision de unoptimized (full = SI, mark = NO)
 *     - los alt texts accesibles
 *
 * Variants:
 *   - "mark"   → compacto horizontal, para sidebars, headers,
 *                badges, favicon. Default.
 *   - "full"   → monograma vertical, para pantallas de branding
 *                (login, splash). Mas pesado pero es "el logo real".
 *
 * Size semantics por variant:
 *   - "mark":  `size` es la altura en px; el ancho se calcula
 *              del aspect 120/40 = 3.0
 *   - "full":  `size` es el ancho en px; la altura se calcula
 *              del aspect 485/695 ≈ 0.697
 *
 * Esto evita el foot-gun de pasar width/height y olvidarse del
 * aspect (e.g. mostrar el mark estirado vertical).
 */
export type AfmMarkVariant = "mark" | "full";

export interface AfmMarkProps {
  variant?: AfmMarkVariant;
  /**
   * Tamaño en px. Para "mark" = altura, para "full" = ancho.
   * Default: 32 (mark) o 64 (full). Unused si pasas className con
   * h-* o w-* — el componente respeta el tamano que el padre le da.
   */
  size?: number;
  className?: string;
  /** Override del alt (default ya es descriptivo). */
  alt?: string;
  /**
   * Marca como prioritaria para LCP. Usar SOLO en el logo
   * above-the-fold (sidebar top, login header).
   */
  priority?: boolean;
}

const ASPECT = {
  // width / height
  mark: 120 / 40, // 3.0
  full: 485 / 695, // ≈ 0.697
} as const;

// Por que "full" necesita unoptimized: el monograma tiene paths con
// fills hardcoded (no currentColor) y dimensiones que el optimizer
// de Next.js no siempre rasteriza bien (issue QA-01 → PR #68 → fix).
// El "mark" es texto + currentColor y se rasteriza bien.
const NEEDS_UNOPTIMIZED: Record<AfmMarkVariant, boolean> = {
  mark: false,
  full: true,
};

const DEFAULT_ALT: Record<AfmMarkVariant, string> = {
  mark: "AFM — AeroAdmin Fumigación",
  full: "Logo AeroAdmin AFM",
};

const DEFAULT_SIZE: Record<AfmMarkVariant, number> = {
  mark: 32,
  full: 64,
};

export function AfmMark({
  variant = "mark",
  size,
  className,
  alt,
  priority = false,
}: AfmMarkProps) {
  const isMark = variant === "mark";
  const src = isMark ? "/afm-logo-mark.svg" : "/afm-logo.svg";
  const aspect = ASPECT[variant];
  const baseSize = size ?? DEFAULT_SIZE[variant];

  const width = isMark ? Math.round(baseSize * aspect) : baseSize;
  const height = isMark ? baseSize : Math.round(baseSize / aspect);

  return (
    <Image
      src={src}
      alt={alt ?? DEFAULT_ALT[variant]}
      width={width}
      height={height}
      className={className}
      priority={priority}
      unoptimized={NEEDS_UNOPTIMIZED[variant]}
    />
  );
}
