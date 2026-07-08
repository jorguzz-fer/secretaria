import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@crm/whatsapp", () => ({
  createEvolutionAdapter: vi.fn(() => ({ provider: "evolution" })),
  createZapiAdapter: vi.fn(() => ({ provider: "zapi" })),
}));

import { resolveWhatsappAdapter } from "../whatsapp-adapter";
import { createEvolutionAdapter, createZapiAdapter } from "@crm/whatsapp";

const evo = vi.mocked(createEvolutionAdapter);
const zap = vi.mocked(createZapiAdapter);

const SAVED = { ...process.env };

beforeEach(() => {
  evo.mockClear();
  zap.mockClear();
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("resolveWhatsappAdapter", () => {
  it("EVOLUTION → createEvolutionAdapter com env + instância", () => {
    process.env.EVOLUTION_API_URL = "https://evo.x";
    process.env.EVOLUTION_WEBHOOK_SECRET = "evo-secret";

    resolveWhatsappAdapter({ instanceName: "inst-a", provider: "EVOLUTION", phone: "+5511000000001" });

    expect(evo).toHaveBeenCalledWith({
      baseUrl: "https://evo.x",
      apiKey: "evo-secret",
      instanceName: "inst-a",
      instancePhone: "+5511000000001",
    });
    expect(zap).not.toHaveBeenCalled();
  });

  it("ZAPI → createZapiAdapter com env (instanceId = instanceName)", () => {
    process.env.ZAPI_INSTANCE_TOKEN = "tok";
    process.env.ZAPI_CLIENT_TOKEN = "client";
    process.env.ZAPI_BASE_URL = "https://api.z-api.io";

    resolveWhatsappAdapter({ instanceName: "3F5C", provider: "ZAPI", phone: "+5511964390121" });

    expect(zap).toHaveBeenCalledWith({
      instanceId: "3F5C",
      instanceToken: "tok",
      clientToken: "client",
      instancePhone: "+5511964390121",
      baseUrl: "https://api.z-api.io",
    });
    expect(evo).not.toHaveBeenCalled();
  });

  it("phone nulo → fallback +5500000000000", () => {
    resolveWhatsappAdapter({ instanceName: "x", provider: "ZAPI", phone: null });
    expect(zap).toHaveBeenCalledWith(expect.objectContaining({ instancePhone: "+5500000000000" }));
  });

  it("META_CLOUD → lança (ainda não habilitado)", () => {
    expect(() =>
      resolveWhatsappAdapter({ instanceName: "x", provider: "META_CLOUD", phone: null }),
    ).toThrow(/META_CLOUD/);
  });
});
