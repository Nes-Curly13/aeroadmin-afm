/**
 * GET  /api/admin/products  — búsqueda/listado para el `ProductPicker`.
 * POST /api/admin/products  — crear (idempotente: si el nombre ya
 *                               existe, devuelve 200 con el row).
 *
 * Sprint S8 — feature/s8-products-catalog / Bloque E.
 * Alimenta el autocomplete del `ProductPicker` (componente que se
 * va a usar en RegisterFumigationForm).
 *
 * Auth: admin o supervisor (lectura/escritura controlada).
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { auth } from "@/lib/auth";
import {
  createDjiProduct,
  findDjiProductByName,
  searchDjiProducts
} from "@/api/repositories";
import type { ProductCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES: readonly ProductCategory[] = [
  "herbicida",
  "insecticida",
  "fertilizante",
  "fungicida",
  "bioestimulante",
  "otro"
] as const;

export async function GET(req: Request) {
  try {
    await requireRole(["admin", "supervisor"]);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "no autenticado" }, { status: 401 });
    }
    if (e.code === "FORBIDDEN") {
      return NextResponse.json({ error: "rol insuficiente" }, { status: 403 });
    }
    return NextResponse.json({ error: e.message ?? "auth error" }, { status: 500 });
  }

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") ?? "").trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10));

  try {
    const products = await searchDjiProducts(search, limit);
    return NextResponse.json({ products });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireRole(["admin", "supervisor"]);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "no autenticado" }, { status: 401 });
    }
    if (e.code === "FORBIDDEN") {
      return NextResponse.json({ error: "rol insuficiente" }, { status: 403 });
    }
    return NextResponse.json({ error: e.message ?? "auth error" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body JSON inválido" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body requerido" }, { status: 400 });
  }
  const b = body as {
    name?: unknown;
    category?: unknown;
    active_ingredient?: unknown;
    ica_registration?: unknown;
    display_color?: unknown;
    notes?: unknown;
  };

  // Validar name
  if (typeof b.name !== "string" || b.name.trim().length < 1) {
    return NextResponse.json(
      { error: "name requerido (string, min 1 char)" },
      { status: 400 }
    );
  }
  const normalizedName = b.name.trim();
  if (normalizedName.length > 200) {
    return NextResponse.json(
      { error: "name demasiado largo (max 200)" },
      { status: 400 }
    );
  }

  // Validar category (opcional, default 'otro')
  let category: ProductCategory = "otro";
  if (b.category != null) {
    if (typeof b.category !== "string" || !VALID_CATEGORIES.includes(b.category as ProductCategory)) {
      return NextResponse.json(
        {
          error: `category inválido. Valores permitidos: ${VALID_CATEGORIES.join(", ")}`
        },
        { status: 400 }
      );
    }
    category = b.category as ProductCategory;
  }

  // Validar strings opcionales (max lengths)
  function optString(v: unknown, max: number): string | null {
    if (v == null) return null;
    if (typeof v !== "string") {
      throw new Error(`${v} debe ser string o null`);
    }
    const t = v.trim();
    if (t.length > max) {
      throw new Error(`string demasiado largo (max ${max})`);
    }
    return t.length > 0 ? t : null;
  }

  let activeIngredient: string | null;
  let icaRegistration: string | null;
  let displayColor: string | null;
  let notes: string | null;
  try {
    activeIngredient = optString(b.active_ingredient, 100);
    icaRegistration = optString(b.ica_registration, 50);
    displayColor = optString(b.display_color, 7);
    notes = optString(b.notes, 500);
  } catch (e) {
    const message = e instanceof Error ? e.message : "validación falló";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // display_color es hex (#rrggbb) — validar formato
  if (displayColor != null && !/^#[0-9a-fA-F]{6}$/.test(displayColor)) {
    return NextResponse.json(
      { error: "display_color debe ser hex (#rrggbb)" },
      { status: 400 }
    );
  }

  // Quien lo crea (audit trail)
  const session = await auth().catch(() => null);
  const createdBy = session?.user?.email ?? "manual@afm.local";

  try {
    // Idempotencia: si ya existe, devolvemos 200 con el row (no 409).
    // El form llama a este endpoint sin miedo a duplicados: si el
    // operador selecciona una sugerencia o tipea + Enter, ambos paths
    // convergen en "el producto queda registrado".
    const existing = await findDjiProductByName(normalizedName);
    if (existing) {
      return NextResponse.json({ product: existing }, { status: 200 });
    }
    const created = await createDjiProduct({
      name: normalizedName,
      category,
      active_ingredient: activeIngredient,
      ica_registration: icaRegistration,
      display_color: displayColor,
      notes,
      created_by: createdBy,
    });
    return NextResponse.json({ product: created }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
