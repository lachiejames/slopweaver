import { describe, expect, it } from "vitest";

import { cloudflareEntityId } from "../../../../../atlas/cloudflare/identity.js";
import { accountScopedEntity } from "../../../../../atlas/cloudflare/projection/accountScopedEntity.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("accountScopedEntity", () => {
  it("builds the whole account-scoped envelope around the caller's detail", () => {
    const detail = { kind: "dlp-dataset", name: "customers" };
    const entity = accountScopedEntity({
      accountId: ACCOUNT_ID,
      at: AT,
      detail,
      kind: "dlp-dataset",
      operation: "dlp-datasets-list",
      providerId: "dataset-1",
    });
    const expectedId = cloudflareEntityId({
      components: { accountId: ACCOUNT_ID, providerId: "dataset-1" },
      kind: "dlp-dataset",
    });
    expect(expectedId).toMatch(/^[0-9a-f]{32}$/);
    expect(entity).toEqual({
      detail: { kind: "dlp-dataset", name: "customers" },
      firstSeenAt: AT,
      id: expectedId,
      kind: "dlp-dataset",
      lastSeenAt: AT,
      providerId: "dataset-1",
      scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: null },
      source: { channel: "rest-api", observedAt: AT, operation: "dlp-datasets-list" },
      state: "observed",
    });
    expect(entity.detail).toBe(detail);
  });

  it("gives the same provider id a different entity id under a different kind", () => {
    const dataset = accountScopedEntity({
      accountId: ACCOUNT_ID,
      at: AT,
      detail: null,
      kind: "dlp-dataset",
      operation: "op",
      providerId: "shared-id",
    });
    const test = accountScopedEntity({
      accountId: ACCOUNT_ID,
      at: AT,
      detail: null,
      kind: "dex-test",
      operation: "op",
      providerId: "shared-id",
    });
    expect(dataset.id).not.toBe(test.id);
  });
});
