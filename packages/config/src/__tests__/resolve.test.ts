import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@crm/db", () => ({
  prisma: {
    tenantModule: { findUnique: vi.fn() },
  },
}));

import { getTenantConfig, isModuleEnabled, resolveModule } from "../resolve";
import { prisma } from "@crm/db";

const findUnique = vi.mocked(prisma.tenantModule.findUnique);

beforeEach(() => {
  findUnique.mockReset();
});

describe("getTenantConfig", () => {
  it("sem linha no banco → defaults do schema", async () => {
    findUnique.mockResolvedValueOnce(null);
    const config = await getTenantConfig("t1", "recuperacao");
    expect(config).toEqual({ sequenceDays: [1, 3, 7], stopOnReply: true });
  });

  it("faz merge de override parcial com defaults", async () => {
    findUnique.mockResolvedValueOnce({ settings: { sequenceDays: [2, 4] } } as never);
    const config = await getTenantConfig("t1", "recuperacao");
    // sequenceDays override; stopOnReply preenchido pelo default
    expect(config).toEqual({ sequenceDays: [2, 4], stopOnReply: true });
  });

  it("valida com Zod: settings inválido no banco lança", async () => {
    findUnique.mockResolvedValueOnce({ settings: { sequenceDays: [5, 1] } } as never);
    await expect(getTenantConfig("t1", "recuperacao")).rejects.toThrow();
  });

  it("scoping: consulta usa tenantId + moduleKey", async () => {
    findUnique.mockResolvedValueOnce(null);
    await getTenantConfig("tenant-X", "recuperacao");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_moduleKey: { tenantId: "tenant-X", moduleKey: "recuperacao" } },
      }),
    );
  });
});

describe("isModuleEnabled", () => {
  it("sem linha → defaultEnabled do registro (recuperacao=true)", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await isModuleEnabled("t1", "recuperacao")).toBe(true);
  });

  it("sem linha → Voz e Cobrança default false", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await isModuleEnabled("t1", "voz")).toBe(false);
    findUnique.mockResolvedValueOnce(null);
    expect(await isModuleEnabled("t1", "cobranca")).toBe(false);
  });

  it("override do banco tem prioridade sobre o default", async () => {
    findUnique.mockResolvedValueOnce({ enabled: false } as never);
    expect(await isModuleEnabled("t1", "recuperacao")).toBe(false);

    findUnique.mockResolvedValueOnce({ enabled: true } as never);
    expect(await isModuleEnabled("t1", "voz")).toBe(true);
  });
});

describe("resolveModule", () => {
  it("retorna enabled + config numa leitura", async () => {
    findUnique.mockResolvedValueOnce({
      enabled: false,
      settings: { sequenceDays: [1, 2, 3] },
    } as never);
    const { enabled, config } = await resolveModule("t1", "recuperacao");
    expect(enabled).toBe(false);
    expect(config.sequenceDays).toEqual([1, 2, 3]);
  });

  it("faz uma única query ao banco", async () => {
    findUnique.mockResolvedValueOnce(null);
    await resolveModule("t1", "recuperacao");
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
