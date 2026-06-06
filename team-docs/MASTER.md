# Refill — Team Master Doc 🦷📞

**START Hack Vienna '26 · fonio.ai track · code freeze: Sunday, June 7, 14:00**

> One doc to onboard the whole team. Read this first, then `CLAUDE.md` (for Claude Code) and
> `team-docs/fonio-reference.md` (fonio account details). This file is team-only — our publish
> script keeps `team-docs/` out of the public submission repo.

---

## 1. One-liner

**Refill turns every appointment cancellation into a booked slot:** it picks the patient who
most needs the freed slot, an AI phone agent (fonio) calls and offers it, books on "yes," and
moves to the next person on "no" — automatically, while the receptionist just watches.

---

## 2. The idea in plain words

**Problem.** A dental clinic is fully booked. Someone cancels → an empty chair (e.g. Thu 17:30).
Empty chair = lost money. There's a waiting list of people who'd take it, but refilling means a
receptionist manually phoning down a list. Most don't answer; after 15 min the slot stays empty.
This happens daily at clinics, salons, etc.

**Our solution.** The moment a cancellation happens:
1. **Pick the right patient** — not "first on the list", but the best fit for *this* slot
   (needs care soon, time fits, likely to say yes, gave consent). We can **explain why**.
2. **Call them for real** via fonio (AI that talks on the phone like a human). We pass the
   patient's name + slot + treatment; fonio has the conversation.
3. **Understand the answer** — fonio returns a structured result (yes / no / call-back).
   - **Yes** → book the slot.
   - **No / no answer** → automatically move to the next-best patient and call them.
4. **Receptionist sees it live** — a dashboard shows who's being called, outcomes, the slot
   filling, and owner metrics (refill rate, revenue recovered).

The whole loop runs by itself in ~1–2 minutes.

---

## 3. Why we win (everyone will use Claude — we go niche)

The obvious build everyone ships: "cancellation → call someone → book." Ours is sharper:

1. **Patient-benefit dispatcher.** The empty chair is *perishable inventory* (like a fresh fish
   at market). We rank by **`urgency × likelihoodToAttend × fit`** — i.e. "right patient, will
   show up" — **NOT by revenue**. In healthcare, calling the lucrative patient over the one in
   pain is the wrong (and bad-looking) move. Revenue recovered is shown as a KPI, not optimized.
2. **Simulation harness for proof.** Beyond the one live call, we replay 100+ simulated
   cancellations and compare our smart picking vs naive "call-first" → higher fill-rate, faster.
   ⚠️ We present this **honestly as policy behavior on synthetic data**, not "proof we're 2× better"
   (a rigged benchmark collapses under one judge question).
3. **Explainable + auditable.** Every pick has a per-factor breakdown + a one-line reason
   ("called Lukas over Maria: both free, but Maria prefers mornings and was called yesterday").
   Matters for GDPR / healthcare trust.

**Important:** fundamentals are the cake, the niche is the cherry. The live loop + clean UX must
be bulletproof before the fancy stuff.

---

## 4. What we have from fonio (verified) + the one open item

Full detail in `team-docs/fonio-reference.md`. Summary:

- Account on **trial until 2026-06-13**. Assistant **Lena** connected to **+493082687385** (our line).
- **⭐ Variable Extraction = structured outcomes.** We define a JSON schema and fonio fills it
  from the call. Our schema: `accepted` (bool/null), `callback_requested` (bool/null),
  `preferred_alternative` (string/null), `reason_declined`. → **No transcript parsing needed.**
- **Webhooks (outbound)** — fonio POSTs call data (extracted vars + transcript + summary) to our
  endpoint after each call = our outcome webhook (`/api/fonio/outcome`).
- **Custom Prompt** — the recovery-call script, personalized per call.
- Native **Book Appointments / Send SMS / Email** (optional confirmation SMS on "yes").
- Limits: max call 20 min, max silence 10 s, guardrails always on.
- ⚠️ If the callee declines recording, **no extraction runs** → announce recording in the prompt.

