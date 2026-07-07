import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { MODULE_KEYS, MODULES, FollowupConfigSchema } from "@crm/config";
import { ModulesList } from "./ModulesList";
import { FollowupConfigForm } from "./FollowupConfigForm";
import { ToggleLeft } from "lucide-react";

export const metadata: Metadata = { title: "Módulos" };

export default async function ModulesSettingsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const tenantId = session.user.tenantId;
  const isAdmin = ["SUPERADMIN", "ADMIN"].includes(session.user.role);

  const rows = await prisma.tenantModule.findMany({
    where: { tenantId },
    select: { moduleKey: true, enabled: true, settings: true },
  });
  const byKey = new Map(rows.map((r) => [r.moduleKey, r]));

  // Estado por módulo = override do banco ?? default do registro.
  const modules = MODULE_KEYS.map((key) => ({
    key,
    label: MODULES[key].label,
    description: MODULES[key].description,
    enabled: byKey.get(key)?.enabled ?? MODULES[key].defaultEnabled,
  }));

  // Config atual da recuperação (defaults + override validado).
  const followup = FollowupConfigSchema.parse(byKey.get("recuperacao")?.settings ?? {});
  const recuperacaoEnabled = byKey.get("recuperacao")?.enabled ?? MODULES.recuperacao.defaultEnabled;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Módulos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ative ou desative funcionalidades da plataforma para este cliente. Um módulo
          desativado não executa nenhuma automação.
        </p>
      </div>

      {!isAdmin ? (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <ToggleLeft size={16} className="shrink-0 mt-0.5" />
          <p>Apenas administradores podem ativar/desativar módulos.</p>
        </div>
      ) : (
        <>
          <ModulesList modules={modules} />

          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold border-b border-border pb-2">
                Recuperação de leads — cadência de follow-up
              </h2>
              <p className="text-xs text-muted-foreground mt-2">
                Dias após o primeiro contato em que cada tentativa de follow-up é enviada.
                Substitui a antiga cadência fixa <span className="font-mono">1, 3, 7</span>.
              </p>
            </div>
            {recuperacaoEnabled ? (
              <FollowupConfigForm
                sequenceDays={followup.sequenceDays}
                stopOnReply={followup.stopOnReply}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Ative o módulo <strong>Recuperação de leads</strong> acima para configurar a cadência.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
