// components/dashboard/sync-banner.tsx
//
// M12 (audit UX 2026-07-22) — Banner de salud del sync DJI.
//
// Decisión de diseño: server-side preferred. Leemos el archivo
// `djiag_exports/_health.json` en el server y derivamos el estado.
// No hay parpadeo cliente-servidor (no es un cliente component que
// pegue a /api/admin/djiag-health en useEffect).
//
// Estados visuales (4):
//   - ok   verde: <12h desde la última sync exitosa
//   - warn amarillo: 12-24h
//   - danger rojo: >24h
//   - unknown gris: archivo no existe / corrupto / sin lastSuccessfulSyncAt
//
// Decisión de thresholds: 12h coincide con el TTL de las S3 signed
// URLs de DJI Agras (memory entry: "DJI AG signed S3 URLs have ~12h
// TTL"). El sync tiene que correr al menos cada 12h para mantener
// los links vivos. 24h es el umbral de "stale" del propio sistema
// (ver `STALE_THRESHOLD_HOURS` en lib/djiag-health.ts).

import {
  deriveResponse,
  readHealthFile,
  type HealthResponse
} from "@/lib/djiag-health";

const HEALTH_FILE_RELATIVE = "djiag_exports/_health.json";
const WARN_THRESHOLD_HOURS = 12;

export type SyncTone = "ok" | "warn" | "danger" | "unknown";

const TONE_STYLES: Record<SyncTone, { bg: string; text: string; dot: string; label: string }> = {
  ok: {
    bg: "bg-[#e9f5ed] border-[#0b5f2d]/20",
    text: "text-[#0b5f2d]",
    dot: "bg-[#0b5f2d]",
    label: "Sincronizado"
  },
  warn: {
    bg: "bg-[#fff7e0] border-[#d4b23c]/40",
    text: "text-[#7a5f0d]",
    dot: "bg-[#d4b23c]",
    label: "Sync atrasado"
  },
  danger: {
    bg: "bg-[#fdecec] border-[#a93232]/30",
    text: "text-[#a93232]",
    dot: "bg-[#a93232]",
    label: "Sync caído"
  },
  unknown: {
    bg: "bg-[#f4f7f4] border-[#cfd8d3]",
    text: "text-[#4a5b50]",
    dot: "bg-[#9fb5a6]",
    label: "Sin datos"
  }
};

/**
 * Deriva el tono a partir de la respuesta del health.
 *
 * Reglas:
 *   - status='unknown' o sin lastSuccessfulSyncAt → unknown
 *   - hoursSinceLastSync <= 12 → ok
 *   - hoursSinceLastSync <= 24 → warn
 *   - hoursSinceLastSync > 24 → danger
 *   - status='failed' o 'partial' (sin importar horas) → danger
 *
 * Pura — testeable sin DOM.
 */
export function deriveSyncTone(response: HealthResponse): SyncTone {
  if (
    response.status === "unknown" ||
    response.lastSuccessfulSyncAt === null ||
    response.hoursSinceLastSync === null
  ) {
    return "unknown";
  }
  if (response.status === "failed" || response.status === "partial") {
    return "danger";
  }
  const hours = response.hoursSinceLastSync;
  if (hours <= WARN_THRESHOLD_HOURS) return "ok";
  if (hours <= 24) return "warn";
  return "danger";
}

/**
 * Formatea el "hace Xh" en lenguaje humano. Si <1h, muestra minutos.
 * Si >24h, muestra días.
 */
export function formatAgo(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `hace ${minutes} min`;
  }
  if (hours < 24) {
    return `hace ${Math.round(hours)} h`;
  }
  const days = Math.round(hours / 24);
  return `hace ${days} día${days === 1 ? "" : "s"}`;
}

export interface SyncBannerProps {
  response: HealthResponse;
}

/**
 * Banner server-side. Renderiza el estado de salud del sync DJI
 * arriba del dashboard. Sin JS, sin useEffect, sin parpadeo.
 */
export function SyncBanner({ response }: SyncBannerProps) {
  const tone = deriveSyncTone(response);
  const styles = TONE_STYLES[tone];
  const ago = formatAgo(response.hoursSinceLastSync);
  // Copy adaptado al estado.
  let detail: string;
  if (tone === "unknown") {
    detail = "No hay datos de la última sincronización DJI. El sistema puede estar desactualizado.";
  } else if (tone === "danger" && response.status === "failed") {
    detail = `La última corrida del pipeline DJI falló (${ago}).`;
  } else if (tone === "danger") {
    detail = `Última sync exitosa ${ago}. Las S3 URLs pueden haber expirado (>24h).`;
  } else if (tone === "warn") {
    detail = `Última sync ${ago}. Programá una corrida pronto para mantener los datos frescos.`;
  } else {
    detail = `Última sync DJI ${ago}. Datos al día.`;
  }
  return (
    <div
      aria-label={`Estado de sincronización DJI: ${styles.label}`}
      className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${styles.bg}`}
      data-testid="dji-sync-banner"
      data-tone={tone}
      role="status"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${styles.dot}`}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${styles.text}`}>
          {styles.label}
        </p>
        <p className={`mt-0.5 text-sm ${styles.text}`}>{detail}</p>
      </div>
      {response.warnings.length > 0 ? (
        <details className={`text-[11px] ${styles.text}`}>
          <summary className="cursor-pointer underline">Detalle</summary>
          <ul className="mt-2 space-y-1">
            {response.warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Server-side loader. Lee el archivo + deriva la respuesta. Si el
 * archivo no existe (dev sin Docker, prod antes del primer run), el
 * banner se renderiza en estado "unknown" sin romper la page.
 *
 * Cache: no cacheamos — el banner debe ser fresh al render del
 * dashboard (TTL 0). El file system read es barato (~1ms).
 */
export async function loadSyncHealth(): Promise<HealthResponse> {
  const { join } = await import("node:path");
  const filePath = join(process.cwd(), HEALTH_FILE_RELATIVE);
  const health = await readHealthFile(filePath);
  return deriveResponse(health);
}
