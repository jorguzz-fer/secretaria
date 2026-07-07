/**
 * Z-API adapter (WhatsApp via Baileys hospedado pela Z-API).
 *
 * Z-API NÃO é igual ao Evolution no payload nem no envio:
 * - Envio: `POST {baseUrl}/instances/{id}/token/{token}/send-text` com header
 *   `Client-Token` (token de segurança da CONTA, distinto do token da instância
 *   que vai na URL) e body `{ phone, message }`.
 * - Recebimento: um webhook por mensagem (não há batching), com `type:
 *   "ReceivedCallback"` e campos `phone`, `text.message`, `image.imageUrl`, etc.
 * - Sem assinatura HMAC: a autenticidade se apoia no `instanceId` do payload
 *   (que só chega nos webhooks daquela instância) + opcional Client-Token.
 *
 * ⚠️ O formato de payload abaixo segue a documentação da Z-API. Confirmar os
 * nomes exatos dos campos contra uma captura real antes do go-live (o parser é
 * defensivo: shape inesperado vira [] em vez de crashar).
 */

import type {
  RawInboundMessage,
  OutboundMessage,
  SendResult,
  WhatsAppAdapter,
} from "../types";

export interface ZapiAdapterConfig {
  instanceId: string; // ex: 3F5C66FFA6EA81F85789B2A896B2E503
  instanceToken: string; // token da instância (vai na URL)
  clientToken: string; // Client-Token de segurança da conta (header)
  instancePhone: string; // número conectado em E.164, ex: +5511964390121
  baseUrl?: string; // default https://api.z-api.io
}

const DEFAULT_BASE_URL = "https://api.z-api.io";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Z-API manda telefone só com dígitos (ex.: "5511999999999") → E.164. */
function zapiPhoneToE164(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

function parseZapiContent(
  p: Record<string, unknown>,
): RawInboundMessage["message"] | null {
  const text = p.text as Record<string, unknown> | undefined;
  if (typeof text?.message === "string" && text.message.length > 0) {
    return { type: "text", text: text.message };
  }

  const img = p.image as Record<string, unknown> | undefined;
  if (typeof img?.imageUrl === "string") {
    return {
      type: "image",
      mediaUrl: img.imageUrl,
      caption: typeof img.caption === "string" && img.caption.length > 0 ? img.caption : undefined,
    };
  }

  const audio = p.audio as Record<string, unknown> | undefined;
  if (typeof audio?.audioUrl === "string") {
    return {
      type: "audio",
      mediaUrl: audio.audioUrl,
      durationSec: typeof audio.seconds === "number" ? audio.seconds : undefined,
    };
  }

  const doc = p.document as Record<string, unknown> | undefined;
  if (typeof doc?.documentUrl === "string") {
    return {
      type: "document",
      mediaUrl: doc.documentUrl,
      filename: (typeof doc.fileName === "string" ? doc.fileName : "arquivo") as string,
    };
  }

  const btn = p.buttonsResponseMessage as Record<string, unknown> | undefined;
  if (typeof btn?.buttonId === "string") {
    return { type: "button", payload: btn.buttonId };
  }

  const list = p.listResponseMessage as Record<string, unknown> | undefined;
  if (typeof list?.selectedRowId === "string") {
    return { type: "interactive", payload: list.selectedRowId };
  }

  return null;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createZapiAdapter(config: ZapiAdapterConfig): WhatsAppAdapter {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

  return {
    provider: "zapi",

    // ── verifyWebhookSignature ────────────────────────────────────────────────

    async verifyWebhookSignature({ rawBody, headers, secret }) {
      // Z-API não assina via HMAC. Autenticidade = instanceId do payload bate
      // com a instância configurada (só chega nos webhooks dela). Se um
      // Client-Token for enviado no header, também é conferido contra `secret`.
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return { ok: false, reason: "body não é JSON válido" };
      }

      if (body.instanceId !== config.instanceId) {
        return { ok: false, reason: "instanceId não confere" };
      }

      const headerToken =
        headers["client-token"] ?? headers["Client-Token"] ?? headers["CLIENT-TOKEN"];
      if (secret && headerToken !== undefined && headerToken !== secret) {
        return { ok: false, reason: "Client-Token inválido" };
      }

      return { ok: true };
    },

    // ── parseInbound ─────────────────────────────────────────────────────────

    async parseInbound(rawBody) {
      let p: Record<string, unknown>;
      try {
        p = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return [];
      }

      // Só mensagens recebidas de terceiros (ignora envio próprio e grupos).
      if (p.type !== "ReceivedCallback") return [];
      if (p.fromMe === true) return [];
      if (p.isGroup === true) return [];

      const phone = zapiPhoneToE164(p.phone);
      const messageId = typeof p.messageId === "string" ? p.messageId : undefined;
      if (!phone || !messageId) return [];

      const content = parseZapiContent(p);
      if (!content) return [];

      // Z-API: `momment` é epoch em MILISSEGUNDOS.
      const momment = typeof p.momment === "number" ? p.momment : undefined;
      const name =
        (typeof p.senderName === "string" && p.senderName) ||
        (typeof p.chatName === "string" && p.chatName) ||
        null;

      return [
        {
          providerInstanceId: config.instanceId,
          externalMessageId: messageId,
          from: { phoneE164: phone, name },
          to: { phoneE164: config.instancePhone },
          message: content,
          ctwaClid: null, // Z-API não expõe ctwa_clid
          receivedAt: momment ? new Date(momment) : new Date(),
        },
      ];
    },

    // ── sendMessage ───────────────────────────────────────────────────────────

    async sendMessage(msg: OutboundMessage): Promise<SendResult> {
      if (msg.content.type === "template") {
        throw new Error(
          "Template messages não suportados no adapter Z-API. Use Meta Cloud API.",
        );
      }

      const phone = msg.toPhoneE164.replace(/\D/g, "");
      const url = `${baseUrl}/instances/${config.instanceId}/token/${config.instanceToken}/send-text`;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Client-Token": config.clientToken,
          },
          body: JSON.stringify({ phone, message: msg.content.text }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => String(res.status));
          return {
            providerMessageId: "",
            status: "failed",
            error: `Z-API ${res.status}: ${errText}`,
          };
        }

        const data = (await res.json()) as Record<string, unknown>;
        const id =
          (typeof data.messageId === "string" && data.messageId) ||
          (typeof data.id === "string" && data.id) ||
          (typeof data.zaapId === "string" && data.zaapId) ||
          "";

        return { providerMessageId: id, status: "sent" };
      } catch (err) {
        return {
          providerMessageId: "",
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
