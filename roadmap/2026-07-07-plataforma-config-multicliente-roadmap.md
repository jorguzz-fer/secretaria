# Roadmap — Plataforma de configuração multi-cliente (substituir o n8n)

**Data:** 2026-07-07
**Status:** Visão / decisão de corte — a aprovar antes de especificar módulos
**Anexo relacionado:** `roadmap/roadmap_anexo.docx`

## 1. Decisão

Transformar os flows da "Secretária v3" (hoje no n8n) em uma **plataforma nativa
multi-cliente, dirigida por configuração**, e **aposentar o n8n por completo**.

Decisões já tomadas no brainstorming:

- **Nível de config = formulários por tenant.** Os flows são código (Inngest); cada
  cliente é ligado preenchendo campos (prompts, horários, integrações, tempos,
  regras). Onboarding em minutos, sem deploy. **Não** vamos construir um flow-builder
  visual tipo n8n agora — a arquitetura só fica pronta para expor blocos no futuro.
- **Escopo = substituir o n8n por completo**, incluindo as peças pesadas (agenda e
  voz), migradas por último quando o padrão de config estiver maduro.
- **Cada módulo/integração tem um _toggle_ de ligar/desligar por tenant.** O cliente
  só "vê" e paga pelo que está ativo. Consequências imediatas:
  - **Voz (Retell): não usar por enquanto** — o módulo é entregue funcional, mas
    **desligado por padrão**, pronto para ativar por tenant no futuro.
  - **Cobrança (Asaas): entregar pronta, porém desligável** — ativa só nos clientes
    que usam cobrança.

## 2. Por que sem n8n (racional de produto)

Para um SaaS revendido a várias clínicas, o n8n é o runtime errado:

- Multi-tenant no n8n = uma instância por cliente ou roteamento frágil; no nativo já
  temos `tenantId` em tudo.
- Corrigir um bug para N clientes = editar N JSONs à mão vs. 1 deploy + config por tenant.
- Testabilidade: já temos suíte Vitest; no n8n é quase impossível.
- Dono dos dados: nosso Postgres, não espalhado em Chatwoot/n8n.
- Custo marginal por novo cliente tende a zero.

n8n cumpriu bem o papel de **prototipagem**. Como motor de SaaS multi-cliente, vira
dívida operacional.

**Custo honesto de largar o n8n:** reconstruir o que os *nodes* davam de graça —
Google Calendar, Asaas, Retell (voz), Drive, quebra de mensagens. Parte já foi refeita.
Os caros que faltam são **agenda** e **voz**.

## 3. Estado atual (já nativo)

Monorepo pnpm/Turbo — Next.js 15 + Prisma 6 + Auth.js v5 + Inngest + Vercel AI SDK.

- **Multi-tenant real:** modelo `Tenant`, `Membership`, `AuditLog`; `TenantTrackingConfig`
  já é um precedente de "config por cliente".
- **Inngest (`packages/jobs`):** `auto-assign`, `first-contact`, `followup-sequence`,
  `classify-on-message` (com testes).
- **IA (`packages/ai`):** `classifier`, `sdr`, `followUp`, `scoring`, `summarize`.
- **Canais/CRM:** `packages/whatsapp`, modelos `Lead/Contact/Company/Pipeline/Stage/
  Opportunity/Activity/Task`, conversas WhatsApp.
- **Tracking:** `Attribution`, `ConversionEvent`, Meta CAPI (Fase 4 concluída).

**Conclusão:** o esqueleto de "aplicar para vários clientes" já existe. O que falta é
tirar o que está chumbado dentro das funções e mover para **config por tenant** + UI.

## 4. Mapa de módulos (n8n → nativo)

