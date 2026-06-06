// Refill seed — uses Olha's richer dataset (waitlist_patients.json, 80 patients, 5 doctors)
// plus a hand-built "today's schedule" of booked slots. Deterministic for a reproducible demo.
//
// Run: npm run seed   (after: npx prisma migrate dev)

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

const db = new PrismaClient();

type Raw = {
  id: string; name: string; age: number; urgency: string; condition: string;
  assigned_doctor: string; time_preference: string; preferred_time: string;
  days_on_waitlist: number; assigned_date: string; contact_attempts: number;
  last_contact_result: string; times_skipped: number; procedure_cost: number;
  procedure_time_min: number; phone: string;
  consent: boolean; opted_out: boolean;
};

// Outbound consent (GDPR hard gate) comes straight from the dataset: a patient is callable only
// if they consented AND have not opted out. (In the Dr. Berger demo cohort this excludes P017,
// P023, P031, so the consent gate is visible in the recovery list.)
const hasOutboundConsent = (p: Raw) => p.consent === true && p.opted_out !== true;

const hrs = (h: number) => new Date(Date.now() + h * 3_600_000);
const todayAt = (hh: number, mm = 0) => {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
};
// Real demo phones (with consent) override the placeholder phones for the first few patients.
const demoPhone = (n: number) => process.env[`DEMO_PHONE_${n}`] || null;

async function main() {
  await db.eventLog.deleteMany();
  await db.recoveryAttempt.deleteMany();
  await db.slot.deleteMany();
  await db.patient.deleteMany();

  const raw: Raw[] = JSON.parse(readFileSync(join(process.cwd(), "waitlist_patients.json"), "utf8"));

  // ---- waitlist patients ----
  let idx = 0;
  for (const p of raw) {
    idx++;
    const overridePhone =
      p.id === "P002" ? demoPhone(1) : p.id === "P003" ? demoPhone(2) : p.id === "P004" ? demoPhone(3) : null;
    await db.patient.create({
      data: {
        name: p.name,
        phone: overridePhone || p.phone,
        age: p.age,
        consentOutbound: hasOutboundConsent(p),
        onWaitlist: true,
        urgency: p.urgency,
        condition: p.condition,
        assignedDoctor: p.assigned_doctor,
        timePreference: p.time_preference,
        preferredTime: p.preferred_time,
        daysOnWaitlist: p.days_on_waitlist,
        assignedDate: new Date(p.assigned_date),
        contactAttempts: p.contact_attempts,
        lastContactResult: p.last_contact_result,
        timesSkipped: p.times_skipped,
        procedureCost: p.procedure_cost,
        procedureTimeMin: p.procedure_time_min,
      },
    });
  }

  // ---- today's schedule (booked appointments) — matches the green design mockups ----
  // Each row: [hh, mm, patientName, treatment, doctor, durationMin, valueEur]
  // The 17:30 Dr. Berger implant consultation is the DEMO cancel target — cancelling it pulls
  // Dr. Berger's waitlist (urgent endodontic / implant patients) into the recovery loop.
  // NOTE: duration is 90 min (the mockup shows 30) so candidates whose procedures need 45–90 min
  // stay eligible — a 30 min slot would hard-filter the whole Berger cohort out and the demo would
  // escalate with no candidates.
  const schedule: [number, number, string, string, string, number, number][] = [
    [9, 0, "Anna Keller", "Hygiene", "Dr. Moser", 30, 90],
    [9, 30, "Felix Wagner", "Crown fitting", "Dr. Berger", 60, 350],
    [10, 30, "Nina Fischer", "Root canal", "Dr. Eder", 75, 300],
    [11, 30, "Lukas Bauer", "Hygiene", "Dr. Moser", 30, 90],
    [14, 0, "Jonas Hofer", "Ortho adjustment", "Dr. Berger", 60, 120],
    [15, 30, "David Fuchs", "Crown fitting", "Dr. Eder", 60, 350],
    [17, 30, "Maria Schmid", "Implant consultation", "Dr. Berger", 90, 450], // <- demo cancel target
  ];
  for (const [hh, mm, who, treatment, doctor, durationMin, valueEur] of schedule) {
    await db.slot.create({
      data: {
        startsAt: todayAt(hh, mm),
        durationMin,
        treatment,
        practitioner: doctor,
        room: "OP 1",
        status: "booked",
        valueEur,
        bookedPatientName: who,
      },
    });
  }

  const counts = {
    patients: raw.length,
    noConsent: raw.filter((p) => !hasOutboundConsent(p)).length,
    slots: schedule.length,
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
