// Refill seed — a private dental/implantology practice.
// Deterministic (seeded RNG) so the demo is reproducible.
// The DEMO COHORT is hand-crafted so the EV dispatcher visibly beats "call the first".
// The BULK POPULATION feeds the simulation harness (A/B uplift numbers).
//
// Run: npx prisma db seed   (configure in package.json: "prisma": { "seed": "ts-node prisma/seed.ts" })

import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

// --- deterministic RNG ---
let _s = 1337;
const rnd = () => (_s = (_s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const hrs = (h: number) => new Date(Date.now() + h * 3_600_000);
const daysAt = (d: number, hh: number, mm = 0) => {
  const dt = hrs(d * 24);
  dt.setHours(hh, mm, 0, 0);
  return dt;
};

// Real phones for the LIVE demo come from env; otherwise obvious placeholders.
// Set DEMO_PHONE_1..3 in .env to team members' phones (with consent).
const PHONE = (n: number) => process.env[`DEMO_PHONE_${n}`] ?? `+4300000000${n}`;

const TREATMENTS: Record<string, number> = {
  implant_consult: 450,
  crown_fitting: 350,
  root_canal: 300,
  ortho_adjust: 120,
  hygiene: 90,
};
const FIRST = ["Lukas","Maria","Hans","Sophie","Elena","Jakob","Anna","Felix","Lena","Paul","Clara","Tobias","Nina","David","Julia","Markus","Sarah","Florian","Lea","Stefan"];
const LAST  = ["Gruber","Huber","Bauer","Wagner","Mueller","Pichler","Steiner","Moser","Mayer","Hofer","Berger","Fuchs","Eder","Fischer","Schmid"];
const WINDOWS = ["morning","afternoon","evening"];
const WEEKDAYS = ["mon","tue","wed","thu","fri"];

async function main() {
  await db.eventLog.deleteMany();
  await db.recoveryAttempt.deleteMany();
  await db.waitlistEntry.deleteMany();
  await db.slot.deleteMany();
  await db.patient.deleteMany();

  // ---------------- DEMO COHORT ----------------
  // Flagship perishable slot: high-value implant consult, just cancelled, this evening-ish.
  const slot1 = await db.slot.create({
    data: {
      startsAt: daysAt(2, 17, 30), treatment: "implant_consult", valueEur: 450,
      practitioner: "Dr. Berger", room: "OP 1", status: "open",
    },
  });

  // A) FIRST on the list — but NO CONSENT -> hard-gated out (shows consent gating).
  const pA = await db.patient.create({ data: {
    name: "Hans Gruber", phone: PHONE(3), language: "de", consentOutbound: false,
    preferredTimes: JSON.stringify(["evening"]), acceptRate: 0.7, noShowCount: 0,
  }});
  // B) SECOND, consented — but bad fit: prefers mornings, contacted yesterday, low accept.
  const pB = await db.patient.create({ data: {
    name: "Maria Huber", phone: PHONE(4), language: "de", consentOutbound: true,
    preferredDays: JSON.stringify(["mon","tue"]), preferredTimes: JSON.stringify(["morning"]),
    lastContactedAt: hrs(-20), acceptRate: 0.2, noShowCount: 2,
  }});
  // C) EV WINNER — consented, evening match, high accept, not recently contacted.
  //    Route to DEMO_PHONE_1 (we answer YES on the live call).
  const pC = await db.patient.create({ data: {
    name: "Lukas Bauer", phone: PHONE(1), language: "de", consentOutbound: true,
    preferredTimes: JSON.stringify(["evening","afternoon"]), acceptRate: 0.85, noShowCount: 0,
  }});
  // D) STRONG #2 — for the no-answer EDGE CASE. Route to DEMO_PHONE_2 (let it ring out).
  const pD = await db.patient.create({ data: {
    name: "Sophie Mayer", phone: PHONE(2), language: "de", consentOutbound: true,
    preferredTimes: JSON.stringify(["evening"]), acceptRate: 0.75, noShowCount: 0,
  }});

  for (const d of [
    { p: pA, urgency: 3, added: hrs(-72) }, // added first
    { p: pB, urgency: 2, added: hrs(-60) },
    { p: pC, urgency: 5, added: hrs(-40) },
    { p: pD, urgency: 4, added: hrs(-30) },
  ]) {
    await db.waitlistEntry.create({ data: {
      patientId: d.p.id, treatment: "implant_consult", urgency: d.urgency,
      earliestAvailable: hrs(1), addedAt: d.added,
    }});
  }

  // Second flagship slot for the EDGE-CASE run (top pick rings out -> advance to next).
  await db.slot.create({ data: {
    startsAt: daysAt(3, 18, 0), treatment: "implant_consult", valueEur: 450,
    practitioner: "Dr. Berger", room: "OP 1", status: "open",
  }});

  // ---------------- BULK POPULATION (simulation harness) ----------------
  const treatments = Object.keys(TREATMENTS);
  for (let i = 0; i < 28; i++) {
    const p = await db.patient.create({ data: {
      name: `${pick(FIRST)} ${pick(LAST)}`,
      phone: `+4366000${between(10000, 99999)}`,
      language: chance(0.85) ? "de" : "en",
      consentOutbound: chance(0.8),
      preferredTimes: chance(0.7) ? JSON.stringify([pick(WINDOWS)]) : null,
      preferredDays: chance(0.5) ? JSON.stringify([pick(WEEKDAYS), pick(WEEKDAYS)]) : null,
      lastContactedAt: chance(0.3) ? hrs(-between(2, 240)) : null,
      noShowCount: between(0, 3),
      acceptRate: chance(0.8) ? Math.round((0.2 + rnd() * 0.7) * 100) / 100 : null,
    }});
    const tr = pick(treatments);
    await db.waitlistEntry.create({ data: {
      patientId: p.id, treatment: tr,
      urgency: chance(0.8) ? between(1, 5) : null,
      earliestAvailable: hrs(between(1, 48)),
      addedAt: hrs(-between(1, 200)),
    }});
  }

  // Extra open slots across treatments for the simulator to refill.
  for (let i = 0; i < 12; i++) {
    const tr = pick(treatments);
    await db.slot.create({ data: {
      startsAt: daysAt(between(1, 5), between(9, 18), pick([0, 30])),
      treatment: tr, valueEur: TREATMENTS[tr], status: "open",
      practitioner: pick(["Dr. Berger", "Dr. Moser", "Dr. Eder"]),
    }});
  }

  console.log("Seed complete: demo cohort + 28 bulk patients + open slots.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
