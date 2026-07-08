import { prisma } from "@crm/db";
import { generateFollowUp } from "@crm/ai";
import { resolveModule, isModuleEnabled } from "@crm/config";
import { inngest } from "../client";
import { resolveWhatsappAdapter } from "../whatsapp-adapter";
import type { EventData } from "../events";

// Módulo do follow-up no registro de config. A cadência (dias) e o toggle
// vêm de `getTenantConfig`/`isModuleEnabled` — não mais de constante global.
const FOLLOWUP_MODULE = "recuperacao" as const;

// Fallback quando a config não resolve (não deve ocorrer: o schema tem default).
const DEFAULT_SEQUENCE_DAYS = [1, 3, 7];

export type FollowupResult =
  | { skipped: true; reason: string }
  | { skipped: false; shouldEscalate: boolean; nextAttemptHours: number | null };

/**
 * Resolve o plano de follow-up do tenant: se o módulo está habilitado e a
 * cadência de dias configurada. Usado pela função Inngest para agendar os
 * `step.sleep` e decidir se roda.
 */
export async function resolveFollowupPlan(
  tenantId: string,
): Promise<{ enabled: boolean; sequenceDays: number[] }> {
  const { enabled, config } = await resolveModule(tenantId, FOLLOWUP_MODULE);
  return { enabled, sequenceDays: config.sequenceDays ?? DEFAULT_SEQUENCE_DAYS };
}

export async function handleFollowup(
  eventData: Partial<EventData<"followup/scheduled">> & {
    tenantId: string;
    leadId: string;
    sequenceId?: string;
  },
  attempt: number,
): Promise<FollowupResult> {
  const { tenantId, leadId } = eventData;

  // Gate: módulo desligado para o tenant → não roda, sem efeitos colaterais.
  if (!(await isModuleEnabled(tenantId, FOLLOWUP_MODULE))) {
    return { skipped: true, reason: "module_disabled" };
  }

  // Load conversation with lead + instance info
  const conversation = await prisma.whatsAppConversation.findFirst({
    where: { tenantId, leadId },
    select: {
      id: true,
      instanceId: true,
      remotePhone: true,
      lead: { select: { id: true, name: true, phone: true } },
      instance: { select: { instanceName: true, provider: true, phone: true, status: true } },
    },
  });

  if (!conversation) return { skipped: true, reason: "no_conversation" };
  if (conversation.instance.status !== "CONNECTED")
    return { skipped: true, reason: "instance_not_connected" };
  if (!conversation.lead?.phone) return { skipped: true, reason: "no_phone" };

  // Get message history for AI context
  const messages = await prisma.whatsAppMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { timestamp: "asc" },
    take: 20,
    select: { fromMe: true, body: true, timestamp: true },
  });

  type MsgRow = { fromMe: boolean; body: string | null; timestamp: Date };
  const previousMessages = (messages as MsgRow[])
    .filter((m) => m.body && m.body.trim().length > 0)
    .map((m) => ({
      role: m.fromMe ? ("sdr" as const) : ("lead" as const),
      content: m.body!,
      at: m.timestamp,
    }));

  const lastLeadReply = (messages as MsgRow[]).filter((m) => !m.fromMe).at(-1);
  const daysSinceLastReply = lastLeadReply
    ? Math.floor((Date.now() - lastLeadReply.timestamp.getTime()) / 86400_000)
    : attempt;

  // Generate follow-up message via AI
  const result = await generateFollowUp({
    tenantId,
    leadId,
    leadName: conversation.lead.name ?? "amigo(a)",
    channel: "whatsapp",
    previousMessages:
      previousMessages.length > 0
        ? previousMessages
        : [{ role: "sdr", content: "Oi! Vi que você tem interesse em nossos cursos.", at: new Date() }],
    attempt: Math.min(attempt, 5) as 1 | 2 | 3 | 4 | 5,
    daysSinceLastReply,
  });

  // Envio pelo adapter do provider real da instância (Evolution/Z-API/...)
  const adapter = resolveWhatsappAdapter(conversation.instance);

  await adapter.sendMessage({
    tenantId,
    providerInstanceId: conversation.instance.instanceName,
    toPhoneE164: conversation.lead.phone,
    content: { type: "text", text: result.message },
    externalEventId: `followup-${leadId}-attempt-${attempt}`,
  });

  // Save message to DB
  await prisma.whatsAppMessage.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      waMessageId: `fu-${leadId}-${attempt}-${Date.now()}`,
      fromMe: true,
      body: result.message,
      mediaType: "TEXT",
      status: "SENT",
      timestamp: new Date(),
    },
  });

  return {
    skipped: false,
    shouldEscalate: result.shouldEscalate,
    nextAttemptHours: result.nextAttemptHours,
  };
}

export const followupSequenceFn = inngest.createFunction(
  {
    id: "followup-sequence",
    name: "Follow-up SDR Sequence D+1/D+3/D+7",
  },
  { event: "followup/scheduled" },
  async ({ event, step }) => {
    const { data } = event;

    // Resolve cadência + toggle do tenant (config por tenant, não constante).
    const plan = await step.run("resolve-plan", () => resolveFollowupPlan(data.tenantId));
    if (!plan.enabled) {
      return { skipped: true, reason: "module_disabled" };
    }

    const sequenceDays = plan.sequenceDays;

    for (let i = 0; i < sequenceDays.length; i++) {
      const attempt = i + 1;

      // Sleep until next follow-up day (relative to previous step)
      if (i === 0) {
        await step.sleep(`wait-d${sequenceDays[i]}`, `${sequenceDays[i] * 24}h`);
      } else {
        const waitDays = sequenceDays[i] - sequenceDays[i - 1];
        await step.sleep(`wait-d${sequenceDays[i]}`, `${waitDays * 24}h`);
      }

      const result = await step.run(`attempt-${attempt}`, () =>
        handleFollowup(data, attempt),
      );

      // Stop sequence on escalation or skip
      if (result.skipped || result.shouldEscalate) break;
    }
  },
);
