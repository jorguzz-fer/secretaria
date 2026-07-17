import { prisma } from "@crm/db";
import { embedText, embeddingsEnabled, toVectorLiteral } from "@crm/ai";

/**
 * Busca no catálogo de cursos (RAG híbrido).
 *
 * - **Estrutural** (sempre): filtra por tenant, ativo, área e preço máximo, e —
 *   quando não há embeddings — casa termos por ILIKE em título/resumo/área/público.
 * - **Semântico** (quando `embeddingsEnabled()`): embeda a pergunta e ordena por
 *   distância de cosseno pgvector (`embedding <=> $vec`), respeitando os filtros
 *   estruturais. Sem chave de embeddings, cai no modo estrutural — nada quebra.
 *
 * Escopo por tenant é sempre aplicado (`"tenantId" = $1`).
 */

export interface CourseHit {
  id: string;
  number: number | null;
  area: string;
  title: string;
  workload: string | null;
  priceRaw: string | null;
  priceBrl: number | null;
  audience: string | null;
  summary: string | null;
  url: string | null;
}

export interface CourseSearchOpts {
  query?: string;
  area?: string;
  maxPriceBrl?: number;
  limit?: number;
}

const SELECT =
  'SELECT "id","number","area","title","workload","priceRaw","priceBrl","audience","summary","url" FROM "Course"';

export async function searchCourses(
  tenantId: string,
  opts: CourseSearchOpts = {},
): Promise<CourseHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const params: unknown[] = [tenantId];
  const where: string[] = ['"tenantId" = $1', '"active" = true'];

  if (opts.area && opts.area.trim()) {
    params.push(`%${opts.area.trim()}%`);
    where.push(`"area" ILIKE $${params.length}`);
  }
  if (typeof opts.maxPriceBrl === "number" && Number.isFinite(opts.maxPriceBrl)) {
    params.push(Math.trunc(opts.maxPriceBrl));
    where.push(`("priceBrl" IS NULL OR "priceBrl" <= $${params.length})`);
  }

  const query = opts.query?.trim();

  if (embeddingsEnabled() && query) {
    const vec = await embedText(query);
    params.push(toVectorLiteral(vec));
    const sql = `${SELECT} WHERE ${where.join(" AND ")} ORDER BY "embedding" <=> $${params.length}::vector NULLS LAST LIMIT ${limit}`;
    return prisma.$queryRawUnsafe<CourseHit[]>(sql, ...params);
  }

  if (query) {
    params.push(`%${query}%`);
    const q = params.length;
    where.push(
      `("title" ILIKE $${q} OR "summary" ILIKE $${q} OR "area" ILIKE $${q} OR "audience" ILIKE $${q})`,
    );
  }
  const sql = `${SELECT} WHERE ${where.join(" AND ")} ORDER BY "number" ASC NULLS LAST LIMIT ${limit}`;
  return prisma.$queryRawUnsafe<CourseHit[]>(sql, ...params);
}

/** Formata os cursos recuperados para injetar no prompt do SDR (productInfo). */
export function formatCoursesForPrompt(hits: CourseHit[]): string {
  return hits
    .map((c) => {
      const parts = [`• ${c.title} (${c.area})`];
      if (c.workload) parts.push(`Carga horária: ${c.workload}`);
      if (c.priceRaw) parts.push(`Valor: ${c.priceRaw}`);
      if (c.audience) parts.push(`Público: ${c.audience}`);
      if (c.summary) parts.push(c.summary);
      if (c.url) parts.push(`Link: ${c.url}`);
      return parts.join(" — ");
    })
    .join("\n");
}

/**
 * Extrai o menor valor total em reais de um texto de preço:
 *   "R$ 1.500,00 ou 10x R$ 150,00" → 1500 · "GRATUITO" → 0 · sem match → null.
 */
export function parsePriceBrl(raw?: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (/gratuito|gr[aá]tis/i.test(s)) return 0;
  const m = s.match(/R\$\s*([\d.]+)(?:,\d{2})?/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/\./g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
