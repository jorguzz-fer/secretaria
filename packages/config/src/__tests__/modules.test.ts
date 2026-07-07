import { describe, it, expect } from "vitest";
import {
  MODULES,
  MODULE_KEYS,
  isModuleKey,
  defaultConfig,
} from "../modules";

describe("MODULES registry", () => {
  it("contém os 7 módulos da plataforma", () => {
    expect(MODULE_KEYS.sort()).toEqual(
      ["agenda", "arquivos", "cobranca", "escalada", "recuperacao", "secretaria", "voz"].sort(),
    );
  });

  it("Voz e Cobrança são defaultEnabled=false; SDR/recuperação/escalada true", () => {
    expect(MODULES.voz.defaultEnabled).toBe(false);
    expect(MODULES.cobranca.defaultEnabled).toBe(false);
    expect(MODULES.agenda.defaultEnabled).toBe(false);
    expect(MODULES.arquivos.defaultEnabled).toBe(false);
    expect(MODULES.secretaria.defaultEnabled).toBe(true);
    expect(MODULES.recuperacao.defaultEnabled).toBe(true);
    expect(MODULES.escalada.defaultEnabled).toBe(true);
  });

  it("cada módulo tem label, description e schema", () => {
    for (const key of MODULE_KEYS) {
      const m = MODULES[key];
      expect(typeof m.label).toBe("string");
      expect(m.label.length).toBeGreaterThan(0);
      expect(typeof m.description).toBe("string");
      expect(m.schema).toBeDefined();
    }
  });

  it("schema de cada módulo resolve config válida a partir de {}", () => {
    for (const key of MODULE_KEYS) {
      expect(() => MODULES[key].schema.parse({})).not.toThrow();
    }
  });
});

describe("isModuleKey", () => {
  it("reconhece chaves válidas", () => {
    expect(isModuleKey("recuperacao")).toBe(true);
    expect(isModuleKey("voz")).toBe(true);
  });

  it("rejeita chaves desconhecidas", () => {
    expect(isModuleKey("inexistente")).toBe(false);
    expect(isModuleKey("")).toBe(false);
    // não confunde com propriedades herdadas de Object
    expect(isModuleKey("toString")).toBe(false);
  });
});

describe("defaultConfig", () => {
  it("recuperacao vem com cadência [1,3,7] e stopOnReply=true", () => {
    expect(defaultConfig("recuperacao")).toEqual({
      sequenceDays: [1, 3, 7],
      stopOnReply: true,
    });
  });
});

describe("FollowupConfigSchema", () => {
  const schema = MODULES.recuperacao.schema;

  it("aceita cadência custom crescente", () => {
    const parsed = schema.parse({ sequenceDays: [2, 5, 10, 20] });
    expect(parsed.sequenceDays).toEqual([2, 5, 10, 20]);
  });

  it("rejeita cadência não crescente", () => {
    expect(() => schema.parse({ sequenceDays: [3, 1] })).toThrow();
  });

  it("rejeita dias não inteiros/negativos", () => {
    expect(() => schema.parse({ sequenceDays: [0] })).toThrow();
    expect(() => schema.parse({ sequenceDays: [1.5] })).toThrow();
  });

  it("rejeita array vazio", () => {
    expect(() => schema.parse({ sequenceDays: [] })).toThrow();
  });

  it("rejeita campos desconhecidos (strict)", () => {
    expect(() => schema.parse({ sequenceDays: [1], foo: "bar" })).toThrow();
  });
});
