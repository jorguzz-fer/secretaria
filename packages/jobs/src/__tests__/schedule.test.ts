import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@crm/db", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock("@crm/config", () => ({ getTenantConfig: vi.fn() }));
vi.mock("@crm/ai", () => ({ interpretScheduling: vi.fn() }));
vi.mock("../scheduling", () => ({ suggestSlots: vi.fn() }));

import { tryScheduling } from "../functions/schedule";
import { prisma } from "@crm/db";
import { getTenantConfig } from "@crm/config";
import { interpretScheduling } from "@crm/ai";
import { suggestSlots } from "../scheduling";

const findMany = vi.mocked(prisma.appointment.findMany);
const update = vi.mocked(prisma.appointment.update);
const updateMany = vi.mocked(prisma.appointment.updateMany);
const deleteMany = vi.mocked(prisma.appointment.deleteMany);
const createMany = vi.mocked(prisma.appointment.createMany);
const cfg = vi.mocked(getTenantConfig);
const intent = vi.mocked(interpretScheduling);
const slots = vi.mocked(suggestSlots);

const CONFIG = { timezone: "America/Sao_Paulo" };
const base = {
  tenantId: "t1",
  conversationId: "conv-1",
  leadId: "lead-1",
  leadName: "Ana",
  history: [{ role: "lead" as const, content: "quero marcar uma reunião", at: new Date() }],
  now: new Date("2026-07-07T12:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  cfg.mockResolvedValue(CONFIG as never);
  findMany.mockResolvedValue([] as never);
  update.mockResolvedValue({} as never);
  updateMany.mockResolvedValue({ count: 0 } as never);
  deleteMany.mockResolvedValue({ count: 0 } as never);
  createMany.mockResolvedValue({ count: 0 } as never);
});

describe("tryScheduling", () => {
  it("intenção none → handled=false, sem escrever nada", async () => {
    intent.mockResolvedValueOnce({ action: "none", pickedIndex: null });
    const res = await tryScheduling(base);
    expect(res).toEqual({ handled: false });
    expect(createMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("propose → sugere horários, grava PROPOSED e lista na resposta", async () => {
    findMany.mockResolvedValueOnce([] as never); // pending
    intent.mockResolvedValueOnce({ action: "propose", pickedIndex: null });
    findMany.mockResolvedValueOnce([] as never); // confirmed (busy)
    slots.mockReturnValueOnce([
      { start: new Date("2026-07-07T12:00:00Z"), end: new Date("2026-07-07T12:30:00Z") },
      { start: new Date("2026-07-07T12:30:00Z"), end: new Date("2026-07-07T13:00:00Z") },
    ]);

    const res = await tryScheduling(base);
    expect(res.handled).toBe(true);
    if (res.handled) {
      expect(res.replyText).toContain("1)");
      expect(res.replyText).toContain("2)");
    }
    // limpa antigas + cria as novas propostas
    expect(deleteMany).toHaveBeenCalled();
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ tenantId: "t1", conversationId: "conv-1", status: "PROPOSED" }),
        ]),
      }),
    );
  });

  it("propose sem horários livres → mensagem de indisponibilidade", async () => {
    intent.mockResolvedValueOnce({ action: "propose", pickedIndex: null });
    slots.mockReturnValueOnce([]);
    const res = await tryScheduling(base);
    expect(res.handled).toBe(true);
    if (res.handled) expect(res.replyText).toMatch(/não tenho horários|consultor/i);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("pick válido → confirma o escolhido e cancela os outros", async () => {
    findMany.mockResolvedValueOnce([
      { id: "appt-1", startsAt: new Date("2026-07-07T12:00:00Z") },
      { id: "appt-2", startsAt: new Date("2026-07-07T12:30:00Z") },
    ] as never);
    intent.mockResolvedValueOnce({ action: "pick", pickedIndex: 2 });

    const res = await tryScheduling(base);
    expect(res.handled).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "appt-2" }, data: { status: "CONFIRMED" } }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PROPOSED", id: { not: "appt-2" } }),
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("pick com índice inválido (sem pending) → handled=false", async () => {
    findMany.mockResolvedValueOnce([] as never); // sem pending
    intent.mockResolvedValueOnce({ action: "pick", pickedIndex: 1 });
    const res = await tryScheduling(base);
    expect(res).toEqual({ handled: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("scoping: consultas de Appointment usam tenantId + conversationId", async () => {
    intent.mockResolvedValueOnce({ action: "none", pickedIndex: null });
    await tryScheduling(base);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "t1", conversationId: "conv-1", status: "PROPOSED" }),
      }),
    );
  });
});
