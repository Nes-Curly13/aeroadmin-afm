"use client";

// components/parcels/download-pdf-report-button.tsx
//
// Botón "Descargar reporte PDF" en /parcels/[id]. Link directo al route
// handler `app/api/parcels/[id]/report.pdf/route.ts` que renderiza el
// PDF server-side con Playwright.
//
// Decisiones (Sprint B — F1.11):
//   - Es un `<a target="_blank" download>`, NO un botón con onClick.
//     Razones:
//       (1) El PDF lo genera el server — el cliente no tiene nada que
//           procesar. Un link es la primitiva HTML correcta para "bajar
//           un archivo del server".
//       (2) `target="_blank"` permite al operador mantener la pestaña
//           del detail page abierta mientras el PDF se abre/descarga.
//       (3) `download` fuerza al browser a descargar en vez de
//           navegar. El filename viene del `Content-Disposition` del
//           server, así que el cliente no necesita conocerlo.
//   - El ícono es un SVG inline liviano (12×12). No usamos una lib
//     de iconos para mantener el bundle chico.
//   - Mismo estilo que `ExportFumigationsCsvButton` (verde oscuro,
//     rounded-full, font-semibold) para que la fila de botones del
//     detail page sea visualmente consistente.
//
// Por qué NO un `<form method="GET">` con `target="_blank"`:
//   - El handler es GET, así que un form funcionaría — pero un `<a>`
//     es más corto, semánticamente correcto, y permite right-click
//     "Save link as" (UX estándar de download).

interface DownloadPdfReportButtonProps {
  parcelId: number;
  /** Etiqueta del botón. Default: "Descargar reporte PDF". */
  label?: string;
}

export function DownloadPdfReportButton({
  parcelId,
  label = "Descargar reporte PDF"
}: DownloadPdfReportButtonProps) {
  const href = `/api/parcels/${parcelId}/report.pdf`;
  return (
    <a
      className="inline-flex items-center gap-1.5 rounded-full bg-[#0b5f2d] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0d7438]"
      data-testid="download-pdf-report-button"
      href={href}
      rel="noopener"
      target="_blank"
    >
      <svg
        aria-hidden="true"
        fill="none"
        height="12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="12"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" x2="12" y1="15" y2="3" />
      </svg>
      {label}
    </a>
  );
}
