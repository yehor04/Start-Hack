// Patient-benefit ranker — ported from Olha's ranker.py into the live app.
// Hard filters + pool-normalised weighted soft score. Transparent + explainable.
// IMPORTANT: procedure_cost is NOT part of the score (revenue is a KPI, not an objective).

export type PatientLite = {
  id: string;
  name: string;
  phone: string;
  consentOutbound: boolean;
  urgency: string; // urgent | moderate | routine
  condition: string;
  assignedDoctor: string;
  timePreference: string; // morning | afternoon | flexible
  preferredTime: string; // "HH:MM"
  daysOnWaitlist: number;
  assignedDate: Date;
  contactAttempts: number;
  lastContactResult: string; // none | voicemail | no_answer | declined
  timesSkipped: number;
  procedureTimeMin: number;
  procedureCost: number;
};

export type SlotLite = { startsAt: Date; durationMin: number; doctor: string };

export type Factor = { label: string; value: number; positive: boolean; detail: string };
export type Scored = {
  eligible: boolean;
  score: number; // 0..1
  urgency: number; // 0..1 (display)
  likelihood: number; // 0..1 (display: "likely to take it")
  factors: Factor[];
  reason: string;
};
export type Ranked = { patient: PatientLite; scored: Scored };

// Tunable weights (cost intentionally excluded from the score).
const WEIGHTS = { urgency: 0.35, timeMatch: 0.2, days: 0.2, attempts: 0.1, result: 0.1, skipped: 0.05 };
const URGENCY: Record<string, number> = { urgent: 1, moderate: 0.5, routine: 0 };
// Reachability penalty by last contact result. "confirmed"/"maybe" are not penalised.
const RESULT_PENALTY: Record<string, number> = {
  none: 0,
  confirmed: 0,
  maybe: 0,
  voicemail: 0.2,
  no_answer: 0.5,
  declined: 1,
};

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const halfDay = (t: Date) => (new Date(t).getHours() < 13 ? "morning" : "afternoon");
const minutes = (d: Date) => new Date(d).getHours() * 60 + new Date(d).getMinutes();
const parseHHMM = (s: string) => {
  const [h, m] = (s || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

function timeMatch(pref: string, preferred: string, slot: Date): number {
  const sh = halfDay(slot);
  if (pref !== "flexible" && pref !== sh) return 0; // wrong half-day
  if (pref === "flexible") return 1;
  const diff = Math.abs(parseHHMM(preferred) - minutes(slot));
  return Math.max(0, 1 - diff / 180); // within 3h of their preferred time
}

function normalize(v: number, pool: number[], penalty = false): number {
  const lo = Math.min(...pool);
  const hi = Math.max(...pool);
  if (lo === hi) return penalty ? 0 : 0.5;
  return (v - lo) / (hi - lo);
}

export function hardFilterReason(p: PatientLite, slot: SlotLite): string | null {
  if (!p.consentOutbound) return "No outbound consent (GDPR) — excluded.";
  if (new Date(p.assignedDate) > new Date(slot.startsAt)) return "Joined the waitlist after this slot's date.";
  if (p.procedureTimeMin > slot.durationMin)
    return `Procedure needs ${p.procedureTimeMin} min > ${slot.durationMin} min slot.`;
  if (slot.doctor && p.assignedDoctor !== slot.doctor)
    return `Assigned to ${p.assignedDoctor}, not ${slot.doctor}.`;
  return null;
}

/** Hard-filter then pool-normalised soft scoring. Eligible (ranked) first, then ineligible. */
export function rankPool(slot: SlotLite, patients: PatientLite[]): Ranked[] {
  const eligible: PatientLite[] = [];
  const rejected: { p: PatientLite; why: string }[] = [];
  for (const p of patients) {
    const why = hardFilterReason(p, slot);
    if (why) rejected.push({ p, why });
    else eligible.push(p);
  }

  const out: Ranked[] = [];
  if (eligible.length) {
    const daysPool = eligible.map((p) => p.daysOnWaitlist);
    const attemptsPool = eligible.map((p) => p.contactAttempts);
    const skippedPool = eligible.map((p) => p.timesSkipped);

    for (const p of eligible) {
      const u = URGENCY[p.urgency] ?? 0;
      const tm = timeMatch(p.timePreference, p.preferredTime, slot.startsAt);
      const dN = normalize(p.daysOnWaitlist, daysPool);
      const aP = normalize(p.contactAttempts, attemptsPool, true);
      const rP = RESULT_PENALTY[p.lastContactResult] ?? 0.2;
      const sP = normalize(p.timesSkipped, skippedPool, true);

      const score = clamp(
        WEIGHTS.urgency * u +
          WEIGHTS.timeMatch * tm +
          WEIGHTS.days * dN -
          WEIGHTS.attempts * aP -
          WEIGHTS.result * rP -
          WEIGHTS.skipped * sP,
      );
      const likelihood = clamp(0.35 + 0.45 * tm + 0.2 * (1 - rP) - 0.15 * aP);

      const factors: Factor[] = [
        { label: "Urgency", value: u, positive: u >= 0.5, detail: p.urgency },
        {
          label: "Time match",
          value: tm,
          positive: tm >= 0.5,
          detail: tm === 0 ? `prefers ${p.timePreference}` : p.timePreference === "flexible" ? "flexible" : `near ${p.preferredTime}`,
        },
        { label: "Waiting", value: dN, positive: dN >= 0.5, detail: `${p.daysOnWaitlist} days` },
        {
          label: "Reachability",
          value: 1 - rP,
          positive: rP < 0.3,
          detail: p.lastContactResult === "none" ? "no prior attempts" : `last: ${p.lastContactResult}`,
        },
      ];
      if (p.timesSkipped) factors.push({ label: "Fairness", value: 1 - sP, positive: false, detail: `skipped ${p.timesSkipped}×` });

      out.push({
        patient: p,
        scored: { eligible: true, score, urgency: u, likelihood, factors, reason: buildReason(p, tm, rP) },
      });
    }
    out.sort((a, b) => b.scored.score - a.scored.score);
  }

  for (const r of rejected) {
    out.push({
      patient: r.p,
      scored: { eligible: false, score: 0, urgency: 0, likelihood: 0, factors: [], reason: r.why },
    });
  }
  return out;
}

function buildReason(p: PatientLite, tm: number, rP: number): string {
  const pos: string[] = [];
  const neg: string[] = [];
  if (p.urgency === "urgent") pos.push("urgent need");
  else if (p.urgency === "routine") neg.push("routine, can wait");
  if (tm >= 0.8) pos.push("time fits their preference");
  else if (tm === 0) neg.push(`prefers ${p.timePreference}s`);
  if (p.daysOnWaitlist >= 14) pos.push(`waited ${p.daysOnWaitlist} days`);
  if (rP >= 0.5) neg.push(`hard to reach (${p.lastContactResult})`);
  if (p.timesSkipped) neg.push(`skipped ${p.timesSkipped}×`);
  let s = "";
  if (pos.length) s += "Strong: " + pos.join(", ") + ".";
  if (neg.length) s += (s ? " " : "") + "Caveats: " + neg.join(", ") + ".";
  return s || `${p.condition}.`;
}
