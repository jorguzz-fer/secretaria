import { prisma } from "@/lib/db";
import { decryptMaybe } from "@crm/config/secrets";

/**
 * Leitura de segredos de integração do tenant (TenantTrackingConfig).
 *
 * Os segredos ficam **cifrados em repouso** (AES-256-GCM). Este helper decifra
 * na borda de uso (webhooks, chamadas server-side a APIs externas). Valores
 * legados em texto puro (gravados antes da migração de cifragem) são
 * devolvidos como estão — `decryptMaybe` cobre os dois casos.
 *
 * Nunca exponha o retorno desta função ao client — é texto puro. A UI usa
 * `maskSecret` (via TrackingConfigForm), não estes valores.
 */
export interface TenantTrackingSecrets {
  metaPixelId: string | null;
  metaAccessToken: string | null;
  hotmartHottok: string | null;
  pagarmeWebhookSecret: string | null;
}

export async function getTrackingSecrets(tenantId: string): Promise<TenantTrackingSecrets> {
  const config = await prisma.tenantTrackingConfig.findUnique({
    where: { tenantId },
    select: {
      metaPixelId: true,
      metaAccessToken: true,
      hotmartHottok: true,
      pagarmeWebhookSecret: true,
    },
  });

  return {
    // metaPixelId não é segredo (ID público) — não é cifrado.
    metaPixelId: config?.metaPixelId ?? null,
    metaAccessToken: decryptMaybe(config?.metaAccessToken),
    hotmartHottok: decryptMaybe(config?.hotmartHottok),
    pagarmeWebhookSecret: decryptMaybe(config?.pagarmeWebhookSecret),
  };
}
