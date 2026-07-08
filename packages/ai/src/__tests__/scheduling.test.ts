import { describe, it, expect } from "vitest";
import {
  schedulingIntentSchema,
  schedulingInterpretInputSchema,
} from "../assistants/scheduling";

describe("schedulingIntentSchema", () => {
  it("aceita pick com índice", () => {
    expect(schedulingIntentSchema.safeParse({ action: "pick", pickedIndex: 2 }).success).toBe(true);
  });
  it("aceita none com pickedIndex null", () => {
    expect(schedulingIntentSchema.safeParse({ action: "none", pickedIndex: null }).success).toBe(true);
  });
  it("rejeita action desconhecida", () => {
    expect(schedulingIntentSchema.safeParse({ action: "book", pickedIndex: null }).success).toBe(false);
  });
  it("rejeita pickedIndex 0", () => {
    expect(schedulingIntentSchema.safeParse({ action: "pick", pickedIndex: 0 }).success).toBe(false);
  });
});

describe("schedulingInterpretInputSchema", () => {
  it("offeredSlots default = []", () => {
    const r = schedulingInterpretInputSchema.safeParse({
      messages: [{ role: "lead", content: "oi", at: new Date() }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.offeredSlots).toEqual([]);
  });
  it("exige ao menos uma mensagem", () => {
    expect(
      schedulingInterpretInputSchema.safeParse({ messages: [], offeredSlots: [] }).success,
    ).toBe(false);
  });
});
