/**
 * Testes (Prisma mockado) para as actions de módulos.
 * Foco: authz, validação Zod na borda, scoping por tenantId da sessão e audit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
  requireAuth: vi.fn(),
  ROLES_ADMIN: ["SUPERADMIN", "ADMIN"],
}));

vi.mock("@crm/db", () => ({
  prisma: {
    tenantModule: { upsert: vi.fn() },
  },
  Prisma: { InputJsonValue: {} },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), getClientIp: vi.fn(() => null) }));

import { requireRole } from "@/lib/authz";
import { prisma } from "@crm/db";
import { logAudit } from "@/lib/audit";
import { toggleModuleAction, updateFollowupConfigAction } from "@/app/actions/modules";

const TENANT_A = "tenant-aaa";
const USER_ID = "user-001";

const mockRequireRole = vi.mocked(requireRole);
const mockUpsert = vi.mocked(prisma.tenantModule.upsert);

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

function asAdmin() {
  mockRequireRole.mockResolvedValue({
    session: { user: { id: USER_ID, tenantId: TENANT_A, role: "ADMIN" } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsert.mockResolvedValue({} as never);
});

describe("toggleModuleAction", () => {
  it("bloqueia não-admin", async () => {
    mockRequireRole.mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await toggleModuleAction(null, form({ moduleKey: "voz", enabled: "true" }));
    expect(res).toEqual({ error: expect.stringContaining("administradores") });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejeita moduleKey desconhecido", async () => {
    asAdmin();
    const res = await toggleModuleAction(null, form({ moduleKey: "inexistente", enabled: "true" }));
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("liga um módulo com scoping por tenant da sessão + audit", async () => {
    asAdmin();
    const res = await toggleModuleAction(null, form({ moduleKey: "voz", enabled: "true" }));

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_moduleKey: { tenantId: TENANT_A, moduleKey: "voz" } },
        create: { tenantId: TENANT_A, moduleKey: "voz", enabled: true },
        update: { enabled: true },
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "module.toggle", tenantId: TENANT_A, entityId: "voz" }),
    );
    expect(res).toEqual({ success: expect.any(String) });
  });

  it("desliga um módulo (enabled=false)", async () => {
    asAdmin();
    await toggleModuleAction(null, form({ moduleKey: "recuperacao", enabled: "false" }));
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { enabled: false } }),
    );
  });
});

describe("updateFollowupConfigAction", () => {
  it("bloqueia não-admin", async () => {
    mockRequireRole.mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await updateFollowupConfigAction(null, form({ sequenceDays: "1,3,7" }));
    expect(res).toEqual({ error: expect.stringContaining("administradores") });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("salva cadência custom válida (settings JSON) com scoping por tenant", async () => {
    asAdmin();
    const res = await updateFollowupConfigAction(null, form({ sequenceDays: "2, 5, 12", stopOnReply: "on" }));

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_moduleKey: { tenantId: TENANT_A, moduleKey: "recuperacao" } },
        update: { settings: { sequenceDays: [2, 5, 12], stopOnReply: true } },
      }),
    );
    expect(res).toEqual({ success: expect.any(String) });
  });

  it("stopOnReply desmarcado → false", async () => {
    asAdmin();
    await updateFollowupConfigAction(null, form({ sequenceDays: "1,3,7" }));
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { settings: { sequenceDays: [1, 3, 7], stopOnReply: false } },
      }),
    );
  });

  it("rejeita cadência não numérica", async () => {
    asAdmin();
    const res = await updateFollowupConfigAction(null, form({ sequenceDays: "1, abc, 7" }));
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejeita cadência não crescente (Zod)", async () => {
    asAdmin();
    const res = await updateFollowupConfigAction(null, form({ sequenceDays: "7, 3, 1" }));
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
