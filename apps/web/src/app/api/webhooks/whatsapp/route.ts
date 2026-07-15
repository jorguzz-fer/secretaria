import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createEvolutionAdapter,
  createZapiAdapter,
  detectProvider,
  handleWebhook,
  type WhatsAppAdapter,
} from "@crm/whatsapp";
import { inngest } from "@crm/jobs";
import { mirrorInboundToChatwoot } from "@/lib/chatwoot";

/**
 * POST /api/webhooks/whatsapp
 *
 * Receptor unificado para Evolution API e Z-API. O provedor é detectado pelo
 * formato do payload; verificação + parsing são delegados ao adapter
 * @crm/whatsapp. Esta rota cuida de: lookup tenant → dedup DB → persistência
 * → evento Inngest → espelho no Chatwoot (opção "a": app recebe, Chatwoot é cópia).
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());

  const detected = detectProvider(rawBody);
  if (!detected) return NextResponse.json({ ok: true });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const instance = await prisma.whatsAppInstance.findUnique({
    where: { instanceName: detected.instanceKey },
    select: { id: true, tenantId: true, phone: true, status: true },
  });
  if (!instance) return NextResponse.json({ ok: true });

  let adapter: WhatsAppAdapter;
  let secret: string;

  if (detected.provider === "zapi") {
    const type = body.type as string | undefined;

    // Callbacks de sistema do Z-API
    if (type === "ConnectedCallback" || type === "DisconnectedCallback") {
      await updateZapiConnection(detected.instanceKey, type);
      return NextResponse.json({ ok: true });
    }
    // Só processa mensagens recebidas; ignora status/delivery/presence/etc.
    if (type !== "ReceivedCallback") return NextResponse.json({ ok: true });

    secret = process.env.ZAPI_CLIENT_TOKEN ?? "";
    adapter = createZapiAdapter({
      instanceId: detected.instanceKey,
      instanceToken: process.env.ZAPI_INSTANCE_TOKEN ?? "",
      clientToken: secret,
      instancePhone: instance.phone ?? "+5500000000000",
      baseUrl: process.env.ZAPI_BASE_URL,
    });
  } else {
    const parsedEvent = (body.event as string | undefined)?.toUpperCase().replace(".", "_");

    if (parsedEvent === "CONNECTION_UPDATE") {
      await handleConnectionUpdate(detected.instanceKey, body.data);
      return NextResponse.json({ ok: true });
    }
    if (parsedEvent === "QRCODE_UPDATED") {
      await handleQrcodeUpdated(detected.instanceKey, body.data);
      return NextResponse.json({ ok: true });
    }

    secret = process.env.EVOLUTION_WEBHOOK_SECRET ?? "";
    adapter = createEvolutionAdapter({
      baseUrl: process.env.EVOLUTION_API_URL ?? "",
      apiKey: secret,
      instanceName: detected.instanceKey,
      instancePhone: instance.phone ?? "+5500000000000",
    });
  }

  const result = await handleWebhook({
    adapter,
    rawBody,
    headers,
    secret,
    tenantId: instance.tenantId,
  });

  if (result.status !== 200) {
    if (result.status === 401)
      console.warn("[webhook/whatsapp] assinatura inválida, instância:", detected.instanceKey);
    else console.error("[webhook/whatsapp] erro interno");
    return NextResponse.json({ ok: true });
  }

  // Self-heal: se chegou mensagem, a instância ESTÁ conectada. O Z-API só manda
  // ConnectedCallback em eventos de conexão (fácil de perder), então o status no
  // banco pode ficar preso em DISCONNECTED e bloquear a resposta da IA. Corrige
  // de forma idempotente ao receber qualquer mensagem.
  if (result.messages.length > 0 && instance.status !== "CONNECTED") {
    await prisma.whatsAppInstance.update({
      where: { id: instance.id },
      data: { status: "CONNECTED", updatedAt: new Date() },
    });
  }

  for (const msg of result.messages) {
    const phone = msg.from.phoneE164.replace("+", "");
    const normalizedPhone = phone.slice(-8);

    const existingConv = await prisma.whatsAppConversation.findUnique({
      where: {
        instanceId_remoteJid: { instanceId: instance.id, remoteJid: `${phone}@s.whatsapp.net` },
      },
    });

    let convId: string;
    let convLeadId: string | null = null;

    if (existingConv) {
      convId = existingConv.id;
      convLeadId = existingConv.leadId;
      await prisma.whatsAppConversation.update({
        where: { id: convId },
        data: {
          remoteName: msg.from.name ?? existingConv.remoteName,
          lastMessageAt: msg.receivedAt,
          unreadCount: existingConv.unreadCount + 1,
          updatedAt: new Date(),
        },
      });
    } else {
      const [lead, contact] = await Promise.all([
        prisma.lead.findFirst({
          where: { tenantId: instance.tenantId, phone: { contains: normalizedPhone } },
          select: { id: true },
        }),
        prisma.contact.findFirst({
          where: { tenantId: instance.tenantId, phone: { contains: normalizedPhone } },
          select: { id: true },
        }),
      ]);

      // Número novo (sem lead nem contato): cria o Lead para ele entrar no CRM.
      // Sem isso, um inbound de desconhecido criava conversa órfã (leadId=null) e
      // não aparecia no funil. Vinculado a contato existente, não duplica lead.
      if (!lead && !contact) {
        const created = await prisma.lead.create({
          data: {
            tenantId: instance.tenantId,
            name: msg.from.name?.trim() || msg.from.phoneE164,
            phone: msg.from.phoneE164,
            source: "WHATSAPP",
          },
          select: { id: true },
        });
        convLeadId = created.id;
      } else {
        convLeadId = lead?.id ?? null;
      }
      const conv = await prisma.whatsAppConversation.create({
        data: {
          tenantId: instance.tenantId,
          instanceId: instance.id,
          remoteJid: `${phone}@s.whatsapp.net`,
          remotePhone: phone,
          remoteName: msg.from.name ?? null,
          leadId: convLeadId,
          contactId: contact?.id ?? null,
          unreadCount: 1,
          lastMessageAt: msg.receivedAt,
        },
      });
      convId = conv.id;
    }

    const mediaType = msg.message.type.toUpperCase() as
      | "TEXT"
      | "IMAGE"
      | "AUDIO"
      | "VIDEO"
      | "DOCUMENT"
      | "STICKER"
      | "UNKNOWN";

    try {
      await prisma.whatsAppMessage.create({
        data: {
          tenantId: instance.tenantId,
          conversationId: convId,
          waMessageId: msg.externalMessageId,
          fromMe: false,
          body: msg.message.type === "text" ? msg.message.text : null,
          mediaType,
          timestamp: msg.receivedAt,
        },
      });
    } catch {
      // waMessageId duplicado — idempotência via DB constraint
    }

    // Dispatch event for AI classification (classifyOnMessageFn)
    await inngest.send({
      name: "message/received",
      data: {
        tenantId: instance.tenantId,
        conversationId: convId,
        messageId: msg.externalMessageId,
        leadId: convLeadId ?? undefined,
        channel: "whatsapp" as const,
        content: {
          type: msg.message.type as
            | "text"
            | "image"
            | "audio"
            | "video"
            | "document"
            | "location"
            | "interactive",
          body: msg.message.type === "text" ? msg.message.text : undefined,
        },
        from: msg.from.phoneE164,
        receivedAt: msg.receivedAt.toISOString(),
      },
    });

    // Espelha no Chatwoot (best-effort; no-op se CHATWOOT_* não configurado).
    const mirrorContent =
      msg.message.type === "text"
        ? msg.message.text
        : "caption" in msg.message && msg.message.caption
          ? msg.message.caption
          : `[${msg.message.type}]`;
    const mirror = await mirrorInboundToChatwoot({
      fromPhoneE164: msg.from.phoneE164,
      fromName: msg.from.name ?? null,
      content: mirrorContent,
      externalMessageId: msg.externalMessageId,
    });
    if (mirror.status === "failed") {
      console.warn("[webhook/whatsapp] espelho Chatwoot falhou:", mirror.error);
    }
  }

  return NextResponse.json({ ok: true });
}

async function updateZapiConnection(
  instanceName: string,
  type: "ConnectedCallback" | "DisconnectedCallback",
) {
  const status = type === "ConnectedCallback" ? "CONNECTED" : "DISCONNECTED";
  await prisma.whatsAppInstance.updateMany({
    where: { instanceName },
    data: { status, updatedAt: new Date() },
  });
}

async function handleConnectionUpdate(instanceName: string, data: unknown) {
  const d = data as Record<string, unknown>;
  const state = d?.state as string;
  const status =
    state === "open" ? "CONNECTED" : state === "connecting" ? "CONNECTING" : "DISCONNECTED";

  await prisma.whatsAppInstance.updateMany({
    where: { instanceName },
    data: {
      status: status as "CONNECTED" | "CONNECTING" | "DISCONNECTED",
      qrCode: status === "CONNECTED" ? null : undefined,
      updatedAt: new Date(),
    },
  });
}

async function handleQrcodeUpdated(instanceName: string, data: unknown) {
  const d = data as Record<string, unknown>;
  const qrcode = d?.qrcode as Record<string, unknown> | undefined;
  const base64 = qrcode?.base64 as string | undefined;
  if (!base64) return;

  await prisma.whatsAppInstance.updateMany({
    where: { instanceName },
    data: { qrCode: base64, status: "CONNECTING", updatedAt: new Date() },
  });
}
