import type { ReactNode } from "react";

/**
 * FilterSidebar — primitive de sidebar de filtros (v1.7 sprint UI).
 *
 * Contexto: el patron bento del sprint v1.7 mueve los filtros del topbar
 * (AppShell `actions` slot) al body de la page, como una sidebar al
 * costado del elemento principal (mapa, lista, etc.).
 *
 * Por que existe (vs. un sidebar ad-hoc por page):
 *   - Consistencia visual entre pages (/map, /task-history, etc.).
 *   - Conteo de items por filtro (a11y: el operador ve cuantos
 *     registros pasan el filtro, no solo que el filtro esta activo).
 *   - Acciones comunes: limpiar filtros, header con titulo.
 *   - Testeable como primitive (sin acoplar a la query del page).
 *
 * Patron de uso tipico:
 *   <FilterSidebar
 *     title="Filtros"
 *     onClear={handleClear}
 *     filterCount={3}
 *     activeFilterCount={2}
 *   >
 *     <FilterSidebarSection title="Drones" count={droneList.length} activeCount={selectedDrones.size}>
 *       ...controles de filtro...
 *     </FilterSidebarSection>
 *     <FilterSidebarSection title="Periodo" count={periods.length} activeCount={1}>
 *       ...
 *     </FilterSidebarSection>
 *   </FilterSidebar>
 *
 * Tests:
 *   - `tests/components/ui/filter-sidebar.test.tsx` cubre el container
 *     y los FilterSidebarSection.
 */

export interface FilterSidebarProps {
  children: ReactNode;
  /** Titulo del sidebar. Si no se pasa, no se muestra. */
  title?: string;
  /** Subtitulo opcional debajo del titulo. */
  subtitle?: string;
  /** Callback del boton "Limpiar filtros". Si no se pasa, no se muestra el boton. */
  onClear?: () => void;
  /** Label del boton de limpiar. Default: "Limpiar filtros". */
  clearLabel?: string;
  /** Numero total de items que pasan los filtros actuales (a11y badge). */
  resultCount?: number;
  /** Texto descriptivo del conteo. Default: "resultados". */
  resultLabel?: string;
  /** className adicional (opcional). */
  className?: string;
  /** ARIA label (opcional). Si no se pasa, usa el `title`. */
  ariaLabel?: string;
  /** data-testid (opcional). */
  testId?: string;
}

const DEFAULT_CLEAR_LABEL = "Limpiar filtros";
const DEFAULT_RESULT_LABEL = "resultados";

export function FilterSidebar({
  children,
  title,
  subtitle,
  onClear,
  clearLabel = DEFAULT_CLEAR_LABEL,
  resultCount,
  resultLabel = DEFAULT_RESULT_LABEL,
  className,
  ariaLabel,
  testId
}: FilterSidebarProps) {
  const showHeader = Boolean(title || subtitle || onClear || resultCount !== undefined);
  return (
    <aside
      aria-label={ariaLabel ?? title}
      className={`flex w-full flex-col gap-3 rounded-2xl border border-[#d2ddd6] bg-white p-4 shadow-[0px_18px_40px_rgba(15,23,42,0.08)] ${
        className ?? ""
      }`}
      data-testid={testId}
    >
      {showHeader ? (
        <header className="flex flex-col gap-1 border-b border-[#d2ddd6] pb-3">
          {title ? (
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[#121815]">
                {title}
              </h2>
              {resultCount !== undefined ? (
                <span
                  aria-label={`${resultCount} ${resultLabel}`}
                  className="rounded-full bg-[#dbe7df] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[#0b5f2d]"
                  data-testid={testId ? `${testId}-result-count` : undefined}
                >
                  {resultCount} {resultLabel}
                </span>
              ) : null}
            </div>
          ) : null}
          {subtitle ? (
            <p className="text-xs text-[#587064]">{subtitle}</p>
          ) : null}
          {onClear ? (
            <button
              className="mt-1 self-start rounded-full border border-[#d2ddd6] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em] text-[#4a5b50] transition hover:bg-[#f4f7f4] hover:text-[#0b5f2d]"
              onClick={onClear}
              type="button"
            >
              {clearLabel}
            </button>
          ) : null}
        </header>
      ) : null}
      <div className="flex flex-col gap-4">{children}</div>
    </aside>
  );
}

// ============================================================
// FilterSidebarSection
// ============================================================

export interface FilterSidebarSectionProps {
  title: string;
  /** Numero total de opciones en este grupo (e.g. "12 drones"). */
  count?: number;
  /** Cuantas opciones estan activas (e.g. "2 de 12"). Si se pasa, muestra un badge. */
  activeCount?: number;
  /** Si true, oculta el contenido sin desmontarlo (con disclosure pattern). */
  collapsed?: boolean;
  /** Callback para togglear el collapse. Si no se pasa, el section no es colapsable. */
  onToggleCollapsed?: () => void;
  children: ReactNode;
  /** data-testid (opcional). */
  testId?: string;
}

/**
 * Sub-seccion de filtros con titulo + conteo + (opcional) collapse.
 * Usado para agrupar filtros relacionados (e.g. "Drones", "Periodo",
 * "Parcela").
 */
export function FilterSidebarSection({
  title,
  count,
  activeCount,
  collapsed = false,
  onToggleCollapsed,
  children,
  testId
}: FilterSidebarSectionProps) {
  const collapsible = Boolean(onToggleCollapsed);
  const showActive = activeCount !== undefined && activeCount > 0;
  const headerId = testId ? `${testId}-header` : undefined;
  const contentId = testId ? `${testId}-content` : undefined;
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <header
        className="flex items-center justify-between gap-2"
        id={headerId}
      >
        {collapsible ? (
          <button
            aria-controls={contentId}
            aria-expanded={!collapsed}
            className="flex flex-1 items-center justify-between gap-2 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-[#4a5b50] transition hover:text-[#0b5f2d]"
            onClick={onToggleCollapsed}
            type="button"
          >
            <span>{title}</span>
            <span className="flex items-center gap-2">
              {showActive ? (
                <span
                  aria-label={`${activeCount} ${activeCount === 1 ? "activo" : "activos"}`}
                  className="rounded-full bg-[#0b5f2d] px-2 py-0.5 text-[10px] font-bold text-white"
                >
                  {activeCount}
                </span>
              ) : null}
              {count !== undefined ? (
                <span className="text-[10px] font-semibold text-[#587064]">{count}</span>
              ) : null}
              <span aria-hidden="true" className="text-xs">
                {collapsed ? "▸" : "▾"}
              </span>
            </span>
          </button>
        ) : (
          <>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#4a5b50]">
              {title}
            </h3>
            <span className="flex items-center gap-2">
              {showActive ? (
                <span
                  aria-label={`${activeCount} ${activeCount === 1 ? "activo" : "activos"}`}
                  className="rounded-full bg-[#0b5f2d] px-2 py-0.5 text-[10px] font-bold text-white"
                >
                  {activeCount}
                </span>
              ) : null}
              {count !== undefined ? (
                <span className="text-[10px] font-semibold text-[#587064]">{count}</span>
              ) : null}
            </span>
          </>
        )}
      </header>
      {collapsed ? null : (
        <div className="flex flex-col gap-2" id={contentId}>
          {children}
        </div>
      )}
    </section>
  );
}
