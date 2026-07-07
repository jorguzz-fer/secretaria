import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifragem de segredos de integração (AES-256-GCM).
 *
 * Formato armazenado: `v1:iv:tag:cipher` — cada parte em base64.
 * O prefixo de versão (`v1`) prepara rotação de chave/algoritmo no futuro.
 *
 * Chave: 32 bytes em `CONFIG_ENCRYPTION_KEY` (env, base64).
 *
 * Regras (ver spec §4.4 e SECURITY_CHECKLIST):
 * - Segredo nunca é logado.
 * - Segredo nunca vai no payload ao client — a UI mostra só `maskSecret()`.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const b64 = process.env.CONFIG_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "CONFIG_ENCRYPTION_KEY não configurada — necessária para cifrar/decifrar segredos",
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CONFIG_ENCRYPTION_KEY deve ter ${KEY_BYTES} bytes em base64 (recebido: ${key.length})`,
    );
  }
  return key;
}

/** Cifra um segredo em texto puro. Retorna `v1:iv:tag:cipher` (base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/** Decifra um valor produzido por `encryptSecret`. Lança se o formato/versão for inválido. */
export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new Error("Segredo cifrado em formato inválido");
  }
  const [version, ivB64, tagB64, dataB64] = parts;
  if (version !== VERSION) {
    throw new Error(`Versão de cifra não suportada: ${version}`);
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** `true` se `value` está no formato cifrado versionado (`v1:...`). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

/**
 * Decifra se estiver cifrado; caso contrário devolve o valor como está.
 *
 * Ponte de compatibilidade para segredos legados gravados em texto puro antes
 * da migração de cifragem — leitores (webhooks, servidor) usam esta função para
 * não quebrar enquanto a migração de dados não roda.
 */
export function decryptMaybe(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return isEncrypted(value) ? decryptSecret(value) : value;
}

/**
 * Máscara para exibição na UI: `••••1234` (apenas os últimos 4 caracteres).
 * Recebe o valor **em texto puro** (nunca envie o cifrado ao client). Retorna
 * `null` para valores vazios.
 */
export function maskSecret(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const last4 = plain.slice(-4);
  return `••••${last4}`;
}
