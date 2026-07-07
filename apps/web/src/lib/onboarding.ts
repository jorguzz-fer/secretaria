import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { MODULE_KEYS, MODULES } from "@crm/config";
import { onboardTenantSchema, type OnboardTenantInput } from "@crm/validators";

/**
 * Onboarding nativo de tenant — equivalente ao workflow n8n "00. Configurações".
 *
 * Cria o tenant com defaults sensatos, numa transação:
 * - linhas de `TenantModule` para todos os módulos (enabled = defaultEnabled do
 *   registro; settings null → defaults do schema resolvem na leitura);
 * - pipeline base + estágios;
 *
 * NÃO faz authz — é lógica de negócio pura, chamável por CLI/seed ou pela
 * server action `onboardTenantAction` (que aplica o guard de papel). Nunca
 * exponha esta função diretamente a um client.
 */

const BASE_STAGES = [
  { name: "Prospecção", color: "#8b5cf6" },
  { name: "Qualificação", color: "#3b82f6" },
  { name: "Proposta", color: "#f59e0b" },
  { name: "Negociação", color: "#f97316" },
  { name: "Fechamento", color: "#10b981" },
];

export interface OnboardTenantResult {
  tenantId: string;
  slug: string;
}

export async function onboardTenant(
  input: OnboardTenantInput,
  opts: { actorUserId?: string | null } = {},
): Promise<OnboardTenantResult> {
  const { name, slug } = onboardTenantSchema.parse(input);

  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({ data: { name, slug } });

    await tx.tenantModule.createMany({
      data: MODULE_KEYS.map((key) => ({
        tenantId: t.id,
        moduleKey: key,
        enabled: MODULES[key].defaultEnabled,
      })),
    });

    const pipeline = await tx.pipeline.create({
      data: { tenantId: t.id, name: "Pipeline Principal", isDefault: true },
    });

    await tx.stage.createMany({
      data: BASE_STAGES.map((s, i) => ({
        tenantId: t.id,
        pipelineId: pipeline.id,
        name: s.name,
        order: i,
        color: s.color,
      })),
    });

    return t;
  });

  await logAudit({
    tenantId: tenant.id,
    userId: opts.actorUserId ?? null,
    action: "tenant.onboard",
    entity: "Tenant",
    entityId: tenant.id,
    meta: { slug: tenant.slug, modules: MODULE_KEYS.length },
  });

  return { tenantId: tenant.id, slug: tenant.slug };
}
