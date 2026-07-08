/**
 * Testes (Prisma mockado) para o toggle de hand-off manual da IA por conversa.
 * Foco: authz, scoping por tenant, persistência do estado e audit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
  requireAuth: vi.fn(),
  ROLES_WRITE: ["SUPERADMIN", "ADMIN", "SUPERVISOR", "ANALYST"],
  ROLES_ADMIN: ["SUPERADMIN", "ADMIN"],
  ROLES_MANAGE: ["SUPERADMIN", "ADMIN", "SUPERVISOR"],
}));

vi.mock("@crm/db", () => ({
  prisma: {
    whatsAppConversation: { findFirst: vi.fn(), update: vi.fn() },
  },
  Prisma: {},
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), getClientIp: vi.fn(() => null) }));

// Evolution lib é importada por whatsapp.ts (outras actions) — stub inofensivo.
vi.mock("@/lib/evolution", () => ({}));

import { requireRole } from "@/lib/authz";
import { prisma } from "@crm/db";
import { logAudit } from "@/lib/audit";
import { toggleConversationAiAction } from "@/app/actions/whatsapp";

const TENANT_A = "tenant-aaa";
const USER_ID = "user-001";

const mockRequireRole = vi.mocked(requireRole);
const findFirst = vi.mocked(prisma.whatsAppConversation.findFirst);
const update = vi.mocked(prisma.whatsAppConversation.update);

function asWriter() {
  mockRequireRole.mockResolvedValue({
    session: { user: { id: USER_ID, tenantId: TENANT_A, role: "SUPERVISOR" } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue({ id: "conv-1" } as never);
  update.mockResolvedValue({} as never);
});

describe("toggleConversationAiAction", () => {
  it("bloqueia sem permissão de escrita", async () => {
    mockRequireRole.mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await toggleConversationAiAction("conv-1", true);
    expect(res).toEqual({ error: "Acesso negado" });
    expect(update).not.toHaveBeenCalled();
  });

  it("erro quando a conversa não é do tenant (scoping)", async () => {
    asWriter();
    findFirst.mockResolvedValueOnce(null);
    const res = await toggleConversationAiAction("conv-x", true);
    expect(res).toEqual({ error: "Conversa não encontrada" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "conv-x", tenantId: TENANT_A } }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("pausa: grava aiPaused=true + reason manual + audit", async () => {
    asWriter();
    const res = await toggleConversationAiAction("conv-1", true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1" },
        data: expect.objectContaining({ aiPaused: true, aiPausedReason: "manual" }),
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "whatsapp.ai_pause", entityId: "conv-1" }),
    );
    expect(res).toEqual({ success: expect.any(String) });
  });

  it("retoma: grava aiPaused=false + limpa reason/at", async () => {
    asWriter();
    await toggleConversationAiAction("conv-1", false);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ aiPaused: false, aiPausedReason: null, aiPausedAt: null }),
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "whatsapp.ai_resume" }),
    );
  });
});
