"""
Waitlist ranker for dental clinic slot recovery.

Usage:
    python ranker.py                   # demo with built-in sample slot
    python ranker.py --doctor "Dr. Stefan Bauer" --duration 90 --time morning
"""

import json
import argparse
from datetime import date

# ── Tune these freely ──────────────────────────────────────────────────────────
WEIGHTS = {
    "urgency":          0.35,
    "time_match":       0.20,
    "days_on_waitlist": 0.20,
    "contact_attempts": 0.10,  # penalty — subtracted
    "contact_result":   0.10,  # penalty — subtracted
    "times_skipped":    0.05,  # penalty — subtracted
    "procedure_cost":   0.05,  # small positive
}

URGENCY_SCORE = {
    "urgent":   1.0,
    "moderate": 0.5,
    "routine":  0.0,
}

CONTACT_RESULT_PENALTY = {
    "none":      0.0,
    "voicemail": 0.2,
    "no_answer": 0.5,
    "declined":  1.0,
}
# ───────────────────────────────────────────────────────────────────────────────


def hard_filter(patients: list, slot: dict) -> tuple:
    """Remove patients who physically cannot fill this slot."""
    eligible, rejected = [], []

    slot_date = date.fromisoformat(slot["date"])

    for p in patients:
        assigned = date.fromisoformat(p["assigned_date"])
        if assigned >= slot_date:
            rejected.append({
                **p,
                "filter_reason": (
                    f"joined waitlist after slot date "
                    f"({p['assigned_date']} >= {slot['date']})"
                ),
            })
        elif p["procedure_time_min"] > slot["duration_min"]:
            rejected.append({
                **p,
                "filter_reason": (
                    f"procedure too long "
                    f"({p['procedure_time_min']} min > {slot['duration_min']} min)"
                ),
            })
        elif p["assigned_doctor"] != slot["doctor"]:
            rejected.append({
                **p,
                "filter_reason": f"wrong doctor ({p['assigned_doctor']})",
            })
        else:
            eligible.append(p)

    return eligible, rejected


def _time_match(patient_pref: str, slot_time: str) -> float:
    if patient_pref == "flexible":
        return 0.7
    return 1.0 if patient_pref == slot_time else 0.0


def _normalize(value: float, pool: list) -> float:
    lo, hi = min(pool), max(pool)
    if lo == hi:
        return 0.5
    return (value - lo) / (hi - lo)


def score_candidates(candidates: list, slot: dict) -> list:
    """Score and rank candidates for a specific slot. Returns sorted list."""
    if not candidates:
        return []

    # Normalisation pools — computed across candidates only, not full waitlist
    days_pool     = [p["days_on_waitlist"] for p in candidates]
    attempts_pool = [p["contact_attempts"] for p in candidates]
    skipped_pool  = [p["times_skipped"]    for p in candidates]
    cost_pool     = [p["procedure_cost"]   for p in candidates]

    scored = []
    for p in candidates:
        urgency      = URGENCY_SCORE[p["urgency"]]
        time_match   = _time_match(p["time_preference"], slot["time_of_day"])
        days_norm    = _normalize(p["days_on_waitlist"], days_pool)
        attempt_pen  = _normalize(p["contact_attempts"], attempts_pool)
        result_pen   = CONTACT_RESULT_PENALTY.get(p["last_contact_result"], 0.0)
        skipped_pen  = _normalize(p["times_skipped"],    skipped_pool)
        cost_norm    = _normalize(p["procedure_cost"],   cost_pool)

        score = (
            WEIGHTS["urgency"]          *  urgency     +
            WEIGHTS["time_match"]       *  time_match  +
            WEIGHTS["days_on_waitlist"] *  days_norm   -
            WEIGHTS["contact_attempts"] *  attempt_pen -
            WEIGHTS["contact_result"]   *  result_pen  -
            WEIGHTS["times_skipped"]    *  skipped_pen +
            WEIGHTS["procedure_cost"]   *  cost_norm
        )

        scored.append({
            **p,
            "final_score": round(score, 4),
            "breakdown": {
                "urgency":           round( urgency,     3),
                "time_match":        round( time_match,  3),
                "days_on_waitlist":  round( days_norm,   3),
                "contact_attempts":  round(-attempt_pen, 3),
                "contact_result":    round(-result_pen,  3),
                "times_skipped":     round(-skipped_pen, 3),
                "procedure_cost":    round( cost_norm,   3),
            },
        })

    return sorted(scored, key=lambda x: x["final_score"], reverse=True)


def rank(patients: list, slot: dict) -> dict:
    """Full pipeline: filter → score → rank. Returns structured result."""
    eligible, rejected = hard_filter(patients, slot)
    ranked = score_candidates(eligible, slot)
    return {
        "slot": slot,
        "total_on_waitlist": len(patients),
        "filtered_out": len(rejected),
        "candidates": len(eligible),
        "ranked": ranked,
        "rejected": rejected,
    }


# ── Pretty printer ─────────────────────────────────────────────────────────────

def print_results(result: dict, top_n: int = 5) -> None:
    slot = result["slot"]
    print("\n" + "═" * 60)
    print(f"  SLOT: {slot['doctor']}")
    print(f"  {slot['time_of_day'].upper()}  ·  {slot['duration_min']} min  ·  {slot['date']}")
    print("═" * 60)
    print(
        f"  Waitlist: {result['total_on_waitlist']} patients  "
        f"→  {result['filtered_out']} filtered out  "
        f"→  {result['candidates']} scored"
    )

    if not result["ranked"]:
        print("\n  No eligible candidates found.\n")
        return

    print(f"\n  TOP {min(top_n, len(result['ranked']))} CANDIDATES\n")
    for i, p in enumerate(result["ranked"][:top_n], 1):
        bd = p["breakdown"]
        print(
            f"  #{i}  {p['name']:<22}  score: {p['final_score']:.3f}"
            f"  [{p['urgency'].upper()}]  {p['condition']}"
        )
        print(
            f"       urgency={bd['urgency']:+.2f}  "
            f"time={bd['time_match']:+.2f}  "
            f"wait={bd['days_on_waitlist']:+.2f}  "
            f"attempts={bd['contact_attempts']:+.2f}  "
            f"result={bd['contact_result']:+.2f}  "
            f"skips={bd['times_skipped']:+.2f}  "
            f"cost={bd['procedure_cost']:+.2f}"
        )
        print(
            f"       {p['days_on_waitlist']} days waiting  ·  "
            f"{p['contact_attempts']} contact attempts ({p['last_contact_result']})  ·  "
            f"skipped {p['times_skipped']}×  ·  €{p['procedure_cost']}"
        )
        print()

    print("─" * 60)
    print("  FILTERED OUT (sample)\n")
    for p in result["rejected"][:3]:
        print(f"  ✗  {p['name']:<22}  {p['filter_reason']}")
    if len(result["rejected"]) > 3:
        print(f"     ... and {len(result['rejected']) - 3} more")
    print()


# ── CLI entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--doctor",   default="Dr. Stefan Bauer")
    parser.add_argument("--duration", type=int, default=75)
    parser.add_argument("--time",     default="morning", choices=["morning", "afternoon"])
    parser.add_argument("--date",     default="2026-06-07")
    parser.add_argument("--top",      type=int, default=5)
    args = parser.parse_args()

    slot = {
        "doctor":       args.doctor,
        "duration_min": args.duration,
        "time_of_day":  args.time,
        "date":         args.date,
    }

    with open("waitlist_patients.json", encoding="utf-8") as f:
        patients = json.load(f)

    result = rank(patients, slot)
    print_results(result, top_n=args.top)
