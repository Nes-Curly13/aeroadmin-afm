import Image from "next/image";
import Link from "next/link";
import { ReactNode } from "react";

type ActiveSection = "dashboard" | "history" | "map" | "devices";

const sidebarNav: Array<{ href: string; label: string; icon: string; key: ActiveSection }> = [
  { href: "/", label: "Panel", icon: "dashboard", key: "dashboard" },
  { href: "/map", label: "Mapa", icon: "map", key: "map" },
  { href: "/history", label: "Historial", icon: "history", key: "history" },
  { href: "/devices", label: "Dispositivos", icon: "devices", key: "devices" }
];

const DEFAULT_SUBTITLE =
  "Reportes, mapas y trazabilidad DJI integrados para operaciones de campo, con foco en el historial de este año.";

export interface AppShellProps {
  children?: ReactNode;
  title: string;
  eyebrow: string;
  subtitle?: string;
  actions?: ReactNode;
  activeSection: ActiveSection;
  parcelsCount?: number;
  highAlertsCount?: number;
}

export function AppShell({
  children,
  title,
  eyebrow,
  subtitle = DEFAULT_SUBTITLE,
  actions,
  activeSection,
  parcelsCount = 0,
  highAlertsCount = 0
}: AppShellProps) {
  const showStatus = parcelsCount > 0 || highAlertsCount > 0;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,139,34,0.12),_transparent_32%),linear-gradient(180deg,_#f4f7f3_0%,_#ebf0ec_100%)] text-[#121815]">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-[#cfd8d3] bg-white/90 px-5 shadow-[0px_10px_28px_rgba(15,23,42,0.08)] backdrop-blur lg:px-8">
        <div className="flex items-center gap-8">
          <Link className="flex items-center gap-3" href="/">
            <div className="relative h-10 w-12 overflow-hidden rounded-lg">
              <Image alt="AeroAdmin AFM Logo" fill src="/logo.svg" style={{ objectFit: "contain" }} />
            </div>
            <span className="text-xl font-black uppercase tracking-[0.22em] text-[#0b5f2d]">AeroAdmin AFM</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:block">{actions}</div>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-64px)]">
        <aside className="hidden h-[calc(100vh-64px)] w-72 shrink-0 flex-col border-r border-[#21352a] bg-[#0f1713] px-4 py-6 text-white lg:flex">
          <div className="space-y-1">
            {sidebarNav.map((item) => {
              const active = item.key === activeSection;
              return (
                <Link
                  className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold uppercase transition-all ${
                    active
                      ? "bg-[#2c7f44] text-white shadow-[0px_8px_24px_rgba(44,127,68,0.3)]"
                      : "text-[#ced8d0] hover:bg-white/10 hover:text-white"
                  }`}
                  href={item.href}
                  key={item.key}
                >
                  <NavIcon icon={item.icon} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          {showStatus ? (
            <div className="mt-8 border-t border-white/10 pt-6" data-testid="status-block">
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
              </div>
            </div>
          ) : null}

          <div className="mt-auto px-2 pb-4" />
        </aside>

        <main className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-7xl p-5 lg:p-8">
            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.28em] text-[#2c7f44]">{eyebrow}</p>
                <h1 className="text-4xl font-black tracking-tight text-[#121815]">{title}</h1>
                <p className="mt-2 max-w-2xl text-base text-[#4a5b50]">{subtitle}</p>
              </div>
              <div className="sm:hidden">{actions}</div>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

const NAV_ICON_PATHS: Record<string, string> = {
  dashboard: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  map: "M1 6v16l7-3 8 3 7-3V3l-7 3-8-3-7 3zm7-2.5L16 6.5l6-2.5v12.5l-6 2.5-8-2.5V3.5z",
  history: "M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V1l4 4-4 4V6a6 6 0 1 0 6 6h2a9 9 0 0 0-9-9zm-1 5v5l4 2 .7-1.2-3.2-1.6V8H12z",
  devices: "M4 6h18V4H4v2zm0 4h18V8H4v2zm0 4h14v-2H4v2zm0 4h14v-2H4v2zM20 14v8h2v-8h-2z"
};

function NavIcon({ icon }: { icon: string }) {
  const path = NAV_ICON_PATHS[icon] ?? NAV_ICON_PATHS.dashboard;
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
      <path d={path} />
    </svg>
  );
}
