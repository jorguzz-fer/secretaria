import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { MODELS } from "../models";

/**
 * Interpretação de intenção de agendamento numa conversa de WhatsApp.
 *
 * Decide, a partir do histórico + horários já ofertados, se o lead:
 * - quer agendar e ainda não há proposta → `propose`
 * - escolheu um dos horários ofertados → `pick` (pickedIndex 1-based)
 * - não está tratando de agendamento → `none`
 */

export const schedulingIntentSchema = z.object({
  action: z.enum(["propose", "pick", "none"]),
  pickedIndex: z.number().int().min(1).max(10).nullable(),
});
export type SchedulingIntent = z.infer<typeof schedulingIntentSchema>;

export const schedulingInterpretInputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["lead", "sdr"]),
        content: z.string().min(1),
        at: z.date(),
      }),
    )
    .min(1),
  offeredSlots: z.array(z.string()).default([]),
});
export type SchedulingInterpretInput = z.input<typeof schedulingInterpretInputSchema>;

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const SYSTEM = `Você classifica a intenção de AGENDAMENTO numa conversa de WhatsApp de um SDR.

Regras:
- Se HÁ horários ofertados (lista numerada) e a última mensagem do lead escolhe um deles
  (por número, ou descrevendo o horário) → action="pick" e pickedIndex = a posição (1-based).
- Se o lead demonstra querer marcar/agendar uma reunião/call e NÃO há oferta pendente
  → action="propose".
- Caso contrário (conversa comum, dúvida, etc.) → action="none".
- pickedIndex só é preenchido quando action="pick"; senão null.

Responda em JSON: { action, pickedIndex }.`;

function buildPrompt(input: SchedulingInterpretInput): string {
  const lines: string[] = [];
  if (input.offeredSlots && input.offeredSlots.length > 0) {
    lines.push("Horários já ofertados:");
    input.offeredSlots.forEach((s, i) => lines.push(`${i + 1}) ${s}`));
    lines.push("");
  } else {
    lines.push("(Nenhum horário ofertado ainda)", "");
  }
  lines.push("Conversa:");
  for (const m of input.messages) lines.push(`[${m.role.toUpperCase()}] ${m.content}`);
  return lines.join("\n");
}

export async function interpretScheduling(
  input: SchedulingInterpretInput,
): Promise<SchedulingIntent> {
  const parsed = schedulingInterpretInputSchema.parse(input);

  const openai = createOpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
  });

  const { object } = await generateObject({
    model: openai(MODELS.sdr),
    schema: schedulingIntentSchema,
    system: SYSTEM,
    prompt: buildPrompt(parsed),
  });

  return object;
}