| # | Módulo | Workflows n8n de origem | Estado nativo | Falta | Esforço | Dep. externa |
|---|--------|-------------------------|---------------|-------|---------|--------------|
| **0** | **Camada de configuração** (a "ferramenta") | `00. Configurações` | `Tenant`, `TenantTrackingConfig` | Modelo de config genérico + resolução nas funções + UI de admin | **M–G (fundação)** | — |
| **1** | Agente Secretária (SDR/atendimento) | `01`, `07`, `07.1`, `08`, `10` | `ai/sdr`, `classify`, `first-contact`, WhatsApp, CRM | Parametrizar por tenant; quebra de mensagens; assistente interno | Médio | LLM, WhatsApp/ZAPI |
| **2** | Recuperação de leads | `13` | `followup-sequence`, `auto-assign` | Parametrizar cadência/gatilhos por tenant | Baixo | — |
| **3** | Escalada humana | `05`, `05.1` | — | Regras + multi-alerta configuráveis | Baixo | Notificação |
| **4** | Agenda | `03`, `04`, `04.1`, `09`, `11` | — | Google Calendar (janelas, criar/atualizar/desmarcar) + lembretes | **Alto** | Google Calendar |
| **5** | Cobrança | `06` | — | Integração Asaas + atributos de status | Médio | Asaas |
| **6** | Arquivos/Drive | `02` | — | Enviar/baixar arquivo (procedimentos, cobrança) | Baixo–médio | Google Drive |
| **7** | Voz | `12`, `Retell` | — | Gestão de ligações + agente de voz | **Alto** | Retell |

**Toggle por tenant:** todos os módulos são ligáveis/desligáveis por cliente.
Padrão **off**: **Voz** (não usar por enquanto) e **Cobrança/Asaas** (liga por cliente).
Ambos entregues funcionais, só desativados por default.

## 5. Arquitetura da camada de config (Módulo 0 — resumo)

Detalhamento completo virá no spec do Módulo 0. Direção proposta:

- **Toggle de módulo por tenant (feature flags).** Cada módulo/integração tem um
  `enabled` por tenant; quando desligado, o flow nem roda e a integração some da UI.
  Defaults: Voz = **off**; Asaas = **off** (liga por cliente). Este é o mecanismo que
  atende "deixar Retell e Asaas prontos mas com opção de ligar ou não".
- **Modelo por tenant no banco** para cada domínio configurável (agente/prompts,
  cadências de follow-up, regras de escalada, horários de atendimento, credenciais de
  integração). Padrão: seguir o precedente `TenantTrackingConfig` (uma tabela de config
  por domínio, tipada) em vez de um blob JSON único — melhor para validação e migração.
- **Camada de resolução** (`getTenantConfig(tenantId, domínio)`) que as funções Inngest
  e o pacote `ai` consomem, com defaults versionados no código e override por tenant.
- **Segredos de integração** (tokens Asaas/Google/Retell/ZAPI) cifrados, nunca em claro
  na config — reaproveitar o padrão de segurança multi-tenant já existente.
- **UI de admin** (área de settings por tenant) com formulários validados (Zod/
  `packages/validators`) — o onboarding de um novo cliente.
- **Seed/onboarding:** um comando/tela que cria o tenant com defaults sensatos (o
  equivalente ao workflow `00. Configurações`, que criava tabelas/etiquetas/atributos).

## 6. Sequência recomendada

`0 → 1 → 2 → 3 → (5, 6) → 4 → 7`

Racional: começar pela **fundação** (0) e pelos módulos que já estão ~80% prontos (1, 2)
para provar o modelo rápido e gerar valor cedo; escalada (3) é barata; cobrança (5) e
arquivos (6) são médios e independentes; **agenda (4)** e **voz (7)** — os caros e mais
dependentes de terceiros — por último, quando o padrão de config já estiver maduro e
testado nos módulos mais simples.

Cada módulo é seu próprio ciclo **spec → plano → implementação**, com testes (test-first,
conforme padrão do projeto).

## 7. Riscos e pontos de atenção

- **Voz (Retell) e Agenda (Calendar)** concentram o esforço e o risco de terceiros —
  por isso ficam por último. Reavaliar se valem migração nativa ou se um serviço
  dedicado (não o n8n) atende melhor.
- **Paridade funcional:** antes de desligar cada workflow n8n, garantir que o nativo
  cobre o mesmo comportamento (checklist de paridade por módulo no spec).
- **Segredos por tenant:** cifrar credenciais de integração; nunca logar.
- **Migração de dados:** clientes que já rodam no n8n/Chatwoot precisam de plano de
  corte (dual-run ou cutover) — decidir por módulo.
- **YAGNI:** resistir a construir o flow-builder visual; o valor está na config por
  formulário.

## 8. Próximo passo

Aprovado este corte, **brainstormar o Módulo 0** (camada de config + UI de admin) como
primeiro spec detalhado, seguido do plano de implementação.
