"use client";

/**
 * ImportGisWizard — wizard de import de parcelas desde archivos GIS.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2 (Import GIS).
 *
 * Flow:
 *   1. Upload (drag&drop o click) → POST /api/admin/parcels/import/preview
 *   2. Preview: tabla con nombre (editable) + geometría mini + área
 *      estimada. El operador puede editar nombres antes de confirmar.
 *   3. Click "Crear N parcelas" → POST /api/admin/parcels/import/commit
 *      → success: muestra lista de IDs creados, link a /admin/parcels
 *
 * Formatos aceptados: .kml, .zip (SHP), .gpkg
 *
 * Decisiones UX:
 *   - El drag&drop es opcional — siempre hay un input file visible
 *     (mejor accesibilidad, mobile-friendly).
 *   - El "preview" muestra el nombre DETECTADO (del GIS) — el operador
 *     lo puede editar inline. El placeholder es "Sin nombre" si el GIS
 *     no tenía nada útil.
 *   - La confirmación muestra cuántos se crearon + lista de IDs.
 */

import { useState, useRef, forwardRef } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  Save,
  TriangleAlert,
  Upload
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDec } from "@/lib/format";

interface PreviewFeature {
  index: number;
  name: string;
  properties: Record<string, unknown>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  approxAreaHa: number;
}

interface PreviewResult {
  features: PreviewFeature[];
  warnings: string[];
  format: "kml" | "shp" | "gpkg";
}

interface CommitResponse {
  created: { id: number; land_name: string }[];
}

type Phase = "idle" | "parsing" | "preview" | "committing" | "done" | "error";

const MAX_BYTES = {
  kml: 25,
  shp: 50,
  gpkg: 100
};

