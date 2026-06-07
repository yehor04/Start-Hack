import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cancelSlot } from "@/lib/orchestrator";

// Patient self-service reschedule.
//   GET  /api/slots/<id>/reschedule  -> times this appointment can move to (open, future, long enough)
//   POST /api/slots/<id>/reschedule  { newSlotId }  -> move the booking + release the old slot
//
// Releasing the old slot runs the recovery loop (real outbound calls in LIVE mode) — that's the whole
// product: a freed slot is immediately offered to the waitlist. Same-origin guarded like /cancel.

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser callers send no Origin; allow for the demo
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const current = await db.slot.findUnique({ where: { id: params.id } });
  if (!current) return NextResponse.json({ ok: false, error: "slot not found" }, { status: 404 });

  // Only times that are empty AND long enough for this appointment's procedure.
  const options = await db.slot.findMany({
    where: {
      id: { not: current.id },
      status: "open",
      startsAt: { gt: new Date() },
      durationMin: { gte: current.durationMin },
    },
    orderBy: { startsAt: "asc" },
    take: 8,
  });

  return NextResponse.json({
    ok: true,
    options: options.map((s) => ({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      treatment: s.treatment,
      practitioner: s.practitioner,
      durationMin: s.durationMin,
    })),
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { newSlotId } = (await req.json().catch(() => ({}))) as { newSlotId?: string };
  if (!newSlotId) return NextResponse.json({ ok: false, error: "missing newSlotId" }, { status: 400 });

  const current = await db.slot.findUnique({ where: { id: params.id } });
  const target = await db.slot.findUnique({ where: { id: newSlotId } });
  if (!current || !target) return NextResponse.json({ ok: false, error: "slot not found" }, { status: 404 });
  if (target.status !== "open") return NextResponse.json({ ok: false, error: "time no longer available" }, { status: 409 });
  if (target.durationMin < current.durationMin)
    return NextResponse.json({ ok: false, error: "not enough time for this procedure" }, { status: 409 });

  const patientName = current.bookedPatientName;

  try {
    // 1) Book the patient into the new slot.
    await db.slot.update({
      where: { id: target.id },
      data: { status: "booked", bookedPatientName: patientName, treatment: current.treatment, recoveredBy: null },
    });
    await db.eventLog.create({
      data: {
        type: "rescheduled",
        slotId: target.id,
        payload: JSON.stringify({ patient: patientName, from: current.startsAt.toISOString(), to: target.startsAt.toISOString() }),
      },
    });
    // 2) Release the old slot → recovery loop offers it to the waitlist.
    await cancelSlot(current.id, "patient_reschedule");
  } catch (e) {
    console.error("[slots/reschedule] failed", e);
    return NextResponse.json({ ok: false, error: "reschedule failed" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, newSlotId: target.id });
}
