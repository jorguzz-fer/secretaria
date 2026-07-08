import type { ScheduleConfig } from "@crm/config";

/**
 * Motor de sugestão de horários (Agenda). Puro e timezone-aware via `Intl`
 * (sem lib de data). `now` e `busy` são injetados — 100% determinístico/testável.
 *
 * Gera os próximos N horários livres dentro do horário comercial configurado,
 * respeitando dias úteis, antecedência mínima (leadTime), horizonte e ocupação.
 */

export interface TimeRange {
  start: Date;
  end: Date;
}

// Offset (ms) do timezone `tz` no instante `instant`: (parede em tz) − UTC.
function tzOffsetMs(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // 'hour' pode vir "24" à meia-noite em alguns ambientes → normaliza.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asUTC - instant.getTime();
}

// Converte um horário de parede (Y-M-D H:M no tz) para o instante UTC correto.
function zonedWallToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - off);
}

// Y/M/D e dia-da-semana (0=dom) de um instante, no tz.
function zonedParts(instant: Date, tz: string): { y: number; mo: number; d: number; wd: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map.weekday);
  return { y: Number(map.year), mo: Number(map.month), d: Number(map.day), wd };
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface SuggestSlotsInput {
  now: Date;
  busy?: TimeRange[];
  count?: number;
}

export function suggestSlots(config: ScheduleConfig, input: SuggestSlotsInput): TimeRange[] {
  const { timezone, slotMinutes, workdays, startHour, endHour, leadTimeHours, horizonDays } = config;
  const count = input.count ?? config.suggestions;
  const busy = input.busy ?? [];

  const earliest = new Date(input.now.getTime() + leadTimeHours * 3_600_000);
  const slotMs = slotMinutes * 60_000;
  const out: TimeRange[] = [];

  const startMin = startHour * 60;
  const endMin = endHour * 60;

  for (let dayOffset = 0; dayOffset <= horizonDays && out.length < count; dayOffset++) {
    const dayInstant = new Date(input.now.getTime() + dayOffset * 86_400_000);
    const { y, mo, d, wd } = zonedParts(dayInstant, timezone);
    if (!workdays.includes(wd)) continue;

    // Passos de slotMinutes que caibam inteiros dentro do expediente — slots
    // consecutivos e não sobrepostos, mesmo para durações não divisoras da hora.
    for (let m = startMin; m + slotMinutes <= endMin && out.length < count; m += slotMinutes) {
      const start = zonedWallToUtc(y, mo, d, Math.floor(m / 60), m % 60, timezone);
      const end = new Date(start.getTime() + slotMs);
      if (start < earliest) continue;
      const slot = { start, end };
      if (busy.some((b) => overlaps(slot, b))) continue;
      out.push(slot);
    }
  }

  return out;
}
