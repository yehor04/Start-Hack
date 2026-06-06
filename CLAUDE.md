# CLAUDE.md — Refill (fonio.ai track, START Hack Vienna '26)

Guidance for Claude Code working in this repo. Read this first.

## What we're building

**Refill** closes the appointment-cancellation loop for a medical practice, end-to-end,
without anyone touching a phone. A cancellation comes in → we pick the *right* person from
the waitlist (not just the first) → fonio places a real, personalized outbound call → we
handle yes / no / callback / voicemail → book the slot or advance to the next candidate →
a live dashboard shows the receptionist what's happening and the owner the weekly numbers.

**Track:** fonio.ai · **Code freeze:** Sunday, June 7, 14:00 sharp.
**Chosen angle (the niche):** *Yield management for the empty chair.* We reframe the
problem from "call the waitlist" to "the empty appointment is **perishable inventory** —
maximize recovered revenue per minute before it goes cold." The hero is an
**expected-value dispatcher** (`pAccept × slotValue × fit`), proven with **hard numbers
from a simulation harness**, and **explainable/auditable** for GDPR. fonio owns voice
quality; we own the quant brain around the calls. See *Differentiation* below.

**Medical context (pick one and own it):** a **private dental / implantology** practice —
high slot value (€90–€450) and long, time-sensitive waitlists, so the revenue-recovery
story has real money behind it. All seed data, copy, and the demo persona are dental.

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
7. **One language, done well:** German *or* English. Default: **German** (DACH market fit).
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

### fonio integration (the three primitives)
- **Outbound Call API** — POST phone number + variables (`name`, `slot_time`, `treatment`,
  `practice_name`) to trigger a real personalized call. This is the "call the candidate" half.
- **API Request (post-processing)** — fonio calls *our* webhook with the call outcome
  (yes/no/callback/voicemail) + captured data. This feeds the loop back.
- **Inbound Webhook** — for the cancellation-by-phone path: fonio posts the caller number,
  our response is injected into the assistant prompt via `{{variable}}`.

> The exact payload shapes, auth, and endpoints come from the **pre-provisioned fonio
> account API docs** (inside the account; credentials via Discord/email). Confirm them with
> a throwaway test call before building on assumptions. Do NOT hardcode unverified payloads.

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

## Scoring engine (the hero — keep it explainable)

**Expected value, not just a rank.** For each eligible candidate compute
`EV = pAccept × slotValueEur × fitMultiplier`, where:
- `pAccept` — propensity to say yes to *this* slot at *this* time: `acceptRate` prior +
  time/day preference match − recent-contact penalty. Missing fields → neutral 0.5.
- `slotValueEur` — perishable value recovered if they book.
- `fitMultiplier` — urgency + treatment match + fairness (down-weight recently offered).

**Consent is a hard gate** (no consent ⇒ ineligible, never scored). Every factor is
**optional and degrades gracefully** (missing enrichment → neutral contribution, never a
crash) — this is how we absorb not knowing a real source's exact fields. Persist the full
`scoreBreakdown` per attempt and generate a one-line counterfactual rationale ("called
Lukas over Maria: same treatment, but Maria prefers mornings and was contacted
yesterday"). Weights live in one config object, tunable live.

## Differentiation (everyone will use Claude — here's why we win)

Most teams ship "cancellation → call first person → book." We go niche on three axes:
1. **Expected-value dispatcher** — perishable-inventory framing (airline/hotel yield
   management applied to clinic chairs), not a flat heuristic. Quant-flavored, defensible.
2. **Simulation harness with real numbers** — not just one happy call; a live **A/B over
   100+ simulated cancellations** (naive "call-first" vs Refill) showing **fill-rate,
   revenue-recovered, and time-to-fill uplift** on the dashboard. Almost nobody else will
   have numbers.
3. **Explainable + auditable** — counterfactual "why this patient" + full per-decision
   audit trail. Serves the GDPR/healthcare trust angle the partner cares about.

The real live call still happens (mandatory for the 30% MVP). The simulator proves it
works *at scale*; the live call proves it's *real*.

## Simulation harness

A `simulator` module replays a stream of cancellation events against the seeded population,
runs both the naive baseline and the EV dispatcher, and records fill-rate, time-to-fill,
and revenue recovered. Powers the dashboard's A/B panel. Deterministic (seeded RNG) so the
demo is reproducible. The bulk seed population exists for exactly this.

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
6. **The proof:** open the A/B panel — Refill vs naive "call-first" over 100+ simulated
   cancellations: higher fill-rate, more revenue recovered, faster time-to-fill.

## Dev commands

```bash
npm install
cp .env.example .env        # fill in fonio creds from the provisioned account
npx prisma migrate dev      # set up SQLite schema
npx prisma db seed          # load dental demo data
npm run dev                 # dashboard + webhook endpoints
```

For local fonio webhook testing, expose the dev server with a tunnel (e.g. `ngrok http 3000`)
and register the public URL as the API Request / Inbound Webhook target in fonio.

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
- Dev 2 — brain: EV dispatcher + propensity + LLM rationale, seed data, simulation harness.
- Dev 3 — cockpit: live dashboard, metrics, A/B uplift panel, overrides, demo video.
