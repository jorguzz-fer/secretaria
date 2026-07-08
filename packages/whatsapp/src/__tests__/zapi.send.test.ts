import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createZapiAdapter } from "../adapters/zapi";

const adapter = createZapiAdapter({
  instanceId: "INST123",
  instanceToken: "TOK456",
  clientToken: "CLIENT789",
  instancePhone: "+5511964390121",
});

const BASE_MSG = {
  tenantId: "t1",
  providerInstanceId: "INST123",
  toPhoneE164: "+5511999990000",
  externalEventId: "msg-uuid-1",
};

describe("zapi — sendMessage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chama o endpoint send-text com id+token na URL e Client-Token no header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ messageId: "ZWAMID1", zaapId: "z1" }), { status: 200 }),
    );

    await adapter.sendMessage({ ...BASE_MSG, content: { type: "text", text: "Olá João!" } });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.z-api.io/instances/INST123/token/TOK456/send-text",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Client-Token": "CLIENT789" }),
      }),
    );
  });

  it("manda phone só com dígitos e message no body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ messageId: "ZWAMID1" }), { status: 200 }),
    );

    await adapter.sendMessage({ ...BASE_MSG, content: { type: "text", text: "oi" } });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toEqual({ phone: "5511999990000", message: "oi" });
  });

  it("retorna messageId e status sent no sucesso", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ messageId: "ZWAMID1" }), { status: 200 }),
    );
    const res = await adapter.sendMessage({ ...BASE_MSG, content: { type: "text", text: "oi" } });
    expect(res).toEqual({ providerMessageId: "ZWAMID1", status: "sent" });
  });

  it("retorna failed em erro HTTP sem lançar", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("nope", { status: 401 }));
    const res = await adapter.sendMessage({ ...BASE_MSG, content: { type: "text", text: "oi" } });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("401");
  });

  it("retorna failed em erro de rede sem lançar", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    const res = await adapter.sendMessage({ ...BASE_MSG, content: { type: "text", text: "oi" } });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("network down");
  });

  it("lança em template (não suportado pela Z-API)", async () => {
    await expect(
      adapter.sendMessage({
        ...BASE_MSG,
        content: { type: "template", templateName: "x", locale: "pt_BR", variables: [] },
      }),
    ).rejects.toThrow(/template/i);
  });
});
