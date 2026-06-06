// The loop. One unified entry point (cancelSlot) for every cancellation source.
// State machine per attempt: queued -> calling -> {yes | no | no_answer | voicemail | callback}.
// yes -> book + stop; otherwise advance to the next eligible candidate. Idempotent.

import { db } from "./db";
import { rankPool, type PatientLite, type Scored } from "./scoring";
import { triggerCall } from "./fonio";

export type Outcome = "yes" | "no" | "no_answer" | "voicemail" | "callback";

export type RankedCandidate = {
  patientId: string;
  name: string;
  phone: string;
  scored: Scored;
  attempted: boolean;
  attemptStatus: string | null;
};

function toLite(p: any): PatientLite {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    consentOutbound: p.consentOutbound,
    urgency: p.urgency,
    condition: p.condition,
    assignedDoctor: p.assignedDoctor,
    timePreference: p.timePreference,
    preferredTime: p.preferredTime,
    daysOnWaitlist: p.daysOnWaitlist,
    assignedDate: p.assignedDate,
    contactAttempts: p.contactAttempts,
    lastContactResult: p.lastContactResult,
    timesSkipped: p.timesSkipped,
    procedureTimeMin: p.procedureTimeMin,
    procedureCost: p.procedureCost,
  };
}

async function log(type: string, payload: Record<string, unknown> & { slotId?: string }) {
  await db.eventLog.create({
    data: { type, slotId: payload.slotId ?? null, payload: JSON.stringify(payload) },
  });
}

export async function rankCandidates(slotId: string): Promise<RankedCandidate[]> {
  const slot = await db.slot.findUnique({ where: { id: slotId } });
  if (!slot) return [];
  const patients = await db.patient.findMany({ where: { onWaitlist: true } });
  const ranked = rankPool(
    { startsAt: slot.startsAt, durationMin: slot.durationMin, doctor: slot.practitioner ?? "" },
    patients.map(toLite),
  );
  const attempts = await db.recoveryAttempt.findMany({ where: { slotId } });
  const byPatient = new Map(attempts.map((a) => [a.patientId, a] as const));

  return ranked.map((r) => {
    const at = byPatient.get(r.patient.id);
    return {
      patientId: r.patient.id,
      name: r.patient.name,
      phone: r.patient.phone,
      scored: r.scored,
      attempted: !!at,
      attemptStatus: at?.status ?? null,
    };
  });
}

/** Unified trigger for ALL cancellation sources (patient page, reception, fonio inbound). */
export async function cancelSlot(slotId: string, source = "reception") {
  const slot = await db.slot.findUnique({ where: { id: slotId } });
  if (!slot) throw new Error("slot not found");
  if (slot.status === "filling") return slot; // idempotent

  await db.slot.update({
    where: { id: slotId },
    data: { status: "open", bookedPatientName: null, recoveredBy: null },
  });
  await log("cancellation", { slotId, source, treatment: slot.treatment, value: slot.valueEur });
  await startRecovery(slotId);
  return slot;
}

export async function startRecovery(slotId: string) {
  await db.slot.update({ where: { id: slotId }, data: { status: "filling" } });
  const ranked = await rankCandidates(slotId);
  const eligible = ranked.filter((r) => r.scored.eligible && !r.attempted);
  await log("scored", { slotId, candidates: eligible.length, top: eligible[0]?.name ?? null });
  if (!eligible.length) return escalate(slotId, "no eligible candidates");
  return callNext(slotId);
}

export async function callNext(slotId: string) {
  const slot = await db.slot.findUnique({ where: { id: slotId } });
  if (!slot) return;
  const ranked = await rankCandidates(slotId);
  const next = ranked.find((r) => r.scored.eligible && !r.attempted);
  if (!next) return escalate(slotId, "waitlist exhausted");

  const attempt = await db.recoveryAttempt.create({
    data: {
      slotId,
      patientId: next.patientId,
      status: "calling",
      score: next.scored.score,
      pAccept: next.scored.likelihood,
      evEur: Math.round(next.scored.score * (slot.valueEur || 0)),
      scoreBreakdown: JSON.stringify(next.scored.factors),
      reasonText: next.scored.reason,
      idempotencyKey: `${slotId}:${next.patientId}`,
    },
  });
  await log("call_started", { slotId, patient: next.name, attemptId: attempt.id });
  await triggerCall({
    attemptId: attempt.id,
    slotId,
    patient: { name: next.name, phone: next.phone },
    slot: { startsAt: slot.startsAt, treatment: slot.treatment },
    pAccept: next.scored.likelihood,
  });
}

export async function handleOutcome(attemptId: string, outcome: Outcome) {
  const attempt = await db.recoveryAttempt.findUnique({
    where: { id: attemptId },
    include: { patient: true, slot: true },
  });
  if (!attempt || attempt.resolvedAt) return; // idempotent

  await db.recoveryAttempt.update({
    where: { id: attemptId },
    data: { status: outcome, resolvedAt: new Date() },
  });
  await log("outcome", { slotId: attempt.slotId, patient: attempt.patient.name, outcome });

  if (outcome === "yes") {
    await db.slot.update({
      where: { id: attempt.slotId },
      data: { status: "filled", recoveredBy: attempt.patient.name },
    });
    await db.patient.update({ where: { id: attempt.patientId }, data: { onWaitlist: false } });
    await log("booked", { slotId: attempt.slotId, patient: attempt.patient.name, value: attempt.slot.valueEur });
    return;
  }

  // record a soft signal so the next ranking reflects the failed contact
  await db.patient.update({
    where: { id: attempt.patientId },
    data: { contactAttempts: { increment: 1 }, lastContactResult: outcome === "no" ? "declined" : outcome },
  });
  await callNext(attempt.slotId);
}

async function escalate(slotId: string, why: string) {
  await db.slot.update({ where: { id: slotId }, data: { status: "open" } });
  await log("escalated", { slotId, why });
}
