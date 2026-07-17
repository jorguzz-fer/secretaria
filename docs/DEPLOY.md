# Deploy & Runbook — secretaria

Guia de deploy da plataforma (VPS + Docker, ex.: Coolify). **Nunca comitar
segredos** — os valores reais vivem apenas no ambiente do deploy. Este arquivo
usa placeholders `‹...›`.

---

## 1. Sources

- **Repositório:** `jorguzz-fer/secretaria` · branch **`main`**
- **Build:** `apps/web/Dockerfile` (multi-stage; usuário não-root; porta 3000;
  `entrypoint.sh` aplica migrations e sobe `server.js`)

### Serviços de apoio

| Serviço | Imagem | Obrigatório | Nota |
|---|---|---|---|
| PostgreSQL | `pgvector/pgvector:pg16` | sim | imagem pgvector já prepara o RAG futuro (`postgres:16` também serve) |
| Inngest | Inngest Cloud (free) ou self-host | sim (automações) | roda IA-responde, follow-up, escalada, agenda |
| Soketi | `quay.io/soketi/soketi` | não | realtime do inbox (Pusher-compatível); degrada sem ele |

Ingress: reverse-proxy (Caddy/Traefik) só na 443 → `app:3000`. Postgres/Soketi
sem porta pública.

---

## 2. Config do serviço (Coolify)

- Build pack **Dockerfile** · path `apps/web/Dockerfile` · base dir = raiz do repo
- Porta `3000` · Healthcheck `GET /api/health`
- Domínio com TLS automático
- Migrations aplicadas no boot (`entrypoint.sh` → `migrate.js`)

### Pós-deploy (rodar 1x no terminal do container)

```bash
# Superadmin
ADMIN_EMAIL="‹voce@dominio›" ADMIN_PASSWORD="‹senha forte›" \
  ADMIN_NAME="Admin" TENANT_SLUG="‹slug-do-tenant›" node apps/web/create-superadmin.js

# Instância Z-API ↔ tenant
ZAPI_INSTANCE_ID="‹id›" ZAPI_PHONE="‹+55DDDNUMERO›" \
  TENANT_SLUG="‹slug-do-tenant›" node apps/web/register-zapi-instance.js

# Catálogo de cursos (RAG do SDR) — importa data/medicine-cursos.json.
# Sem EMBEDDINGS_API_KEY, importa só estrutural (busca por área/preço funciona);
# com a chave, calcula embeddings (busca semântica pgvector).
TENANT_SLUG="‹slug-do-tenant›" node apps/web/import-courses.js
```

### Webhooks

| Provedor | Evento | URL |
|---|---|---|
| Z-API | Ao receber mensagem | `https://‹DOMINIO›/api/webhooks/whatsapp` |
| Chatwoot | Message created | `https://‹DOMINIO›/api/webhooks/chatwoot?secret=‹CHATWOOT_WEBHOOK_SECRET›` |

### Módulos por tenant

Após logar, em `/configuracoes/modulos`: Secretária/Recuperação/Escalada já
vêm ligados; **Agenda/Cobrança/Voz** vêm desligados — ligue conforme o cliente.

---

## 3. Variáveis de ambiente

Gere os segredos localmente:
```bash
openssl rand -base64 32   # AUTH_SECRET e CONFIG_ENCRYPTION_KEY (32 bytes)
openssl rand -hex 32      # CRON_SECRET
openssl rand -hex 24      # CHATWOOT_WEBHOOK_SECRET
```

| Var | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | sim | Postgres (`postgresql://user:pass@postgres:5432/db?schema=public`) |
| `AUTH_SECRET` | sim | `openssl rand -base64 32` |
| `AUTH_URL` / `NEXT_PUBLIC_APP_URL` | sim | `https://‹DOMINIO›` |
| `CONFIG_ENCRYPTION_KEY` | sim | 32 bytes base64 — cifra os segredos por tenant (Módulo 0) |
| `OPENROUTER_API_KEY` | sim (IA) | openrouter.ai — chat do SDR |
| `EMBEDDINGS_API_KEY` | não (RAG) | chave compatível-OpenAI p/ embeddings do catálogo (`EMBEDDINGS_BASE_URL`/`EMBEDDINGS_MODEL` opcionais). Sem ela, catálogo funciona só na busca estruturada |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | sim (automações) | inngest.com |
| `ZAPI_INSTANCE_ID` / `ZAPI_INSTANCE_TOKEN` / `ZAPI_CLIENT_TOKEN` | sim (WhatsApp) | painel Z-API → Instância + Segurança |
| `ZAPI_BASE_URL` | não | default `https://api.z-api.io` |
| `CHATWOOT_URL` / `CHATWOOT_ACCOUNT_ID` / `CHATWOOT_INBOX_ID` / `CHATWOOT_API_TOKEN` | sim (espelho) | inbox tipo **API** no Chatwoot |
| `CHATWOOT_WEBHOOK_SECRET` / `CHATWOOT_TENANT_SLUG` | sim (hand-off) | segredo do webhook + slug do tenant dono da conta |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | não | login social Google |
| `SOKETI_*` / `NEXT_PUBLIC_SOKETI_*` | não | realtime do inbox |
| `META_WEBHOOK_VERIFY_TOKEN` / `CRON_SECRET` | não | tracking Meta + jobs de cron |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_WEBHOOK_SECRET` | não | provedor WhatsApp legado (deixe vazio se só Z-API) |

O template completo (comentado) fica em [`apps/web/.env.example`](../apps/web/.env.example).

---

## 4. Fluxo WhatsApp (arquitetura)

Z-API → **nosso app** (`/api/webhooks/whatsapp`) → persiste conversa, dispara
IA (Inngest) e **espelha uma cópia no Chatwoot** (inbox humano). O envio (IA /
follow-up) sai pelo adapter do provider da instância. Quando um humano responde
no Chatwoot, o webhook `/api/webhooks/chatwoot` **pausa a IA** naquela conversa
(hand-off). A IA também pausa quando o lead vira HOT, quando ela mesma escala,
ou por pausa manual no inbox.

---

## 5. Segurança / operação

- **Rotacionar** periodicamente: token e Client-Token do Z-API, `CHATWOOT_API_TOKEN`.
- Segredos de integração por tenant são cifrados em repouso (AES-256-GCM) — não
  aparecem em log nem no client (UI mascara `••••1234`).
- Backup do Postgres automatizado + restauração testada.
- Rollback: reimplantar a imagem da tag anterior; migrations são aditivas.
