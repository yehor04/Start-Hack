-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'de',
    "consentOutbound" BOOLEAN NOT NULL DEFAULT false,
    "preferredDays" TEXT,
    "preferredTimes" TEXT,
    "lastContactedAt" DATETIME,
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "acceptRate" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startsAt" DATETIME NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "treatment" TEXT NOT NULL,
    "practitioner" TEXT,
    "room" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "valueEur" INTEGER NOT NULL DEFAULT 0,
    "bookedPatientName" TEXT,
    "recoveredBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "treatment" TEXT NOT NULL,
    "urgency" INTEGER,
    "earliestAvailable" DATETIME,
    "fairnessLastOfferedAt" DATETIME,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "WaitlistEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecoveryAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slotId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "score" REAL NOT NULL,
    "pAccept" REAL,
    "evEur" REAL,
    "scoreBreakdown" TEXT NOT NULL,
    "reasonText" TEXT,
    "fonioCallId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "RecoveryAttempt_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecoveryAttempt_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "slotId" TEXT,
    "patientId" TEXT,
    "attemptId" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryAttempt_idempotencyKey_key" ON "RecoveryAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryAttempt_slotId_patientId_key" ON "RecoveryAttempt"("slotId", "patientId");
