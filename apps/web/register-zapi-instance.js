"use strict";
/**
 * Registra (idempotente) a instância WhatsApp do Z-API para um tenant.
 *
 * As CREDENCIAIS do Z-API (token/client-token) NÃO ficam aqui — vivem em env
 * vars lidas em runtime pela rota do webhook. Este script só cria o vínculo
 * instância ↔ tenant no banco (instanceName = ZAPI_INSTANCE_ID, provider ZAPI).
 *
 * Uso:
 *   ZAPI_INSTANCE_ID="3F5C..." ZAPI_PHONE="+5511964390121" TENANT_SLUG="medicine" \
 *     DATABASE_URL="..." node apps/web/register-zapi-instance.js
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const phone = process.env.ZAPI_PHONE || null;
  const tenantSlug = process.env.TENANT_SLUG;

  if (!instanceId || !tenantSlug) {
    console.error("❌ ZAPI_INSTANCE_ID e TENANT_SLUG são obrigatórios");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    console.error(`❌ Tenant '${tenantSlug}' não encontrado`);
    process.exit(1);
  }

  const instance = await prisma.whatsAppInstance.upsert({
    where: { instanceName: instanceId },
    update: { provider: "ZAPI", phone, tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      instanceName: instanceId,
      provider: "ZAPI",
      phone,
      status: "DISCONNECTED",
    },
  });

  console.log(`✓ Instância Z-API registrada: ${instance.instanceName} → tenant '${tenantSlug}'`);
  console.log("  Configure o webhook 'Ao receber' no Z-API apontando para:");
  console.log("    https://SEU_APP/api/webhooks/whatsapp");
}

main()
  .catch((e) => {
    console.error("❌ Falhou:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
