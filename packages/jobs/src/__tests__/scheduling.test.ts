import { describe, it, expect } from "vitest";
import { suggestSlots } from "../scheduling";
import { ScheduleConfigSchema } from "@crm/config";

// Config default (America/Sao_Paulo, 09-18, seg-sex, slot 30, lead 2h, horizon 7, sug 3)
const cfg = ScheduleConfigSchema.parse({});

// Helper: hora de parede (BRT = UTC-3) em UTC.
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe("suggestSlots", () => {
  it("sugere os primeiros N horários dentro do expediente (BRT)", () => {
    // Ter 2026-07-07 06:00 BRT → leadTime 2h → primeiro slot 09:00
    const now = brt("2026-07-07T06:00:00");
    const slots = suggestSlots(cfg, { now });
    expect(slots).toHaveLength(3);
    expect(slots[0].start.getTime()).toBe(brt("2026-07-07T09:00:00").getTime());
    expect(slots[1].start.getTime()).toBe(brt("2026-07-07T09:30:00").getTime());
    // duração = 30min
    expect(slots[0].end.getTime() - slots[0].start.getTime()).toBe(30 * 60_000);
  });

  it("respeita a antecedência mínima (leadTime)", () => {
    // Ter 10:15 BRT + 2h = 12:15 → primeiro slot ofertável é 12:30
    const now = brt("2026-07-07T10:15:00");
    const slots = suggestSlots(cfg, { now, count: 1 });
    expect(slots[0].start.getTime()).toBe(brt("2026-07-07T12:30:00").getTime());
  });

  it("pula horários ocupados (busy)", () => {
    const now = brt("2026-07-07T06:00:00");
    const busy = [
      { start: brt("2026-07-07T09:00:00"), end: brt("2026-07-07T09:30:00") },
      { start: brt("2026-07-07T09:30:00"), end: brt("2026-07-07T10:00:00") },
    ];
    const slots = suggestSlots(cfg, { now, busy, count: 1 });
    expect(slots[0].start.getTime()).toBe(brt("2026-07-07T10:00:00").getTime());
  });

  it("pula fim de semana (sáb/dom não são dias úteis)", () => {
    // Sáb 2026-07-11 08:00 BRT → primeiro slot cai na seg 2026-07-13 09:00
    const now = brt("2026-07-11T08:00:00");
    const slots = suggestSlots(cfg, { now, count: 1 });
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    }).format(slots[0].start);
    expect(p).toContain("Mon");
    expect(slots[0].start.getTime()).toBe(brt("2026-07-13T09:00:00").getTime());
  });

  it("não oferta depois do fim do expediente (último slot termina às 18:00)", () => {
    // Sexta tarde; pega todos os slots do dia a partir de agora
    const now = brt("2026-07-07T16:00:00");
    const slots = suggestSlots(cfg, { now, count: 10 });
    for (const s of slots.filter((x) => x.start < brt("2026-07-08T00:00:00"))) {
      expect(s.end.getTime()).toBeLessThanOrEqual(brt("2026-07-07T18:00:00").getTime());
    }
  });

  it("respeita duração custom sem sobrepor (slot 45min)", () => {
    const c45 = ScheduleConfigSchema.parse({ slotMinutes: 45, leadTimeHours: 0 });
    const now = brt("2026-07-07T08:00:00");
    const slots = suggestSlots(c45, { now, count: 3 });
    expect(slots[0].start.getTime()).toBe(brt("2026-07-07T09:00:00").getTime());
    expect(slots[1].start.getTime()).toBe(brt("2026-07-07T09:45:00").getTime());
    expect(slots[2].start.getTime()).toBe(brt("2026-07-07T10:30:00").getTime());
  });

  it("timezone diferente muda os instantes UTC", () => {
    const cLisbon = ScheduleConfigSchema.parse({ timezone: "Europe/Lisbon", leadTimeHours: 0 });
    const now = new Date("2026-07-07T00:00:00Z");
    const slots = suggestSlots(cLisbon, { now, count: 1 });
    // Lisboa no verão = UTC+1 → 09:00 local = 08:00 UTC
    expect(slots[0].start.toISOString()).toBe("2026-07-07T08:00:00.000Z");
  });
});
