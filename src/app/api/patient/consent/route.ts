import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Patient toggles "call me if an earlier slot opens up" = the outbound-consent (GDPR) gate.
//   POST /api/patient/consent  { name, enabled }
// Same-origin guarded; identifies the patient by name (demo-grade — add real auth for production).

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { name, enabled } = (await req.json().catch(() => ({}))) as { name?: string; enabled?: boolean };
  if (!name || typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "missing name/enabled" }, { status: 400 });
  }
  const patient = await db.patient.findFirst({ where: { name } });
  if (!patient) return NextResponse.json({ ok: false, error: "patient not found" }, { status: 404 });

  await db.patient.update({ where: { id: patient.id }, data: { consentOutbound: enabled } });
  await db.eventLog.create({
    data: { type: "consent_changed", payload: JSON.stringify({ patient: name, consent: enabled }) },
  });
  return NextResponse.json({ ok: true, consent: enabled });
}
