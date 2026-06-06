// fonio webhook receiver. Real fonio posts call data here after each call.
// With Variable Extraction enabled, expect { variables: { attempt_id, accepted, callback_requested, ... } }.

import { NextResponse } from "next/server";
import { handleOutcome, type Outcome } from "@/lib/orchestrator";
import { verifyFonioRequest } from "@/lib/fonio-auth";

export async function POST(req: Request) {
  if (!verifyFonioRequest(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  console.log("[fonio/outcome] payload:", JSON.stringify(body));

  const v = (body.variables ?? body) as Record<string, unknown>;
  // attempt_id may arrive top-level (snake/camel), inside context, or inside variables.
  const ctx = (body.context ?? {}) as Record<string, unknown>;
  const attemptId = (body.attemptId ?? body.attempt_id ?? ctx.attempt_id ?? v.attempt_id) as string | undefined;
  if (!attemptId) {
    return NextResponse.json({ ok: false, error: "missing attemptId" }, { status: 400 });
  }

  // fonio templating may send booleans as real bools OR strings ("true"/"false") — accept both.
  const truthy = (x: unknown) => x === true || x === "true";
  const falsy = (x: unknown) => x === false || x === "false";

  let outcome = body.outcome as Outcome | undefined;
  if (!outcome) {
    if (truthy(v.accepted)) outcome = "yes";
    else if (truthy(v.callback_requested)) outcome = "callback";
    else if (falsy(v.accepted)) outcome = "no";
    else outcome = "no_answer";
  }

  try {
    await handleOutcome(attemptId, outcome);
  } catch (err) {
    console.error("[fonio/outcome] handleOutcome failed", err);
    return NextResponse.json({ ok: false, error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, outcome });
}
