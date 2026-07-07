-- Migration 0015: TenantModule — per-tenant module toggle + settings (Módulo 0)
-- Non-breaking: new table only

CREATE TABLE IF NOT EXISTS "TenantModule" (
  "id"        TEXT         NOT NULL,
  "tenantId"  TEXT         NOT NULL,
  "moduleKey" TEXT         NOT NULL,
  "enabled"   BOOLEAN      NOT NULL,
  "settings"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantModule_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TenantModule"
  ADD CONSTRAINT "TenantModule_tenantId_moduleKey_key" UNIQUE ("tenantId", "moduleKey");

CREATE INDEX IF NOT EXISTS "TenantModule_tenantId_idx" ON "TenantModule" ("tenantId");

ALTER TABLE "TenantModule"
  ADD CONSTRAINT "TenantModule_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
