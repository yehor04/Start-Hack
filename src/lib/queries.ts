// Read helpers for the UI + /api/state.

import { db } from "./db";
import { rankCandidates } from "./orchestrator";

export async function getTodaySchedule() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return db.slot.findMany({
    where: { startsAt: { gte: start, lte: end } },
    orderBy: { startsAt: "asc" },
  });
}

export async function getKpis() {
  const filled = await db.slot.findMany({ where: { status: "filled", recoveredBy: { not: null } } });
  const revenue = filled.reduce((s, x) => s + (x.valueEur || 0), 0);
  const open = await db.slot.count({ where: { status: { in: ["open", "filling"] } } });
  const onCall = await db.recoveryAttempt.count({ where: { status: "calling" } });
  return { recovered: filled.length, revenue, open, onCall };
}

/** The currently-active recovery (most recent slot being filled), with ranked candidates + activity. */
export async function getActiveRecovery() {
  const lastAttempt = await db.recoveryAttempt.findFirst({
    orderBy: { createdAt: "desc" },
    include: { slot: true },
  });
  const slot =
    (lastAttempt?.slot && ["filling", "filled", "open"].includes(lastAttempt.slot.status)
      ? lastAttempt.slot
      : null) ?? (await db.slot.findFirst({ where: { status: "filling" } }));
  if (!slot) return null;

  const ranked = await rankCandidates(slot.id);
  const candidates = ranked.map((r) => ({
    name: r.name,
    score: r.scored.score,
    likelihood: r.scored.likelihood,
    urgency: r.scored.urgency,
    eligible: r.scored.eligible,
    reason: r.scored.reason,
    factors: r.scored.factors,
    status: r.attemptStatus ?? (r.scored.eligible ? "queued" : "excluded"),
  }));

  const activity = await db.eventLog.findMany({
    where: { slotId: slot.id },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return { slot, candidates, activity };
}

export async function getDemoAppointment() {
  // The patient page shows our demo cancel target: the 17:30 Root canal (Maria Schmid), as seeded.
  // Match by patient name; fall back to the LATEST booked slot (not the earliest) so the page still
  // shows a real, cancellable appointment consistent with the dashboard demo narrative.
  return (
    (await db.slot.findFirst({
      where: { status: "booked", bookedPatientName: "Maria Schmid" },
      orderBy: { startsAt: "desc" },
    })) ?? (await db.slot.findFirst({ where: { status: "booked" }, orderBy: { startsAt: "desc" } }))
  );
}
