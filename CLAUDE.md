# CLAUDE.md — Refill (fonio.ai track, START Hack Vienna '26)

Guidance for Claude Code working in this repo. Read this first.

## What we're building

**Refill** closes the appointment-cancellation loop for a medical practice, end-to-end,
without anyone touching a phone. A cancellation comes in → we pick the *right* person from
the waitlist (not just the first) → fonio places a real, personalized outbound call → we
handle yes / no / callback / voicemail → book the slot or advance to the next candidate →
a live dashboard shows the receptionist what's happening and the owner the weekly numbers.

**Track:** fonio.ai · **Code freeze:** Sunday, June 7, 14:00 sharp.
**Chosen angle (the niche):** *The empty chair is perishable inventory.* We reframe the
problem from "call the waitlist" to "recover the slot for the patient who most needs it and
is most likely to show up — before it goes cold." The hero is a **patient-benefit
dispatcher** that ranks by `urgency × likelihoodToAttend × fit` (NOT by revenue — see
*Objective & ethics*), is **explainable/auditable** for GDPR, and is backed by a
**simulation harness** for policy analysis. Revenue recovered is shown as a business KPI,
not the thing we optimize. fonio owns voice quality; we own the dispatch brain. See
*Differentiation* below.

**Medical context:** a **private dental / implantology** practice **in Vienna serving
international/expat patients** — which makes an **English-speaking** assistant in-character
(not a cop-out), with high slot value (€90–€450) and long, time-sensitive waitlists. All
seed data, copy, call dialog, and the pitch are in **English**.

## Non-negotiables (from the brief — optimize for these)

Judging weights: Functional MVP **30%**, Technical Execution **25%**, Problem Fit **20%**,
UX & Design **15%**, Pitch **10%**.

1. **The end-to-end loop must run live with a real outbound call.** This is 30% and the
   biggest risk. A demo that falls back to slides loses. Get one real call placed
   end-to-end as early as possible.
2. **Pick the right person, not the first.** Scoring must be real and *explainable* — we
   must be able to say exactly why a candidate was chosen.
3. **Survive production (Technical Execution):** persistence, error handling,
   **idempotency**, sane architecture. No double-booking, no double-calling.
4. **Consent before any outbound call** (GDPR). Gate every call on a consent flag; never
   call without it. Show we've thought about it.
5. **Handle edge cases visibly:** no, no-answer, voicemail, callback → degrade cleanly and
   surface what needs a human. Demo at least one edge case.
6. **Dashboard a receptionist would actually use** and numbers an owner can read: refill
   rate, revenue recovered, attempts per slot, outcomes by reason.
7. **Language: English**, done well (brief allows German or English). Persona = a Vienna
   clinic serving international patients, so English is in-character.
8. **Be honest in the README** about what's real vs. mocked.

## Architecture

```
Cancellation event ──► Orchestrator ──► Scoring engine ranks waitlist (with reasons)
  (dashboard button or                          │
   inbound fonio call → webhook)         picks top eligible candidate
                            │                    ▼
                    Attempt state machine ──► fonio Outbound Call API (vars: name, slot, treatment)
                            ▲                    │
                            │            fonio places the real call
                  outcome webhook ◄──── fonio API Request posts result
                            │
        YES → book slot + update downstream | NO/no-answer → next candidate | voicemail/callback → retry/human
                            │
            Live dashboard updates via SSE/WebSocket
```

### fonio integration (VERIFIED from the account — full detail in `team-docs/fonio-reference.md`)
Account: trial to 2026-06-13. Assistant **Lena** is connected to **+493082687385** (our line).

- **⭐ Variable Extraction = structured outcome.** fonio fills a JSON schema we define from the
  call (it ships a `name`/`anliegen` example). We define `accepted` (bool/null),
  `callback_requested` (bool/null), `preferred_alternative` (string/null), `reason_declined`.
  → **No transcript-parsing needed for the happy path.** This retires the big risk.
- **Webhooks (outbound)** — after the call fonio POSTs call data (extracted variables +
  transcript + summary) to our endpoint = our outcome webhook (`/api/fonio/outcome`).
