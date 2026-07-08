import { prisma } from "@crm/db";
import { getTenantConfig } from "@crm/config";
import { interpretScheduling } from "@crm/ai";
import { suggestSlots } from "../scheduling";

/**
 * Orquestração conversacional da Agenda (modo "sugere horários e confirma").
 *
 * Dado o histórico da conversa, decide via IA se o lead quer agendar:
 * - propõe horários livres (motor `suggestSlots` + ocupação dos confirmados),
 *   grava-os como Appointment PROPOSED e devolve a mensagem numerada;
 * - se o lead escolhe um horário ofertado, confirma (CONFIRMED), cancela os
 *   outros propostos e devolve a confirmação.
 *
 * Retorna `{ handled }`: quando true, o respondedor SDR envia `replyText` e NÃO
 * gera a resposta genérica. `now` é injetável para teste.
 */

export interface SchedulingArgs {
  tenantId: string;
  conversationId: string;
  leadId?: string | null;
  leadName: string;
  history: { role: "lead" | "sdr"; content: string; at: Date }[];
  now?: Date;
}

export type SchedulingOutcome = { handled: false } | { handled: true; replyText: string };

export function formatSlotPtBR(start: Date, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
}

export async function tryScheduling(args: SchedulingArgs): Promise<SchedulingOutcome> {
  const { tenantId, conversationId } = args;
  const config = await getTenantConfig(tenantId, "agenda");

  const pending = await prisma.appointment.findMany({
    where: { tenantId, conversationId, status: "PROPOSED" },
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true },
  });

  const offeredSlots = pending.map((a) => formatSlotPtBR(a.startsAt, config.timezone));
  const intent = await interpretScheduling({ messages: args.history, offeredSlots });

  // Escolha de um horário ofertado → confirma.
  if (
    intent.action === "pick" &&
    pending.length > 0 &&
    intent.pickedIndex &&
    intent.pickedIndex <= pending.length
  ) {
    const chosen = pending[intent.pickedIndex - 1];
    await prisma.appointment.update({
      where: { id: chosen.id },
      data: { status: "CONFIRMED" },
    });
    await prisma.appointment.updateMany({
      where: { tenantId, conversationId, status: "PROPOSED", id: { not: chosen.id } },
      data: { status: "CANCELLED" },
    });
    return {
      handled: true,
      replyText: `Perfeito! ✅ Agendei para *${formatSlotPtBR(chosen.startsAt, config.timezone)}*. Você vai receber um lembrete. Até lá!`,
    };
  }

  // Intenção de agendar sem proposta pendente → propõe horários.
  if (intent.action === "propose") {
    const now = args.now ?? new Date();
    const confirmed = await prisma.appointment.findMany({
      where: { tenantId, status: "CONFIRMED", startsAt: { gte: now } },
      select: { startsAt: true, endsAt: true },
    });
    const busy = confirmed.map((c) => ({ start: c.startsAt, end: c.endsAt }));
    const slots = suggestSlots(config, { now, busy });

    if (slots.length === 0) {
      return {
        handled: true,
        replyText:
          "No momento não tenho horários livres na agenda. Um consultor vai falar com você para encontrar o melhor horário. 🙌",
      };
    }

    // Substitui propostas antigas desta conversa pelas novas.
    await prisma.appointment.deleteMany({
      where: { tenantId, conversationId, status: "PROPOSED" },
    });
    await prisma.appointment.createMany({
      data: slots.map((s) => ({
        tenantId,
        conversationId,
        leadId: args.leadId ?? null,
        title: `Reunião com ${args.leadName}`,
        startsAt: s.start,
        endsAt: s.end,
        status: "PROPOSED" as const,
        source: "ai",
      })),
    });

    const list = slots.map((s, i) => `${i + 1}) ${formatSlotPtBR(s.start, config.timezone)}`).join("\n");
    return {
      handled: true,
      replyText: `Tenho estes horários disponíveis:\n${list}\n\nQual fica melhor pra você? É só responder com o número.`,
    };
  }

  return { handled: false };
}
