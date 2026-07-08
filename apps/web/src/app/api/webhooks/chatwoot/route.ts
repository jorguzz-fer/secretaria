import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseChatwootTakeover } from "@/lib/chatwoot";

/**
 * POST /api/webhooks/chatwoot
 *
 * Gatilho 1 da Escalada: quando um AGENTE HUMANO responde pelo Chatwoot,
 * pausa a IA SDR naquela conversa (hand-off). O corpo é interpretado por
 * `parseChatwootTakeover`; só mensagens `outgoing` de humano contam.
 *
 * Auth: o Chatwoot não assina o webhook, então protegemos por um segredo na
 * URL (`?secret=`) ou header `x-webhook-secret`, comparado a
 * `CHATWOOT_WEBHOOK_SECRET`. Sem o segredo configurado, o endpoint fica
 * desabilitado (503) — nunca aberto.
 *
 * Tenant: `CHATWOOT_TENANT_SLUG` identifica a qual tenant esta conta Chatwoot
 * pertence (mapeamento explícito, evita cruzar tenants).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.CHATWOOT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Chatwoot webhook desabilitado" }, { status: 503 });
  }

  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-webhook-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const takeover = parseChatwootTakeover(body);
  if (!takeover) return NextResponse.json({ ok: true, skipped: true });

  const tenantSlug = process.env.CHATWOOT_TENANT_SLUG;
  if (!tenantSlug) {
    return NextResponse.json({ error: "CHATWOOT_TENANT_SLUG não configurado" }, { status: 503 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ ok: true, skipped: true });

  // Casa pelo fim do telefone (normalização tolerante a DDI/formatação) e
  // pausa a IA nas conversas ainda ativas desse contato.
  const last8 = takeover.contactPhone.slice(-8);
  const result = await prisma.whatsAppConversation.updateMany({
    where: {
      tenantId: tenant.id,
      remotePhone: { contains: last8 },
      aiPaused: false,
    },
    data: { aiPaused: true, aiPausedReason: "human_takeover", aiPausedAt: new Date() },
  });

  return NextResponse.json({ ok: true, paused: result.count });
}
