/*
 * The parent-fanout steps a "parent inventory + embedded child collection" kind shares: each parent's scope
 * string, the per-parent gap inputs a failed and a succeeded parent earn, and the fan-out-and-reconcile read
 * driven over a plain fake reader rather than a client.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { type CloudflareClientError, CloudflareClientErrors } from "../../../../atlas/cloudflare/errors.js";
import type { ParentCollectionAttempt } from "../../../../atlas/cloudflare/fanout.js";
import { CLOUDFLARE_GAP_CONDITIONS, openCloudflareGap } from "../../../../atlas/cloudflare/gaps.js";
import type { CloudflareEntity } from "../../../../atlas/cloudflare/model.js";
import {
  basicParentFanoutGapInputs,
  fanOutAndReconcile,
  PARENT_FANOUT_CONCURRENCY,
  parentFanoutScope,
} from "../../../../atlas/cloudflare/parentFanoutFold.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";

const AT = "2026-03-04T05:06:07.000Z";
const ACCOUNT = "acct-1";

/** The stored detail shape this test's fake kind writes, so a stored entity's children can be read back. */
const listDetailSchema = z.object({ children: z.array(z.string()) });

/** One account-filter-list entity carrying the given children, shaped the way a real projection stores one. */
function listEntity({ parentId, children }: { parentId: string; children: readonly string[] }): CloudflareEntity {
  return {
    detail: { children: [...children] },
    firstSeenAt: AT,
    id: `list-${parentId}`,
    kind: "account-filter-list",
    lastSeenAt: AT,
    providerId: parentId,
    scope: { accountId: ACCOUNT, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: AT, operation: "filter-list-items" },
    state: "observed",
  };
}

describe("parentFanoutScope", () => {
  it("records one parent under its account, kind and own id", () => {
    expect(parentFanoutScope({ accountId: ACCOUNT, kind: "gateway-list", parentId: "list-a" })).toBe(
      "account/acct-1/gateway-list/list-a",
    );
  });

  it("caps every fan-out at four concurrent reads", () => {
    expect(PARENT_FANOUT_CONCURRENCY).toBe(4);
  });
});

describe("basicParentFanoutGapInputs", () => {
  it("opens one gap for a failed parent and rechecks every condition on a succeeded one", () => {
    const refused = CloudflareClientErrors.permission({ cause: new Error("forbidden"), operation: "list-items" });
    const attempts: readonly ParentCollectionAttempt<string>[] = [
      { parentId: "p1", result: ok(["x"]) },
      { parentId: "p2", result: err(refused) },
    ];

    const inputs = basicParentFanoutGapInputs({ accountId: ACCOUNT, at: AT, attempts, kind: "account-filter-list" });

    expect(inputs.observed).toEqual([
      openCloudflareGap({
        at: AT,
        condition: "permission-refused",
        kind: "account-filter-list",
        reason: refused.message,
        scope: "account/acct-1/account-filter-list/p2",
      }),
    ]);
    expect(inputs.rechecks).toEqual(
      CLOUDFLARE_GAP_CONDITIONS.map((condition) => ({
        condition,
        resolved: true,
        scope: "account/acct-1/account-filter-list/p1",
      })),
    );
  });

  it("observes nothing and rechecks nothing when there were no parents", () => {
    const attempts: readonly ParentCollectionAttempt<string>[] = [];

    const inputs = basicParentFanoutGapInputs({ accountId: ACCOUNT, at: AT, attempts, kind: "account-filter-list" });

    expect(inputs.observed).toEqual([]);
    expect(inputs.rechecks).toEqual([]);
  });
});

describe("fanOutAndReconcile", () => {
  it("reads every parent, normalizes each raw child and keeps a failed parent's stored children", async () => {
    const read: string[] = [];
    const down = CloudflareClientErrors.transport({ cause: new Error("reset"), operation: "list-items" });
    const result = await fanOutAndReconcile<{ id: string; name: string }, { value: string }, string>({
      accountId: ACCOUNT,
      at: AT,
      buildEntity: ({ parentId, children }) => listEntity({ children, parentId }),
      extractStoredChildren: (entity) => {
        const parsed = listDetailSchema.safeParse(entity.detail);
        return parsed.success ? parsed.data.children : null;
      },
      normalizeChild: ({ raw }) => raw.value.toUpperCase(),
      parents: [
        { id: "p1", name: "First" },
        { id: "p2", name: "Second" },
      ],
      readChild: ({ parentId }) => {
        read.push(parentId);
        const outcome: Result<readonly { value: string }[], CloudflareClientError> =
          parentId === "p1" ? ok([{ value: "fresh" }]) : err(down);
        return Promise.resolve(outcome);
      },
      stored: [listEntity({ children: ["OLD"], parentId: "p2" })],
    });

    expect(read.toSorted()).toEqual(["p1", "p2"]);
    expect(result.attempts.map((attempt) => attempt.parentId)).toEqual(["p1", "p2"]);
    expect(unwrap(result.attempts[0]!.result)).toEqual(["FRESH"]);
    expect(result.reconciliation).toEqual({
      complete: false,
      entities: [
        listEntity({ children: ["FRESH"], parentId: "p1" }),
        listEntity({ children: ["OLD"], parentId: "p2" }),
      ],
      failedParentIds: ["p2"],
      reasons: [`p2: ${down.message}`],
    });
  });

  it("is complete when every parent's read succeeds", async () => {
    const result = await fanOutAndReconcile<{ id: string }, { value: string }, string>({
      accountId: ACCOUNT,
      at: AT,
      buildEntity: ({ parentId, children }) => listEntity({ children, parentId }),
      extractStoredChildren: () => null,
      normalizeChild: ({ raw }) => raw.value,
      parents: [{ id: "p1" }],
      readChild: () => Promise.resolve(ok([{ value: "only" }])),
      stored: [],
    });

    expect(result.reconciliation).toEqual({
      complete: true,
      entities: [listEntity({ children: ["only"], parentId: "p1" })],
      failedParentIds: [],
      reasons: [],
    });
  });
});
