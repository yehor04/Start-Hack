import { NextResponse } from "next/server";
import { stopRecovery } from "@/lib/orchestrator";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await stopRecovery(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[slots/stop-recovery] failed", e);
    return NextResponse.json({ ok: false, error: "stop failed" }, { status: 400 });
  }
}
