-- Migration 0018: Course — catálogo de cursos por tenant (RAG híbrido)
--
-- pgvector: a imagem do Postgres é `pgvector/pgvector:pg16`. A coluna
-- `embedding vector(1536)` guarda o embedding do curso (text-embedding-3-small)
-- e é lida/escrita via SQL cru — o Prisma não modela tipo vector.
--
-- Sem bloco DO/$$ — o runner de produção (apps/web/migrate.js) divide por ';'.
-- Idempotência: IF NOT EXISTS nos objetos + catch de "already exists" do runner.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "Course" (
  "id"          TEXT         NOT NULL,
  "tenantId"    TEXT         NOT NULL,
  "number"      INTEGER,
  "area"        TEXT         NOT NULL,
  "title"       TEXT         NOT NULL,
  "workload"    TEXT,
  "priceRaw"    TEXT,
  "priceBrl"    INTEGER,
  "audience"    TEXT,
  "summary"     TEXT,
  "instructors" TEXT,
  "url"         TEXT,
  "active"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

CREATE INDEX IF NOT EXISTS "Course_tenantId_area_idx" ON "Course" ("tenantId", "area");
CREATE INDEX IF NOT EXISTS "Course_tenantId_active_idx" ON "Course" ("tenantId", "active");
CREATE INDEX IF NOT EXISTS "Course_embedding_idx" ON "Course" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "Course"
  ADD CONSTRAINT "Course_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
