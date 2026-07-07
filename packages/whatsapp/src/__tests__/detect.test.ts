import { describe, it, expect } from "vitest";
import { detectProvider } from "../detect";

describe("detectProvider", () => {
  it("detecta Evolution por `instance` + `event`", () => {
    const body = JSON.stringify({ instance: "medicine-evo", event: "messages.upsert", data: {} });
    expect(detectProvider(body)).toEqual({ provider: "evolution", instanceKey: "medicine-evo" });
  });

  it("detecta Z-API por `instanceId`", () => {
    const body = JSON.stringify({ instanceId: "3F5C...", type: "ReceivedCallback", phone: "5511" });
    expect(detectProvider(body)).toEqual({ provider: "zapi", instanceKey: "3F5C..." });
  });

  it("Evolution tem prioridade quando ambos os campos aparecem", () => {
    const body = JSON.stringify({ instance: "evo", instanceId: "zid" });
    expect(detectProvider(body)?.provider).toBe("evolution");
  });

  it("retorna null quando não reconhece", () => {
    expect(detectProvider(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("retorna null para JSON inválido", () => {
    expect(detectProvider("not-json")).toBeNull();
  });
});
