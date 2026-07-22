import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de todas as dependências da rota antes do import.
vi.mock("@/lib/db", () => ({
  prisma: {
    whatsAppInstance: { findUnique: vi.fn(), update: vi.fn() },
    whatsAppConversation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    whatsAppMessage: { create: vi.fn(), deleteMany: vi.fn() },
    lead: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    contact: { findFirst: vi.fn() },
  },
}));

const { detectProviderMock, handleWebhookMock, sendMessageMock } = vi.hoisted(() => ({
  detectProviderMock: vi.fn(),
  handleWebhookMock: vi.fn(),
  sendMessageMock: vi.fn(),
}));

vi.mock("@crm/whatsapp", () => ({
  detectProvider: detectProviderMock,
  handleWebhook: handleWebhookMock,
  createZapiAdapter: vi.fn(() => ({ provider: "zapi", sendMessage: sendMessageMock })),
  createEvolutionAdapter: vi.fn(() => ({ provider: "evolution", sendMessage: sendMessageMock })),
}));

const { inngestSendMock } = vi.hoisted(() => ({ inngestSendMock: vi.fn() }));
vi.mock("@crm/jobs", () => ({ inngest: { send: inngestSendMock } }));

vi.mock("@/lib/chatwoot", () => ({
  mirrorInboundToChatwoot: vi.fn(async () => ({ status: "skipped" })),
}));

import { POST } from "@/app/api/webhooks/whatsapp/route";
import { prisma } from "@/lib/db";

const inst = vi.mocked(prisma.whatsAppInstance);
const conv = vi.mocked(prisma.whatsAppConversation);
const lead = vi.mocked(prisma.lead);
const contact = vi.mocked(prisma.contact);
const msg = vi.mocked(prisma.whatsAppMessage);

function req(body: unknown) {
  return new Request("https://app.example.com/api/webhooks/whatsapp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const inboundMsg = {
  externalMessageId: "wamid-1",
  receivedAt: new Date("2026-07-15T19:36:13Z"),
  from: { phoneE164: "+5511989940404", name: "Ana" },
  message: { type: "text" as const, text: "Ola" },
};

beforeEach(() => {
  vi.clearAllMocks();
  detectProviderMock.mockReturnValue({ provider: "zapi", instanceKey: "inst-1" });
  handleWebhookMock.mockResolvedValue({ status: 200, messages: [inboundMsg] });
  inst.findUnique.mockResolvedValue({
    id: "wai-1",
    tenantId: "tenant-1",
    phone: "+5511000000001",
    status: "DISCONNECTED",
  } as never);
  inst.update.mockResolvedValue({} as never);
  conv.findUnique.mockResolvedValue(null); // conversa nova
  conv.create.mockResolvedValue({ id: "conv-1" } as never);
  conv.update.mockResolvedValue({} as never);
  lead.findFirst.mockResolvedValue(null);
  lead.create.mockResolvedValue({ id: "lead-new" } as never);
  contact.findFirst.mockResolvedValue(null);
  msg.create.mockResolvedValue({} as never);
  msg.deleteMany.mockResolvedValue({ count: 0 } as never);
  lead.update.mockResolvedValue({} as never);
  sendMessageMock.mockResolvedValue({} as never);
});

describe("POST /api/webhooks/whatsapp — z-api ReceivedCallback", () => {
  it("self-heal: marca instância DISCONNECTED como CONNECTED ao receber mensagem", async () => {
    // body precisa ter type ReceivedCallback pra passar do guard do z-api
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    expect(inst.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wai-1" },
        data: expect.objectContaining({ status: "CONNECTED" }),
      }),
    );
  });

  it("não reescreve status quando já CONNECTED (idempotente)", async () => {
    inst.findUnique.mockResolvedValueOnce({
      id: "wai-1",
      tenantId: "tenant-1",
      phone: "+5511000000001",
      status: "CONNECTED",
    } as never);
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    expect(inst.update).not.toHaveBeenCalled();
  });

  it("número novo (sem lead nem contato): cria Lead e vincula à conversa", async () => {
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    expect(lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          name: "Ana",
          phone: "+5511989940404",
          source: "WHATSAPP",
        }),
      }),
    );
    expect(conv.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadId: "lead-new" }),
      }),
    );
  });

  it("lead sem nome usa o telefone como nome", async () => {
    handleWebhookMock.mockResolvedValueOnce({
      status: 200,
      messages: [{ ...inboundMsg, from: { phoneE164: "+5511989940404", name: undefined } }],
    });
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    expect(lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "+5511989940404" }),
      }),
    );
  });

  it("já existe lead pelo telefone: NÃO cria lead novo, reusa o existente", async () => {
    lead.findFirst.mockResolvedValueOnce({ id: "lead-existente" } as never);
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    expect(lead.create).not.toHaveBeenCalled();
    expect(conv.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ leadId: "lead-existente" }) }),
    );
  });

  it("self-heal de conversa órfã: existente sem leadId cria lead e vincula", async () => {
    conv.findUnique.mockResolvedValueOnce({
      id: "conv-existente",
      leadId: null,
      contactId: null,
      remoteName: "Ana",
      unreadCount: 2,
    } as never);
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    expect(lead.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "WHATSAPP" }) }),
    );
    expect(conv.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-existente" },
        data: expect.objectContaining({ leadId: "lead-new" }),
      }),
    );
    expect(conv.create).not.toHaveBeenCalled();
  });

  it("conversa existente que JÁ tem lead: não cria nem revincula", async () => {
    conv.findUnique.mockResolvedValueOnce({
      id: "conv-existente",
      leadId: "lead-antigo",
      contactId: null,
      remoteName: "Ana",
      unreadCount: 2,
    } as never);
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    expect(lead.create).not.toHaveBeenCalled();
    expect(lead.findFirst).not.toHaveBeenCalled();
  });

  it("dispara evento message/received para a IA", async () => {
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    expect(inngestSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "message/received",
        data: expect.objectContaining({ tenantId: "tenant-1", conversationId: "conv-1" }),
      }),
    );
  });
});

