"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@crm/db";
import { requireRole } from "@/lib/authz";
import { onboardTenant } from "@/lib/onboarding";
import { onboardTenantSchema } from "@crm/validators";

export type ActionState = { error: string } | { success: string } | null;

/**
 * Cria um novo cliente (tenant) com defaults. Apenas SUPERADMIN — criar tenant
 * é operação de plataforma, fora do escopo de um ADMIN de tenant.
 */
export async function onboardTenantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await requireRole(["SUPERADMIN"]);
  if (error) return { error: "Apenas superadmin pode criar clientes" };

  const parsed = onboardTenantSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const existing = await prisma.tenant.findUnique({
    where: { slug: parsed.data.slug },
    select: { id: true },
  });
  if (existing) return { error: "Slug já em uso" };

  const { slug } = await onboardTenant(parsed.data, {
    actorUserId: session!.user.id,
  });

  revalidatePath("/configuracoes");
  return { success: `Cliente "${parsed.data.name}" criado (${slug}).` };
}
