import type { z } from "zod";
import {
  AsaasConfigSchema,
  EscalationConfigSchema,
  FilesConfigSchema,
  FollowupConfigSchema,
  ScheduleConfigSchema,
  SecretariaConfigSchema,
  VoiceConfigSchema,
} from "./schemas";

/**
 * Registro de módulos da plataforma — **fonte única de verdade**.
 *
 * Cada módulo declara:
 * - `label` / `description`: exibidos na UI de administração.
 * - `defaultEnabled`: valor padrão do toggle quando não há override por tenant.
 * - `schema`: schema Zod da config do módulo (carrega os defaults).
 *
 * Adicionar um módulo = adicionar uma entrada aqui. O tipo `ModuleKey` deriva
 * automaticamente das chaves.
 */
export const MODULES = {
  secretaria: {
    label: "Secretária (SDR)",
    description: "Atendimento e qualificação de leads por IA no WhatsApp.",
    defaultEnabled: true,
    schema: SecretariaConfigSchema,
  },
  recuperacao: {
    label: "Recuperação de leads",
    description: "Sequência de follow-up automática para leads sem resposta.",
    defaultEnabled: true,
    schema: FollowupConfigSchema,
  },
  escalada: {
    label: "Escalada humana",
    description: "Transfere a conversa para um humano quando a IA atinge o limite.",
    defaultEnabled: true,
    schema: EscalationConfigSchema,
  },
  agenda: {
    label: "Agenda",
    description: "Agendamento de reuniões e visitas.",
    defaultEnabled: false,
    schema: ScheduleConfigSchema,
  },
  cobranca: {
    label: "Cobrança (Asaas)",
    description: "Régua de cobrança e conciliação de pagamentos via Asaas.",
    defaultEnabled: false,
    schema: AsaasConfigSchema,
  },
  arquivos: {
    label: "Arquivos/Drive",
    description: "Sincronização de arquivos e documentos do tenant.",
    defaultEnabled: false,
    schema: FilesConfigSchema,
  },
  voz: {
    label: "Voz (Retell)",
    description: "Atendimento e follow-up por voz (ligações).",
    defaultEnabled: false,
    schema: VoiceConfigSchema,
  },
} as const;

export type ModuleKey = keyof typeof MODULES;

export type ModuleSchema<K extends ModuleKey> = (typeof MODULES)[K]["schema"];

export type ModuleConfig<K extends ModuleKey> = z.infer<ModuleSchema<K>>;

/** Lista ordenada das chaves de módulo (ordem de declaração no registro). */
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

/** Type guard: `true` se `key` é uma `ModuleKey` conhecida. */
export function isModuleKey(key: string): key is ModuleKey {
  return Object.prototype.hasOwnProperty.call(MODULES, key);
}

/**
 * Config default de um módulo (defaults do schema, sem nenhum override).
 * Equivale a `MODULES[key].schema.parse({})`.
 */
export function defaultConfig<K extends ModuleKey>(key: K): ModuleConfig<K> {
  return MODULES[key].schema.parse({}) as ModuleConfig<K>;
}
