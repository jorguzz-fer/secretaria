/**
 * Detecção de provedor a partir do corpo bruto do webhook.
 *
 * Evolution e Z-API postam na mesma rota `/api/webhooks/whatsapp`; os formatos
 * são distintos:
 * - Evolution: `{ instance: "<nome>", event: "messages.upsert", data: ... }`
 * - Z-API:     `{ instanceId: "<id>", type: "ReceivedCallback", phone, ... }`
 *
 * Retorna também a `instanceKey` — o identificador usado para achar a
 * `WhatsAppInstance` no banco (Evolution → `instance`; Z-API → `instanceId`).
 */

export interface DetectedProvider {
  provider: "evolution" | "zapi";
  instanceKey: string;
}

export function detectProvider(rawBody: string): DetectedProvider | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Evolution: campo `instance` (nome) + `event`.
  if (typeof body.instance === "string" && body.instance.length > 0) {
    return { provider: "evolution", instanceKey: body.instance };
  }

  // Z-API: campo `instanceId`.
  if (typeof body.instanceId === "string" && body.instanceId.length > 0) {
    return { provider: "zapi", instanceKey: body.instanceId };
  }

  return null;
}
