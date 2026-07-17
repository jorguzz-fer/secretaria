import { prisma } from "@crm/db";
import { generateReply } from "@crm/ai";
import { isModuleEnabled, getTenantConfig } from "@crm/config";
import { inngest } from "../client";
import { resolveWhatsappAdapter } from "../whatsapp-adapter";
import { tryScheduling } from "./schedule";
import { searchCourses, formatCoursesForPrompt } from "../courses";

// Módulo do SDR (secretária) no registro de config. Desligado → não responde.
const SDR_MODULE = "secretaria" as const;
const SCHEDULE_MODULE = "agenda" as const;

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
      aiPaused: true,
      lead: { select: { id: true, name: true, phone: true } },
      instance: { select: { instanceName: true, provider: true, phone: true, status: true } },
    },
  });

  if (!conversation) return { skipped: true, reason: "no_conversation" };
  // Hand-off: IA pausada nessa conversa (humano assumiu / HOT / escalada / manual).
  if (conversation.aiPaused) return { skipped: true, reason: "ai_paused" };
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

  const leadName = conversation.lead?.name ?? conversation.remoteName ?? "amigo(a)";
  const adapter = resolveWhatsappAdapter(conversation.instance);

  async function sendAndPersist(text: string, tag: string): Promise<void> {
    await adapter.sendMessage({
      tenantId,
      providerInstanceId: conversation!.instance.instanceName,
      toPhoneE164: toPhone!,
      content: { type: "text", text },
      externalEventId: `${tag}-${conversation!.id}-${eventData.messageId ?? "unknown"}`,
    });
    await prisma.whatsAppMessage.create({
      data: {
        tenantId,
        conversationId: conversation!.id,
        waMessageId: `${tag}-${conversation!.id}-${Date.now()}`,
        fromMe: true,
        body: text,
        mediaType: "TEXT",
        status: "SENT",
        timestamp: new Date(),
      },
    });
  }

  // Agenda: se o módulo estiver ligado, a IA pode propor/confirmar horários.
  if (await isModuleEnabled(tenantId, SCHEDULE_MODULE)) {
    const sched = await tryScheduling({
      tenantId,
      conversationId: conversation.id,
      leadId: conversation.lead?.id,
      leadName,
      history,
    });
    if (sched.handled) {
      await sendAndPersist(sched.replyText, "sched");
      return { skipped: false, escalated: false, message: sched.replyText };
    }
  }

  // Persona por tenant (config `secretaria`): quem a IA é, produto, preços,
  // instruções. O generateReply monta o system prompt a partir disso.
  const sdrConfig = await getTenantConfig(tenantId, SDR_MODULE);

  // RAG do catálogo: recupera os cursos relevantes à última mensagem do lead e
  // injeta como productInfo (com 286 cursos não cabe tudo no prompt). Best-effort:
  // qualquer falha mantém o productInfo estático da config.
  let productInfo = sdrConfig.productInfo;
  try {
    const lastLead = [...history].reverse().find((m) => m.role === "lead");
    if (lastLead) {
      const hits = await searchCourses(tenantId, { query: lastLead.content, limit: 5 });
      if (hits.length > 0) productInfo = formatCoursesForPrompt(hits);
    }
  } catch {
    // mantém sdrConfig.productInfo
  }

  const reply = await generateReply({
    tenantId,
    leadId: conversation.lead?.id,
    leadName,
    channel: "whatsapp",
    messages: history,
    persona: {
      agentName: sdrConfig.agentName,
      businessName: sdrConfig.businessName,
      role: sdrConfig.role,
      tone: sdrConfig.tone,
      productInfo,
      goal: sdrConfig.goal,
      instructions: sdrConfig.instructions,
      canQuotePrice: sdrConfig.canQuotePrice,
    },
  });

  // Escalada: pausa a IA nessa conversa e deixa pro humano (atende via Chatwoot).
  if (reply.shouldEscalate) {
    await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        aiPaused: true,
        aiPausedReason: reply.escalationReason ?? "ai_escalation",
        aiPausedAt: new Date(),
      },
    });
    return { skipped: false, escalated: true };
  }

  await sendAndPersist(reply.message, "sdr-reply");
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
