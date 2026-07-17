"use strict";
/**
 * Importa (idempotente) o catálogo de cursos de um tenant a partir de um JSON.
 *
 * Substitui o catálogo do tenant (delete + insert) e, se houver chave de
 * embeddings, calcula o embedding de cada curso (busca semântica pgvector).
 * Sem chave, importa só os dados estruturais — a busca estruturada já funciona.
 *
 * Uso (no container):
 *   TENANT_SLUG="medicine" node apps/web/import-courses.js
 *   # opcional: COURSES_JSON=/caminho/arquivo.json (default ./data/medicine-cursos.json)
 *
 * Embeddings (opcional): EMBEDDINGS_API_KEY (ou OPENAI_API_KEY),
 *   EMBEDDINGS_BASE_URL (default https://api.openai.com/v1),
 *   EMBEDDINGS_MODEL (default text-embedding-3-small).
 */

const { PrismaClient } = require("@prisma/client");
const { readFileSync, existsSync } = require("fs");
const { join } = require("path");

const prisma = new PrismaClient();

function parsePriceBrl(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/gratuito|gr[aá]tis/i.test(s)) return 0;
  const m = s.match(/R\$\s*([\d.]+)(?:,\d{2})?/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/\./g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function embeddingsKey() {
  return process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY || "";
}

async function embedBatch(texts) {
  const base = process.env.EMBEDDINGS_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.EMBEDDINGS_MODEL || "text-embedding-3-small";
  const res = await fetch(`${base.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${embeddingsKey()}` },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

async function main() {
  const tenantSlug = process.env.TENANT_SLUG;
  if (!tenantSlug) {
    console.error("❌ TENANT_SLUG é obrigatório");
    process.exit(1);
  }

  const jsonPath =
    process.env.COURSES_JSON ||
    (existsSync(join(__dirname, "data/medicine-cursos.json"))
      ? join(__dirname, "data/medicine-cursos.json")
      : join(__dirname, "../../apps/web/data/medicine-cursos.json"));
  if (!existsSync(jsonPath)) {
    console.error(`❌ JSON não encontrado: ${jsonPath}`);
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    console.error(`❌ Tenant '${tenantSlug}' não encontrado`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  console.log(`→ ${raw.length} cursos de ${jsonPath}`);

  // Substitui o catálogo do tenant (idempotente).
  await prisma.course.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.course.createMany({
    data: raw
      .filter((c) => c.title && c.area)
      .map((c) => ({
        tenantId: tenant.id,
        number: typeof c.number === "number" ? c.number : null,
        area: String(c.area),
        title: String(c.title),
        workload: c.workload ? String(c.workload) : null,
        priceRaw: c.price ? String(c.price) : null,
        priceBrl: parsePriceBrl(c.price),
        audience: c.audience ? String(c.audience) : null,
        summary: c.summary ? String(c.summary) : null,
        instructors: c.instructors ? String(c.instructors) : null,
        url: c.url ? String(c.url) : null,
      })),
  });
  const inserted = await prisma.course.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, title: true, area: true, summary: true, audience: true },
  });
  console.log(`✓ ${inserted.length} cursos inseridos`);

  if (!embeddingsKey()) {
    console.log("⚠ Sem EMBEDDINGS_API_KEY — pulando embeddings (busca estruturada funciona).");
    return;
  }

  console.log("→ Calculando embeddings...");
  const BATCH = 100;
  let done = 0;
  for (let i = 0; i < inserted.length; i += BATCH) {
    const chunk = inserted.slice(i, i + BATCH);
    const texts = chunk.map((c) =>
      [c.title, c.area, c.audience, c.summary].filter(Boolean).join(". ").slice(0, 8000),
    );
    const vecs = await embedBatch(texts);
    for (let j = 0; j < chunk.length; j++) {
      const lit = `[${vecs[j].join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "Course" SET embedding = $1::vector WHERE id = $2`,
        lit,
        chunk[j].id,
      );
    }
    done += chunk.length;
    console.log(`  ${done}/${inserted.length}`);
  }
  console.log("✓ Embeddings gravados");
}

main()
  .catch((e) => {
    console.error("❌ Import falhou:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
