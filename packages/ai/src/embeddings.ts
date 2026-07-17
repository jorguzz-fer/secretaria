import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";

/**
 * Embeddings para o RAG do catálogo de cursos.
 *
 * Provider **compatível-OpenAI** (o OpenRouter usado no chat não serve embeddings
 * de forma confiável). Config por env, com degradação graciosa:
 *   EMBEDDINGS_API_KEY   → chave (ou cai em OPENAI_API_KEY)
 *   EMBEDDINGS_BASE_URL  → default https://api.openai.com/v1
 *   EMBEDDINGS_MODEL     → default text-embedding-3-small (1536 dims)
 *
 * Sem chave, `embeddingsEnabled()` é false e a busca de cursos opera só no
 * modo estruturado — nada quebra.
 */
export const EMBEDDING_DIM = 1536;
const DEFAULT_MODEL = "text-embedding-3-small";

function apiKey(): string {
  return process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY || "";
}

export function embeddingsEnabled(): boolean {
  return apiKey().length > 0;
}

function model() {
  const client = createOpenAI({
    apiKey: apiKey(),
    baseURL: process.env.EMBEDDINGS_BASE_URL || "https://api.openai.com/v1",
  });
  return client.textEmbeddingModel(process.env.EMBEDDINGS_MODEL || DEFAULT_MODEL);
}

/** Embedding de um texto. Lança se `embeddingsEnabled()` for false. */
export async function embedText(value: string): Promise<number[]> {
  if (!embeddingsEnabled()) throw new Error("embeddings desabilitado (sem EMBEDDINGS_API_KEY)");
  const { embedding } = await embed({ model: model(), value });
  return embedding;
}

/** Embeddings em lote (para ingestão do catálogo). */
export async function embedTexts(values: string[]): Promise<number[][]> {
  if (!embeddingsEnabled()) throw new Error("embeddings desabilitado (sem EMBEDDINGS_API_KEY)");
  if (values.length === 0) return [];
  const { embeddings } = await embedMany({ model: model(), values });
  return embeddings;
}

/** Serializa um vetor para o literal aceito pelo pgvector: `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