- **Custom Prompt / Instructions** — the recovery-call script, personalized per call.
- **Book Appointments / Send SMS / Send Email** — native; optional confirmation SMS on "yes".
- Limits: max call 20 min; max silence wait 10 s; guardrails always on.
- ⚠️ **Automatic Deletion**: if the callee declines recording, NO extraction runs → handle
  recording consent in the prompt (announce + proceed).

> ⚠️ THE ONE OPEN ITEM: find the **outbound-call TRIGGER endpoint** (REST API to start a call
> with phone + variables) + its auth/API key — under More/Settings/API or Webhooks/Integrations.
> Everything else (structured outcome, delivery, script) is confirmed. The in-app **Test call**
> works meanwhile. See the spike checklist in `team-docs/fonio-reference.md`.

## Tech stack

- **Next.js (TypeScript), App Router** — dashboard + API routes (fonio webhooks) in one app.
- **Prisma + SQLite** for speed in the hack (Postgres-compatible schema; swap if time allows).
- **Server-Sent Events** for live dashboard updates (simpler than WebSocket for one-way).
- **One LLM call** to generate the human-readable "why this candidate" rationale.
- **Tailwind** for fast, clean UI.

## Data model (design our own — start here)

- `Patient` — id, name, phone, **consent_outbound** (bool, required for calls), preferences
  (preferred times/days), treatment needs, last_contacted_at, no_show_count.
- `Slot` — id, datetime, duration, treatment_type, room/practitioner, status
  (booked/cancelled/open/filling/filled), revenue_value.
- `WaitlistEntry` — patient_id, treatment_type, urgency, earliest_available, time_prefs,
  added_at, fairness_last_offered_at.
- `RecoveryAttempt` — slot_id, candidate_patient_id, status (queued/calling/yes/no/
  no_answer/voicemail/callback/failed), fonio_call_id, **idempotency_key**, score,
  score_breakdown (JSON), reason_text, created_at, resolved_at.
- `Outcome` / event log — append-only audit of everything for the dashboard timeline.

## Scoring engine (the hero — patient-benefit, explainable)

### Objective & ethics
We rank by **patient benefit**, not money: `priority = urgency × likelihoodToAttend × fit`.
Revenue recovered is a **displayed KPI**, never the optimization target — in healthcare,
calling the lucrative patient over the one in pain is the wrong (and bad-looking) thing.
This is also the better Problem-Fit answer for the judges.