**⚠️ THE ONE OPEN ITEM:** the **outbound-call TRIGGER endpoint** (REST API to start a call with
phone + variables) + API key. We have the **API Keys** page (More → API Keys → Create) and
**More → Open Documentation** / **Outbound Campaigns** — someone needs to grab the endpoint +
auth + body fields from the docs. Everything else is confirmed.

---

## 5. Architecture

```
Cancellation (dashboard button) ──► Orchestrator ──► Scoring engine ranks waitlist (with reasons)
                                          │                    │
                                          │            picks top eligible candidate
                                          ▼                    ▼
                                  Attempt state machine ──► fonio: trigger outbound call (name, slot, treatment)
                                          ▲                    │
                                          │            fonio places the real call
                            outcome webhook ◄──── fonio outbound Webhook (structured: accepted, etc.)
                                          │
        YES → book slot + update | NO/no-answer → next candidate | callback → retry/human
                                          │
                          Live dashboard updates via Server-Sent Events
```

**Modules (kept separate — scores points on Technical Execution):** fonio client · webhook
handlers · orchestrator/state machine · scoring engine · dashboard · simulator.

**State machine per attempt:** `queued → calling → {yes | no | no_answer | voicemail | callback | failed}`.
Idempotent transitions; a given (slot, candidate) is never called twice.

---

## 6. Data + the "model" (how we choose whom to call)

**Dataset = synthetic, already in `prisma/seed.ts`.** The brief says design our own. No real
patient data (GDPR). Two parts:
- **Demo cohort** (hand-crafted) so "call-first" is visibly wrong: Hans (no consent → skipped),
  Maria (mornings + called yesterday + low accept), **Lukas (the right pick)**, Sophie (the
  no-answer edge case).
- **Bulk population** (~28 patients) for the simulator.

**The "model" is NOT a neural net — it's a transparent scoring function:**

```
priority = urgency × likelihoodToAttend × fit          (consent = hard gate: no consent ⇒ skipped)
```
- `urgency` — clinical/wait urgency.
- `likelihoodToAttend` — `acceptRate` prior + time/day match − recent-contact penalty − no-show penalty (missing → 0.5).
- `fit` — treatment match + fairness (down-weight recently offered).

Why a heuristic, not ML: (1) no real training data — training on our own synthetic data is
circular; (2) explainability is our differentiator + GDPR need; (3) 24h. The LLM is used only for
the human-readable "why this patient" sentence (and as a fallback outcome classifier).

**Schema design (`prisma/schema.prisma`):** fields split into **CORE** (always present) vs
**ENRICHMENT** (optional; scoring degrades gracefully if missing). A thin adapter normalizes any
source into our model, so unknown real fields never break us.

---

## 7. Tech stack & decisions

- **Next.js (TypeScript), App Router** — dashboard + fonio webhooks in one app.
- **Prisma + SQLite** — DB (patients, slots, waitlist, attempts, audit log).
- **Server-Sent Events** — live dashboard updates.
- **Vercel** — deploy early for a stable public HTTPS URL to register as fonio's webhook
  (more reliable than ngrok during the hack).
- **Anthropic API** — the "why" rationale (one HTTP call).
- **Language: English** (persona = a Vienna clinic serving international patients, so English is
  in-character). Demo calls go to our own phones.

---

## 8. Repo & collaboration workflow

**Two-repo model so teammates get the AI/strategy docs but judges don't:**
- **Private dev repo** (this one) — everything, incl. `CLAUDE.md` + `team-docs/`. We all work here.
- **Public submission repo** — created at the end via `scripts/publish-submission.sh <url>`,
  which strips `CLAUDE.md`, `team-docs/`, `scripts/`, the case PDF, secrets, and history → a clean
  single-commit repo judges see.

