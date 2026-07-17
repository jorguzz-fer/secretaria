import { vi, describe, it, expect, beforeEach } from "vitest";

const { queryRawMock } = vi.hoisted(() => ({ queryRawMock: vi.fn() }));
const { embedTextMock, embeddingsEnabledMock } = vi.hoisted(() => ({
  embedTextMock: vi.fn(),
  embeddingsEnabledMock: vi.fn(),
}));

vi.mock("@crm/db", () => ({ prisma: { $queryRawUnsafe: queryRawMock } }));
vi.mock("@crm/ai", () => ({
  embedText: embedTextMock,
  embeddingsEnabled: embeddingsEnabledMock,
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import { searchCourses, formatCoursesForPrompt, parsePriceBrl } from "../courses";

beforeEach(() => {
  vi.clearAllMocks();
  queryRawMock.mockResolvedValue([]);
});

describe("parsePriceBrl", () => {
  it("extrai o menor valor total", () => {
    expect(parsePriceBrl("R$ 1.500,00 ou 10x R$ 150,00")).toBe(1500);
    expect(parsePriceBrl("R$ 499,00 ou 10x R$ 49,90")).toBe(499);
    expect(parsePriceBrl("R$ 8.000,00")).toBe(8000);
  });
  it("GRATUITO → 0", () => {
    expect(parsePriceBrl("GRATUITO")).toBe(0);
    expect(parsePriceBrl("Grátis")).toBe(0);
  });
  it("vazio/sem match → null", () => {
    expect(parsePriceBrl("")).toBeNull();
    expect(parsePriceBrl(null)).toBeNull();
    expect(parsePriceBrl("consulte")).toBeNull();
  });
});

describe("searchCourses — estrutural (sem embeddings)", () => {
  beforeEach(() => embeddingsEnabledMock.mockReturnValue(false));

  it("escopa por tenant e ativo, ordena por número, não chama embedText", async () => {
    await searchCourses("tenant-1");
    expect(embedTextMock).not.toHaveBeenCalled();
    const [sql, ...params] = queryRawMock.mock.calls[0];
    expect(sql).toContain('"tenantId" = $1');
    expect(sql).toContain('"active" = true');
    expect(sql).toContain('ORDER BY "number" ASC');
    expect(params[0]).toBe("tenant-1");
  });

  it("aplica filtro de área e preço máximo", async () => {
    await searchCourses("tenant-1", { area: "Cardiologia", maxPriceBrl: 1000 });
    const [sql, ...params] = queryRawMock.mock.calls[0];
    expect(sql).toContain('"area" ILIKE');
    expect(sql).toContain('"priceBrl" <=');
    expect(params).toContain("%Cardiologia%");
    expect(params).toContain(1000);
  });

  it("query vira ILIKE em título/resumo/área/público", async () => {
    await searchCourses("tenant-1", { query: "ultrassom" });
    const [sql, ...params] = queryRawMock.mock.calls[0];
    expect(sql).toContain('"title" ILIKE');
    expect(params).toContain("%ultrassom%");
  });
});

describe("searchCourses — semântico (com embeddings)", () => {
  beforeEach(() => {
    embeddingsEnabledMock.mockReturnValue(true);
    embedTextMock.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it("embeda a query e ordena por distância pgvector", async () => {
    await searchCourses("tenant-1", { query: "curso pra UTI" });
    expect(embedTextMock).toHaveBeenCalledWith("curso pra UTI");
    const [sql, ...params] = queryRawMock.mock.calls[0];
    expect(sql).toContain('"embedding" <=>');
    expect(sql).toContain("::vector");
    expect(params).toContain("[0.1,0.2,0.3]");
  });

  it("sem query cai no estrutural mesmo com embeddings ligados", async () => {
    await searchCourses("tenant-1", { area: "Nefrologia" });
    expect(embedTextMock).not.toHaveBeenCalled();
    const [sql] = queryRawMock.mock.calls[0];
    expect(sql).toContain('ORDER BY "number"');
  });

  it("respeita limit (clamp) no LIMIT do SQL", async () => {
    await searchCourses("tenant-1", { query: "x", limit: 3 });
    const [sql] = queryRawMock.mock.calls[0];
    expect(sql).toContain("LIMIT 3");
  });
});

describe("formatCoursesForPrompt", () => {
  it("monta linhas com título, área, valor e link", () => {
    const out = formatCoursesForPrompt([
      {
        id: "c1",
        number: 1,
        area: "Cardiologia",
        title: "Ecocardiografia",
        workload: "40 horas",
        priceRaw: "R$ 2.000,00",
        priceBrl: 2000,
        audience: "Cardiologistas",
        summary: "Curso prático.",
        url: "https://x/curso",
      },
    ]);
    expect(out).toContain("Ecocardiografia (Cardiologia)");
    expect(out).toContain("Valor: R$ 2.000,00");
    expect(out).toContain("https://x/curso");
  });
});
