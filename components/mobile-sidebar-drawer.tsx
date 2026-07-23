"use client";

/**
 * MobileSidebarDrawer — hamburger menu + drawer mobile.
 *
 * Track B (mobile) v1.2 — MEJORA 1: cierra el gap del audit ui-ux-2026-07 §1
 * (🟠 ALTA): el operador de campo en Valle del Cauca no tenía forma de
 * navegar el panel desde el celular porque `app-shell.tsx` esconde el
 * `<aside>` con `hidden lg:flex`.
 *
 * Comportamiento:
 *   - Botón hamburguesa visible solo en mobile (`lg:hidden`).
 *   - Click en hamburguesa abre un drawer lateral que se desliza desde la
 *     izquierda (transform translate-x + transition 200ms).
 *   - Mismo contenido que el sidebar desktop: los 6 items de navegación
 *     (Panel, Mapa, Historial, Parcelas, Faltan, Dispositivos) + el bloque
 *     "Estado actual" (parcelsCount + highAlertsCount) cuando aplica.
 *   - Cierre por: click en backdrop, tecla Escape, o navegación a un item.
 *   - Body overflow:hidden mientras el drawer está abierto (no scroll detrás).
 *   - Foco vuelve al botón hamburguesa al cerrar (UX keyboard-friendly).
 *
 * Sin dependencias externas: solo Tailwind + React. NO headlessui, NO
 * framer-motion (regla dura del track). Reutiliza `NavIcon` desde
 * `lib/nav-icons.ts` (DRY con el sidebar desktop).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { NavIcon } from "@/lib/nav-icons";

export type MobileSidebarSection =
  | "dashboard"
  | "history"
  | "map"
  | "devices"
  | "task-history"
  | "parcels"
  | "faltan";

export interface MobileSidebarNavItem {
  href: string;
  label: string;
  icon: string;
  key: MobileSidebarSection;
}

export interface MobileSidebarDrawerProps {
  sidebarNav: readonly MobileSidebarNavItem[];
  parcelsCount: number;
  highAlertsCount: number;
  /**
   * M4/F1.16 — Count de parcelas vencidas (severity='overdue'). Mismo
   * contrato que el `overdueCount` de `AppShell`: si es `undefined`,
   * el chip se oculta. Solo el dashboard (`app/page.tsx`) pasa este
   * valor. Ver `app-shell.tsx` para más contexto.
   */
  overdueCount?: number;
  activeSection: MobileSidebarSection;
}

const DRAWER_DIALOG_LABEL = "Menú principal de navegación";
const BURGER_LABEL_OPEN = "Cerrar menú";
const BURGER_LABEL_CLOSED = "Abrir menú";

