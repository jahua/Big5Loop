import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL || "http://localhost:5678";
const N8N_TIMEOUT_MS = 20000;

export function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/chat",
    method: "POST",
    hint: "Send POST with body: { session_id, turn_index, message, context }. Activate the CareLoop workflow in N8N (http://localhost:5678) to get replies.",
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
    const res = await fetch(`${WEBHOOK_URL}/webhook/careloop-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const raw = await res.json().catch(() => ({}));
    const data = Array.isArray(raw) ? raw[0] : raw;
    if (!res.ok) {
      const message =
        res.status === 404
          ? "N8N webhook not found. Import and activate careloop-simplified.json in N8N (http://localhost:5678)."
          : data?.error || data?.message || `Upstream ${res.status}`;
      return NextResponse.json({ error: message }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message =
      e instanceof Error && e.name === "AbortError"
        ? "Request to N8N timed out. Check that N8N is running and the workflow is active."
        : e instanceof Error
          ? e.message
          : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
