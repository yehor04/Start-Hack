// Patient-benefit scoring — transparent, explainable, degrades gracefully on missing fields.
// priority = urgency × likelihoodToAttend × fit. Consent is a hard eligibility gate.
// Revenue is NEVER part of the score (it's only a displayed KPI).

type Json = string | null;
const arr = (j: Json): string[] => {
  try {
    return j ? (JSON.parse(j) as string[]) : [];
  } catch {
    return [];
  }
};
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function windowOf(d: Date): "morning" | "afternoon" | "evening" {
  const h = new Date(d).getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

export type Factor = { label: string; value: number; positive: boolean; detail: string };

export type Scored = {
  eligible: boolean;
  score: number; // 0..1 (0 when ineligible)
  urgency: number;
  likelihood: number;
  fit: number;
  factors: Factor[];
  reason: string;
};

export type ScoreInput = {
  slotStartsAt: Date;
  slotTreatment: string;
  patient: {
    consentOutbound: boolean;
    preferredTimes: Json;
    preferredDays: Json;
    lastContactedAt: Date | null;
    noShowCount: number;
    acceptRate: number | null;
  };
  entry: {
    treatment: string;
    urgency: number | null;
    addedAt: Date;
    fairnessLastOfferedAt: Date | null;
  };
  now?: Date;
};

export function scoreCandidate(input: ScoreInput): Scored {
  const now = input.now ?? new Date();
  const p = input.patient;
  const e = input.entry;
  const factors: Factor[] = [];

  // ---- eligibility gates ----
  if (!p.consentOutbound) return zero("No outbound consent (GDPR) — excluded.");
  if (e.treatment !== input.slotTreatment)
    return zero("Waiting for a different treatment — not this slot.");

  // ---- urgency (0..1) ----
  let urgency = e.urgency != null ? e.urgency / 5 : 0.6; // null -> neutral
  const waitDays = (now.getTime() - new Date(e.addedAt).getTime()) / 86_400_000;
  const waitBonus = clamp(waitDays / 30, 0, 0.2); // up to +0.2 for long waits
  urgency = clamp(urgency + waitBonus);
  factors.push({
    label: "Urgency",
    value: urgency,
    positive: urgency >= 0.6,
    detail: e.urgency != null ? `priority ${e.urgency}/5` : "no urgency set",
  });

  // ---- likelihood to attend (0..1) ----
  const base = p.acceptRate ?? 0.5;
  let like = base;
  const win = windowOf(input.slotStartsAt);
  const wd = WD[new Date(input.slotStartsAt).getDay()];
  const times = arr(p.preferredTimes);
  const days = arr(p.preferredDays);
  let timeMatch = false,
    timeMismatch = false;
  if (times.length) {
    if (times.includes(win)) {
      like += 0.15;
      timeMatch = true;
    } else {
      like -= 0.18;
      timeMismatch = true;
    }
  }
  if (days.length && days.includes(wd)) like += 0.08;
  const recentlyContacted =
    !!p.lastContactedAt &&
    now.getTime() - new Date(p.lastContactedAt).getTime() < 48 * 3600_000;
  if (recentlyContacted) like -= 0.25;
  if (p.noShowCount) like -= Math.min(0.24, p.noShowCount * 0.08);
  like = clamp(like, 0.05, 0.98);
  factors.push({
    label: "Likely to say yes",
    value: like,
    positive: like >= 0.6,
    detail:
      `${Math.round(like * 100)}% (base ${Math.round(base * 100)}%` +
      `${timeMatch ? `, ${win} match` : ""}${timeMismatch ? `, prefers ${times.join("/")}` : ""}` +
      `${recentlyContacted ? ", contacted recently" : ""}${p.noShowCount ? `, ${p.noShowCount} no-shows` : ""})`,
  });

  // ---- fit (0..1): treatment matched (=1) minus fairness penalty ----
  let fit = 1;
  const recentlyOffered =
    !!e.fairnessLastOfferedAt &&
    now.getTime() - new Date(e.fairnessLastOfferedAt).getTime() < 7 * 24 * 3600_000;
  if (recentlyOffered) {
    fit -= 0.25;
    factors.push({ label: "Fairness", value: 0.75, positive: false, detail: "offered a slot recently" });
  }
  fit = clamp(fit, 0.3, 1);

  const score = clamp(urgency * like * fit);
  const reason = buildReason({ urgency, like, timeMatch, timeMismatch, times, win, recentlyContacted, noShow: p.noShowCount });

  return { eligible: true, score, urgency, likelihood: like, fit, factors, reason };

  function zero(why: string): Scored {
    return { eligible: false, score: 0, urgency: 0, likelihood: 0, fit: 0, factors: [], reason: why };
  }
}

function buildReason(o: {
  urgency: number;
  like: number;
  timeMatch: boolean;
  timeMismatch: boolean;
  times: string[];
  win: string;
  recentlyContacted: boolean;
  noShow: number;
}): string {
  const pos: string[] = [];
  const neg: string[] = [];
  if (o.urgency >= 0.7) pos.push("high urgency");
  else if (o.urgency < 0.45) neg.push("lower urgency");
  if (o.timeMatch) pos.push(`prefers ${o.win}s (fits the slot)`);
  if (o.timeMismatch) neg.push(`prefers ${o.times.join("/")}, slot is ${o.win}`);
  if (o.like >= 0.75) pos.push("very likely to accept");
  if (o.recentlyContacted) neg.push("contacted recently");
  if (o.noShow) neg.push(`${o.noShow} past no-show${o.noShow > 1 ? "s" : ""}`);
  let s = "";
  if (pos.length) s += "Strong: " + pos.join(", ") + ".";
  if (neg.length) s += (s ? " " : "") + "Caveats: " + neg.join(", ") + ".";
  return s || "Eligible candidate.";
}
