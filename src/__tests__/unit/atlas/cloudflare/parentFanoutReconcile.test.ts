import { describe, expect, it } from "vitest";

import { CloudflareClientErrors } from "../../../../atlas/cloudflare/errors.js";
import type { CloudflareEntity } from "../../../../atlas/cloudflare/model.js";
import { reconcileParentFanout } from "../../../../atlas/cloudflare/parentFanoutReconcile.js";
import { err, ok } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

interface FakeParent {
  readonly id: string;
  readonly name: string;
}

function fakeEntity({ parentId, children }: { parentId: string; children: readonly string[] }): CloudflareEntity {
  return {
    detail: { children },
    firstSeenAt: AT,
    id: `gateway-list:${ACCOUNT_ID}:${parentId}`,
    kind: "gateway-list",
    lastSeenAt: AT,
    providerId: parentId,
    scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: AT, operation: "test" },
    state: "observed",
  };
}

function buildEntity({ parentId, children }: { parentId: string; children: readonly string[] }): CloudflareEntity {
  return fakeEntity({ children, parentId });
}

describe("reconcileParentFanout", () => {
  it("builds one entity per parent from a successful child read", () => {
    const reconciliation = reconcileParentFanout<FakeParent, string>({
      accountId: ACCOUNT_ID,
      at: AT,
      attempts: [{ parentId: "p1", result: ok(["a", "b"]) }],
      buildEntity: ({ children, parentId }) => buildEntity({ children, parentId }),
      extractStoredChildren: () => null,
      parentId: (parent) => parent.id,
      parents: [{ id: "p1", name: "P1" }],
      stored: [],
    });
    expect(reconciliation.entities.map((entity) => entity.providerId)).toEqual(["p1"]);
    expect(reconciliation.complete).toBe(true);
  });

  it("preserves only the failed parent's stored children while another parent's success still updates", () => {
    const stored = [fakeEntity({ children: ["old"], parentId: "p1" })];
    const reconciliation = reconcileParentFanout<FakeParent, string>({
      accountId: ACCOUNT_ID,
      at: AT,
      attempts: [
        {
          parentId: "p1",
          result: err(CloudflareClientErrors.provider({ cause: new Error("boom"), operation: "test", status: 500 })),
        },
        { parentId: "p2", result: ok(["fresh"]) },
      ],
      buildEntity: ({ children, parentId }) => buildEntity({ children, parentId }),
      extractStoredChildren: (entity) => (entity.detail as { children: readonly string[] }).children,
      parentId: (parent) => parent.id,
      parents: [
        { id: "p1", name: "P1" },
        { id: "p2", name: "P2" },
      ],
      stored,
    });
    const preserved = reconciliation.entities.find((entity) => entity.providerId === "p1")!;
    expect((preserved.detail as { children: readonly string[] }).children).toEqual(["old"]);
    expect(reconciliation.complete).toBe(false);
    expect(reconciliation.failedParentIds).toEqual(["p1"]);
  });

  it("drops a parent no longer present in this run's fresh inventory", () => {
    const stored = [fakeEntity({ children: ["old"], parentId: "gone" })];
    const reconciliation = reconcileParentFanout<FakeParent, string>({
      accountId: ACCOUNT_ID,
      at: AT,
      attempts: [{ parentId: "p1", result: ok(["a"]) }],
      buildEntity: ({ children, parentId }) => buildEntity({ children, parentId }),
      extractStoredChildren: (entity) => (entity.detail as { children: readonly string[] }).children,
      parentId: (parent) => parent.id,
      parents: [{ id: "p1", name: "P1" }],
      stored,
    });
    expect(reconciliation.entities.map((entity) => entity.providerId)).toEqual(["p1"]);
  });

  it("treats a brand-new parent whose first read failed as having no children to preserve", () => {
    const reconciliation = reconcileParentFanout<FakeParent, string>({
      accountId: ACCOUNT_ID,
      at: AT,
      attempts: [
        {
          parentId: "p1",
          result: err(CloudflareClientErrors.provider({ cause: new Error("boom"), operation: "test", status: 500 })),
        },
      ],
      buildEntity: ({ children, parentId }) => buildEntity({ children, parentId }),
      extractStoredChildren: () => null,
      parentId: (parent) => parent.id,
      parents: [{ id: "p1", name: "P1" }],
      stored: [],
    });
    const entity = reconciliation.entities.find((entry) => entry.providerId === "p1")!;
    expect((entity.detail as { children: readonly string[] }).children).toEqual([]);
  });

  it("carries no children forward for a failed parent whose stored detail does not validate as this kind's shape", () => {
    const reconciliation = reconcileParentFanout<FakeParent, string>({
      accountId: ACCOUNT_ID,
      at: AT,
      attempts: [
        {
          parentId: "p1",
          result: err(CloudflareClientErrors.provider({ cause: new Error("boom"), operation: "test", status: 500 })),
        },
      ],
      buildEntity: ({ children, parentId }) => buildEntity({ children, parentId }),
      extractStoredChildren: () => null,
      parentId: (parent) => parent.id,
      parents: [{ id: "p1", name: "P1" }],
      stored: [fakeEntity({ children: ["unreadable"], parentId: "p1" })],
    });
    const entity = reconciliation.entities.find((entry) => entry.providerId === "p1")!;
    expect((entity.detail as { children: readonly string[] }).children).toEqual([]);
    expect(reconciliation.failedParentIds).toEqual(["p1"]);
  });

  it("returns no entities for no parents", () => {
    const reconciliation = reconcileParentFanout<FakeParent, string>({
      accountId: ACCOUNT_ID,
      at: AT,
      attempts: [],
      buildEntity: ({ children, parentId }) => buildEntity({ children, parentId }),
      extractStoredChildren: () => null,
      parentId: (parent) => parent.id,
      parents: [],
      stored: [],
    });
    expect(reconciliation.entities).toEqual([]);
    expect(reconciliation.complete).toBe(true);
  });
});
