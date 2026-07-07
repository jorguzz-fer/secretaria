# Spec — Módulo 0: Camada de configuração por tenant

**Data:** 2026-07-07
**Repo:** `github.com/jorguzz-fer/secretaria`
**Roadmap pai:** `roadmap/2026-07-07-plataforma-config-multicliente-roadmap.md`
**Status:** A revisar antes do plano de implementação

## 1. Objetivo

Criar a fundação que torna a plataforma **multi-cliente dirigida por configuração**:
mover o que hoje está chumbado no código (constantes, prompts, tempos, credenciais)
para **config por tenant**, com **toggle de módulo** (ligar/desligar por cliente),
**segredos cifrados** e uma **UI de administração/onboarding**.

É o módulo que destrava todos os outros do roadmap — cada módulo seguinte passa a
consumir esta camada em vez de constantes.

## 2. Problema atual (evidências no código)

- `packages/jobs/src/functions/followup-sequence.ts`: `SEQUENCE_DAYS = [1,3,7]` é
  constante global — igual para todo tenant.
- `TenantTrackingConfig` guarda segredos (`metaAccessToken`, `hotmartHottok`,
  `pagarmeWebhookSecret`) como `String?` em **texto puro**.
- Não existe camada de config de aplicação (`packages/config` é só tsconfig/eslint).
- Não há mecanismo de habilitar/desabilitar funcionalidade por tenant.

## 3. Escopo

### 3.1 Dentro (o que este módulo entrega)

1. **Registro de módulos** (catálogo tipado em código): fonte única de verdade dos
   módulos da plataforma (`secretaria`, `recuperacao`, `escalada`, `agenda`,
   `cobranca`, `arquivos`, `voz`), cada um com `key`, label, descrição, `defaultEnabled`
   e schema Zod da sua config.
2. **Toggle por tenant**: tabela `TenantModule` com `enabled` por (tenant, módulo).
   Default vem do registro; override por tenant. Voz e Cobrança = `false` por padrão.
3. **Camada de resolução**: `getTenantConfig(tenantId, moduleKey)` e
   `isModuleEnabled(tenantId, moduleKey)` — mescla defaults do código + overrides do
   banco, valida com Zod, com cache por request.
4. **Cifragem de segredos**: helper `encryptSecret`/`decryptSecret` (AES-256-GCM, chave
   em env), aplicado a toda credencial de integração. Migrar as colunas de segredo do
   `TenantTrackingConfig` para cifradas. Segredos nunca logados, nunca enviados ao client
   (mascarados na UI).
5. **UI de admin (settings por tenant)**: página de **módulos** (toggles) + formulários
   por módulo validados com Zod (`packages/validators`), sob `/configuracoes/*` (já existe
   `/configuracoes/tracking` como precedente).
6. **Onboarding de tenant**: server action `onboardTenant(input)` que cria o tenant com
   defaults sensatos (pipeline/estágios base, linhas de `TenantModule`, config inicial) —
   equivalente nativo ao workflow n8n `00. Configurações`.
7. **Fatia vertical de prova**: migrar **uma** config real de ponta a ponta —
   a cadência de follow-up (`SEQUENCE_DAYS`) → `TenantFollowupConfig`, consumida por
   `followup-sequence.ts` via `getTenantConfig`. Valida todo o pipeline (modelo → resolução
   → função → UI → teste).

### 3.2 Fora (escopo dos módulos seguintes)

- As configs específicas de cada outro módulo (persona/prompts do agente, regras de
  agenda, Asaas, etc.) — cada uma entra no spec do seu módulo, **usando** esta camada.
- Flow-builder visual (YAGNI, decisão do roadmap).
- Migração de dados de clientes que já rodam no n8n (plano de cutover é por módulo).

## 4. Arquitetura

### 4.1 Registro de módulos (código — fonte da verdade)

`packages/config/src/modules.ts` (novo pacote de config de aplicação):

```ts
export const MODULES = {
  secretaria:  { label: "Secretária (SDR)",       defaultEnabled: true,  schema: SecretariaConfigSchema },
  recuperacao: { label: "Recuperação de leads",   defaultEnabled: true,  schema: FollowupConfigSchema },
  escalada:    { label: "Escalada humana",        defaultEnabled: true,  schema: EscalationConfigSchema },
  agenda:      { label: "Agenda",                 defaultEnabled: false, schema: ScheduleConfigSchema },
  cobranca:    { label: "Cobrança (Asaas)",       defaultEnabled: false, schema: AsaasConfigSchema },
  arquivos:    { label: "Arquivos/Drive",         defaultEnabled: false, schema: FilesConfigSchema },
  voz:         { label: "Voz (Retell)",           defaultEnabled: false, schema: VoiceConfigSchema },
} as const;
export type ModuleKey = keyof typeof MODULES;
```

Cada `schema` também carrega os **defaults** (via `.default()` do Zod), então a config
"vazia" já resolve para valores válidos sem nenhuma linha no banco.

### 4.2 Modelo de dados (Prisma)

