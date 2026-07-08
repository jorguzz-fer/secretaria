import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mirrorInboundToChatwoot, isChatwootConfigured } from "@/lib/chatwoot";

const ENV = {
  CHATWOOT_URL: "https://chat.example.com",
  CHATWOOT_ACCOUNT_ID: "7",
  CHATWOOT_INBOX_ID: "3",
  CHATWOOT_API_TOKEN: "cw-token",
};

const INPUT = {
  fromPhoneE164: "+5511999990000",
  fromName: "Ana",
  content: "Olá!",
  externalMessageId: "wamid-1",
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("isChatwootConfigured", () => {
  beforeEach(() => {
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  it("false quando falta config", () => {
    expect(isChatwootConfigured()).toBe(false);
  });

  it("true quando todas as vars presentes", () => {
    Object.assign(process.env, ENV);
    expect(isChatwootConfigured()).toBe(true);
    for (const k of Object.keys(ENV)) delete process.env[k];
  });
});

describe("mirrorInboundToChatwoot", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  it("no-op (skipped) quando não configurado", async () => {
    const res = await mirrorInboundToChatwoot(INPUT);
    expect(res).toEqual({ status: "skipped", reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("happy path: cria contato → conversa → mensagem incoming", async () => {
    Object.assign(process.env, ENV);
    vi.mocked(fetch)
      .mockResolvedValueOnce(ok({ payload: { contact: { id: 42 }, contact_inbox: { source_id: "src-9" } } }))
      .mockResolvedValueOnce(ok({ id: 100 }))
      .mockResolvedValueOnce(ok({ id: 555 }));

    const res = await mirrorInboundToChatwoot(INPUT);
    expect(res).toEqual({ status: "sent", conversationId: 100 });

    const calls = vi.mocked(fetch).mock.calls;
    // 1) contato
    expect(calls[0][0]).toBe("https://chat.example.com/api/v1/accounts/7/contacts");
    expect(JSON.parse(calls[0][1]!.body as string)).toMatchObject({
      inbox_id: 3,
      phone_number: "+5511999990000",
      identifier: "5511999990000",
    });
    // 2) conversa usa source_id do contato
    expect(calls[1][0]).toBe("https://chat.example.com/api/v1/accounts/7/conversations");
    expect(JSON.parse(calls[1][1]!.body as string)).toEqual({
      source_id: "src-9",
      inbox_id: 3,
      contact_id: 42,
    });
    // 3) mensagem incoming
    expect(calls[2][0]).toBe("https://chat.example.com/api/v1/accounts/7/conversations/100/messages");
    expect(JSON.parse(calls[2][1]!.body as string)).toEqual({
      content: "Olá!",
      message_type: "incoming",
    });
    // auth header
    expect((calls[0][1]!.headers as Record<string, string>).api_access_token).toBe("cw-token");
  });

  it("contato duplicado (422) → busca e reaproveita source_id", async () => {
    Object.assign(process.env, ENV);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("exists", { status: 422 }))
      .mockResolvedValueOnce(
        ok({ payload: [{ id: 7, contact_inboxes: [{ source_id: "src-x", inbox: { id: 3 } }] }] }),
      )
      .mockResolvedValueOnce(ok({ id: 200 }))
      .mockResolvedValueOnce(ok({ id: 999 }));

    const res = await mirrorInboundToChatwoot(INPUT);
    expect(res).toEqual({ status: "sent", conversationId: 200 });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string)).toMatchObject({
      source_id: "src-x",
      contact_id: 7,
    });
  });

  it("falha de API → status failed, sem lançar", async () => {
    Object.assign(process.env, ENV);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const res = await mirrorInboundToChatwoot(INPUT);
    expect(res.status).toBe("failed");
  });
});
