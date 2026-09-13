/**
 * lib/env.ts — Validación de variables de entorno.
 *
 * Auditoría 2026-09-10 (#43): la app no validaba `process.env` y el
 * `.env.example` había derivado del set real. Este módulo centraliza qué
 * variables son críticas (faltan → la app no arranca bien) y cuáles son
 * recomendadas (faltan → feature degradada), y expone un reporter para
 * el arranque del server.
 *
 * `validateEnv` es puro (recibe el env por param) para poder testearlo
 * sin tocar `process.env`.
 *
 * Lo llama `instrumentation.ts` en el `register()` (runtime Node).
 */

export type EnvSeverity = "error" | "warn";

export interface EnvIssue {
  name: string;
  severity: EnvSeverity;
  message: string;
}

/**
 * Críticas: sin ellas la app no opera (BD o sesiones rotas). NextAuth v5
 * acepta `AUTH_SECRET` o su alias `NEXTAUTH_SECRET`.
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): EnvIssue[] {
  const issues: EnvIssue[] = [];

  if (!env.DATABASE_URL && !env.DATABASE_URL_DIRECT) {
    issues.push({
      name: "DATABASE_URL",
      severity: "error",
      message: "falta DATABASE_URL o DATABASE_URL_DIRECT (la app no puede leer la BD)"
    });
  }

  if (!env.AUTH_SECRET && !env.NEXTAUTH_SECRET) {
    issues.push({
      name: "AUTH_SECRET",
      severity: "error",
      message: "falta AUTH_SECRET (generá con `openssl rand -base64 32`)"
    });
  }

  // Recomendadas: features que degradan de forma segura si faltan.
  const recommended: Array<{ name: string; message: string }> = [
    { name: "AUTH_URL", message: "sin AUTH_URL NextAuth intenta inferirla (en Vercel usa VERCEL_URL)" },
    { name: "HEALTH_TOKEN", message: "el watchdog del pipeline DJI no podrá autenticarse sin sesión" },
    { name: "BACKFILL_TOKEN", message: "el refresh de fumigaciones por cron no podrá autenticarse" },
    { name: "INTERNAL_MAP_TOKEN", message: "el endpoint interno de mapas para PDF queda sin gate" },
    { name: "NEXT_PUBLIC_MAPTILER_KEY", message: "el geovisor cae a EOX Sentinel-2 (basemap de menor resolución)" }
  ];
  for (const { name, message } of recommended) {
    if (!env[name]) {
      issues.push({ name, severity: "warn", message });
    }
  }

  return issues;
}

/**
 * Loguea el resultado de `validateEnv`. Los `error` se reportan en
 * cualquier entorno; los `warn` solo en producción (para no ensuciar la
 * consola de dev). Devuelve los issues para callers que quieran actuar.
 */
export function reportEnv(env: NodeJS.ProcessEnv = process.env): EnvIssue[] {
  const issues = validateEnv(env);
  const isProd = env.NODE_ENV === "production";
  for (const issue of issues) {
    if (issue.severity === "warn" && !isProd) continue;
    const line = `[env] ${issue.severity.toUpperCase()}: ${issue.name} — ${issue.message}`;
    if (issue.severity === "error") console.error(line);
    else console.warn(line);
  }
  return issues;
}
