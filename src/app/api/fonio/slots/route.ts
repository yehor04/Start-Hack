// Inbound read endpoint for the fonio assistant (register as a Webhook / custom function tool).
//
// The assistant calls this MID-CALL to read LIVE data from our DB:
//   GET /api/fonio/slots                  -> open/filling slots the assistant can offer
//   GET /api/fonio/slots?slotId=<id>      -> + ranked, eligible waitlist candidates for that slot
//
// Secret-gated like the outcome webhook. Returns flat, speakable fields so the assistant can read
// them aloud without post-processing (ISO for logic + a human label for speech).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rankCandidates } from "@/lib/orchestrator";
import { verifyFonioRequest } from "@/lib/fonio-auth";
import { treatmentLabel, timeLabel, weekdayLabel } from "@/lib/format";

export async function GET(req: Request) {
  if (!verifyFonioRequest(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const slotId = new URL(req.url).searchParams.get("slotId");

  // Single slot + its ranked candidates (only consent-eligible ones leave the building).
  if (slotId) {
    const slot = await db.slot.findUnique({ where: { id: slotId } });
    if (!slot) {
      return NextResponse.json({ ok: false, error: "slot not found" }, { status: 404 });
    }
    const candidates = (await rankCandidates(slotId))
      .filter((c) => c.scored.eligible)
      .map((c, i) => ({
        rank: i + 1,
        name: c.name,
        likelihood: c.scored.likelihood,
        urgency: c.scored.urgency,
        reason: c.scored.reason,
        status: c.attemptStatus ?? "queued",
      }));
    return NextResponse.json({ ok: true, slot: shapeSlot(slot), candidates });
  }

  // All currently-offerable slots.
  const slots = await db.slot.findMany({
    where: { status: { in: ["open", "filling"] } },
    orderBy: { startsAt: "asc" },
  });
  return NextResponse.json({ ok: true, count: slots.length, slots: slots.map(shapeSlot) });
}

type SlotRow = {
  id: string;
  startsAt: Date;
  durationMin: number;
  treatment: string;
  practitioner: string | null;
  room: string | null;
  status: string;
  valueEur: number;
};

function shapeSlot(s: SlotRow) {
  return {
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    when: `${weekdayLabel(s.startsAt)} at ${timeLabel(s.startsAt)}`, // speakable
    durationMin: s.durationMin,
    treatment: treatmentLabel(s.treatment),
    practitioner: s.practitioner ?? null,
    room: s.room ?? null,
    status: s.status,
    valueEur: s.valueEur,
  };
}