```prisma
model TenantModule {
  id        String   @id @default(cuid())
  tenantId  String
  moduleKey String              // corresponde a ModuleKey
  enabled   Boolean
  settings  Json?               // config específica do módulo (validada por Zod na app)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, moduleKey])
  @@index([tenantId])
}
```

**Decisão — `settings Json` vs. tabela tipada por domínio:** o roadmap sugeriu tabela
tipada por domínio. Reavaliando com o `settings Json` + validação Zod na borda:
- `Json` valida por Zod na leitura/escrita, evolui sem migração a cada campo novo, e o
  registro de módulos já dá a tipagem. **Recomendado** para as configs de comportamento.
- **Exceção — segredos**: ficam em colunas dedicadas e cifradas (não em `Json`), para
  cifrar/descifrar explicitamente e nunca serializar por engano. `TenantTrackingConfig`
  segue como tabela de segredos; novas integrações seguem o mesmo padrão.

`TenantTrackingConfig` — migração: colunas de segredo passam a guardar valor cifrado
(mesmo tipo `String?`, conteúdo AES-GCM base64). Migração de dados converte os valores
existentes.

### 4.3 Camada de resolução

`packages/config/src/resolve.ts`:

```ts
getTenantConfig<K extends ModuleKey>(tenantId, key: K): Promise<z.infer<Schema<K>>>
isModuleEnabled(tenantId, key: ModuleKey): Promise<boolean>
```

- Lê `TenantModule` (uma query), aplica `MODULES[key].schema.parse(settings ?? {})`
  para obter defaults + overrides validados.
- `enabled` = linha do banco ?? `MODULES[key].defaultEnabled`.
- Cache por request (memoização em `React.cache`/escopo do handler) — sem cache global
  cross-request nesta fase (evita invalidação; otimização futura).
- Uma função desligada **não roda**: o gate entra no início de cada função Inngest
  (`if (!(await isModuleEnabled(tenantId, key))) return { skipped: true, reason: "module_disabled" }`).

### 4.4 Cifragem de segredos

`packages/config/src/secrets.ts`: AES-256-GCM, chave de 32 bytes em
`CONFIG_ENCRYPTION_KEY` (env, base64). `encryptSecret(plain) -> "v1:iv:tag:cipher"`
(base64), `decryptSecret(stored) -> plain`. Prefixo de versão para rotação futura.
Regras: segredo nunca em log, nunca no payload ao client; UI mostra só "•••• últimos 4".

### 4.5 UI de admin / onboarding

- `/configuracoes/modulos`: lista de módulos com toggle (Server Action grava
  `TenantModule.enabled`), respeitando authz (só ADMIN/owner do tenant).
- Formulário por módulo (renderizado a partir do schema Zod) — Módulo 0 entrega o de
  follow-up como exemplo; os demais chegam com cada módulo.
- Onboarding: `onboardTenant()` — cria tenant + defaults; exposto por uma tela simples
  (ou script CLI) para ligar cliente novo.
- Toda mutação de config grava `AuditLog` (modelo já existe).

## 5. Segurança

Seguir os playbooks do projeto (multi-tenant security):
- Todo acesso a config **scoped por `tenantId`** derivado da sessão, nunca do input.
- Authz: só papéis ADMIN/owner editam config; leitura conforme membership.
- Validação Zod na borda de toda escrita de `settings`.
- Segredos cifrados em repouso; mascarados na UI; fora de logs e de respostas ao client.
- `AuditLog` em toda mudança de toggle/config.

## 6. Testes (test-first — obrigatório)

- `resolve`: defaults sem linha no banco; merge de override; validação Zod rejeita
  settings inválidos.
- `isModuleEnabled`: default do registro vs. override; Voz/Cobrança default `false`.
- `secrets`: round-trip encrypt→decrypt; valor cifrado ≠ texto puro; formato versionado.
- Gate: função Inngest com módulo desligado retorna `skipped: module_disabled` e não
  chama efeitos colaterais.
- `followup-sequence`: passa a ler cadência de `getTenantConfig("recuperacao")`; teste
  com cadência custom por tenant.
- `onboardTenant`: cria tenant + linhas de módulo default + pipeline base (integração).

## 7. Migrações

1. `TenantModule` (nova tabela).
2. `TenantTrackingConfig`: converter segredos existentes para cifrado (migração de dados
   idempotente; requer `CONFIG_ENCRYPTION_KEY` em runtime).

## 8. Riscos / decisões a confirmar

- **`Json` vs. tabela tipada por domínio** (§4.2) — recomendo `Json`+Zod; confirmar.
- **Chave de cifragem**: uma por ambiente em env agora; rotação/KMS fica para depois
  (prefixo de versão já preparado).
- **Cache**: sem cache cross-request nesta fase; revisitar se virar gargalo.

## 9. Critérios de aceite

- É possível ligar/desligar cada módulo por tenant pela UI, com Voz e Cobrança `off` por
  padrão, e uma função desligada não executa.
- Follow-up lê a cadência do tenant (não mais a constante `[1,3,7]`).
- Segredos gravados cifrados; UI mascara; nenhum segredo em log.
- `onboardTenant` liga um cliente novo com defaults sensatos em uma ação.
- Suíte de testes cobrindo os itens da §6, verde.
