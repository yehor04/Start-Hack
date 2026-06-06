"""
explainer.py

Takes the top-ranked candidate from the ranker and generates a natural language
explanation of why this patient was selected — suitable for display in the
receptionist dashboard or logged alongside the outbound call.
"""

import requests
import json

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "qwen3:30b"


def _build_prompt(patient: dict, slot: dict) -> str:
    bd = patient["breakdown"]

    factors = {
        "Urgency":           bd["urgency"],
        "Time match":        bd["time_match"],
        "Days on waitlist":  bd["days_on_waitlist"],
        "Doctor match":      bd["doctor_match"],
        "Contact attempts":  bd["contact_attempts"],
        "Contact result":    bd["contact_result"],
        "Times skipped":     bd["times_skipped"],
        "Procedure cost":    bd["procedure_cost"],
    }

    top_reasons = sorted(
        [(k, v) for k, v in factors.items() if v > 0],
        key=lambda x: abs(x[1]), reverse=True
    )[:3]

    penalty_reasons = sorted(
        [(k, v) for k, v in factors.items() if v < 0],
        key=lambda x: x[1]
    )

    lines = []
    for k, v in top_reasons:
        lines.append(f"  - {k}: {v:+.2f}")
    for k, v in penalty_reasons:
        lines.append(f"  - {k}: {v:+.2f} (penalty)")

    return f"""You are the AI dispatcher for a dental clinic.

A slot has just opened up:
- Doctor: {slot['doctor']}
- Date: {slot['date']}
- Time: {slot['time']}
- Duration: {slot['duration_min']} minutes

The system has selected the following patient from the waitlist:
- Name: {patient['name']}
- Age: {patient['age']}
- Condition: {patient['condition']}
- Urgency: {patient['urgency']}
- Days on waitlist: {patient['days_on_waitlist']}
- Time preference: {patient['time_preference']} (preferred: {patient['preferred_time']})
- Contact history: {patient['contact_attempts']} attempt(s), last result: {patient['last_contact_result']}
- Times previously skipped: {patient['times_skipped']}
- Final score: {patient['final_score']}

Key scoring factors that drove this selection:
{chr(10).join(lines)}

Write 2-3 sentences explaining to the receptionist why this patient was chosen.
Be specific, use the patient's name and condition, and mention the top 1-2 reasons.
Do not use bullet points. Do not mention numerical scores. Sound professional but human.
/no_think"""


def explain(patient: dict, slot: dict, model: str = OLLAMA_MODEL) -> str:
    prompt = _build_prompt(patient, slot)

    try:
        response = requests.post(
            OLLAMA_URL,
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=60,
        )
        response.raise_for_status()
        return response.json()["response"].strip()
    except requests.exceptions.ConnectionError:
        return _fallback_explanation(patient, slot)
    except Exception as e:
        return _fallback_explanation(patient, slot)


def _fallback_explanation(patient: dict, slot: dict) -> str:
    bd = patient["breakdown"]

    reasons = []
    if bd["urgency"] >= 0.5:
        reasons.append(f"their condition ({patient['condition']}) is classified as {patient['urgency']}")
    if bd["time_match"] >= 0.7:
        reasons.append(f"their time preference ({patient['time_preference']}) aligns well with the {slot['time']} slot")
    if bd["days_on_waitlist"] >= 0.6:
        reasons.append(f"they have been waiting {patient['days_on_waitlist']} days")
    if bd["doctor_match"] >= 0.6:
        reasons.append(f"their condition is a strong match for {slot['doctor']}")
    if not reasons:
        reasons.append(f"they are the highest-scoring available candidate")

    reason_str = " and ".join(reasons[:2])
    return (
        f"{patient['name']} was selected as the top candidate because {reason_str}. "
        f"They have {patient['contact_attempts']} prior contact attempt(s) and are reachable at {patient['phone']}."
    )


if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    from ranker import rank

    with open("waitlist_patients.json", encoding="utf-8") as f:
        patients = json.load(f)
    with open("doctors.json", encoding="utf-8") as f:
        doctors = json.load(f)

    slot = {
        "doctor":       "Dr. Stefan Bauer",
        "duration_min": 75,
        "time":         "09:00",
        "date":         "2026-06-07",
    }

    result = rank(patients, slot, doctors=doctors)
    top = result["ranked"][0]

    print(f"\nTop candidate: {top['name']} (score: {top['final_score']})")
    print("\n--- Explanation ---")
    print(explain(top, slot))