export function ImportGisWizard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [editedNames, setEditedNames] = useState<Record<number, string>>({});
  const [createdIds, setCreatedIds] = useState<CommitResponse["created"]>([]);

  function handleFile(file: File) {
    setError(null);
    setPreview(null);
    setEditedNames({});
    setCreatedIds([]);
    setFileName(file.name);
    setPhase("parsing");

    const ext = file.name.toLowerCase();
    if (
      !ext.endsWith(".kml") &&
      !ext.endsWith(".zip") &&
      !ext.endsWith(".gpkg")
    ) {
      setError(`Formato no soportado: ${file.name}. Aceptamos .kml, .zip, .gpkg`);
      setPhase("error");
      return;
    }

    const fmt = ext.endsWith(".kml")
      ? "kml"
      : ext.endsWith(".zip")
        ? "shp"
        : "gpkg";
    if (file.size > MAX_BYTES[fmt] * 1024 * 1024) {
      setError(`Archivo demasiado grande (max ${MAX_BYTES[fmt]} MB)`);
      setPhase("error");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    fetch("/api/admin/parcels/import/preview", {
      method: "POST",
      body: formData
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<PreviewResult>;
      })
      .then((data) => {
        setPreview(data);
        // Pre-llenar el mapa de nombres editados con el name detectado
        const seed: Record<number, string> = {};
        for (const f of data.features) seed[f.index] = f.name;
        setEditedNames(seed);
        setPhase("preview");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "error de red");
        setPhase("error");
      });
  }

  function handleCommit() {
    if (!preview) return;
    setError(null);
    setPhase("committing");

    const parcels = preview.features.map((f) => ({
      name: editedNames[f.index]?.trim() || f.name,
      geometry: f.geometry
    }));

    fetch("/api/admin/parcels/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parcels })
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<CommitResponse>;
      })
      .then((data) => {
        setCreatedIds(data.created);
        setPhase("done");
        router.refresh();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "error al crear");
        setPhase("preview"); // Volvemos a la preview para que pueda reintentar
      });
  }

  function handleReset() {
    setPhase("idle");
    setError(null);
    setPreview(null);
    setEditedNames({});
    setCreatedIds([]);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-6">
      {phase === "idle" || phase === "parsing" || phase === "error" ? (
        <UploadCard
          ref={inputRef}
          onFile={handleFile}
          isParsing={phase === "parsing"}
        />
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Error</p>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {preview ? (
        <PreviewTable
          preview={preview}
          fileName={fileName ?? ""}
          editedNames={editedNames}
          onNameChange={(idx, name) =>
            setEditedNames((prev) => ({ ...prev, [idx]: name }))
          }
        />
      ) : null}

      {phase === "preview" && preview ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {preview.features.length === 0
              ? "No hay parcelas para crear"
              : `${preview.features.length} parcela${preview.features.length === 1 ? "" : "s"} lista${preview.features.length === 1 ? "" : "s"} para crear`}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleCommit}
              disabled={preview.features.length === 0}
            >
              <Save className="size-3.5" aria-hidden />
              Crear {preview.features.length} parcela
              {preview.features.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "committing" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Creando parcelas…
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="flex flex-col gap-3 rounded-md border border-green-300 bg-green-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-green-900">
            <CheckCircle2 className="size-5" aria-hidden />
            {createdIds.length} parcela{createdIds.length === 1 ? "" : "s"} creada
            {createdIds.length === 1 ? "" : "s"} exitosamente
          </div>
          <ul className="grid grid-cols-2 gap-1 text-xs text-green-800 sm:grid-cols-4">
            {createdIds.map((c) => (
              <li key={c.id} className="font-mono">
                #{c.id} — {c.land_name}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              Importar otro archivo
            </Button>
            <Button size="sm" onClick={() => router.push("/admin/parcels")}>
              Ir al inventario
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// Subcomponente: UploadCard
// ============================================================

interface UploadCardProps {
  onFile: (f: File) => void;
  isParsing: boolean;
}

const UploadCard = forwardRef<HTMLInputElement, UploadCardProps>(function UploadCard(
  { onFile, isParsing },
  ref
) {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed border-border bg-muted/30 p-10 text-center"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
    >
      {isParsing ? (
        <>
          <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
          <p className="text-sm font-semibold">Parseando archivo…</p>
          <p className="text-xs text-muted-foreground">
            Detectando formato, extrayendo polígonos…
          </p>
        </>
      ) : (
        <>
          <FileUp className="size-10 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-semibold">Subí un archivo GIS</p>
            <p className="text-xs text-muted-foreground">
              KML · ZIP (shapefile) · GPKG — hasta 100 MB
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const r = ref as React.RefObject<HTMLInputElement>;
              r.current?.click();
            }}
          >
            <Upload className="size-3.5" aria-hidden />
            Seleccionar archivo
          </Button>
          <input
            ref={ref}
            type="file"
            accept=".kml,.zip,.gpkg"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </>
      )}
    </div>
  );
});

// ============================================================
// Subcomponente: PreviewTable
// ============================================================

function PreviewTable({
  preview,
  fileName,
  editedNames,
  onNameChange
}: {
  preview: PreviewResult;
  fileName: string;
  editedNames: Record<number, string>;
  onNameChange: (idx: number, name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Preview — {fileName}{" "}
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {preview.format}
          </span>
        </h3>
        <p className="text-xs text-muted-foreground">
          Editá los nombres si querés. Click &quot;Crear N parcelas&quot; abajo para confirmar.
        </p>
      </div>

      {preview.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {preview.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-y border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">#</th>
              <th className="px-3 py-2 text-left font-semibold">Nombre</th>
              <th className="px-3 py-2 text-left font-semibold">Tipo</th>
              <th className="px-3 py-2 text-right font-semibold">Área est.</th>
            </tr>
          </thead>
          <tbody>
            {preview.features.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  No se detectaron polígonos importables en el archivo.
                </td>
              </tr>
            ) : (
              preview.features.map((f) => (
                <tr key={f.index} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {f.index + 1}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={editedNames[f.index] ?? f.name}
                      onChange={(e) => onNameChange(f.index, e.target.value)}
                      maxLength={200}
                      className="h-7"
                      aria-label={`Nombre de la parcela #${f.index + 1}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {f.geometry.type}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                    {fmtDec(f.approxAreaHa)} ha
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
