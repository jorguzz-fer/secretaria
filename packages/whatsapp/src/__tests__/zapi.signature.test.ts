import { describe, it, expect } from "vitest";
import { createZapiAdapter } from "../adapters/zapi";

const adapter = createZapiAdapter({
  instanceId: "INST123",
  instanceToken: "TOK456",
  clientToken: "CLIENT789",
  instancePhone: "+5511964390121",
});

const body = (o: Record<string, unknown>) => JSON.stringify(o);

describe("zapi — verifyWebhookSignature", () => {
  it("aceita quando o instanceId do payload confere", async () => {
    const res = await adapter.verifyWebhookSignature({
      rawBody: body({ instanceId: "INST123", type: "ReceivedCallback" }),
      headers: {},
      secret: "",
    });
    expect(res.ok).toBe(true);
  });

  it("rejeita instanceId de outra instância", async () => {
    const res = await adapter.verifyWebhookSignature({
      rawBody: body({ instanceId: "OUTRA", type: "ReceivedCallback" }),
      headers: {},
      secret: "",
    });
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("instanceId") });
  });

  it("rejeita Client-Token divergente quando header presente e secret setado", async () => {
    const res = await adapter.verifyWebhookSignature({
      rawBody: body({ instanceId: "INST123" }),
      headers: { "client-token": "ERRADO" },
      secret: "CLIENT789",
    });
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("Client-Token") });
  });

  it("aceita Client-Token correto no header", async () => {
    const res = await adapter.verifyWebhookSignature({
      rawBody: body({ instanceId: "INST123" }),
      headers: { "client-token": "CLIENT789" },
      secret: "CLIENT789",
    });
    expect(res.ok).toBe(true);
  });

  it("rejeita body não-JSON", async () => {
    const res = await adapter.verifyWebhookSignature({
      rawBody: "xxx",
      headers: {},
      secret: "",
    });
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("JSON") });
  });
});
