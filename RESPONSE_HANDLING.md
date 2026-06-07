# Response Handling — Implementation Plan

Covers all outcomes after fonio places an outbound call to a waitlist patient.
Case 4 (patient questions) is deferred — Lena handles appointment-related questions
from context; alternative timeslot requests are future work.

---

## Variables to fix before implementing

- Remove `opted_out` field from patient JSON — duplicate of `consent`
- Add `"declined"` and `"maybe"` as valid `last_contact_result` values in ranker
- Add `"confirmed"` as a valid `last_contact_result` value
- Rename `"rejected"` → `"declined"` everywhere for consistency

---

## Case 1 — "Don't ever call me"

**Trigger:** patient explicitly says they never want to be contacted

**Variable updates:**
- `consent` = `false`
- `last_contact_result` = `"declined"`
- `contact_attempts` += 1

**Actions:**
- Remove patient from active waitlist entirely (they don't want the appointment either)
- fonio automatic deletion already configured
- Do NOT call next candidate — slot recovery continues without this patient permanently

---

## Case 2 — Confirmed

**Trigger:** patient accepts the offered slot

**Variable updates:**
- `last_contact_result` = `"confirmed"`
- `contact_attempts` += 1
- Remove patient from waitlist (appointment is now booked)

**Actions:**
- Book the slot in the system and mark it as filled
- Stop calling other candidates immediately — signal to backend that slot is resolved
- Only care about same-day cancellations; future slots handled by new appointment flow

---

## Case 3 — Rejection

**Trigger:** patient declines this specific slot but does not opt out permanently

**Variable updates:**
- `last_contact_result` = `"declined"`
- `times_skipped` += 1
- `contact_attempts` += 1

**Actions:**
- Call next candidate immediately
- Patient stays on waitlist for future slots

---

## Case 5 — Maybe

**Trigger:** patient is unsure, does not commit either way

**Variable updates:**
- None — patient record stays unchanged

**Actions:**
- Lena responds: *"No problem, we'll reach out to others and if the slot is still
  available we'll call you back shortly."*
- Backend skips this patient for the current round and calls next candidate
- If all other candidates decline or don't answer → call this patient back
- Patient is not penalised in the ranker — their position is preserved for the callback

---

## Case 6 — Voicemail

**Trigger:** call reaches patient's voicemail box

**Variable updates:**
- `last_contact_result` = `"voicemail"`
- `contact_attempts` += 1

**Actions:**
- Lena leaves a brief message: who she is, that a slot opened up, that the
  clinic will try again shortly
- Move patient to last place in ranking
- Retry maximum 2 times total — after 2 voicemails treat as `"no_answer"` and stop

---

## Case 7 — No Answer

**Trigger:** phone rings but nobody picks up, no voicemail box

**Variable updates:**
- `last_contact_result` = `"no_answer"`
- `contact_attempts` += 1

**Actions:**
- Move patient to last place in ranking
- Retry once after 30 minutes
- After 2 no-answers, move on permanently for this slot

---

## Case 8 — Technical Failure

**Trigger:** call could not connect — wrong number, network error, carrier issue

**Variable updates:**
- Do NOT increment `contact_attempts` (not a real attempt)
- Log error separately

**Actions:**
- Retry once immediately
- If retry also fails, move to next candidate and flag patient for manual review

---

## Case 9 — Wrong Person Answers

**Trigger:** someone other than the patient picks up

**Variable updates:**
- Do NOT update `times_skipped` or `last_contact_result` (not the patient's fault)
- `contact_attempts` += 1

**Actions:**
- End call politely
- Retry once at a different time
- Note: Lena should detect this early — if name confirmation fails, end gracefully

---

## Case 10 — Slot Expires

**Trigger:** slot time passes before anyone confirms

**Variable updates:**
- No patient updates

**Actions:**
- Mark slot as `"lost"` in the system
- Log revenue lost (procedure cost of the slot) for dashboard metric
- Stop all active outbound calls for this slot

---

## Summary table

| Case | last_contact_result | contact_attempts | times_skipped | consent | Next action |
|------|--------------------|--------------------|---------------|---------|-------------|
| Don't call me | declined | +1 | — | false | Remove from waitlist |
| Confirmed | confirmed | +1 | — | — | Mark slot filled, stop calls |
| Rejection | declined | +1 | +1 | — | Call next candidate |
| Maybe | no change | no change | no change | — | Call next, callback if all fail |
| Voicemail | voicemail | +1 | — | — | Retry max 2×, then stop |
| No answer | no_answer | +1 | — | — | Retry once after 30 min |
| Technical failure | — | no change | — | — | Retry once, then skip |
| Wrong person | — | +1 | — | — | Retry at different time |
| Slot expires | — | — | — | — | Log as lost, stop calls |
