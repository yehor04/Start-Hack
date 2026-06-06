# fonio account reference (what we actually have)

Captured from the account on 2026-06-06. This file is **team-only** — the publish script
excludes `team-docs/` from the public submission repo.

## Account

- **Trial** valid until **2026-06-13** (covers the hack).
- Plan menu: Overview · Assistants · Conversations · Knowledge · More.

## Assistants

| Name | Type | Connected number |
|---|---|---|
| **Lena** | Phone | **+493082687385** (German / Berlin) — our calling line |
| Snezhana | Phone | none connected |

- "Create Assistant" available. In-app **Test call** uses the number `+49 30 82687385`.
- For the demo, calls will originate from the German Lena number — fine for calling our own phones.

## Assistant capabilities (Edit Assistant → Behaviour)

- **Essentials** — name/identity.
- **Answer Questions** — FAQs from the Knowledge base.
- **Transfer Calls** — forward to team/numbers.
- **Send Email** — automated emails with call data, dynamic recipients, custom templates.
- **Custom Prompt / Instructions** — the call script. ← we put the recovery-call prompt here,
  personalized with the variables we pass per call.
- **Send SMS** — dynamic content to callers or fixed numbers. ← optional confirmation SMS on "yes".
- **Book Appointments** — native "book appointment for the caller". (We'll likely use our own
  booking via extraction instead, but this exists as a fallback.)
- **Webhooks** — "Advanced setups with inbound and outbound API webhooks." ← our outcome path.
- **Integrations (NEW)** — connect external services.

## Technical tab (the important settings)

- **Guardrails & Content Moderation** — always on.
- **Maximum Call Duration**: 20 min (auto-end).
- **Maximum Wait Time**: 10 s of silence without response → call ends.
- **Record Audio**: off by default; if on, available 30 days and the assistant must announce it.
- **Automatic Deletion (recommended)**: ⚠️ if the callee **declines a recording**, the recording
  and transcript are deleted and **NO post-call actions or extraction run**. Our outcome depends
  on extraction → we must handle recording consent in the prompt (announce + proceed), or make
  sure this setting doesn't silently kill extraction in the demo.
- **Technical Terms** — store rare words (names, products) for better recognition.
- **Speech Speed**, **Sensitivity** (interruption/noise), **Creativity (Temperature)** sliders.
- **Precise Information Processing** — name/format pairs (e.g. Email → max.mustermann@example.com)
  that trigger a stronger transcription model for accuracy.

## ⭐ Variable Extraction = our STRUCTURED OUTCOME (this is the key feature)

`Variable Extraction Active` lets us define a JSON schema that fonio fills from the conversation.
The shipped example:

```json
{
  "name":     { "type": ["string", "null"], "description": "Name of the caller" },
  "anliegen": { "type": ["string", "null"], "description": "Brief description of the concern" }
}
```

> Note from fonio: always allow `null`, otherwise the AI hallucinates content to fill fields.

**Our extraction schema for the recovery call** (define in the assistant):

```json
{
  "accepted":            { "type": ["boolean", "null"], "description": "Did the patient accept the offered appointment slot? true=yes, false=no, null=unclear" },
  "callback_requested":  { "type": ["boolean", "null"], "description": "Did they ask to be called back later?" },
  "preferred_alternative": { "type": ["string", "null"], "description": "Any alternative time/day they'd prefer instead" },
  "reason_declined":     { "type": ["string", "null"], "description": "Short reason if they declined" }
}
```

This means **we do NOT need to parse transcripts** for the happy path — fonio returns structured
intent. (Keep a transcript-fallback only as defense in depth.)

## Other technical toggles seen

- **Free Call Transfer** (off) — assistant can transfer to numbers defined in the prompt.
- **DTMF / Tone Dial Tones Sending** (off).
- **Prevent Start Message Interruption** (on) — caller can't talk over the opening message.

## Conversations (post-call data)

- Each call appears under **Conversations** as a `Webcall` with duration, an auto-generated
  **Summary**, and a full **History** transcript (timestamped, Assistant/Caller turns).
- Status labels seen: normal, **Abandoned**.
- So per call we get: summary + transcript + (with extraction on) structured variables.

## ✅ What's solved vs ⚠️ still to confirm

