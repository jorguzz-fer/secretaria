import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@crm/db", () => ({
  prisma: {
    whatsAppConversation: { findFirst: vi.fn() },
    whatsAppMessage: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@crm/ai", () => ({
  generateFollowUp: vi.fn(),
}));

vi.mock("@crm/whatsapp", () => ({
  createEvolutionAdapter: vi.fn(() => ({
    provider: "evolution",
    sendMessage: vi.fn().mockResolvedValue({ providerMessageId: "wamid-fu-1", status: "sent" }),
    verifyWebhookSignature: vi.fn(),
    parseInbound: vi.fn(),
  })),
  createZapiAdapter: vi.fn(() => ({
    provider: "zapi",
    sendMessage: vi.fn().mockResolvedValue({ providerMessageId: "zwamid-fu-1", status: "sent" }),
    verifyWebhookSignature: vi.fn(),
    parseInbound: vi.fn(),
  })),
}));

vi.mock("@crm/config", () => ({
  isModuleEnabled: vi.fn().mockResolvedValue(true),
  resolveModule: vi.fn().mockResolvedValue({
    enabled: true,
    config: { sequenceDays: [1, 3, 7], stopOnReply: true },
  }),
}));

vi.mock("../client", () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(() => ({})),
  },
}));

import { handleFollowup, resolveFollowupPlan } from "../functions/followup-sequence";
import { prisma } from "@crm/db";
import { generateFollowUp } from "@crm/ai";
import { isModuleEnabled, resolveModule } from "@crm/config";
import { inngest } from "../client";

const baseEvent = {
  tenantId: "tenant-1",
  leadId: "lead-1",
  sequenceId: "seq-abc",
  nextStepAt: new Date(Date.now() + 86400_000).toISOString(),
};

const mockConversation = {
  id: "conv-1",
  instanceId: "inst-1",
  remotePhone: "5511999990000",
  lead: { id: "lead-1", name: "Ana", phone: "+5511999990000" },
  instance: {
    instanceName: "inst-tenant-1",
    provider: "EVOLUTION",
    phone: "+5511000000001",
    status: "CONNECTED",
  },
};

const mockMessages = [
  { fromMe: true, body: "Oi Ana! Vi que você tem interesse...", timestamp: new Date() },
];

const continueFollowUp = {
  message: "Ana, tudo bem? Queria saber se teve chance de ver o material.",
  shouldEscalate: false,
  nextAttemptHours: 48,
};

const escalateFollowUp = {
  message: "Ana, vou te colocar em contato com um de nossos consultores.",
  shouldEscalate: true,
  nextAttemptHours: null,
};

