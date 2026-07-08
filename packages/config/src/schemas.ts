import { z } from "zod";

/**
 * Schemas de configuração por módulo.
 *
 * Cada schema carrega seus próprios **defaults** (via `.default()` do Zod),
 * então uma config "vazia" (`schema.parse({})`) já resolve para valores
 * válidos — sem precisar de nenhuma linha no banco.
 *
 * Módulo 0 entrega apenas a fatia vertical de `recuperacao` (cadência de
 * follow-up) totalmente cabeada de ponta a ponta. Os demais schemas são
 * mínimos e sensatos; cada módulo seguinte enriquece o seu no próprio spec.
 */

// ─── recuperacao (follow-up SDR) — fatia vertical de prova ────────────────────

/**
 * Cadência de follow-up. `sequenceDays` substitui a antiga constante global
 * `SEQUENCE_DAYS = [1, 3, 7]` de `packages/jobs`. Dias são contados a partir do
 * primeiro contato e devem ser estritamente crescentes.
 */
export const FollowupConfigSchema = z
  .object({
    sequenceDays: z
      .array(z.number().int().positive().max(365))
      .min(1)
      .max(10)
      .default([1, 3, 7])
      .refine(
        (days) => days.every((d, i) => i === 0 || d > days[i - 1]),
        "Os dias da cadência devem ser estritamente crescentes",
      ),
    stopOnReply: z.boolean().default(true),
  })
  .strict();
export type FollowupConfig = z.infer<typeof FollowupConfigSchema>;

// ─── secretaria (SDR) ─────────────────────────────────────────────────────────

export const SecretariaConfigSchema = z
  .object({
    agentName: z.string().min(1).max(60).default("Assistente"),
    maxTurns: z.number().int().min(1).max(50).default(12),
  })
  .strict();
export type SecretariaConfig = z.infer<typeof SecretariaConfigSchema>;

// ─── escalada (escalada humana) ───────────────────────────────────────────────

export const EscalationConfigSchema = z
  .object({
    maxAiAttempts: z.number().int().min(1).max(10).default(3),
  })
  .strict();
export type EscalationConfig = z.infer<typeof EscalationConfigSchema>;

// ─── agenda ───────────────────────────────────────────────────────────────────

export const ScheduleConfigSchema = z
  .object({
    // IANA timezone usada para calcular horário comercial e slots.
    timezone: z.string().min(1).max(64).default("America/Sao_Paulo"),
    // Duração de cada reunião/slot (min).
    slotMinutes: z.number().int().min(5).max(240).default(30),
    // Dias úteis (0=domingo … 6=sábado).
    workdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
    // Janela de horário comercial (hora local, 0-24). start < end.
    startHour: z.number().int().min(0).max(23).default(9),
    endHour: z.number().int().min(1).max(24).default(18),
    // Antecedência mínima (h) entre "agora" e um slot ofertável.
    leadTimeHours: z.number().int().min(0).max(168).default(2),
    // Quantos dias à frente ofertar.
    horizonDays: z.number().int().min(1).max(60).default(7),
    // Quantos horários sugerir por vez.
    suggestions: z.number().int().min(1).max(5).default(3),
  })
  .strict()
  .refine((c) => c.endHour > c.startHour, "endHour deve ser maior que startHour");
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

// ─── cobranca (Asaas) ─────────────────────────────────────────────────────────

export const AsaasConfigSchema = z
  .object({
    overdueGraceDays: z.number().int().min(0).max(60).default(3),
  })
  .strict();
export type AsaasConfig = z.infer<typeof AsaasConfigSchema>;

// ─── arquivos (Drive) ─────────────────────────────────────────────────────────

export const FilesConfigSchema = z
  .object({
    rootFolder: z.string().max(200).default(""),
  })
  .strict();
export type FilesConfig = z.infer<typeof FilesConfigSchema>;

// ─── voz (Retell) ─────────────────────────────────────────────────────────────

export const VoiceConfigSchema = z
  .object({
    maxCallSeconds: z.number().int().min(30).max(1800).default(300),
  })
  .strict();
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