**Get started (each teammate) — the app is built ✅ and runs:**
```bash
git clone <private-repo-url>
cd "Start Hack"
claude                  # CLAUDE.md auto-loads as context for your Claude Code

cp .env.example .env    # has DATABASE_URL; FONIO_LIVE defaults to simulation (no keys needed)
npm install             # installs deps + generates the Prisma client (postinstall)
npx prisma migrate dev  # first time only: creates the local SQLite db
npm run seed            # load the demo data (dental cohort + today's schedule)
npm run dev             # → http://localhost:3000      patient page → /p/demo
```
With `FONIO_LIVE=false` (default) calls are **simulated in-process**, so the whole loop is
demoable with no phone. Set `FONIO_LIVE=true` + fill the keys to make calls real.
- Each teammate needs their **own Claude Pro/Max** to run Claude Code.
- **VS Code Live Share** = for pair-debugging on one screen; **GitHub** = the durable source of truth.
- Never commit `.env` / secrets / the DB file (`.gitignore` handles this).

---

## 9. 24-hour plan & roles

**H0–2 (together):** find the outbound-trigger endpoint, place one test call, confirm Variable
Extraction returns structured output, scaffold the app, run the seed.

**H2–6 (DE-RISK):** get **one real outbound call end-to-end** — trigger → call → structured
outcome in our webhook → DB updated. Nothing else matters until this works.

| Person | Owns |
|---|---|
| **Dev 1 — telephony** | fonio client, webhook receiver, state machine, idempotency, consent gate |
| **Dev 2 — brain** | scoring engine + likelihood-to-attend + LLM rationale, seed data, simulator (after loop is green) |
| **Dev 3 — cockpit** | dashboard (live status, candidate reasons, metrics, A/B panel), demo video |

**H18–24 (together):** polish the demo run, handle edge cases, record video, write README/REPORT,
publish the clean repo, fill the Tally form.

---

## 10. Demo script (the 3-min video — rehearse exactly this)

1. A cancellation comes in (a dental slot opens).
2. Dashboard shows the ranked waitlist **with reasons** for the top pick.
3. Top candidate gets a **real call**; patient says yes.
4. Slot **books live**; metrics tick up.
5. **Edge case:** a second slot where the top pick doesn't answer → auto-advances to the next.
6. **Policy view:** A/B panel — Refill vs naive over 100+ simulated cancellations (honest framing).

> Record a clean backup video the moment the loop works — the live call is the most fragile part.

---

## 11. Do-this-now (current status)

- ✅ Step 1 — private repo pushed, teammates added.
- ✅ Step 2 — fonio account mapped; **Variable Extraction** confirmed as our structured-outcome
  path (see `fonio-reference.md`). **One open item:** the outbound-call **trigger endpoint**
  (More → Open Documentation / Outbound Campaigns) + create an **API key** (More → API Keys).
- ✅ Step 3 — **Next.js app scaffolded, builds clean, loop verified end-to-end** (in simulation:
  cancel → Lukas ranked top → booked; Hans excluded by the consent gate; KPIs + audit trail update).
- 🔄 Step 4 — wire the **real fonio call** in `src/lib/fonio.ts` (the `fetch` is stubbed and
  commented) and flip `FONIO_LIVE=true`. Until then calls are simulated.
- ⏭️ Step 5 — **reconcile Olha's richer ranker + data into the app** (see §14), add the
  no-answer→next demo path, polish, record the 3-min video.

