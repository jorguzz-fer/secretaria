import { createEvolutionAdapter, createZapiAdapter, type WhatsAppAdapter } from "@crm/whatsapp";
import type { WaProvider } from "@crm/db";

/**
 * Resolve o adapter de envio conforme o `provider` da instância do tenant.
 *
 * Antes o envio (first-contact/follow-up) era chumbado no Evolution; agora
 * respeita o provedor real da `WhatsAppInstance`. Credenciais vêm de env
 * (nunca do banco/código) — mesmo padrão do receptor de webhooks.
 */
export interface InstanceForAdapter {
  instanceName: string;
  provider: WaProvider;
  phone: string | null;
}

export function resolveWhatsappAdapter(instance: InstanceForAdapter): WhatsAppAdapter {
  const instancePhone = instance.phone ?? "+5500000000000";

  switch (instance.provider) {
    case "ZAPI":
      return createZapiAdapter({
        instanceId: instance.instanceName,
        instanceToken: process.env.ZAPI_INSTANCE_TOKEN ?? "",
        clientToken: process.env.ZAPI_CLIENT_TOKEN ?? "",
        instancePhone,
        baseUrl: process.env.ZAPI_BASE_URL,
      });

    case "META_CLOUD":
      throw new Error(
        "Adapter META_CLOUD ainda não habilitado para envio (ver OPEN_QUESTIONS #1)",
      );

    case "EVOLUTION":
    default:
      return createEvolutionAdapter({
        baseUrl: process.env.EVOLUTION_API_URL ?? "",
        apiKey: process.env.EVOLUTION_WEBHOOK_SECRET ?? "",
        instanceName: instance.instanceName,
        instancePhone,
      });
  }
}
