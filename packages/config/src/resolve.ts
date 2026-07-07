import { prisma } from "@crm/db";
import { MODULES, type ModuleConfig, type ModuleKey } from "./modules";

/**
 * Camada de resolução de config por tenant.
 *
 * Mescla os defaults do código (registro de módulos) com os overrides do banco
 * (`TenantModule`), validando o resultado com Zod na borda.
 *
 * Cache: nesta fase **não há cache cross-request** (spec §4.3) — cada chamada é
 * uma query. `resolveModule` lê `enabled` + `settings` numa única query; use-o
 * quando precisar dos dois para evitar ida dupla ao banco.
 */

export interface ResolvedModule<K extends ModuleKey> {
  enabled: boolean;
  config: ModuleConfig<K>;
}

async function loadRow(tenantId: string, key: ModuleKey) {
  return prisma.tenantModule.findUnique({
    where: { tenantId_moduleKey: { tenantId, moduleKey: key } },
    select: { enabled: true, settings: true },
  });
}

/**
 * Config validada de um módulo para um tenant: defaults do schema + overrides
 * do banco. Lança `ZodError` se `settings` no banco estiver inválido.
 */
export async function getTenantConfig<K extends ModuleKey>(
  tenantId: string,
  key: K,
): Promise<ModuleConfig<K>> {
  const row = await loadRow(tenantId, key);
  return MODULES[key].schema.parse(row?.settings ?? {}) as ModuleConfig<K>;
}

/**
 * `true` se o módulo está habilitado para o tenant. Override do banco tem
 * prioridade; na ausência de linha, usa `defaultEnabled` do registro.
 */
export async function isModuleEnabled(tenantId: string, key: ModuleKey): Promise<boolean> {
  const row = await loadRow(tenantId, key);
  return row?.enabled ?? MODULES[key].defaultEnabled;
}

/** Resolve `enabled` + `config` de um módulo numa única query. */
export async function resolveModule<K extends ModuleKey>(
  tenantId: string,
  key: K,
): Promise<ResolvedModule<K>> {
  const row = await loadRow(tenantId, key);
  return {
    enabled: row?.enabled ?? MODULES[key].defaultEnabled,
    config: MODULES[key].schema.parse(row?.settings ?? {}) as ModuleConfig<K>,
  };
}
