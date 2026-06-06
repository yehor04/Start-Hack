-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "age" INTEGER,
    "consentOutbound" BOOLEAN NOT NULL DEFAULT true,
    "onWaitlist" BOOLEAN NOT NULL DEFAULT true,
    "urgency" TEXT NOT NULL DEFAULT 'routine',
    "condition" TEXT NOT NULL DEFAULT '',
    "assignedDoctor" TEXT NOT NULL DEFAULT '',
    "timePreference" TEXT NOT NULL DEFAULT 'flexible',
    "preferredTime" TEXT NOT NULL DEFAULT '09:00',
    "daysOnWaitlist" INTEGER NOT NULL DEFAULT 0,
    "assignedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastContactResult" TEXT NOT NULL DEFAULT 'none',
    "timesSkipped" INTEGER NOT NULL DEFAULT 0,
    "procedureCost" INTEGER NOT NULL DEFAULT 0,
    "procedureTimeMin" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "treatment" TEXT NOT NULL,
    "practitioner" TEXT,
    "room" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "valueEur" INTEGER NOT NULL DEFAULT 0,
    "bookedPatientName" TEXT,
    "recoveredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryAttempt" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "score" DOUBLE PRECISION NOT NULL,
    "pAccept" DOUBLE PRECISION,
    "evEur" DOUBLE PRECISION,
    "scoreBreakdown" TEXT NOT NULL,
    "reasonText" TEXT,
    "fonioCallId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RecoveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slotId" TEXT,
    "patientId" TEXT,
    "attemptId" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryAttempt_idempotencyKey_key" ON "RecoveryAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryAttempt_slotId_patientId_key" ON "RecoveryAttempt"("slotId", "patientId");

-- AddForeignKey
ALTER TABLE "RecoveryAttempt" ADD CONSTRAINT "RecoveryAttempt_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryAttempt" ADD CONSTRAINT "RecoveryAttempt_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
