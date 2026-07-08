import { vi, describe, it, expect, beforeEach } from "vitest";

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));

vi.mock("@crm/db", () => ({
  prisma: {
    whatsAppConversation: { findFirst: vi.fn() },
    whatsAppMessage: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@crm/ai", () => ({ generateReply: vi.fn() }));

vi.mock("@crm/config", () => ({ isModuleEnabled: vi.fn() }));

vi.mock("@crm/whatsapp", () => ({
  createEvolutionAdapter: vi.fn(() => ({
    provider: "evolution",
    sendMessage: sendMessageMock,
    verifyWebhookSignature: vi.fn(),
    parseInbound: vi.fn(),
  })),
  createZapiAdapter: vi.fn(() => ({
    provider: "zapi",
    sendMessage: sendMessageMock,
    verifyWebhookSignature: vi.fn(),
    parseInbound: vi.fn(),
  })),
}));

vi.mock("../client", () => ({
  inngest: { send: vi.fn(), createFunction: vi.fn(() => ({})) },
}));

import { handleRespondOnMessage } from "../functions/respond-on-message";
import { prisma } from "@crm/db";
import { generateReply } from "@crm/ai";
import { isModuleEnabled } from "@crm/config";

const findFirst = vi.mocked(prisma.whatsAppConversation.findFirst);
const findMany = vi.mocked(prisma.whatsAppMessage.findMany);
const createMsg = vi.mocked(prisma.whatsAppMessage.create);
const genReply = vi.mocked(generateReply);
const modEnabled = vi.mocked(isModuleEnabled);

const baseEvent = {
  tenantId: "tenant-1",
  conversationId: "conv-1",
  messageId: "wamid-1",
  content: { type: "text", body: "Qual o valor?" },
};

const mockConversation = {
  id: "conv-1",
  remotePhone: "5511999990000",
  remoteName: "Ana",
  lead: { id: "lead-1", name: "Ana", phone: "+5511999990000" },
  instance: {
    instanceName: "inst-1",
    provider: "EVOLUTION",
    phone: "+5511000000001",
    status: "CONNECTED",
  },
};

const history = [{ fromMe: false, body: "Qual o valor?", timestamp: new Date() }];

beforeEach(() => {
  vi.clearAllMocks();
  modEnabled.mockResolvedValue(true);
  findFirst.mockResolvedValue(mockConversation as never);
  findMany.mockResolvedValue(history as never);
  createMsg.mockResolvedValue({} as never);
  genReply.mockResolvedValue({
    message: "O investimento varia conforme a turma. Posso te passar as opções?",
    shouldEscalate: false,
    escalationReason: null,
  });
});

describe("handleRespondOnMessage", () => {
  it("gate: módulo 'secretaria' desligado → skip sem gerar/enviar", async () => {
    modEnabled.mockResolvedValueOnce(false);
    const res = await handleRespondOnMessage(baseEvent);
    expect(res).toEqual({ skipped: true, reason: "module_disabled" });
    expect(genReply).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("ignora conteúdo não-texto (mídia)", async () => {
    const res = await handleRespondOnMessage({
      ...baseEvent,
      content: { type: "image" },
    });
    expect(res).toEqual({ skipped: true, reason: "unsupported_content" });
    expect(genReply).not.toHaveBeenCalled();
  });

  it("skip quando não há conversa", async () => {
    findFirst.mockResolvedValueOnce(null);
    const res = await handleRespondOnMessage(baseEvent);
    expect(res).toEqual({ skipped: true, reason: "no_conversation" });
  });

  it("skip quando a instância não está conectada", async () => {
    findFirst.mockResolvedValueOnce({
      ...mockConversation,
      instance: { ...mockConversation.instance, status: "DISCONNECTED" },
    } as never);
    const res = await handleRespondOnMessage(baseEvent);
    expect(res).toEqual({ skipped: true, reason: "instance_not_connected" });
  });

  it("happy path: gera resposta, envia pelo adapter e persiste (fromMe=true)", async () => {
    const res = await handleRespondOnMessage(baseEvent);

    expect(genReply).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        leadId: "lead-1",
        channel: "whatsapp",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "lead", content: "Qual o valor?" }),
        ]),
      }),
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        toPhoneE164: "+5511999990000",
        content: { type: "text", text: expect.stringContaining("investimento") },
      }),
    );
    expect(createMsg).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromMe: true, body: expect.any(String) }),
      }),
    );
    expect(res).toMatchObject({ skipped: false, escalated: false });
  });

  it("escalada: shouldEscalate=true → NÃO envia nem persiste, deixa pro humano", async () => {
    genReply.mockResolvedValueOnce({
      message: "Vou te transferir para um consultor.",
      shouldEscalate: true,
      escalationReason: "lead pediu humano",
    });
    const res = await handleRespondOnMessage(baseEvent);
    expect(res).toEqual({ skipped: false, escalated: true });
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(createMsg).not.toHaveBeenCalled();
  });

  it("tenant isolation: findFirst usa tenantId + id da conversa", async () => {
    findFirst.mockResolvedValueOnce(null);
    await handleRespondOnMessage({ ...baseEvent, tenantId: "tenant-Z" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-Z", id: "conv-1" }),
      }),
    );
  });
});
