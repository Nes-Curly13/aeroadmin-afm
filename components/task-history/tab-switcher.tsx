"use client";

/**
 * TabSwitcher — client component.
 *
 * Toggle entre las dos vistas del Task History (Map vs List) usando el
 * query param `?view=map|list`. Mantiene la convención del repo: cambiar
 * de tab NO recarga la página, sino que actualiza la URL via
 * `next/navigation:useRouter().replace(pathname + "?view=...")` y
 * refresca la data del Server Component padre con `router.refresh()`.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  [🗺 Map]    [📋 List]                       │  ← tabs
 *   │  ───                                         │  ← border-bottom 2px verde (active)
 *   └─────────────────────────────────────────────┘
 *
 * El estado activo se calcula del URL (no de useState local) para que
 * sea shareable y back/forward del browser funcione.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export type TaskHistoryView = "map" | "list";

export interface TabSwitcherProps {
  /** Tab actualmente activo (opcional — si se omite se lee del URL `?view=`). */
  active?: TaskHistoryView;
  /** Opcional: aria-label del contenedor. */
  ariaLabel?: string;
  /** Opcional: tab default si el URL no trae `?view=` (default: "map"). */
  defaultView?: TaskHistoryView;
  /**
   * Opcional: query params a preservar al cambiar de tab. Si se omite, se
   * preservan TODOS los params actuales (excepto `view`).
   */
  preserveSearchParams?: string[];
}

const TABS: Array<{ value: TaskHistoryView; label: string }> = [
  { value: "map", label: "Map" },
  { value: "list", label: "List" }
];

const DEFAULT_ARIA_LABEL = "Selector de vista del Task History";
const VALID_VIEWS: ReadonlySet<TaskHistoryView> = new Set(["map", "list"]);

function isTaskHistoryView(value: string | null | undefined): value is TaskHistoryView {
  return typeof value === "string" && VALID_VIEWS.has(value as TaskHistoryView);
}

export function TabSwitcher({
  active,
  ariaLabel = DEFAULT_ARIA_LABEL,
  defaultView = "map",
  preserveSearchParams
}: TabSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentView: TaskHistoryView = useMemo(() => {
    if (active && VALID_VIEWS.has(active)) return active;
    const fromUrl = searchParams.get("view");
    return isTaskHistoryView(fromUrl) ? fromUrl : defaultView;
  }, [active, searchParams, defaultView]);

  const buildHref = useCallback(
    (view: TaskHistoryView): string => {
      const params = new URLSearchParams();
      const keysToPreserve = preserveSearchParams ?? Array.from(searchParams.keys()).filter((k) => k !== "view");
      for (const key of keysToPreserve) {
        // Solo preserva params que siguen en searchParams (si no se pasaron explícitamente)
        const all = searchParams.getAll(key);
        for (const v of all) {
          params.append(key, v);
        }
      }
      if (view !== defaultView) {
        params.set("view", view);
      }
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams, preserveSearchParams, defaultView]
  );

  const onTabClick = useCallback(
    (view: TaskHistoryView) => {
      if (view === currentView) return;
      router.replace(buildHref(view), { scroll: false });
      router.refresh();
    },
    [router, buildHref, currentView]
  );

  return (
    <div
      aria-label={ariaLabel}
      className="flex items-center gap-1 border-b border-[#d2ddd6]"
      data-testid="task-history-tab-switcher"
      role="tablist"
    >
      {TABS.map((tab) => {
        const isActive = tab.value === currentView;
        return (
          <button
            aria-selected={isActive}
            className={
              isActive
                ? "-mb-px flex items-center gap-2 border-b-2 border-[#0b5f2d] px-4 py-2 text-sm font-semibold text-[#0b5f2d]"
                : "flex items-center gap-2 border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-[#587064] hover:text-[#121815]"
            }
            data-testid={`task-history-tab-${tab.value}`}
            data-active={isActive ? "true" : "false"}
            key={tab.value}
            onClick={() => onTabClick(tab.value)}
            role="tab"
            type="button"
          >
            <TabIcon view={tab.value} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TabIcon({ view }: { view: TaskHistoryView }) {
  if (view === "map") {
    return (
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
        <path d="M1 6v16l7-3 8 3 7-3V3l-7 3-8-3-7 3Z" transform="translate(-1 0) scale(0.7)" />
      </svg>
    );
  }
  return (
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
      <line x1="3" x2="13" y1="4" y2="4" />
      <line x1="3" x2="13" y1="8" y2="8" />
      <line x1="3" x2="10" y1="12" y2="12" />
    </svg>
  );
}