export function MobileSidebarDrawer({
  sidebarNav,
  parcelsCount,
  highAlertsCount,
  overdueCount,
  activeSection
}: MobileSidebarDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement | null>(null);
  // Guardamos el overflow original para restaurarlo exactamente al cerrar
  // (no asumir "" — puede haber sido "scroll" o "auto" antes).
  const previousBodyOverflowRef = useRef<string>("");
  const dialogId = useId();

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // Body overflow lock + listener de Escape. Effect corre solo cuando `open`
  // cambia. Cleanup restaura el estado previo (no asumir "").
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    previousBodyOverflowRef.current = previousOverflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflowRef.current;
    };
  }, [open]);

  // Devolver el foco al botón hamburguesa tras cerrar. Usa rAF para esperar
  // a que React commitee el desmontaje del dialog antes de mover el foco.
  useEffect(() => {
    if (open) return;
    // Solo devolver foco si el foco actual está dentro del documento (puede
    // haber sido removido por el unmount del dialog).
    if (typeof requestAnimationFrame === "function") {
      const rafId = requestAnimationFrame(() => {
        burgerRef.current?.focus();
      });
      return () => {
        cancelAnimationFrame(rafId);
      };
    }
    burgerRef.current?.focus();
    return undefined;
  }, [open]);

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Solo cerramos si el click fue directamente sobre el backdrop, no
      // sobre un hijo (panel, link, etc.). Mismo patrón que el modal de
      // `keyboard-shortcuts.tsx`.
      if (event.target === event.currentTarget) {
        close();
      }
    },
    [close]
  );

  function handleNavClick(href: string) {
    close();
    router.push(href);
  }

  const showStatus =
    parcelsCount > 0 || highAlertsCount > 0 || (overdueCount ?? 0) > 0;
  const burgerLabel = open ? BURGER_LABEL_OPEN : BURGER_LABEL_CLOSED;

  return (
    <>
      <button
        aria-controls={dialogId}
        aria-expanded={open}
        aria-label={burgerLabel}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#cfd8d3] bg-white text-[#0b5f2d] shadow-sm transition hover:bg-[#f4f7f4] lg:hidden"
        onClick={() => setOpen((prev) => !prev)}
        ref={burgerRef}
        type="button"
      >
        {/* Ícono hamburguesa (3 barras) / X según estado. Mismo viewBox que el
            sidebar desktop para coherencia visual. */}
        <svg
          aria-hidden="true"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          {open ? (
            <path d="M6 6l12 12M18 6l-12 12" />
          ) : (
            <path d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {open ? (
        <div
          aria-label="Cerrar menú"
          className="fixed inset-0 z-[100] lg:hidden"
          onClick={handleBackdropClick}
          role="presentation"
        >
          {/* Backdrop semi-transparente. z-100 igual que el modal de atajos
              de keyboard-shortcuts para consistencia. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/50 transition-opacity duration-200"
          />

          {/* Panel deslizante. max-w-sm para que no ocupe todo el ancho en
              tablets chicas. Transform + transition 200ms. */}
          <aside
            aria-label={DRAWER_DIALOG_LABEL}
            aria-modal="true"
            className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-[#21352a] bg-[#0f1713] px-4 py-6 text-white shadow-[0px_24px_60px_rgba(15,23,42,0.18)] transition-transform duration-200 ease-out translate-x-0"
            id={dialogId}
            role="dialog"
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9fb5a6]">
                Navegación
              </p>
              <button
                aria-label="Cerrar menú"
                className="rounded-md p-1 text-[#9fb5a6] transition hover:bg-white/10 hover:text-white"
                onClick={close}
                type="button"
              >
                <span aria-hidden="true" className="text-xl leading-none">×</span>
              </button>
            </div>

            <nav className="space-y-1" aria-label="Secciones">
              {sidebarNav.map((item) => {
                const active = item.key === activeSection;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold uppercase transition-all ${
                      active
                        ? "bg-[#2c7f44] text-white shadow-[0px_8px_24px_rgba(44,127,68,0.3)]"
                        : "text-[#ced8d0] hover:bg-white/10 hover:text-white"
                    }`}
                    href={item.href}
                    key={item.key}
                    onClick={() => handleNavClick(item.href)}
                  >
                    <NavIcon icon={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {showStatus ? (
              <div
                className="mt-8 border-t border-white/10 pt-6"
                data-testid="status-block"
              >
                <p className="mb-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#9fb5a6]">
                  Estado actual
                </p>
                <div className="space-y-2 px-2">
                  {parcelsCount > 0 ? (
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ced8d0]">
                        Parcelas
                      </span>
                      <span className="rounded-full bg-[#2c7f44] px-3 py-0.5 text-sm font-bold text-white">
                        {parcelsCount}
                      </span>
                    </div>
                  ) : null}
                  {highAlertsCount > 0 ? (
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ced8d0]">
                        Alertas altas
                      </span>
                      <span className="rounded-full bg-[#a93232] px-3 py-0.5 text-sm font-bold text-white">
                        {highAlertsCount}
                      </span>
                    </div>
                  ) : null}
                  {/* M4/F1.16 — Mismo chip que el sidebar desktop. El
                      Link en el drawer usa el mismo handler de nav que
                      los otros items (handleNavClick) para que el
                      drawer se cierre al navegar. */}
                  {overdueCount !== undefined && overdueCount > 0 ? (
                    <Link
                      aria-label={`Ver ${overdueCount} parcelas vencidas`}
                      className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3 transition hover:bg-white/10"
                      data-testid="sidebar-overdue-link-mobile"
                      href="/parcels/overdue?severity=overdue"
                      onClick={() => handleNavClick("/parcels/overdue?severity=overdue")}
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ced8d0]">
                        Vencidas
                      </span>
                      <span className="rounded-full bg-[#a93232] px-3 py-0.5 text-sm font-bold text-white">
                        {overdueCount}
                      </span>
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
