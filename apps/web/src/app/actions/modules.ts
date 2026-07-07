"use server";

import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@crm/db";
import { requireRole, ROLES_ADMIN } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { MODULES, isModuleKey, FollowupConfigSchema } from "@crm/config";
import { z } from "zod";

export type ActionState = { error: string } | { success: string } | null;

const toggleSchema = z.object({
  moduleKey: z.string().refine(isModuleKey, "Módulo desconhecido"),
  enabled: z.enum(["true", "false"]),
});

/**
 * Liga/desliga um módulo para o tenant da sessão. Grava o override em
 * `TenantModule.enabled` (default do registro é usado quando não há linha).
 */
export async function toggleModuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await requireRole(ROLES_ADMIN);
  if (error) return { error: "Apenas administradores podem alterar módulos" };

  const parsed = toggleSchema.safeParse({
    moduleKey: formData.get("moduleKey"),
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const tenantId = session!.user.tenantId;
  const moduleKey = parsed.data.moduleKey;
  const enabled = parsed.data.enabled === "true";

  await prisma.tenantModule.upsert({
    where: { tenantId_moduleKey: { tenantId, moduleKey } },
    create: { tenantId, moduleKey, enabled },
    update: { enabled },
  });

  await logAudit({
    tenantId,
    userId: session!.user.id,
    action: "module.toggle",
    entity: "TenantModule",
    entityId: moduleKey,
    meta: { moduleKey, enabled },
  });

  revalidatePath("/configuracoes/modulos");
  return { success: `Módulo "${MODULES[moduleKey].label}" ${enabled ? "ativado" : "desativado"}.` };
}

/**
 * Atualiza a config do módulo de recuperação (cadência de follow-up).
 * Recebe `sequenceDays` como lista separada por vírgula (ex.: "1,3,7").
 */
export async function updateFollowupConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await requireRole(ROLES_ADMIN);
  if (error) return { error: "Apenas administradores podem editar configurações" };

  const raw = String(formData.get("sequenceDays") ?? "");
  const stopOnReply = formData.get("stopOnReply") === "on";

  const sequenceDays = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));

  if (sequenceDays.some((n) => Number.isNaN(n))) {
    return { error: "A cadência deve conter apenas números separados por vírgula (ex.: 1, 3, 7)" };
  }

  const parsed = FollowupConfigSchema.safeParse({ sequenceDays, stopOnReply });
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const tenantId = session!.user.tenantId;

  await prisma.tenantModule.upsert({
    where: { tenantId_moduleKey: { tenantId, moduleKey: "recuperacao" } },
    create: {
      tenantId,
      moduleKey: "recuperacao",
      enabled: MODULES.recuperacao.defaultEnabled,
      settings: parsed.data as Prisma.InputJsonValue,
    },
    update: { settings: parsed.data as Prisma.InputJsonValue },
  });

  await logAudit({
    tenantId,
    userId: session!.user.id,
    action: "module.config_update",
    entity: "TenantModule",
    entityId: "recuperacao",
    meta: { moduleKey: "recuperacao", sequenceDays: parsed.data.sequenceDays, stopOnReply: parsed.data.stopOnReply },
  });

  revalidatePath("/configuracoes/modulos");
  return { success: "Cadência de follow-up salva." };
}
