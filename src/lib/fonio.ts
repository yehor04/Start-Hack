// fonio client. When FONIO_LIVE=true it triggers a real outbound call; otherwise it
// SIMULATES the call in-process so the whole loop is demoable without a phone.
//
// Real outcomes come back via the /api/fonio/outcome webhook (fonio Variable Extraction:
// accepted / callback_requested / ...). In simulation we resolve the attempt ourselves.

import type { Outcome } from "./orchestrator";

const LIVE = process.env.FONIO_LIVE === "true";

export type TriggerOpts = {
  attemptId: string;
  slotId: string;
  patient: { name: string; phone: string };
  slot: { startsAt: Date; treatment: string };
  pAccept: number;
};

export async function triggerCall(opts: TriggerOpts): Promise<void> {
  if (LIVE) {
    // TODO: real fonio outbound trigger once we have the endpoint + auth.
    // Pass attempt_id as a call variable so the webhook can correlate the outcome.
    //
    // await fetch(`${process.env.FONIO_API_BASE_URL}/<OUTBOUND_ENDPOINT>`, {
    //   method: "POST",
    //   headers: {
    //     Authorization: `Bearer ${process.env.FONIO_API_KEY}`,
    //     "Content-Type": "application/json",
    //   },
    //   body: JSON.stringify({
    //     assistant_id: process.env.FONIO_ASSISTANT_ID,
    //     phone: opts.patient.phone,
    //     variables: {
    //       attempt_id: opts.attemptId,
    //       name: opts.patient.name,
    //       slot_time: opts.slot.startsAt.toISOString(),
    //       treatment: opts.slot.treatment,
    //     },
    //   }),
    // });
    return; // outcome will arrive via /api/fonio/outcome
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

function simulateOutcome(pAccept: number): Outcome {
  if (pAccept >= 0.7) return "yes";
  if (pAccept >= 0.45) return "no_answer";
  return "no";
}
