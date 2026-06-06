import { NextResponse } from "next/server";
import { cancelSlot } from "@/lib/orchestrator";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await cancelSlot(params.id, "reception");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
  }
}
