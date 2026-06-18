import { NextRequest, NextResponse } from "next/server";

import { getParcels } from "@/api/repositories";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const pageParam = parseIntParam(request.nextUrl.searchParams.get("page") ?? "1", "page", 1);
    const limitParam = parseIntParam(request.nextUrl.searchParams.get("limit") ?? "20", "limit", 1, 100);

    if (pageParam.error) {
      return NextResponse.json({ error: pageParam.error }, { status: 400 });
    }
    if (limitParam.error) {
      return NextResponse.json({ error: limitParam.error }, { status: 400 });
    }

    const result = await getParcels(pageParam.value, limitParam.value);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch parcels."
      },
      { status: 500 }
    );
  }
}
