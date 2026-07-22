import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@crm/db", () => ({
  prisma: {
    lead: { update: vi.fn(), findFirst: vi.fn() },
    pipeline: { findFirst: vi.fn() },
    stage: { findMany: vi.fn() },
    opportunity: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

const { autoAssignMock } = vi.hoisted(() => ({ autoAssignMock: vi.fn() }));
vi.mock("../functions/auto-assign", () => ({ handleAutoAssign: autoAssignMock }));

vi.mock("../client", () => ({ inngest: { createFunction: vi.fn(() => ({})) } }));

import { handleQualifyOnClassified } from "../functions/qualify-on-classified";
import { prisma } from "@crm/db";

const leadUpdate = vi.mocked(prisma.lead.update);
const leadFindFirst = vi.mocked(prisma.lead.findFirst);
const pipelineFindFirst = vi.mocked(prisma.pipeline.findFirst);
const stageFindMany = vi.mocked(prisma.stage.findMany);
const oppFindFirst = vi.mocked(prisma.opportunity.findFirst);
const oppCreate = vi.mocked(prisma.opportunity.create);
const oppUpdate = vi.mocked(prisma.opportunity.update);

const STAGES = [
  { id: "s-prosp", name: "Prospecção", order: 0 },
  { id: "s-qual", name: "Qualificação", order: 1 },
  { id: "s-prop", name: "Proposta", order: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  leadUpdate.mockResolvedValue({} as never);
  leadFindFirst.mockResolvedValue({ assignedTo: "user-1", name: "Ana" } as never);
  pipelineFindFirst.mockResolvedValue({ id: "pipe-1" } as never);
  stageFindMany.mockResolvedValue(STAGES as never);
  oppFindFirst.mockResolvedValue(null);
  oppCreate.mockResolvedValue({ id: "opp-1" } as never);
  oppUpdate.mockResolvedValue({} as never);
  autoAssignMock.mockResolvedValue({ skipped: false, assignedTo: "user-1" });
});

describe("handleQualifyOnClassified", () => {
  it("COLD → não qualifica (sem status, sem oportunidade)", async () => {
    const res = await handleQualifyOnClassified({ tenantId: "t1", leadId: "l1", score: "COLD" });
    expect(res).toEqual({ skipped: true, reason: "not_qualifying" });
    expect(leadUpdate).not.toHaveBeenCalled();
    expect(oppCreate).not.toHaveBeenCalled();
  });

  it("HOT → status QUALIFICADO + Oportunidade na etapa Qualificação", async () => {
    const res = await handleQualifyOnClassified({ tenantId: "t1", leadId: "l1", score: "HOT" });
    expect(leadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "l1", tenantId: "t1" }, data: { status: "QUALIFICADO" } }),
    );
    expect(oppCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pipelineId: "pipe-1", stageId: "s-qual", leadId: "l1" }),
      }),
    );
    expect(res).toMatchObject({ skipped: false, action: "created", stage: "Qualificação" });
  });

  it("WARM → status EM_CONTATO + Oportunidade na etapa Prospecção", async () => {
    const res = await handleQualifyOnClassified({ tenantId: "t1", leadId: "l1", score: "WARM" });
    expect(leadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EM_CONTATO" } }),
    );
    expect(oppCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stageId: "s-prosp" }) }),
    );
    expect(res).toMatchObject({ action: "created", stage: "Prospecção" });
  });

  it("oportunidade aberta em etapa anterior + HOT → avança (Prospecção→Qualificação)", async () => {
    oppFindFirst.mockResolvedValueOnce({ id: "opp-1", stageId: "s-prosp" } as never);
    const res = await handleQualifyOnClassified({ tenantId: "t1", leadId: "l1", score: "HOT" });
    expect(oppCreate).not.toHaveBeenCalled();
    expect(oppUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "opp-1" }, data: { stageId: "s-qual" } }),
    );
    expect(res).toMatchObject({ action: "advanced", stage: "Qualificação" });
  });

  it("oportunidade já adiante (Proposta) → não recua", async () => {
    oppFindFirst.mockResolvedValueOnce({ id: "opp-1", stageId: "s-prop" } as never);
    const res = await handleQualifyOnClassified({ tenantId: "t1", leadId: "l1", score: "HOT" });
    expect(oppUpdate).not.toHaveBeenCalled();
    expect(res).toMatchObject({ action: "unchanged" });
  });

  it("atribui vendedor só quando o lead ainda não tem responsável", async () => {
    leadFindFirst.mockResolvedValue({ assignedTo: null, name: "Ana" } as never);
    await handleQualifyOnClassified({ tenantId: "t1", leadId: "l1", score: "HOT" });
    expect(autoAssignMock).toHaveBeenCalledWith({ tenantId: "t1", leadId: "l1" });
  });

  it("não reatribui quando já há responsável", async () => {
    leadFindFirst.mockResolvedValue({ assignedTo: "user-9", name: "Ana" } as never);
    await handleQualifyOnClassified({ tenantId: "t1", leadId: "l1", score: "HOT" });
    expect(autoAssignMock).not.toHaveBeenCalled();
  });

  it("sem pipeline → skip gracioso", async () => {
    pipelineFindFirst.mockResolvedValue(null);
    const res = await handleQualifyOnClassified({ tenantId: "t1", leadId: "l1", score: "HOT" });
    expect(res).toEqual({ skipped: true, reason: "no_pipeline" });
  });
});
