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

const LIVE = process.env.FONIO_LIVE === "true";
const BASE = (process.env.FONIO_API_BASE_URL || "https://app.fonio.ai").replace(/\/$/, "");
const OUTBOUND_PATH = process.env.FONIO_OUTBOUND_PATH || "/api/public/v1/outbound_call";
const API_KEY = process.env.FONIO_API_KEY || "";
const FROM_NUMBER = process.env.FONIO_FROM_NUMBER || "";
const TIMEOUT_MS = 15_000;

export type TriggerOpts = {
  attemptId: string;
  slotId: string;
  patient: { name: string; phone: string };
  slot: { startsAt: Date; treatment: string };
  pAccept: number;
};

/** Normalise to E.164 (the API requires ^\+\d+$). Returns null if it can't. */
function toE164(raw: string): string | null {
  const t = (raw || "").replace(/[\s()\-.]/g, "");
  return /^\+\d{6,15}$/.test(t) ? t : null;
}

export async function triggerCall(opts: TriggerOpts): Promise<void> {
  if (LIVE) {
    await triggerLiveCall(opts);
    return; // the real outcome arrives later via /api/fonio/outcome
  }

  // ---- SIMULATION ----
  const delay = 4000 + Math.random() * 3000;
  const outcome = simulateOutcome(opts.pAccept);
  setTimeout(() => {
    // dynamic import avoids a circular import at module load
    import("./orchestrator")
      .then((m) => m.handleOutcome(opts.attemptId, outcome))
      .catch((err) => console.error("[fonio sim] outcome failed", err));
  }, delay);
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

  // context = the variables the assistant prompt / extraction can read as {{context.<key>}}.
  // attempt_id is the critical one: it round-trips so the outcome webhook can correlate the call.
  const body = {
    fromNumber: FROM_NUMBER,
    toNumber,
    context: {
      attempt_id: opts.attemptId,
      slot_id: opts.slotId,
      patient_name: opts.patient.name,
      slot_time: opts.slot.startsAt.toISOString(),
      treatment: opts.slot.treatment,
    },
  };

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
    const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
    if (!res.ok || data?.status === "error") {
      console.error(`❌ fonio API rejected — HTTP ${res.status}`, data);
      return failAttempt(opts.attemptId);
    }
    console.log(`✅ fonio API ${res.status} — ${data?.status}: ${data?.message}  → ${toNumber} is ringing\n`);
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

function simulateOutcome(pAccept: number): Outcome {
  if (pAccept >= 0.7) return "yes";
  if (pAccept >= 0.45) return "no_answer";
  return "no";
}
