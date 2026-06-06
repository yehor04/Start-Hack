// fonio webhook receiver. Real fonio posts call data here after each call.
// With Variable Extraction enabled, expect { variables: { attempt_id, accepted, callback_requested, ... } }.

import { NextResponse } from "next/server";
import { handleOutcome, type Outcome } from "@/lib/orchestrator";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const v = (body.variables ?? body) as Record<string, unknown>;
  const attemptId = (body.attemptId ?? v.attempt_id) as string | undefined;
  if (!attemptId) {
    return NextResponse.json({ ok: false, error: "missing attemptId" }, { status: 400 });
  }

  let outcome = body.outcome as Outcome | undefined;
  if (!outcome) {
    if (v.accepted === true) outcome = "yes";
    else if (v.callback_requested === true) outcome = "callback";
    else if (v.accepted === false) outcome = "no";
    else outcome = "no_answer";
  }

  await handleOutcome(attemptId, outcome);
  return NextResponse.json({ ok: true, outcome });
}
