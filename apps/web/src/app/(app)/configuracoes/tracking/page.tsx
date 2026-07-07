import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTrackingSecrets } from "@/lib/tenant-secrets";
import { maskSecret } from "@crm/config/secrets";
import { TrackingConfigForm } from "./TrackingConfigForm";
import { BarChart2 } from "lucide-react";

export const metadata: Metadata = { title: "Tracking & Conversões" };

export default async function TrackingSettingsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const tenantId = session.user.tenantId;
  const isAdmin = ["SUPERADMIN", "ADMIN"].includes(session.user.role);

  // Decifra server-side e envia ao client APENAS a máscara (••••1234) dos
  // segredos — nunca o texto puro. metaPixelId não é segredo (ID público).
  const secrets = await getTrackingSecrets(tenantId);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Tracking & Conversões</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure as integrações de rastreamento de conversões e gateways de pagamento.
        </p>
      </div>

      {!isAdmin ? (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <BarChart2 size={16} className="shrink-0 mt-0.5" />
          <p>Apenas administradores podem editar as configurações de tracking.</p>
        </div>
      ) : (
        <TrackingConfigForm
          metaPixelId={secrets.metaPixelId}
          metaAccessTokenMask={maskSecret(secrets.metaAccessToken)}
          hotmartHottokMask={maskSecret(secrets.hotmartHottok)}
          pagarmeWebhookSecretMask={maskSecret(secrets.pagarmeWebhookSecret)}
          tenantId={tenantId}
        />
      )}
    </div>
  );
}
