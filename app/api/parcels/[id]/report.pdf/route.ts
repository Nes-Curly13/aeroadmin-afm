// app/api/parcels/[id]/report.pdf/route.ts
//
// GET /api/parcels/[id]/report.pdf
//
// Sprint B — F1.11: reporte PDF server-side de UNA parcela.
// Renderiza HTML via React template puro (sin CSR) y lo convierte a PDF
// con Playwright (chromium headless). Se descarga como attachment.
//
// Status codes:
//   - 200: PDF binary (`Content-Type: application/pdf`).
//   - 400: parcelId no es entero positivo.
//   - 401: sin sesión (`requireAuth`).
//   - 404: la parcela no existe o está soft-deleted.
//   - 500: BD falla o Playwright truena.
//
// Cache: `unstable_cache` con tag `parcelReport` + TTL 60s. Se invalida
// en `invalidateAfterFumigationMutation()` y
// `invalidateAfterParcelMutation()` (ambos llaman al helper
// correspondiente en `lib/cache.ts`).
//
// Auth: `requireAuth()` (admin y supervisor pueden descargar el reporte
// de cualquier parcela — el scope de "operación" ya quedó validado por
// el login).
//
// Por qué `.pdf` en la URL y no `/api/parcels/[id]/report?format=pdf`:
//   - Es la convención estándar de APIs que sirven archivos (mismo
//     patrón que `/api/v1/users/123/avatar.jpg` en REST).
//   - El navegador trata la URL con extensión como download attachment
//     con el filename sugerido, sin necesidad de Content-Disposition
//     extra.
//   - Si en el futuro se quiere HTML + PDF del mismo recurso
//     (`/report.html`, `/report.pdf`), la URL es trivial de extender.

import { NextRequest, NextResponse } from "next/server";

import {
  fetchParcelReportData,
  getParcelReportData
} from "@/lib/reports/fetch-parcel-report-data";
import { buildParcelReportHtml } from "@/lib/reports/parcel-pdf-template";
import { renderHtmlToPdf } from "@/lib/reports/render-pdf";
import { parseIntParam } from "@/lib/request";
import { requireAuth } from "@/lib/auth";

/** Forzamos runtime Node — Playwright NO corre en Edge. */
export const runtime = "nodejs";
/** No cacheamos la respuesta HTTP entera — el cache está en
 *  `getParcelReportData()` (que envuelve `fetchParcelReportData` con
 *  `unstable_cache`). `force-dynamic` es la combinación correcta con
 *  `runtime = "nodejs"`. */
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ---- Auth ----
    // requireAuth() lanza error tipado con status=401 si no hay sesión.
    try {
      await requireAuth();
    } catch (authErr) {
      const status =
        (authErr as { status?: number }).status === 401 ? 401 : 500;
      return NextResponse.json(
        { error: (authErr as Error).message || "UNAUTHENTICATED" },
        { status }
      );
    }

    // ---- Validate parcelId ----
    const { id: rawId } = await params;
    const idParsed = parseIntParam(rawId, "id", 1);
    if ("error" in idParsed) {
      return NextResponse.json({ error: idParsed.error }, { status: 400 });
    }
    const parcelId = idParsed.value;

    // ---- Fetch data (cacheado por parcelId, tag parcelReport) ----
    // `getParcelReportData` envuelve `fetchParcelReportData` con
    // `unstable_cache`. Los tests mockean `fetchParcelReportData`
    // directamente (saltando el cache) para no depender del runtime
    // de Next.
    const data = await getParcelReportData(parcelId);
    if (!data) {
      return NextResponse.json(
        { error: "Parcel not found." },
        { status: 404 }
      );
    }

    // ---- Build HTML + render PDF ----
    const html = buildParcelReportHtml(data);
    const pdf = await renderHtmlToPdf(html);

    // Filename: `reporte_<slug>_<YYYY-MM-DD>.pdf`. Bogota local.
    const dateLabel = data.generatedAt.slice(0, 10); // YYYY-MM-DD prefijo
    const slug = (data.parcel.land_name ?? data.parcel.external_id ?? `parcela-${parcelId}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60);
    const filename = `reporte_${slug}_${dateLabel}.pdf`;

    // Devolvemos el PDF como `application/pdf` con Content-Disposition
    // `inline` + `filename` para que el browser lo previsualice O lo
    // descargue, según el comportamiento del usuario.
    // NextResponse acepta `BodyInit` (no `Buffer` directamente en
    // algunas versiones de tipos); pasamos el Uint8Array subyacente.
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `inline; filename="${filename}"`,
        // Sugerencia al browser: NO cachear el PDF en su cache de
        // disco. La cache vive server-side en `unstable_cache` y se
        // invalida por tag. Esto evita que el usuario vea un PDF viejo
        // después de que se actualizó la data.
        "Cache-Control": "private, max-age=0, no-cache, no-store, must-revalidate"
      }
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to render PDF report.";
    // Loggear al stderr para que Vercel / dev server lo capture.
    console.error("[parcel-report.pdf] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Re-export para tests que quieran invalidar el cache explícitamente.
export { invalidateParcelReportCache } from "@/lib/reports/fetch-parcel-report-data";
// Re-export de `fetchParcelReportData` para que el test que mockea
// la función subyacente (en vez de `getParcelReportData`) tenga
// acceso al símbolo mockeable.
export { fetchParcelReportData };
