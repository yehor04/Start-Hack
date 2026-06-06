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

  // Allow an explicit outcome override; otherwise derive it from accepted / callback_requested,
  // accepting booleans, numbers, or strings ("yes"/"no"/"ja"/"nein"/"true"/"false"/…).
  let outcome = (deepFind(body, ["outcome"]) ?? q.get("outcome")) as Outcome | undefined;
  if (!outcome) {
    const accepted = norm(deepFind(body, ["accepted", "accept", "slot_accepted"]) ?? q.get("accepted"));
    const callback = norm(deepFind(body, ["callback_requested", "callback"]) ?? q.get("callback_requested"));
    if (YES.has(accepted)) outcome = "yes";
    else if (YES.has(callback)) outcome = "callback";
    else if (NO.has(accepted)) outcome = "no";
    else outcome = "no_answer";
  }
  console.log(`[fonio/outcome] attempt=${attemptId} -> ${outcome}`);

  try {
    await handleOutcome(attemptId, outcome as Outcome);
  } catch (err) {
    console.error("[fonio/outcome] handleOutcome failed", err);
    return NextResponse.json({ ok: false, error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, outcome });
}
