import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenantTrackingConfig: { findUnique: vi.fn() },
  },
}));

import { getTrackingSecrets } from "@/lib/tenant-secrets";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@crm/config/secrets";

const findUnique = vi.mocked(prisma.tenantTrackingConfig.findUnique);

beforeAll(() => {
  process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

beforeEach(() => {
  findUnique.mockReset();
});

describe("getTrackingSecrets", () => {
  it("decifra segredos cifrados em repouso", async () => {
    findUnique.mockResolvedValueOnce({
      metaPixelId: "12345",
      metaAccessToken: encryptSecret("EAA-token"),
      hotmartHottok: encryptSecret("hottok-xyz"),
      pagarmeWebhookSecret: encryptSecret("pg-secret"),
    } as never);

    const secrets = await getTrackingSecrets("t1");

    expect(secrets).toEqual({
      metaPixelId: "12345",
      metaAccessToken: "EAA-token",
      hotmartHottok: "hottok-xyz",
      pagarmeWebhookSecret: "pg-secret",
    });
  });

  it("aceita segredos legados em texto puro (compat)", async () => {
    findUnique.mockResolvedValueOnce({
      metaPixelId: null,
      metaAccessToken: "legacy-plaintext",
      hotmartHottok: null,
      pagarmeWebhookSecret: null,
    } as never);

    const secrets = await getTrackingSecrets("t1");
    expect(secrets.metaAccessToken).toBe("legacy-plaintext");
    expect(secrets.hotmartHottok).toBeNull();
  });

  it("sem config → todos null", async () => {
    findUnique.mockResolvedValueOnce(null);
    const secrets = await getTrackingSecrets("t1");
    expect(secrets).toEqual({
      metaPixelId: null,
      metaAccessToken: null,
      hotmartHottok: null,
      pagarmeWebhookSecret: null,
    });
  });

  it("scoping: consulta por tenantId", async () => {
    findUnique.mockResolvedValueOnce(null);
    await getTrackingSecrets("tenant-abc");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-abc" } }),
    );
  });
});
