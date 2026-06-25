import { NextRequest, NextResponse } from "next/server";

import { getAlerts } from "@/api/repositories";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const alerts = await getAlerts();
    return NextResponse.json({ data: alerts });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch alerts."
      },
      { status: 500 }
    );
  }
}
