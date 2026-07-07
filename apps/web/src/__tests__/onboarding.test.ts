/**
 * Testes (Prisma mockado) para o core onboardTenant.
 * Verifica: cria tenant + linhas de módulo default + pipeline/estágios base.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { txMock } = vi.hoisted(() => ({
  txMock: {
    tenant: { create: vi.fn() },
    tenantModule: { createMany: vi.fn() },
    pipeline: { create: vi.fn() },
    stage: { createMany: vi.fn() },
  },
}));

vi.mock("@crm/db", () => ({
  prisma: {
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  },
  Prisma: {},
}));

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), getClientIp: vi.fn(() => null) }));

import { onboardTenant } from "@/lib/onboarding";
import { logAudit } from "@/lib/audit";
import { MODULE_KEYS, MODULES } from "@crm/config";

beforeEach(() => {
  vi.clearAllMocks();
  txMock.tenant.create.mockResolvedValue({ id: "tenant-new", slug: "acme-novo" });
  txMock.tenantModule.createMany.mockResolvedValue({ count: MODULE_KEYS.length });
  txMock.pipeline.create.mockResolvedValue({ id: "pipeline-1" });
  txMock.stage.createMany.mockResolvedValue({ count: 5 });
});

describe("onboardTenant", () => {
  it("cria o tenant com name/slug", async () => {
    const res = await onboardTenant({ name: "Acme Novo", slug: "acme-novo" });
    expect(txMock.tenant.create).toHaveBeenCalledWith({
      data: { name: "Acme Novo", slug: "acme-novo" },
    });
    expect(res).toEqual({ tenantId: "tenant-new", slug: "acme-novo" });
  });

  it("cria uma linha de TenantModule por módulo com o defaultEnabled do registro", async () => {
    await onboardTenant({ name: "Acme Novo", slug: "acme-novo" });

    expect(txMock.tenantModule.createMany).toHaveBeenCalledTimes(1);
    const arg = txMock.tenantModule.createMany.mock.calls[0][0] as {
      data: { tenantId: string; moduleKey: string; enabled: boolean }[];
    };
    expect(arg.data).toHaveLength(MODULE_KEYS.length);

    // Todos scoped ao novo tenant
    expect(arg.data.every((r) => r.tenantId === "tenant-new")).toBe(true);

    // enabled reflete o default do registro (Voz/Cobrança = false)
    for (const key of MODULE_KEYS) {
      const row = arg.data.find((r) => r.moduleKey === key)!;
      expect(row.enabled).toBe(MODULES[key].defaultEnabled);
    }
    const voz = arg.data.find((r) => r.moduleKey === "voz")!;
    expect(voz.enabled).toBe(false);
  });

  it("cria pipeline default + 5 estágios base scoped ao tenant", async () => {
    await onboardTenant({ name: "Acme Novo", slug: "acme-novo" });

    expect(txMock.pipeline.create).toHaveBeenCalledWith({
      data: { tenantId: "tenant-new", name: "Pipeline Principal", isDefault: true },
    });

    const stageArg = txMock.stage.createMany.mock.calls[0][0] as {
      data: { tenantId: string; pipelineId: string; order: number }[];
    };
    expect(stageArg.data).toHaveLength(5);
    expect(stageArg.data.every((s) => s.tenantId === "tenant-new")).toBe(true);
    expect(stageArg.data.every((s) => s.pipelineId === "pipeline-1")).toBe(true);
    expect(stageArg.data.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("grava AuditLog do onboarding", async () => {
    await onboardTenant({ name: "Acme Novo", slug: "acme-novo" }, { actorUserId: "su-1" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-new",
        userId: "su-1",
        action: "tenant.onboard",
        entity: "Tenant",
      }),
    );
  });

  it("rejeita slug inválido (Zod) antes de tocar o banco", async () => {
    await expect(onboardTenant({ name: "X", slug: "Slug Inválido!" })).rejects.toThrow();
    expect(txMock.tenant.create).not.toHaveBeenCalled();
  });
});
