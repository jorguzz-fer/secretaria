/**
 * Testes (Prisma mockado) para resetUserPasswordAction.
 * Foco: authz, validação, scoping por tenant, hash da senha e audit sem vazar segredo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
  requireAuth: vi.fn(),
  ROLES_ADMIN: ["SUPERADMIN", "ADMIN"],
}));

vi.mock("@crm/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), getClientIp: vi.fn(() => null) }));
vi.mock("@crm/config/secrets", () => ({ encryptSecret: vi.fn((v: string) => `enc:${v}`) }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed-pw") } }));
vi.mock("@/lib/password", () => ({ validatePassword: vi.fn(() => ({ ok: true })) }));

import { requireRole } from "@/lib/authz";
import { prisma } from "@crm/db";
import { logAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/password";
import { resetUserPasswordAction } from "@/app/actions/settings";

const TENANT_A = "tenant-aaa";
const ADMIN_ID = "user-admin";
const TARGET_ID = "clzzzzzzzzzzzzzzzzzzzzzzz"; // cuid-like

const mockRequireRole = vi.mocked(requireRole);
const mockFindFirst = vi.mocked(prisma.user.findFirst);
const mockUpdate = vi.mocked(prisma.user.update);
const mockValidate = vi.mocked(validatePassword);

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

function asAdmin() {
  mockRequireRole.mockResolvedValue({
    session: { user: { id: ADMIN_ID, tenantId: TENANT_A, role: "ADMIN" } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidate.mockReturnValue({ ok: true } as never);
  mockFindFirst.mockResolvedValue({ id: TARGET_ID, name: "Maria" } as never);
  mockUpdate.mockResolvedValue({} as never);
});

describe("resetUserPasswordAction", () => {
  it("bloqueia não-admin", async () => {
    mockRequireRole.mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await resetUserPasswordAction(null, form({ userId: TARGET_ID, newPassword: "senhaforte123" }));
    expect(res).toEqual({ error: expect.stringContaining("administradores") });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejeita senha curta (Zod)", async () => {
    asAdmin();
    const res = await resetUserPasswordAction(null, form({ userId: TARGET_ID, newPassword: "curta" }));
    expect(res).toEqual({ error: expect.any(String) });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("respeita a política de senha (validatePassword)", async () => {
    asAdmin();
    mockValidate.mockReturnValueOnce({ ok: false, error: "Senha fraca" } as never);
    const res = await resetUserPasswordAction(null, form({ userId: TARGET_ID, newPassword: "senhaforte123" }));
    expect(res).toEqual({ error: "Senha fraca" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("erro quando o usuário não é do tenant da sessão", async () => {
    asAdmin();
    mockFindFirst.mockResolvedValueOnce(null);
    const res = await resetUserPasswordAction(null, form({ userId: TARGET_ID, newPassword: "senhaforte123" }));
    expect(res).toEqual({ error: "Usuário não encontrado" });
    // findFirst deve ser escopado por tenantId da sessão
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET_ID, tenantId: TENANT_A } }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("sucesso: grava hash e audita SEM a senha em claro", async () => {
    asAdmin();
    const res = await resetUserPasswordAction(null, form({ userId: TARGET_ID, newPassword: "senhaforte123" }));

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: TARGET_ID },
      data: { passwordHash: "hashed-pw" },
    });
    const auditArg = vi.mocked(logAudit).mock.calls[0][0];
    expect(auditArg).toMatchObject({ action: "user.password_reset", tenantId: TENANT_A, entityId: TARGET_ID });
    expect(JSON.stringify(auditArg)).not.toContain("senhaforte123");
    expect(res).toEqual({ success: expect.stringContaining("Maria") });
  });
});
