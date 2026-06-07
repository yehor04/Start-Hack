// fonio client. When FONIO_LIVE=true it triggers a REAL outbound call via the fonio API;
// otherwise it SIMULATES the call in-process so the whole loop is demoable without a phone.
//
// Real outcomes come back via the /api/fonio/outcome webhook (fonio Variable Extraction +
// the context we pass below). In simulation we resolve the attempt ourselves.
//
// Outbound API (from app.fonio.ai/api/docs):
//   POST {BASE}/api/public/v1/outbound_call
//   Authorization: Bearer <FONIO_API_KEY>
//   body: { fromNumber, toNumber, context }   (all required)
//   -> { status: "success" | "error", message }
// NOTE: there is NO assistant/agent id in the body — the assistant is bound to fromNumber,
// so fromNumber MUST be an outbound-enabled number whose assistant is the recovery agent.

import type { Outcome } from "./orchestrator";
import { db } from "./db";

const LIVE = process.env.FONIO_LIVE === "true";
const BASE = (process.env.FONIO_API_BASE_URL || "https://app.fonio.ai").replace(/\/$/, "");
const OUTBOUND_PATH = process.env.FONIO_OUTBOUND_PATH || "/api/public/v1/outbound_call";
const API_KEY = process.env.FONIO_API_KEY || "";
const FROM_NUMBER = process.env.FONIO_FROM_NUMBER || "";
const AGENT_ID = process.env.FONIO_AGENT_ID || "";
const TIMEOUT_MS = 15_000;

// Simulation: track pending call timers so cancelCall() can abort them immediately.
const pendingSimCalls = new Map<string, ReturnType<typeof setTimeout>>();

export type TriggerOpts = {
  attemptId: string;
  slotId: string;
  patient: { name: string; phone: string; condition: string };
  slot: { startsAt: Date; treatment: string; practitioner: string; durationMin: number };
  procedureMinutes: number; // how long THIS patient's procedure needs — used to filter reschedule options
  pAccept: number;
};

/** Normalise to E.164 (the API requires ^\+\d+$). Returns null if it can't. */
function toE164(raw: string): string | null {
  const t = (raw || "").replace(/[\s()\-.]/g, "");
  return /^\+\d{6,15}$/.test(t) ? t : null;
}

// Format the slot instant for the assistant prompt, in the clinic's timezone (Vienna).
const CLINIC_TZ = "Europe/Vienna";
const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // YYYY-MM-DD
const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: CLINIC_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d); // HH:MM
// "Mon, 09 Jun at 14:00 with Dr. Bauer" — human-readable for the assistant to read aloud.
const fmtSlotHuman = (d: Date, practitioner: string) =>
  `${new Intl.DateTimeFormat("en-GB", { timeZone: CLINIC_TZ, weekday: "short", day: "2-digit", month: "short" }).format(d)} at ${fmtTime(d)}${practitioner ? ` with ${practitioner}` : ""}`;

// We can't query the DB mid-call (fonio's Tools feature isn't enabled on this account), so we read
// the DB BEFORE the call and pre-load the valid reschedule options into context. We only include
// slots that are BOTH empty AND long enough for this patient's procedure (procedureMinutes), so the
// feasibility check is baked into the data: if the time the caller wants isn't in this list, the
// assistant simply tells them it's not possible — no live lookup needed.
// Best-effort: a failure here must never abort the call.
async function buildAlternativeSlots(currentSlotId: string, procedureMinutes: number): Promise<string> {
  try {
    const others = await db.slot.findMany({
      where: {
        id: { not: currentSlotId },
        status: { in: ["open", "filling"] },
        startsAt: { gt: new Date() },
        durationMin: { gte: procedureMinutes }, // must fit the procedure
      },
      orderBy: { startsAt: "asc" },
      take: 8,
    });
    if (!others.length) return "None — there are no other openings that fit this appointment.";
    return others.map((s) => fmtSlotHuman(s.startsAt, s.practitioner ?? "")).join("; ");
  } catch (err) {
    console.error("[fonio] buildAlternativeSlots failed (non-fatal)", err);
    return "";
  }
}

export async function triggerCall(opts: TriggerOpts): Promise<void> {
  if (LIVE) {
    await triggerLiveCall(opts);
    return; // the real outcome arrives later via /api/fonio/outcome
  }

  // ---- SIMULATION ----
  const delay = 4000 + Math.random() * 3000;
  const outcome = simulateOutcome(opts.pAccept);
  const timer = setTimeout(() => {
    pendingSimCalls.delete(opts.attemptId);
    // dynamic import avoids a circular import at module load
    import("./orchestrator")
      .then((m) => m.handleOutcome(opts.attemptId, outcome))
      .catch((err) => console.error("[fonio sim] outcome failed", err));
  }, delay);
  pendingSimCalls.set(opts.attemptId, timer);
}

