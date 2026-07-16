import { describe, it, expect } from "vitest";
import {
  firstContactInputSchema,
  firstContactOutputSchema,
  followUpInputSchema,
  followUpOutputSchema,
  replyInputSchema,
  replyOutputSchema,
  generateFirstContact,
  generateFollowUp,
  buildReplySystem,
  type SdrPersona,
} from "../assistants/sdr";

describe("replyInputSchema", () => {
  const base = {
    tenantId: "t1",
    leadName: "João",
    channel: "whatsapp" as const,
    messages: [{ role: "lead" as const, content: "Qual o valor?", at: new Date() }],
  };

  it("aceita payload mínimo (leadId opcional, tone default)", () => {
    const r = replyInputSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tone).toBe("consultivo");
  });

  it("exige ao menos uma mensagem", () => {
    expect(replyInputSchema.safeParse({ ...base, messages: [] }).success).toBe(false);
  });

  it("rejeita canal desconhecido", () => {
    expect(replyInputSchema.safeParse({ ...base, channel: "telegram" }).success).toBe(false);
  });
});

describe("replyOutputSchema", () => {
  it("aceita saída válida com escalationReason null", () => {
    const r = replyOutputSchema.safeParse({
      message: "Oi! O investimento varia conforme a turma...",
      shouldEscalate: false,
      escalationReason: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejeita mensagem acima de 900 chars", () => {
    const r = replyOutputSchema.safeParse({
      message: "x".repeat(901),
      shouldEscalate: false,
      escalationReason: null,
    });
    expect(r.success).toBe(false);
  });
});

describe("buildReplySystem (persona por tenant)", () => {
  const persona: SdrPersona = {
    agentName: "Bia",
    businessName: "Faculdade Medicine",
    role: "uma consultora de pós-graduações",
    tone: "informal",
    productInfo: "Especialização em Cardiologia — 12x R$ 890.",
    goal: "agendar uma call",
    instructions: "Nunca prometa desconto.",
    canQuotePrice: true,
  };

  it("sem persona retorna o prompt estático padrão", () => {
    const s = buildReplySystem();
    expect(s).toContain("SDR consultivo especializado em pós-graduações médicas");
  });

  it("com persona injeta nome, negócio, função e tom", () => {
    const s = buildReplySystem(persona);
    expect(s).toContain("Você é Bia, uma consultora de pós-graduações da Faculdade Medicine.");
    expect(s).toContain("objetivo e informal");
    expect(s).toContain("agendar uma call");
  });

  it("canQuotePrice=true libera falar preço e injeta o contexto do produto", () => {
    const s = buildReplySystem(persona);
    expect(s).toContain("Você PODE informar preços");
    expect(s).toContain("Especialização em Cardiologia — 12x R$ 890.");
    expect(s).toContain("Nunca prometa desconto.");
  });

  it("canQuotePrice=false proíbe citar preço", () => {
    const s = buildReplySystem({ ...persona, canQuotePrice: false });
    expect(s).toContain("NÃO informe preços");
    expect(s).not.toContain("Você PODE informar preços");
  });

  it("campos vazios (businessName/productInfo) não vazam para o prompt", () => {
    const s = buildReplySystem({ ...persona, businessName: "", productInfo: "", instructions: "" });
    expect(s).toContain("Você é Bia, uma consultora de pós-graduações.");
    expect(s).not.toContain("CONTEXTO DO PRODUTO");
    expect(s).not.toContain("INSTRUÇÕES ADICIONAIS");
  });
});

describe("firstContactInputSchema", () => {
  it("aceita payload mínimo válido", () => {
    const result = firstContactInputSchema.safeParse({
      tenantId: "t1",
      leadId: "l1",
      leadName: "João",
      channel: "whatsapp",
      productContext: {
        name: "Pós Cardio",
        priceBrl: 14997,
        highlights: ["EAD", "certificado MEC"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejeita canal desconhecido", () => {
    const result = firstContactInputSchema.safeParse({
      tenantId: "t1",
      leadId: "l1",
      leadName: "João",
      channel: "telegram",
      productContext: { name: "X", priceBrl: 1, highlights: ["a"] },
    });
    expect(result.success).toBe(false);
  });

  it("exige priceBrl positivo", () => {
    const result = firstContactInputSchema.safeParse({
      tenantId: "t1",
      leadId: "l1",
      leadName: "João",
      channel: "whatsapp",
      productContext: { name: "X", priceBrl: 0, highlights: ["a"] },
    });
    expect(result.success).toBe(false);
  });

  it("aplica tone=consultivo como default", () => {
    const result = firstContactInputSchema.safeParse({
      tenantId: "t1",
      leadId: "l1",
      leadName: "João",
      channel: "whatsapp",
      productContext: { name: "X", priceBrl: 100, highlights: ["a"] },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tone).toBe("consultivo");
  });
});

describe("firstContactOutputSchema", () => {
  it("aceita output válido", () => {
    const result = firstContactOutputSchema.safeParse({
      message: "Oi João! Vi que você baixou o material...",
      suggestedFollowUpMinutes: 120,
      intent: "qualify",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita message vazia", () => {
    const result = firstContactOutputSchema.safeParse({
      message: "",
      suggestedFollowUpMinutes: 60,
      intent: "qualify",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita message acima de 900 chars (WhatsApp-safe)", () => {
    const result = firstContactOutputSchema.safeParse({
      message: "x".repeat(901),
      suggestedFollowUpMinutes: 60,
      intent: "qualify",
    });
    expect(result.success).toBe(false);
  });
});

describe("generateFirstContact (Fase 2)", () => {
  // Comportamentos cobertos em sdr.behavior.test.ts (com mocks do AI SDK).
  it.todo("não inclui link de pagamento na primeira mensagem");
  it.todo("suggestedFollowUpMinutes respeita canal (wpp=120, email=1440)");
});

describe("followUpInputSchema", () => {
  it("aceita payload válido", () => {
    const result = followUpInputSchema.safeParse({
      tenantId: "t1",
      leadId: "l1",
      leadName: "João",
      channel: "whatsapp",
      previousMessages: [{ role: "sdr", content: "oi", at: new Date() }],
      attempt: 1,
      daysSinceLastReply: 3,
    });
    expect(result.success).toBe(true);
  });

  it("rejeita attempt > 5 (cap de follow-ups)", () => {
    const result = followUpInputSchema.safeParse({
      tenantId: "t1",
      leadId: "l1",
      leadName: "João",
      channel: "whatsapp",
      previousMessages: [{ role: "sdr", content: "oi", at: new Date() }],
      attempt: 6,
      daysSinceLastReply: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe("followUpOutputSchema", () => {
  it("aceita shouldEscalate true com nextAttemptHours null", () => {
    const result = followUpOutputSchema.safeParse({
      message: "Vou te colocar com um consultor.",
      shouldEscalate: true,
      nextAttemptHours: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("generateFollowUp (Fase 2)", () => {
  // Comportamentos cobertos em sdr.behavior.test.ts (com mocks do AI SDK).
  it.todo("attempt=5 retorna shouldEscalate=true E nextAttemptHours=null");
  it.todo("nunca repete verbatim o texto da attempt anterior");
});