describe("handleFollowup", () => {
  beforeEach(() => {
    vi.mocked(prisma.whatsAppConversation.findFirst).mockReset();
    vi.mocked(prisma.whatsAppMessage.findMany).mockReset();
    vi.mocked(prisma.whatsAppMessage.create).mockReset();
    vi.mocked(generateFollowUp).mockReset();
    vi.mocked(inngest.send).mockReset();
    vi.mocked(isModuleEnabled).mockReset();
    vi.mocked(isModuleEnabled).mockResolvedValue(true);
    vi.mocked(resolveModule).mockReset();
    vi.mocked(resolveModule).mockResolvedValue({
      enabled: true,
      config: { sequenceDays: [1, 3, 7], stopOnReply: true },
    } as never);
  });

  it("retorna skipped=true quando lead não tem conversa WA ativa", async () => {
    vi.mocked(prisma.whatsAppConversation.findFirst).mockResolvedValueOnce(null);

    const result = await handleFollowup(baseEvent, 1);
    expect(result.skipped).toBe(true);
    expect(generateFollowUp).not.toHaveBeenCalled();
  });

  it("chama generateFollowUp com attempt e histórico de mensagens", async () => {
    vi.mocked(prisma.whatsAppConversation.findFirst).mockResolvedValueOnce(
      mockConversation as never,
    );
    vi.mocked(prisma.whatsAppMessage.findMany).mockResolvedValueOnce(mockMessages as never);
    vi.mocked(prisma.whatsAppMessage.create).mockResolvedValueOnce({} as never);
    vi.mocked(generateFollowUp).mockResolvedValueOnce(continueFollowUp);
    vi.mocked(inngest.send).mockResolvedValueOnce({} as never);

    await handleFollowup(baseEvent, 2);

    expect(generateFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        leadId: "lead-1",
        attempt: 2,
        previousMessages: expect.arrayContaining([
          expect.objectContaining({ role: "sdr", content: expect.any(String) }),
        ]),
      }),
    );
  });

  it("salva mensagem de follow-up no DB com fromMe=true", async () => {
    vi.mocked(prisma.whatsAppConversation.findFirst).mockResolvedValueOnce(
      mockConversation as never,
    );
    vi.mocked(prisma.whatsAppMessage.findMany).mockResolvedValueOnce(mockMessages as never);
    vi.mocked(prisma.whatsAppMessage.create).mockResolvedValueOnce({} as never);
    vi.mocked(generateFollowUp).mockResolvedValueOnce(continueFollowUp);
    vi.mocked(inngest.send).mockResolvedValueOnce({} as never);

    await handleFollowup(baseEvent, 1);

    expect(prisma.whatsAppMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          fromMe: true,
          body: continueFollowUp.message,
        }),
      }),
    );
  });

  it("emite followup/scheduled para próximo attempt quando shouldEscalate=false", async () => {
    vi.mocked(prisma.whatsAppConversation.findFirst).mockResolvedValueOnce(
      mockConversation as never,
    );
    vi.mocked(prisma.whatsAppMessage.findMany).mockResolvedValueOnce(mockMessages as never);
    vi.mocked(prisma.whatsAppMessage.create).mockResolvedValueOnce({} as never);
    vi.mocked(generateFollowUp).mockResolvedValueOnce(continueFollowUp);
    vi.mocked(inngest.send).mockResolvedValueOnce({} as never);

    const result = await handleFollowup(baseEvent, 1);
    if (result.skipped) throw new Error("expected result not skipped");

    expect(result.shouldEscalate).toBe(false);
    expect(result.nextAttemptHours).toBe(48);
    // Inngest function will schedule next step via step.sleep — not done here
  });

  it("não emite followup quando shouldEscalate=true (attempt final)", async () => {
    vi.mocked(prisma.whatsAppConversation.findFirst).mockResolvedValueOnce(
      mockConversation as never,
    );
    vi.mocked(prisma.whatsAppMessage.findMany).mockResolvedValueOnce(mockMessages as never);
    vi.mocked(prisma.whatsAppMessage.create).mockResolvedValueOnce({} as never);
    vi.mocked(generateFollowUp).mockResolvedValueOnce(escalateFollowUp);

    const result = await handleFollowup(baseEvent, 5);
    if (result.skipped) throw new Error("expected result not skipped");

    expect(result.shouldEscalate).toBe(true);
    expect(result.nextAttemptHours).toBeNull();
  });

  it("tenant isolation: findFirst da conversa usa tenantId no where", async () => {
    vi.mocked(prisma.whatsAppConversation.findFirst).mockResolvedValueOnce(null);

    await handleFollowup({ ...baseEvent, tenantId: "tenant-Y" }, 1);

    expect(prisma.whatsAppConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-Y", leadId: "lead-1" }),
      }),
    );
  });

  it("gate: módulo 'recuperacao' desligado → skipped=module_disabled sem efeitos colaterais", async () => {
    vi.mocked(isModuleEnabled).mockResolvedValueOnce(false);

    const result = await handleFollowup(baseEvent, 1);

    expect(result.skipped).toBe(true);
    if (result.skipped) expect(result.reason).toBe("module_disabled");
    // Não toca conversa, não gera IA, não grava mensagem.
    expect(prisma.whatsAppConversation.findFirst).not.toHaveBeenCalled();
    expect(generateFollowUp).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessage.create).not.toHaveBeenCalled();
  });

  it("checa o toggle scoped por tenantId derivado do evento", async () => {
    vi.mocked(isModuleEnabled).mockResolvedValueOnce(false);
    await handleFollowup({ ...baseEvent, tenantId: "tenant-Z" }, 1);
    expect(isModuleEnabled).toHaveBeenCalledWith("tenant-Z", "recuperacao");
  });

  it("propaga erro do AI SDK sem engolir", async () => {
    vi.mocked(prisma.whatsAppConversation.findFirst).mockResolvedValueOnce(
      mockConversation as never,
    );
    vi.mocked(prisma.whatsAppMessage.findMany).mockResolvedValueOnce(mockMessages as never);
    vi.mocked(generateFollowUp).mockRejectedValueOnce(new Error("AI timeout"));

    await expect(handleFollowup(baseEvent, 1)).rejects.toThrow(/AI timeout/);
    expect(prisma.whatsAppMessage.create).not.toHaveBeenCalled();
  });
});

describe("resolveFollowupPlan", () => {
  beforeEach(() => {
    vi.mocked(resolveModule).mockReset();
  });

  it("lê a cadência configurada do tenant (não a constante [1,3,7])", async () => {
    vi.mocked(resolveModule).mockResolvedValueOnce({
      enabled: true,
      config: { sequenceDays: [2, 5, 12], stopOnReply: true },
    } as never);

    const plan = await resolveFollowupPlan("tenant-custom");

    expect(resolveModule).toHaveBeenCalledWith("tenant-custom", "recuperacao");
    expect(plan).toEqual({ enabled: true, sequenceDays: [2, 5, 12] });
  });

  it("reflete o toggle desabilitado do tenant", async () => {
    vi.mocked(resolveModule).mockResolvedValueOnce({
      enabled: false,
      config: { sequenceDays: [1, 3, 7], stopOnReply: true },
    } as never);

    const plan = await resolveFollowupPlan("tenant-off");
    expect(plan.enabled).toBe(false);
  });
});