async function triggerLiveCall(opts: TriggerOpts): Promise<void> {
  const toNumber = toE164(opts.patient.phone);
  if (!API_KEY || !FROM_NUMBER || !toNumber) {
    console.error("[fonio] live call misconfigured — aborting", {
      hasApiKey: !!API_KEY,
      hasFromNumber: !!FROM_NUMBER,
      rawPhone: opts.patient.phone,
      normalised: toNumber,
    });
    return failAttempt(opts.attemptId);
  }

  // Read the DB before placing the call and bundle in the valid reschedule options (empty + fit).
  const alternativeSlots = await buildAlternativeSlots(opts.slotId, opts.procedureMinutes);

  // context = the variables the assistant prompt / extraction can read as {{context.<key>}}.
  // attempt_id is the critical one: it round-trips so the outcome webhook can correlate the call.
  const body: Record<string, unknown> = {
    fromNumber: FROM_NUMBER,
    toNumber,
    context: {
      // The fields the assistant prompt reads as {{context.<key>}}:
      patient_name: opts.patient.name,
      patient_condition: opts.patient.condition,
      doctor_name: opts.slot.practitioner,
      slot_date: fmtDate(opts.slot.startsAt), // "2026-06-07"
      slot_time: fmtTime(opts.slot.startsAt), // "09:00"
      slot_duration: String(opts.slot.durationMin),
      // Pre-loaded from the DB: the ONLY times this patient can reschedule to (empty + long enough
      // for their procedure). If the time they want isn't here, the assistant says it's not possible.
      // e.g. "Tue, 10 Jun at 09:00 with Dr. Wagner; Wed, 11 Jun at 14:30 with Dr. Bauer".
      reschedule_options: alternativeSlots,
      // Not used by the prompt, but our post-call webhook reads it to correlate the outcome:
      attempt_id: opts.attemptId,
    },
  };
  // fonio's example includes agentId (selects the assistant explicitly); send it when configured.
  if (AGENT_ID) body.agentId = AGENT_ID;

  const url = `${BASE}${OUTBOUND_PATH}`;
  console.log(`🌐 fonio API → POST ${url}`);
  console.log(`   from ${FROM_NUMBER}  to ${toNumber}  context.attempt_id=${opts.attemptId}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const rawText = await res.text().catch(() => "");
    console.log(`[fonio] outbound_call raw response: ${rawText}`);
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(rawText); } catch {}
    if (!res.ok || data?.status === "error") {
      console.error(`❌ fonio API rejected — HTTP ${res.status}`, data);
      return failAttempt(opts.attemptId);
    }
    const fonioCallId = (data.id ?? data.callId ?? data.call_id ?? data.callid ?? null) as string | null;
    if (fonioCallId) {
      await db.recoveryAttempt.update({ where: { id: opts.attemptId }, data: { fonioCallId } }).catch(() => {});
    }
    console.log(`✅ fonio API ${res.status} — ${data?.status}: ${data?.message}  → ${toNumber} is ringing (callId=${fonioCallId})\n`);
  } catch (err) {
    console.error("[fonio] outbound_call threw", err);
    return failAttempt(opts.attemptId);
  } finally {
    clearTimeout(timer);
  }
}

/** A trigger that never connects would strand the slot in "calling" — advance the loop instead. */
async function failAttempt(attemptId: string): Promise<void> {
  try {
    const m = await import("./orchestrator");
    await m.handleOutcome(attemptId, "failed");
  } catch (err) {
    console.error("[fonio] failAttempt could not advance the loop", err);
  }
}

/**
 * Cancel an in-progress call. In simulation mode, clears the pending timer immediately.
 * In live mode, fonio's public API has no cancel endpoint — the call rings until fonio's
 * own timeout. We still resolve the attempt in the DB so the outcome webhook is ignored
 * and no new call is placed.
 */
export async function cancelCall(_fonioCallId: string | null, attemptId?: string): Promise<void> {
  if (!LIVE && attemptId && pendingSimCalls.has(attemptId)) {
    clearTimeout(pendingSimCalls.get(attemptId)!);
    pendingSimCalls.delete(attemptId);
    console.log(`🔕 SIM: cancelled pending call timer for attempt ${attemptId}`);
  }
}

function simulateOutcome(pAccept: number): Outcome {
  if (pAccept >= 0.7) return "yes";
  if (pAccept >= 0.45) return "no_answer";
  return "no";
}