### The score
For each eligible candidate:
- `urgency` — clinical/wait urgency (waitlist urgency + how long they've waited).
- `likelihoodToAttend` — a transparent **heuristic prior** (NOT a fake "learned" rate — own
  this): `acceptRate` prior + time/day preference match − recent-contact penalty − no-show
  penalty. Missing fields → neutral 0.5.
- `fit` — treatment match + fairness (down-weight recently offered, so we don't always ring
  the same person first).

**Consent is a hard gate** (no consent ⇒ ineligible, never scored). Every factor is
**optional and degrades gracefully** (missing enrichment → neutral contribution, never a
crash) — this is how we absorb not knowing a real source's exact fields. Persist the full
`scoreBreakdown` per attempt and generate a one-line counterfactual rationale ("called
Lukas over Maria: same treatment, both available, but Maria prefers mornings and was
contacted yesterday"). Weights live in one config object, tunable live.

## Differentiation (everyone will use Claude — here's why we win)

Most teams ship "cancellation → call first person → book." We go niche on three axes:
1. **Patient-benefit dispatcher** — perishable-inventory *framing*, but the objective is
   "right patient, will show up", with consent + fairness baked in. Defensible, not a flat
   heuristic, and not the ethically-iffy revenue-max version.
2. **Simulation harness for policy analysis** — beyond one happy call, an **A/B over 100+
   simulated cancellations** (naive "call-first" vs Refill) on the dashboard. **Framing
   matters:** present it honestly as *how the policy behaves* (fill-rate, time-to-fill,
   right-patient match), NOT "proof we're 2× better" — the data is synthetic and a sharp
   judge will call out a rigged benchmark. Honest > impressive-but-fragile.
3. **Explainable + auditable** — counterfactual "why this patient" + full per-decision
   audit trail. Serves the GDPR/healthcare trust angle the partner cares about.

The real live call still happens (mandatory for the 30% MVP) and is the most fragile part,
so **record a clean backup video the moment the loop works.** The simulator is demo
insurance + shows behavior at scale; the live call proves it's real.

## Simulation harness

A `simulator` module replays a stream of cancellation events against the seeded population,
runs both the naive baseline and the patient-benefit dispatcher, and records fill-rate,
time-to-fill, and revenue recovered. Powers the dashboard's A/B panel. Deterministic
(seeded RNG) so the demo is reproducible. **Build only AFTER the live loop is green** — it
is NOT in the 30% critical path. Frame results as policy behavior, not proof of uplift.

## Data layer & adapter

The DB schema (`prisma/schema.prisma`) splits **CORE** fields (any source has them) from
**ENRICHMENT** fields (optional). A thin `adapter` normalizes any source (mock JSON now /
real PMS or fonio variables later) into the internal `Patient`/`WaitlistEntry` model, so
when real fields appear we change only the adapter — scoring and dashboard never move.

## State machine (per RecoveryAttempt — keep it strict)

`queued → calling → {yes | no | no_answer | voicemail | callback | failed}`
- `yes` → mark slot `filled`, attempt resolved, stop the loop for that slot.
- `no` / `no_answer` → mark attempt resolved, auto-advance: score remaining, queue next.
- `voicemail` / `callback` → schedule retry per policy or surface to human; advance loop.
- Every transition is idempotent and logged. A given (slot, candidate) is never called twice.

## Conventions

- Keep modules separated: **fonio client**, **webhook handlers**, **orchestrator/state
  machine**, **scoring engine**, **dashboard**. This maps to the Technical Execution rubric.
- All secrets in `.env` (git-ignored). Maintain `.env.example`. **Never commit secrets.**
- Idempotency keys on every outbound-call trigger and every inbound webhook.
- Timeouts + retries + clear error messages on all fonio/API/LLM calls.
- Seed script for demo data (`prisma/seed.ts`) with the dental persona + a waitlist that
  makes the scoring demo obvious.
- Commit messages: conventional, small, frequent.

## Demo script (the 3-min video — rehearse this exact run)

1. Cancellation comes in (a dental slot opens).
2. Dashboard shows the ranked waitlist **with reasons** for the top pick.
3. Top candidate receives a **real outbound call**; patient says yes.
4. Slot **books live**; metrics tick up (refill rate, revenue recovered).
5. **Edge case:** trigger the second slot where the top candidate doesn't answer → system
   auto-advances to the next candidate. Show it degrade cleanly.
6. **The policy view:** open the A/B panel — Refill vs naive "call-first" over 100+
   simulated cancellations: higher fill-rate, faster time-to-fill, right-patient match
   (revenue recovered shown as a KPI). Present honestly as policy behavior on synthetic data.

## Dev commands

```bash
npm install
cp .env.example .env        # fill in fonio creds from the provisioned account
npx prisma migrate dev      # set up SQLite schema
npx prisma db seed          # load dental demo data
npm run dev                 # dashboard + webhook endpoints
```

fonio needs a public HTTPS URL for the outcome webhook. **Preferred: deploy to Vercel**
early (`vercel`) for a stable URL to register in fonio — more reliable than a tunnel during
the hack. Local fallback: `ngrok http 3000`. Register the URL as the fonio API Request /
Inbound Webhook target.

## Submission checklist (don't lose easy points)

- [ ] Public repo in START Hack Vienna '26 org, **fonio** folder, team folder.
- [ ] **MIT LICENSE** at root.
- [ ] README: setup + run instructions; honest about working vs. mocked.
- [ ] No secrets in repo; `.env.example` present.
- [ ] 3-min demo video: cancellation → slot detected → candidate picked → outbound call →
      slot booked (+ the edge case).
- [ ] Tally form filled (title, one-line pitch, team, problem, solution, tech stack, links).
- [ ] Optional but recommended: `REPORT.md` technical write-up.

## Team

- Dev 1 — fonio/telephony: outbound trigger, webhooks, state machine, idempotency, consent.
- Dev 2 — brain: patient-benefit dispatcher + likelihood-to-attend + LLM rationale, seed
  data, simulation harness (after the loop is green).
- Dev 3 — cockpit: live dashboard, metrics, A/B uplift panel, overrides, demo video.