### The running app, in one picture
```
Schedule (cancel) ─┐                                  src/lib/
Patient /p/demo  ──┼─► POST /api/slots/[id]/cancel ─► orchestrator.cancelSlot()
 (Cancel)          │                                    ├─ scoring.ts   (rank waitlist, explainable)
fonio inbound* ────┘                                    ├─ fonio.ts     (trigger call: sim | real)
                                                        └─ handleOutcome → book / advance
   webhook ◄── POST /api/fonio/outcome ◄── fonio (Variable Extraction)   *inbound = stretch
   UI polls GET /api/state every 1.5s → StaffShell (Schedule / Recovery / Owner) + patient page
```
Files: `src/lib/{scoring,orchestrator,fonio,queries,db}.ts`, `src/app/StaffShell.tsx`,
`src/app/p/[token]/`, `src/app/api/{state,slots/[id]/cancel,fonio/outcome}`.

---

## 12. Submission checklist (don't lose easy points)

- [ ] Public repo in the START Hack org → **fonio** folder → team folder (confirm on Discord).
- [ ] **MIT LICENSE** at root · README honest about working vs. mocked · no secrets · `.env.example`.
- [ ] 3-min demo video: cancellation → slot detected → candidate picked → call → booked (+ edge case).
- [ ] Tally form: title, one-line pitch, team, problem, solution, tech stack, links.
- [ ] Optional: `REPORT.md` technical write-up.

---

## 13. File map

| File | What |
|---|---|
| `team-docs/MASTER.md` | **this doc** — start here |
| `CLAUDE.md` | guidance for Claude Code (root, auto-loaded) |
| `team-docs/fonio-reference.md` | fonio account capabilities + spike checklist |
| `team-docs/mockups/*` | the 4 design mockups (HTML + PNG) |
| `prisma/schema.prisma` · `prisma/seed.ts` | data model + synthetic seed |
| `src/lib/scoring.ts` | the dispatcher (patient-benefit, explainable) |
| `src/lib/orchestrator.ts` | the loop (cancel → rank → call → book/advance) |
| `src/lib/fonio.ts` | call trigger — simulated now, real stubbed |
| `src/app/StaffShell.tsx` | staff UI (persona + Schedule/Recovery/Owner) |
| `src/app/p/[token]/` | patient page + Cancel |
| `src/app/api/*` | state / cancel / fonio outcome routes |
| `scripts/publish-submission.sh` | builds the clean judge-facing public repo |
| `README.md` | judge-facing front door (goes to the public repo) |
| `ranker.py` · `waitlist_patients.json` · `doctors.json` | Olha's richer ranker + data — **to fold in, see §14** |

---

## 14. Teammate work & reconciliation (Olha's ranker)

Olha built, in parallel (Python, standalone), a **richer ranker and dataset**:
- `ranker.py` — weighted scorer with **hard filters** (joined-after-slot, procedure longer than
  the slot, wrong doctor) + soft scoring (urgency, half-day + preferred-time distance, days on
  waitlist, contact-attempt/result penalties, times-skipped fairness).
- `waitlist_patients.json` — richer patients (condition, `assigned_doctor`, `preferred_time`,
  `procedure_time_min`, `last_contact_result`, `times_skipped`, `procedure_cost`, phone…).
- `doctors.json` — doctors with specialization + keywords (condition → right doctor).

**Verdict: genuinely good — in several ways richer than the scaffold's `scoring.ts`.** Worth
adopting: the **procedure-duration vs slot-length filter**, **doctor matching**, **preferred-time
distance**, and **contact-result penalties**.

**But two things to reconcile (we should converge on ONE brain):**
1. **One implementation, not two.** The live web demo is the TS app; a separate Python script
   isn't wired in. → **Port Olha's logic into `src/lib/scoring.ts`** (keep one runnable app) and
   adopt her richer fields into `prisma/schema.prisma` + `seed.ts` (the adapter absorbs the rename).
2. **Drop `procedure_cost` from the score.** Her weights give cost a small positive weight — that
   re-introduces revenue into ranking, which we deliberately removed (patient-benefit, not money).
   Keep cost as a **displayed KPI only**. Protects the ethics story the judges care about.

Action: Dev 2 + Olha pick TS as the source of truth, port the ranker, unify the data model.
Claude can do this port in one pass when you're ready.