**Solved by the account:**
- Structured outcome → **Variable Extraction**.
- Outcome delivery to us → **outbound Webhook** (POSTs call data to our endpoint).
- Personalized script → **Custom Prompt** + passed variables.
- Confirmation → **Send SMS / Send Email**.

**⚠️ STILL TO CONFIRM (the one open item):** the **outbound-call TRIGGER endpoint** — the REST
API to *programmatically start* an outbound call with a phone number + variables. Not visible in
these screenshots. Find it under **More / Settings / API keys**, or inside the **Webhooks /
Integrations** config. Until found, the assistant is testable via the in-app **Test call** button.

## Spike checklist (do this first)

1. Find the outbound-call trigger API (endpoint, auth header, body for phone + variables).
2. Turn on **Variable Extraction** on Lena with our schema above.
3. Add an **outbound Webhook** pointing at our `/api/fonio/outcome` (use the Vercel URL).
4. Place one real call to a teammate phone → confirm: structured variables arrive at our webhook,
   and note the **latency** (call end → webhook fired).
5. Record what the webhook payload actually looks like and paste it back here.

## ⚠️ Outbound calling setup (from the fonio Discord)

- **The internal fonio number is NOT allowed for outbound by default.** Our +493082687385
  (assigned to Lena) is inbound-only → that's why "No outbound phone numbers available".
- **Fix:** set up a real outbound number — official guide (Loom):
  https://www.loom.com/share/fc67a879ec6c44a383f432451f137c99 (Phone Numbers → Add Number /
  Create SIP Number / Import Number). The fonio team **will enable outbound on request** — always
  **state your account** when asking (ours: "Hack Start GmbH 14").
- **International restriction:** calling across countries can throw `outOfBounds` / "outbound not
  allowed" (e.g. +36 → +43). Use a number whose region matches the phones you'll call, or ask the
  team to **allow international**. Tell them which destination country your test phones are in.
- **Minutes:** ~**750 outbound minutes** available on the account. ⚠️ But note the separate
  **2-credit cap** below — credits, not minutes, are the binding limit for testing.
- **There IS a REST API to trigger outbound calls** (teams in the channel call it directly) — get
  the exact endpoint from More → Open Documentation. The CSV "Outbound Campaigns" is the batch
  tool, NOT what we want for event-driven single calls.
- **Prompt tip (Marco):** in Lena's prompt add a pronunciation note — "read numbers as words
  (1 = one, 2 = two…), and read symbols/units in full" — fixes AI mis-reading digits, esp. non-EN.

## ⚠️ Credit cap — conserve real calls (Discord, 2026-06-06)

- There is a **hard 2-credit cap per account** (`x/2`). Marco was checking whether teams hit it
  before asking the tech team to raise it across all 40 accounts (a manual hassle for them).
- **A proper call costs ~0.3 credits** (Ersjan: 0.3 after one real call) → only **~6 real calls**
  before the cap. Budget accordingly.
- **Plan:** rehearse the whole loop in **simulation** (`FONIO_LIVE=false`) and spend real calls
  only on (1) the one mandatory live-loop proof and (2) the backup video. **Record the backup
  video the moment the first real call succeeds.**
- **If you hit `x/2`:** ask **Marco in the public Discord thread** (he asked: no DMs) and state the
  account (`Hack Start GmbH 14`) — the tech team will raise the limit. Only ask once actually
  blocked.

## Native scheduler does NOT expose calendar metadata → use our own booking (Discord, 2026-06-06)

- Philipp confirmed: the **native fonio scheduler books into the linked Google Calendar**, but the
  **calendar event metadata is NOT exposed** to us — you get a booking reference you can't link
  back to the event (no event ID / start / duration). Marco: "the data isn't available in the
  frontend, it only runs on the dev side."
- **Implication for Refill:** this validates our design — we do **NOT** use the native scheduler.
  We book into our **own Postgres DB** from the outcome webhook + Variable Extraction
  (`handleOutcome` → slot `filled`), so we own all the metadata. **We do not need Google Calendar.**
- **Fallback only if calendar sync is ever required:** Marco's workaround is fonio → **n8n** →
  Google Calendar (reproduce the scheduler in n8n so you control the event metadata). Not needed
  for our current architecture.
