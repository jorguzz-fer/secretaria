import { describe, it, expect } from "vitest";
import { createZapiAdapter } from "../adapters/zapi";

const adapter = createZapiAdapter({
  instanceId: "INST123",
  instanceToken: "TOK456",
  clientToken: "CLIENT789",
  instancePhone: "+5511964390121",
});

function received(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "ReceivedCallback",
    instanceId: "INST123",
    messageId: "3EB0MSG1",
    phone: "5511999990000",
    fromMe: false,
    isGroup: false,
    momment: 1_700_000_000_000,
    senderName: "Ana",
    ...overrides,
  });
}

describe("zapi — parseInbound", () => {
  it("parseia mensagem de texto com from/to/timestamp corretos", async () => {
    const [msg] = await adapter.parseInbound(received({ text: { message: "Olá!" } }));
    expect(msg).toMatchObject({
      providerInstanceId: "INST123",
      externalMessageId: "3EB0MSG1",
      from: { phoneE164: "+5511999990000", name: "Ana" },
      to: { phoneE164: "+5511964390121" },
      message: { type: "text", text: "Olá!" },
      ctwaClid: null,
    });
    // momment em ms → Date correta
    expect(msg.receivedAt.getTime()).toBe(1_700_000_000_000);
  });

  it("parseia imagem com legenda", async () => {
    const [msg] = await adapter.parseInbound(
      received({ image: { imageUrl: "https://cdn.z-api/i.jpg", caption: "olha" } }),
    );
    expect(msg.message).toEqual({
      type: "image",
      mediaUrl: "https://cdn.z-api/i.jpg",
      caption: "olha",
    });
  });

  it("parseia áudio e documento", async () => {
    const [a] = await adapter.parseInbound(
      received({ audio: { audioUrl: "https://cdn.z-api/a.ogg" } }),
    );
    expect(a.message).toMatchObject({ type: "audio", mediaUrl: "https://cdn.z-api/a.ogg" });

    const [d] = await adapter.parseInbound(
      received({ document: { documentUrl: "https://cdn.z-api/d.pdf", fileName: "contrato.pdf" } }),
    );
    expect(d.message).toEqual({
      type: "document",
      mediaUrl: "https://cdn.z-api/d.pdf",
      filename: "contrato.pdf",
    });
  });

  it("ignora mensagens próprias (fromMe)", async () => {
    const out = await adapter.parseInbound(received({ fromMe: true, text: { message: "eu" } }));
    expect(out).toEqual([]);
  });

  it("ignora grupos", async () => {
    const out = await adapter.parseInbound(received({ isGroup: true, text: { message: "grupo" } }));
    expect(out).toEqual([]);
  });

  it("ignora callbacks que não são de recebimento", async () => {
    const out = await adapter.parseInbound(
      JSON.stringify({ type: "MessageStatusCallback", instanceId: "INST123", status: "READ" }),
    );
    expect(out).toEqual([]);
  });

  it("ignora payload sem conteúdo reconhecível", async () => {
    const out = await adapter.parseInbound(received({}));
    expect(out).toEqual([]);
  });

  it("retorna [] em JSON inválido (não lança)", async () => {
    expect(await adapter.parseInbound("not-json")).toEqual([]);
  });

  it("descarta telefone inválido", async () => {
    const out = await adapter.parseInbound(received({ phone: "123", text: { message: "x" } }));
    expect(out).toEqual([]);
  });
});
