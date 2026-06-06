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
};

// Patients we deliberately mark as NO-CONSENT to demo the GDPR gate.
// P001 (Maria Gruber) is an urgent Dr. Bauer/morning patient — she'd rank top, so excluding
// her makes the consent gate visible right at the top of the list.
const NO_CONSENT = new Set(["P001", "P020", "P044"]);

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
        consentOutbound: !NO_CONSENT.has(p.id),
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

  // ---- today's schedule (booked appointments) ----
  // Each row: [hh, mm, patientName, treatment, doctor, durationMin, valueEur]
  // The 17:30 Dr. Stefan Bauer root canal is the DEMO cancel target — cancelling it pulls his
  // waitlist (urgent endodontic patients) into the recovery loop.
  const schedule: [number, number, string, string, string, number, number][] = [
    [9, 0, "Johanna Reiter", "Hygiene", "Dr. Anna Wagner", 30, 90],
    [9, 30, "Markus Lang", "Crown fitting", "Dr. Elisabeth Huber", 60, 350],
    [10, 30, "Petra Kofler", "Root canal", "Dr. Stefan Bauer", 75, 450],
    [11, 30, "Georg Brunner", "Filling", "Dr. Michael Gruber", 45, 180],
    [14, 0, "Sandra Holzer", "Check-up", "Dr. Thomas Müller", 30, 80],
    [15, 30, "Daniel Auer", "Crown fitting", "Dr. Anna Wagner", 60, 350],
    [17, 30, "Maria Schmid", "Root canal", "Dr. Stefan Bauer", 90, 550], // <- demo cancel target
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
    noConsent: NO_CONSENT.size,
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
