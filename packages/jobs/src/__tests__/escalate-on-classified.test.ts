import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@crm/db", () => ({
  prisma: {
    whatsAppConversation: { updateMany: vi.fn() },
  },
}));

vi.mock("@crm/config", () => ({ isModuleEnabled: vi.fn() }));

vi.mock("../client", () => ({
  inngest: { send: vi.fn(), createFunction: vi.fn(() => ({})) },
}));

import { handleEscalateOnClassified } from "../functions/escalate-on-classified";
import { prisma } from "@crm/db";
import { isModuleEnabled } from "@crm/config";

const updateMany = vi.mocked(prisma.whatsAppConversation.updateMany);
const modEnabled = vi.mocked(isModuleEnabled);

beforeEach(() => {
  vi.clearAllMocks();
  modEnabled.mockResolvedValue(true);
  updateMany.mockResolvedValue({ count: 1 } as never);
});

describe("handleEscalateOnClassified", () => {
  it("ignora quando o score não é HOT", async () => {
    const res = await handleEscalateOnClassified({ tenantId: "t1", leadId: "l1", score: "WARM" });
    expect(res).toEqual({ skipped: true, reason: "not_hot" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("gate: módulo 'escalada' desligado → não pausa", async () => {
    modEnabled.mockResolvedValueOnce(false);
    const res = await handleEscalateOnClassified({ tenantId: "t1", leadId: "l1", score: "HOT" });
    expect(res).toEqual({ skipped: true, reason: "module_disabled" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("HOT + módulo ligado → pausa a IA nas conversas do lead (scoped por tenant)", async () => {
    const res = await handleEscalateOnClassified({ tenantId: "t1", leadId: "l1", score: "HOT" });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t1", leadId: "l1", aiPaused: false },
        data: expect.objectContaining({ aiPaused: true, aiPausedReason: "lead_hot" }),
      }),
    );
    expect(res).toEqual({ skipped: false, paused: 1 });
  });

  it("idempotente: só pausa conversas ainda não pausadas (aiPaused=false no where)", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 } as never);
    const res = await handleEscalateOnClassified({ tenantId: "t1", leadId: "l1", score: "HOT" });
    expect(res).toEqual({ skipped: false, paused: 0 });
  });
});
