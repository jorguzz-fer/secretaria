import { prisma } from "@crm/db";
import { generateReply } from "@crm/ai";
import { isModuleEnabled } from "@crm/config";
import { inngest } from "../client";
import { resolveWhatsappAdapter } from "../whatsapp-adapter";

// Módulo do SDR (secretária) no registro de config. Desligado → não responde.
const SDR_MODULE = "secretaria" as const;

export interface RespondInput {
  tenantId: string;
  conversationId: string;
  messageId?: string;
  content?: { type?: string; body?: string };
}

export type RespondResult =
  | { skipped: true; reason: string }
  | { skipped: false; escalated: boolean; message?: string };

export async function handleRespondOnMessage(eventData: RespondInput): Promise<RespondResult> {
  const { tenantId, conversationId } = eventData;

  // Gate: módulo SDR desligado para o tenant → não roda.
  if (!(await isModuleEnabled(tenantId, SDR_MODULE))) {
    return { skipped: true, reason: "module_disabled" };
  }

  // Só responde automaticamente a texto (mídia/áudio ficam pro humano).
  const contentType = eventData.content?.type;
  if (contentType && contentType !== "text") {
    return { skipped: true, reason: "unsupported_content" };
  }

  const conversation = await prisma.whatsAppConversation.findFirst({
    where: { tenantId, id: conversationId },
    select: {
      id: true,
      remotePhone: true,
      remoteName: true,
      lead: { select: { id: true, name: true, phone: true } },
      instance: { select: { instanceName: true, provider: true, phone: true, status: true } },
    },
  });

  if (!conversation) return { skipped: true, reason: "no_conversation" };
  if (conversation.instance.status !== "CONNECTED") {
    return { skipped: true, reason: "instance_not_connected" };
  }

  const toPhone =
    conversation.lead?.phone ??
    (conversation.remotePhone ? `+${conversation.remotePhone}` : null);
  if (!toPhone) return { skipped: true, reason: "no_phone" };

  // Histórico para dar contexto à IA
  const messages = await prisma.whatsAppMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { timestamp: "asc" },
    take: 20,
    select: { fromMe: true, body: true, timestamp: true },
  });

  type MsgRow = { fromMe: boolean; body: string | null; timestamp: Date };
  const history = (messages as MsgRow[])
    .filter((m) => m.body && m.body.trim().length > 0)
    .map((m) => ({
      role: m.fromMe ? ("sdr" as const) : ("lead" as const),
      content: m.body!,
      at: m.timestamp,
    }));

  if (history.length === 0) return { skipped: true, reason: "no_history" };
  if (!history.some((m) => m.role === "lead")) {
    return { skipped: true, reason: "no_inbound" };
  }

  const reply = await generateReply({
    tenantId,
    leadId: conversation.lead?.id,
    leadName: conversation.lead?.name ?? conversation.remoteName ?? "amigo(a)",
    channel: "whatsapp",
    messages: history,
  });

  // Escalada: deixa a conversa pro humano (que atende via Chatwoot) — não auto-responde.
  if (reply.shouldEscalate) {
    return { skipped: false, escalated: true };
  }

  const adapter = resolveWhatsappAdapter(conversation.instance);
  await adapter.sendMessage({
    tenantId,
    providerInstanceId: conversation.instance.instanceName,
    toPhoneE164: toPhone,
    content: { type: "text", text: reply.message },
    externalEventId: `sdr-reply-${conversation.id}-${eventData.messageId ?? "unknown"}`,
  });

  await prisma.whatsAppMessage.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      waMessageId: `reply-${conversation.id}-${Date.now()}`,
      fromMe: true,
      body: reply.message,
      mediaType: "TEXT",
      status: "SENT",
      timestamp: new Date(),
    },
  });

  return { skipped: false, escalated: false, message: reply.message };
}

export const respondOnMessageFn = inngest.createFunction(
  {
    id: "respond-on-message",
    name: "SDR IA responde mensagem recebida",
    // Debounce: várias mensagens seguidas do lead viram UMA resposta.
    debounce: { key: "event.data.conversationId", period: "10s" },
  },
  { event: "message/received" },
  async ({ event, step }) => {
    return step.run("respond", () => handleRespondOnMessage(event.data));
  },
);