describe("comando secreto /reset", () => {
  const resetMsg = { ...inboundMsg, message: { type: "text" as const, text: "/reset" } };

  beforeEach(() => {
    handleWebhookMock.mockResolvedValue({ status: 200, messages: [resetMsg] });
  });

  it("conversa existente: apaga histórico, despausa e reseta o lead — sem IA", async () => {
    conv.findUnique.mockResolvedValueOnce({
      id: "conv-existente",
      leadId: "lead-1",
      contactId: null,
      remoteName: "Ana",
      unreadCount: 5,
      aiPaused: true,
    } as never);

    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));

    expect(msg.deleteMany).toHaveBeenCalledWith({ where: { conversationId: "conv-existente" } });
    expect(conv.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-existente" },
        data: expect.objectContaining({ aiPaused: false }),
      }),
    );
    expect(lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "lead-1" },
        data: expect.objectContaining({ score: null, scoreLabel: null, status: "NOVO" }),
      }),
    );
    // confirma por mensagem e NÃO aciona a IA
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: { type: "text", text: expect.stringContaining("reiniciado") } }),
    );
    expect(inngestSendMock).not.toHaveBeenCalled();
    expect(msg.create).not.toHaveBeenCalled();
  });

  it("número sem conversa: só confirma, nada a resetar, sem IA", async () => {
    conv.findUnique.mockResolvedValueOnce(null);
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    expect(msg.deleteMany).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalled();
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("com WHATSAPP_RESET_SECRET setado, /reset puro NÃO dispara (segue como msg normal)", async () => {
    process.env.WHATSAPP_RESET_SECRET = "abc";
    conv.findUnique.mockResolvedValueOnce(null);
    await POST(req({ type: "ReceivedCallback", phone: "5511989940404" }));
    // sem o segredo correto, /reset é tratado como mensagem normal → cria conversa + dispara IA
    expect(msg.deleteMany).not.toHaveBeenCalled();
    expect(inngestSendMock).toHaveBeenCalled();
    delete process.env.WHATSAPP_RESET_SECRET;
  });
});
