import { NextResponse } from "next/server";
import { cancelSlot } from "@/lib/orchestrator";

// Same-origin guard: cancelling triggers the recovery loop (real outbound calls in LIVE mode), so
// reject cross-site / off-origin POSTs. This is CSRF-grade protection for the unauthenticated demo
// UI — NOT a substitute for real auth. Add a session/login before exposing this in production.
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser callers (curl/tests) send no Origin; allow for the demo
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  try {
    await cancelSlot(params.id, "reception");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[slots/cancel] failed", e);
    return NextResponse.json({ ok: false, error: "cancel failed" }, { status: 400 });
  }
}
