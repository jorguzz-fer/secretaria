/**
 * Forwarder Chatwoot — espelha mensagens WhatsApp recebidas (inbound) num
 * inbox do tipo **API** do Chatwoot.
 *
 * Arquitetura (opção "a"): nosso app é o receptor do Z-API (roda IA/SDR +
 * tracking) e envia uma **cópia** de cada mensagem recebida pro Chatwoot, que
 * serve de inbox humano. O Chatwoot NÃO fala com o Z-API direto.
 *
 * Config por env (o forwarder é no-op enquanto não estiver configurado):
 *   CHATWOOT_URL         ex: https://chatwoot.tudomudou.com.br
 *   CHATWOOT_ACCOUNT_ID  id numérico da conta
 *   CHATWOOT_INBOX_ID    id do inbox tipo API onde espelhar
 *   CHATWOOT_API_TOKEN   access token de um agente/bot (header api_access_token)
 *
 * ⚠️ O ciclo contato→conversa→mensagem segue a Application API do Chatwoot e
 * ainda precisa ser validado contra a instância real. É best-effort: qualquer
 * falha é engolida (log) para nunca quebrar o 200 do webhook do Z-API.
 */

interface ChatwootConfig {
  url: string;
  accountId: string;
  inboxId: string;
  token: string;
}

export interface ChatwootMirrorInput {
  fromPhoneE164: string; // +5511999990000
  fromName: string | null;
  content: string; // texto (ou legenda / rótulo de mídia)
  externalMessageId: string;
}

export type ChatwootMirrorResult =
  | { status: "skipped"; reason: string }
  | { status: "sent"; conversationId: number }
  | { status: "failed"; error: string };

function readConfig(): ChatwootConfig | null {
  const url = process.env.CHATWOOT_URL?.replace(/\/$/, "");
  const accountId = process.env.CHATWOOT_ACCOUNT_ID;
  const inboxId = process.env.CHATWOOT_INBOX_ID;
  const token = process.env.CHATWOOT_API_TOKEN;
  if (!url || !accountId || !inboxId || !token) return null;
  return { url, accountId, inboxId, token };
}

export function isChatwootConfigured(): boolean {
  return readConfig() !== null;
}

function apiBase(cfg: ChatwootConfig): string {
  return `${cfg.url}/api/v1/accounts/${cfg.accountId}`;
}

function headers(cfg: ChatwootConfig): Record<string, string> {
  return { "Content-Type": "application/json", api_access_token: cfg.token };
}

/** Cria (ou reaproveita, em caso de duplicado) o contato e devolve id + source_id. */
async function findOrCreateContact(
  cfg: ChatwootConfig,
  phoneE164: string,
  name: string | null,
): Promise<{ contactId: number; sourceId: string }> {
  const identifier = phoneE164.replace(/\D/g, "");

  const createRes = await fetch(`${apiBase(cfg)}/contacts`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({
      inbox_id: Number(cfg.inboxId),
      name: name ?? phoneE164,
      phone_number: phoneE164,
      identifier,
    }),
  });

  if (createRes.ok) {
    const data = (await createRes.json()) as Record<string, unknown>;
    const payload = (data.payload ?? data) as Record<string, unknown>;
    const contact = (payload.contact ?? payload) as Record<string, unknown>;
    const contactInbox = payload.contact_inbox as Record<string, unknown> | undefined;
    return {
      contactId: Number(contact.id),
      sourceId: String(contactInbox?.source_id ?? identifier),
    };
  }

  // 422 = já existe. Busca e reaproveita.
  const searchRes = await fetch(
    `${apiBase(cfg)}/contacts/search?q=${encodeURIComponent(identifier)}`,
    { headers: headers(cfg) },
  );
  if (!searchRes.ok) {
    throw new Error(`contato não criado/encontrado (${createRes.status}/${searchRes.status})`);
  }
  const search = (await searchRes.json()) as Record<string, unknown>;
  const list = (search.payload ?? []) as Array<Record<string, unknown>>;
  const contact = list[0];
  if (!contact) throw new Error("contato não encontrado após 422");

  const inboxes = (contact.contact_inboxes ?? []) as Array<Record<string, unknown>>;
  const match = inboxes.find(
    (ci) => String((ci.inbox as Record<string, unknown>)?.id ?? "") === String(cfg.inboxId),
  );
  return {
    contactId: Number(contact.id),
    sourceId: String(match?.source_id ?? identifier),
  };
}

async function createConversation(
  cfg: ChatwootConfig,
  sourceId: string,
  contactId: number,
): Promise<number> {
  const res = await fetch(`${apiBase(cfg)}/conversations`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({
      source_id: sourceId,
      inbox_id: Number(cfg.inboxId),
      contact_id: contactId,
    }),
  });
  if (!res.ok) {
    throw new Error(`conversa não criada (${res.status})`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return Number(data.id);
}

async function postIncomingMessage(
  cfg: ChatwootConfig,
  conversationId: number,
  content: string,
): Promise<void> {
  const res = await fetch(`${apiBase(cfg)}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify({ content, message_type: "incoming" }),
  });
  if (!res.ok) {
    throw new Error(`mensagem não postada (${res.status})`);
  }
}

/**
 * Espelha uma mensagem inbound no Chatwoot. Best-effort: nunca lança — devolve
 * um resultado tipado; o chamador (webhook) ignora falhas para manter o 200.
 */
export async function mirrorInboundToChatwoot(
  input: ChatwootMirrorInput,
): Promise<ChatwootMirrorResult> {
  const cfg = readConfig();
  if (!cfg) return { status: "skipped", reason: "not_configured" };

  try {
    const { contactId, sourceId } = await findOrCreateContact(
      cfg,
      input.fromPhoneE164,
      input.fromName,
    );
    const conversationId = await createConversation(cfg, sourceId, contactId);
    await postIncomingMessage(cfg, conversationId, input.content);
    return { status: "sent", conversationId };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
