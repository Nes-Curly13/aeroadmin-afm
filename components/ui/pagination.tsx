import type { ReactNode } from "react";

/**
 * Pagination — primitive de paginacion (v1.7 sprint UI).
 *
 * Contexto: el sprint v1.7 limita la carga de alerts y upcoming
 * fumigations. En vez de traer 500 filas y meterlas en un ScrollView
 * (UX mala — el operador pierde contexto), paginamos server-side
 * via URL searchParams. Este componente es la UI: el padre controla
 * la logica de la query, el componente solo renderiza los botones.
 *
 * Decisiones:
 *   - Stateless: el padre pasa `currentPage`, `totalPages`, y
 *     `onPageChange`. El componente no hace router push ni fetch.
 *   - Numeros visibles: ventana de 5 paginas (current ± 2). Si el
 *     total excede, muestra "..." a los costados.
 *   - Botones prev/next: disabled cuando currentPage es 1 o totalPages.
 *   - Accesibilidad: aria-label "Pagina N" en cada boton, aria-current="page"
 *     en la pagina activa.
 *   - Responsive: en mobile muestra solo prev/next + pagina actual
 *     (los numeros de pagina se ocultan para ahorrar espacio).
 *
 * Tests:
 *   - `tests/components/ui/pagination.test.tsx` cubre los 5 numeros,
 *     la ventana, los elipsis, prev/next disabled, y callbacks.
 */

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /**
   * Texto descriptivo para screen readers. Default: "Paginación".
   */
  ariaLabel?: string;
  /**
   * Si true, oculta los numeros de pagina y muestra solo prev/next
   * + label "Pagina N de M". Util para mobile o espacios chicos.
   */
  compact?: boolean;
  className?: string;
  testId?: string;
}

const DEFAULT_ARIA_LABEL = "Paginación";
const VISIBLE_PAGE_WINDOW = 2; // current ± 2 = 5 numeros max

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  ariaLabel = DEFAULT_ARIA_LABEL,
  compact = false,
  className,
  testId
}: PaginationProps) {
  if (totalPages <= 1) return null;

  // Clamp currentPage para que el calculo de la ventana sea estable cuando
  // data y UI se desincronizan (ej. URL dice ?page=15 pero totalPages=10).
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const pages: (number | "ellipsis")[] = [];
  // Ventana: safePage ± VISIBLE_PAGE_WINDOW
  const start = Math.max(1, safePage - VISIBLE_PAGE_WINDOW);
  const end = Math.min(totalPages, safePage + VISIBLE_PAGE_WINDOW);
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push("ellipsis");
  }
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push("ellipsis");
    pages.push(totalPages);
  }

  // Defensive: si por algun motivo los extremos no quedaron en la lista
  // (ej. safePage clamping resulto en start > end), forzarlos.
  if (!pages.includes(1)) pages.unshift(1);
  if (!pages.includes(totalPages)) pages.push(totalPages);

  const isFirst = currentPage <= 1;
  const isLast = currentPage >= totalPages;

  return (
    <nav
      aria-label={ariaLabel}
      className={`flex items-center gap-1 ${className ?? ""}`}
      data-testid={testId}
    >
      <PageButton
        ariaLabel="Página anterior"
        disabled={isFirst}
        onClick={() => onPageChange(currentPage - 1)}
      >
        ← Anterior
      </PageButton>
      {compact ? (
        <span
          aria-current="page"
          className="px-3 py-1.5 text-sm font-semibold text-[#121815]"
        >
          {currentPage} / {totalPages}
        </span>
      ) : (
        <ol className="flex items-center gap-1" role="list">
          {pages.map((page, idx) => (
            <li key={page === "ellipsis" ? `e-${idx}` : `p-${page}`}>
              {page === "ellipsis" ? (
                <span aria-hidden="true" className="px-2 py-1.5 text-sm text-[#587064]">
                  …
                </span>
              ) : (
                <PageButton
                  ariaCurrent={page === currentPage ? "page" : undefined}
                  ariaLabel={`Página ${page}`}
                  isActive={page === currentPage}
                  onClick={() => onPageChange(page)}
                >
                  {page}
                </PageButton>
              )}
            </li>
          ))}
        </ol>
      )}
      <PageButton
        ariaLabel="Página siguiente"
        disabled={isLast}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Siguiente →
      </PageButton>
    </nav>
  );
}

// ============================================================
// PageButton — interno, no se exporta
// ============================================================

interface PageButtonProps {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  isActive?: boolean;
  ariaLabel: string;
  ariaCurrent?: "page";
}

function PageButton({
  children,
  onClick,
  disabled = false,
  isActive = false,
  ariaLabel,
  ariaCurrent
}: PageButtonProps) {
  const baseClass =
    "rounded-md px-3 py-1.5 text-sm font-semibold transition";
  const variantClass = isActive
    ? "bg-[#0b5f2d] text-white"
    : disabled
      ? "text-[#9fb5a6] cursor-not-allowed"
      : "text-[#121815] hover:bg-[#f4f7f4]";
  return (
    <button
      aria-current={ariaCurrent}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      className={`${baseClass} ${variantClass}`}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      type="button"
    >
      {children}
    </button>
  );
}
