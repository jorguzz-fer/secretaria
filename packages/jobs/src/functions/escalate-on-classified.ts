import { prisma } from "@crm/db";
import { isModuleEnabled } from "@crm/config";
import { inngest } from "../client";

// Módulo de Escalada no registro de config. Desligado → não pausa a IA.
const ESCALATION_MODULE = "escalada" as const;

export type EscalateResult =
  | { skipped: true; reason: string }
  | { skipped: false; paused: number };

/**
 * Quando um lead é classificado como HOT, pausa a IA nas conversas dele
 * (hand-off para atendimento humano). A atribuição a um vendedor fica a cargo
 * do auto-assign (que também consome lead/classified) — aqui tratamos só do
 * gate de escalada.
 */
export async function handleEscalateOnClassified(eventData: {
  tenantId: string;
  leadId: string;
  score: string;
}): Promise<EscalateResult> {
  const { tenantId, leadId, score } = eventData;

  if (score !== "HOT") return { skipped: true, reason: "not_hot" };
  if (!(await isModuleEnabled(tenantId, ESCALATION_MODULE))) {
    return { skipped: true, reason: "module_disabled" };
  }

  const result = await prisma.whatsAppConversation.updateMany({
    where: { tenantId, leadId, aiPaused: false },
    data: { aiPaused: true, aiPausedReason: "lead_hot", aiPausedAt: new Date() },
  });

  return { skipped: false, paused: result.count };
}

export const escalateOnClassifiedFn = inngest.createFunction(
  {
    id: "escalate-on-classified",
    name: "Escalada: pausa IA quando lead vira HOT",
  },
  { event: "lead/classified" },
  async ({ event, step }) => {
    return step.run("escalate", () => handleEscalateOnClassified(event.data));
  },
);
