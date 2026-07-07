"use strict";
/**
 * Data migration (idempotente) — cifra os segredos existentes de
 * TenantTrackingConfig que ainda estão em texto puro.
 *
 * Contexto: até o Módulo 0 os segredos (metaAccessToken, hotmartHottok,
 * pagarmeWebhookSecret) eram gravados em texto puro. Esta migração converte os
 * valores existentes para o formato cifrado AES-256-GCM `v1:iv:tag:cipher`
 * (mesmo formato de `packages/config/src/secrets.ts`).
 *
 * Idempotente: valores que já começam com "v1:" são pulados — rodar duas vezes
 * não faz nada na segunda.
 *
 * Requer `CONFIG_ENCRYPTION_KEY` (32 bytes em base64) no ambiente.
 *
 * Uso:
 *   CONFIG_ENCRYPTION_KEY="..." DATABASE_URL="..." \
 *     node packages/db/prisma/data-migrations/0015_encrypt_tracking_secrets.js
 */

const { PrismaClient } = require("@prisma/client");
const { createCipheriv, randomBytes } = require("crypto");

const VERSION = "v1";
const SECRET_FIELDS = ["metaAccessToken", "hotmartHottok", "pagarmeWebhookSecret"];

function getKey() {
  const b64 = process.env.CONFIG_ENCRYPTION_KEY;
  if (!b64) throw new Error("CONFIG_ENCRYPTION_KEY não configurada");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(`CONFIG_ENCRYPTION_KEY deve ter 32 bytes em base64 (recebido: ${key.length})`);
  }
  return key;
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

function encryptSecret(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

async function main() {
  const key = getKey();
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.tenantTrackingConfig.findMany({
      select: {
        id: true,
        metaAccessToken: true,
        hotmartHottok: true,
        pagarmeWebhookSecret: true,
      },
    });

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const data = {};
      for (const field of SECRET_FIELDS) {
        const value = row[field];
        if (value && !isEncrypted(value)) {
          data[field] = encryptSecret(value, key);
        }
      }

      if (Object.keys(data).length > 0) {
        await prisma.tenantTrackingConfig.update({ where: { id: row.id }, data });
        updated++;
      } else {
        skipped++;
      }
    }

    console.log(`✓ Cifragem concluída: ${updated} config(s) atualizada(s), ${skipped} já cifrada(s)/vazia(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("❌ Migração de cifragem falhou:", e.message);
  process.exit(1);
});
