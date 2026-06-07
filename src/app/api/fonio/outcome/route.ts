// fonio post-call webhook (the "API Request" action). fonio POSTs call data here after each call.
// The extracted variables (accepted, callback_requested, …) + our outbound context (attempt_id) are
// somewhere in the payload — but fonio does NOT wrap them in a fixed "variables" object, and the
// nesting/value-format varies. So we search the whole payload by key name and accept any sane value.

import { NextResponse } from "next/server";
import { handleOutcome, type Outcome } from "@/lib/orchestrator";
import { verifyFonioRequest } from "@/lib/fonio-auth";
import { db } from "@/lib/db";

/** First non-empty value for any of `keys` (case-insensitive) found anywhere in a nested object. */
function deepFind(obj: unknown, keys: string[]): unknown {
  const want = new Set(keys.map((k) => k.toLowerCase()));
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === "object") {
      for (const [k, val] of Object.entries(cur as Record<string, unknown>)) {
        if (want.has(k.toLowerCase()) && val !== undefined && val !== null && val !== "") return val;
        if (val && typeof val === "object") stack.push(val);
      }
    }
  }
  return undefined;
}

const YES = new Set(["true", "yes", "ja", "y", "accepted", "accept", "1"]);
const NO = new Set(["false", "no", "nein", "n", "declined", "decline", "0"]);
const norm = (x: unknown) => String(x ?? "").trim().toLowerCase();

export async function POST(req: Request) {
  if (!verifyFonioRequest(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const rawPayload = JSON.stringify(body);
  console.log("[fonio/outcome] payload:", rawPayload);
  // Persist the raw payload so the exact shape is inspectable from the DB (logs truncate it).
  await db.eventLog
    .create({ data: { type: "fonio_raw", payload: rawPayload } })
    .catch((e) => console.error("[fonio/outcome] raw log failed", e));

  const q = new URL(req.url).searchParams;
  const attemptId = (deepFind(body, ["attempt_id", "attemptId"]) ?? q.get("attempt_id")) as string | undefined;
  if (!attemptId) {
    return NextResponse.json({ ok: false, error: "missing attemptId" }, { status: 400 });
  }

  // Allow an explicit outcome override; otherwise derive it from the extracted variables + call
  // status (RESPONSE_HANDLING cases). Values may be booleans, numbers, or strings.
  let outcome = (deepFind(body, ["outcome"]) ?? q.get("outcome")) as Outcome | undefined;
  if (!outcome) {
    const accepted = norm(deepFind(body, ["accepted", "accept", "slot_accepted", "confirmed"]) ?? q.get("accepted"));
    const maybe = norm(deepFind(body, ["maybe", "unsure", "undecided", "callback_requested", "callback"]) ?? q.get("maybe"));
    const optout = norm(deepFind(body, ["opt_out", "optout", "do_not_contact", "do_not_call", "never_call"]) ?? q.get("opt_out"));
    const wrong = norm(deepFind(body, ["wrong_person", "wrong_number", "not_the_patient"]) ?? q.get("wrong_person"));
    const human = norm(deepFind(body, ["human_requested", "speak_to_human", "wants_human", "transfer_to_human", "human"]) ?? q.get("human_requested"));
    const reschedule = norm(deepFind(body, ["reschedule_requested", "reschedule", "different_time", "another_time"]) ?? q.get("reschedule"));
    const cancel = norm(deepFind(body, ["cancel_requested", "cancel", "withdraw", "remove_from_waitlist"]) ?? q.get("cancel"));
    const status = norm(deepFind(body, ["call_status", "callStatus", "outcome_status", "status"]));

    if (YES.has(optout)) outcome = "optout"; // Case 1 — never contact again
    else if (YES.has(cancel)) outcome = "cancel"; // wants to withdraw from the waitlist
    else if (YES.has(human)) outcome = "human_requested"; // caller wants a human
    else if (YES.has(wrong)) outcome = "wrong_person"; // Case 9
    else if (YES.has(accepted)) outcome = "yes"; // Case 2 — accepted the offered slot
    else if (YES.has(reschedule)) outcome = "reschedule"; // declines this time, wants a different one
    else if (YES.has(maybe)) outcome = "maybe"; // Case 5
    else if (NO.has(accepted)) outcome = "no"; // Case 3
    else if (/voicemail|voice_mail|mailbox/.test(status)) outcome = "voicemail"; // Case 6
    else if (/no[-_ ]?answer|unanswered|noanswer/.test(status)) outcome = "no_answer"; // Case 7
    else if (/fail|error|busy|abandon|cancel/.test(status)) outcome = "failed"; // Case 8
    else outcome = "no_answer";
  }
  // Capture fonio's AI conversation summary so the dashboard can show what was discussed.
  const summary = (deepFind(body, ["summary", "call_summary", "conversation_summary"]) ?? undefined) as
    | string
    | undefined;
  // For a reschedule, the time/day they asked for (free text, e.g. "Tuesday morning").
  const preferredAlternative = (deepFind(body, ["preferred_alternative", "preferred_time", "preferred_day", "new_time"]) ??
    undefined) as string | undefined;
  console.log(`[fonio/outcome] attempt=${attemptId} -> ${outcome}`);

  try {
    await handleOutcome(attemptId, outcome as Outcome, { summary, preferredAlternative });
  } catch (err) {
    console.error("[fonio/outcome] handleOutcome failed", err);
    return NextResponse.json({ ok: false, error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, outcome });
}
