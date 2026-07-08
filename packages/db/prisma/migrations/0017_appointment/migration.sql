-- Migration 0017: Appointment — agendamentos (Agenda; interno + espelho Google)
-- Non-breaking: novo enum + tabela

DO $$ BEGIN
  CREATE TYPE "AppointmentStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'CANCELLED', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "Appointment" (
  "id"             TEXT              NOT NULL,
  "tenantId"       TEXT              NOT NULL,
  "leadId"         TEXT,
  "conversationId" TEXT,
  "userId"         TEXT,
  "title"          TEXT              NOT NULL,
  "startsAt"       TIMESTAMP(3)      NOT NULL,
  "endsAt"         TIMESTAMP(3)      NOT NULL,
  "status"         "AppointmentStatus" NOT NULL DEFAULT 'PROPOSED',
  "source"         TEXT              NOT NULL DEFAULT 'ai',
  "googleEventId"  TEXT,
  "createdAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Appointment_tenantId_startsAt_idx" ON "Appointment" ("tenantId", "startsAt");
CREATE INDEX IF NOT EXISTS "Appointment_tenantId_leadId_idx" ON "Appointment" ("tenantId", "leadId");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
