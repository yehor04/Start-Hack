# Refill — empty slots, filled before they go cold

**Yield management for the empty chair.** When an appointment is cancelled, Refill treats the
empty slot as perishable inventory: it picks the patient with the highest *expected recovered
revenue* off the waitlist, has fonio.ai place a real, personalized outbound call, and books the
slot on yes — all in under a minute. Built for the **fonio.ai** track at **START Hack Vienna '26**.

> Status: work in progress. This README is honest about what's working vs. mocked (see below).

## The challenge

Close the cancellation→rebooking loop end-to-end without anyone at the practice touching a phone:
a cancellation comes in, the right candidate is selected, called, and the slot is booked or the
system advances to the next candidate — with a live dashboard for the receptionist and metrics
for the owner.

## What we built

- **Expected-value dispatcher** — ranks the waitlist by `pAccept × slotValue × fit`, not "first come".
- **Explainable + auditable** — every pick has a per-factor breakdown and a counterfactual reason.
- **Real outbound calls via fonio** — personalized, with yes / no / no-answer / voicemail handling.
- **Operator cockpit** — live call status, candidate reasons, refill rate & revenue recovered.
- **Simulation harness** — A/B over 100+ simulated cancellations: Refill vs naive baseline.

## Getting started

### Prerequisites
- Node.js 20+
- A fonio.ai account (provisioned for the track) with API access

### Setup
```bash
npm install
cp .env.example .env        # fill in fonio creds + DEMO_PHONE_1..3 (real phones, with consent)
npx prisma migrate dev      # create the local SQLite schema
npx prisma db seed          # load the dental demo data + bulk population
npm run dev                 # dashboard + fonio webhook endpoints
```

For local fonio webhook testing, expose your dev server with a tunnel (e.g. `ngrok http 3000`)
and register the public URL as the fonio API Request / Inbound Webhook target.

## Configuration

See `.env.example`. Never commit `.env` (it is git-ignored).

## Architecture & assumptions

- **Stack:** Next.js (TypeScript) + Prisma/SQLite + SSE for live updates.
- **Data model:** CORE fields (any source has them) vs ENRICHMENT (optional; scoring degrades
  gracefully when missing). A thin adapter normalizes any source into the internal model.
- **fonio:** Outbound Call API (trigger + variables), API Request (outcome webhook),
  Inbound Webhook (cancellation-by-phone). Voice quality is fonio's; we own the dispatch brain.
- See `CLAUDE.md` for the full design, state machine, and demo script.

## What's working vs mocked

- _To be filled in as we build — be honest here for the judges._

## Team

- Dev 1 — fonio/telephony (outbound, webhooks, state machine, consent)
- Dev 2 — brain (EV dispatcher, propensity, rationale, simulator, seed data)
- Dev 3 — cockpit (dashboard, metrics, A/B panel, demo video)

## Submission

- Track: **fonio.ai** · START Hack Vienna '26 · Code freeze: Sunday, June 7, 14:00.

## License

MIT — see [LICENSE](./LICENSE).
