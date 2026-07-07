import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  decryptMaybe,
  maskSecret,
} from "../secrets";

beforeAll(() => {
  // Chave de teste determinística (32 bytes → base64)
  process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trip devolve o texto original", () => {
    const plain = "EAA-super-secret-token-123";
    const stored = encryptSecret(plain);
    expect(decryptSecret(stored)).toBe(plain);
  });

  it("valor cifrado é diferente do texto puro", () => {
    const plain = "meu-hottok";
    const stored = encryptSecret(plain);
    expect(stored).not.toContain(plain);
  });

  it("usa formato versionado v1:iv:tag:cipher", () => {
    const stored = encryptSecret("x");
    const parts = stored.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("cada cifragem usa IV novo (ciphertext não é determinístico)", () => {
    expect(encryptSecret("mesmo")).not.toBe(encryptSecret("mesmo"));
  });

  it("decrypt falha se o tag/ciphertext for adulterado", () => {
    const stored = encryptSecret("valor");
    const [v, iv, tag, data] = stored.split(":");
    const tamperedData = Buffer.from(data, "base64");
    tamperedData[0] ^= 0xff;
    const tampered = [v, iv, tag, tamperedData.toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("decrypt rejeita versão desconhecida", () => {
    const stored = encryptSecret("v");
    const bumped = stored.replace(/^v1:/, "v2:");
    expect(() => decryptSecret(bumped)).toThrow(/versão/i);
  });

  it("encrypt lança sem CONFIG_ENCRYPTION_KEY", () => {
    const saved = process.env.CONFIG_ENCRYPTION_KEY;
    delete process.env.CONFIG_ENCRYPTION_KEY;
    try {
      expect(() => encryptSecret("x")).toThrow(/CONFIG_ENCRYPTION_KEY/);
    } finally {
      process.env.CONFIG_ENCRYPTION_KEY = saved;
    }
  });

  it("lança se a chave não tiver 32 bytes", () => {
    const saved = process.env.CONFIG_ENCRYPTION_KEY;
    process.env.CONFIG_ENCRYPTION_KEY = Buffer.from("curta").toString("base64");
    try {
      expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    } finally {
      process.env.CONFIG_ENCRYPTION_KEY = saved;
    }
  });
});

describe("isEncrypted", () => {
  it("reconhece valores cifrados", () => {
    expect(isEncrypted(encryptSecret("a"))).toBe(true);
  });
  it("rejeita texto puro e vazios", () => {
    expect(isEncrypted("texto-puro")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });
});

describe("decryptMaybe", () => {
  it("decifra valores cifrados", () => {
    expect(decryptMaybe(encryptSecret("token"))).toBe("token");
  });
  it("devolve texto puro legado como está", () => {
    expect(decryptMaybe("legado-plaintext")).toBe("legado-plaintext");
  });
  it("devolve null para vazio/null", () => {
    expect(decryptMaybe(null)).toBeNull();
    expect(decryptMaybe("")).toBeNull();
  });
});

describe("maskSecret", () => {
  it("mostra só os últimos 4 caracteres", () => {
    expect(maskSecret("abcdef1234")).toBe("••••1234");
  });
  it("null/vazio → null", () => {
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret("")).toBeNull();
  });
});
