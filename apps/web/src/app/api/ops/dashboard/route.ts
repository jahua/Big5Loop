import { NextResponse } from "next/server";
import { buildOpsDashboardData } from "@/lib/ops-dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await buildOpsDashboardData();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build operations dashboard.";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
