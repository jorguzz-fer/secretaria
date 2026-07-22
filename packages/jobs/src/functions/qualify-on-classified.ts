import { prisma } from "@crm/db";
import { inngest } from "../client";
import { handleAutoAssign } from "./auto-assign";

/**
 * Qualificação: ao classificar um lead, reflete a temperatura no funil.
 *
 * - HOT  → status QUALIFICADO + Oportunidade na etapa "Qualificação"
 * - WARM → status EM_CONTATO  + Oportunidade na etapa "Prospecção"
 * - COLD/DISQUALIFIED → não faz nada (fica só na lista de leads)
 *
 * Idempotente: o classificador re-roda a cada mensagem. A oportunidade é criada
 * uma vez e depois só **avança** de etapa (nunca recua) — assim WARM→HOT promove
 * o card de Prospecção p/ Qualificação, mas não puxa de volta um card que um
 * humano já moveu adiante.
 *
 * Atribuição: chama o auto-assign direto (não emite `lead/created`, que dispararia
 * o first-contact — mensagem proativa indevida para quem nos escreveu primeiro).
 */

const QUAL_MAP: Record<string, { status: "QUALIFICADO" | "EM_CONTATO"; stage: string }> = {
  HOT: { status: "QUALIFICADO", stage: "Qualificação" },
  WARM: { status: "EM_CONTATO", stage: "Prospecção" },
};

export type QualifyResult =
  | { skipped: true; reason: string }
  | { skipped: false; action: "created" | "advanced" | "unchanged"; stage: string };

export async function handleQualifyOnClassified(data: {
  tenantId: string;
  leadId: string;
  score: string;
}): Promise<QualifyResult> {
  const { tenantId, leadId, score } = data;
  const target = QUAL_MAP[score];
  if (!target) return { skipped: true, reason: "not_qualifying" };

  // 1. Status do lead (etapa comercial).
  await prisma.lead.update({ where: { id: leadId, tenantId }, data: { status: target.status } });

  // 2. Atribui um vendedor se ainda não houver (no-op se não há vendedores).
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: { assignedTo: true, name: true },
  });
  if (lead && !lead.assignedTo) {
    await handleAutoAssign({ tenantId, leadId });
  }

  // 3. Pipeline default (ou o primeiro) + etapa alvo por nome.
  const pipeline =
    (await prisma.pipeline.findFirst({ where: { tenantId, isDefault: true }, select: { id: true } })) ??
    (await prisma.pipeline.findFirst({ where: { tenantId }, select: { id: true } }));
  if (!pipeline) return { skipped: true, reason: "no_pipeline" };

  const stages = await prisma.stage.findMany({
    where: { tenantId, pipelineId: pipeline.id },
    select: { id: true, name: true, order: true },
    orderBy: { order: "asc" },
  });
  const targetStage = stages.find((s) => s.name.toLowerCase() === target.stage.toLowerCase());
  if (!targetStage) return { skipped: true, reason: "no_stage" };

  // 4. Oportunidade — reusa quem foi (re)atribuído.
  const assigned = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: { assignedTo: true, name: true },
  });

  const open = await prisma.opportunity.findFirst({
    where: { tenantId, leadId, status: "ABERTA" },
    select: { id: true, stageId: true },
  });

  if (!open) {
    await prisma.opportunity.create({
      data: {
        tenantId,
        pipelineId: pipeline.id,
        stageId: targetStage.id,
        leadId,
        assignedTo: assigned?.assignedTo ?? null,
        title: `${assigned?.name ?? lead?.name ?? "Lead"} — WhatsApp`,
      },
    });
    return { skipped: false, action: "created", stage: targetStage.name };
  }

  // Só avança (target à frente da etapa atual); nunca recua.
  const current = stages.find((s) => s.id === open.stageId);
  if (current && targetStage.order > current.order) {
    await prisma.opportunity.update({ where: { id: open.id }, data: { stageId: targetStage.id } });
    return { skipped: false, action: "advanced", stage: targetStage.name };
  }
  return { skipped: false, action: "unchanged", stage: current?.name ?? targetStage.name };
}

export const qualifyOnClassifiedFn = inngest.createFunction(
  { id: "qualify-on-classified", name: "Qualificação: status + oportunidade no funil" },
  { event: "lead/classified" },
  async ({ event, step }) =>
    step.run("qualify", () => handleQualifyOnClassified(event.data as { tenantId: string; leadId: string; score: string })),
);
