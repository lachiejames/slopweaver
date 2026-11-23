/**
 * The coverage cell each KnowBe4 path earns, and the pure generation built from one observation: a complete
 * read is `synced`, a bounded one `deferred` with the bound named, a 403 names the subscription tier, and a kind
 * never read keeps no success.
 */
import { describe, expect, it } from "vitest";

import { failureWords, type Knowbe4PriorGeneration, pathCell } from "../../../../atlas/knowbe4/cells.js";
import { KNOWBE4_FILL_CALLS, SUBSCRIPTION_UNBLOCKED_BY } from "../../../../atlas/knowbe4/fill/plan.js";
import type { Knowbe4CallFailed, Knowbe4FillObservation } from "../../../../atlas/knowbe4/fill/run.js";
import { buildKnowbe4Generation } from "../../../../atlas/knowbe4/sync.js";

const AT = "2026-10-15T00:00:00.000Z";

const NO_PRIOR: Knowbe4PriorGeneration = {
  files: {
    account: null,
    group: null,
    "group-member": null,
    "phishing-campaign": null,
    "phishing-recipient": null,
    "phishing-security-test": null,
    policy: null,
    "store-purchase": null,
    "training-campaign": null,
    "training-enrollment": null,
    user: null,
  },
  manifest: null,
};

const USERS_CALL = KNOWBE4_FILL_CALLS.find((call) => call.template === "/v1/users")!;

/**
 * Every path answered empty except those `failed` names, with the users path stopped by `usersTruncatedBy`.
 *
 * @param failed the paths that failed instead
 * @param usersTruncatedBy the bound the users read stopped at, or `null` for a complete read
 * @returns the observation
 */
function observation({
  failed,
  usersTruncatedBy,
}: {
  failed: readonly Knowbe4CallFailed[];
  usersTruncatedBy: string | null;
}): Knowbe4FillObservation {
  const failedTemplates = new Set(failed.map((entry) => entry.template));
  return {
    answered: KNOWBE4_FILL_CALLS.filter((call) => !failedTemplates.has(call.template)).map((call) => ({
      items: [],
      kind: call.kind,
      template: call.template,
      truncatedBy: call.template === "/v1/users" ? usersTruncatedBy : null,
    })),
    failed,
    filledAtIso: AT,
  };
}

describe("failureWords", () => {
  it("leads with KnowBe4's status when it answered", () => {
    expect(failureWords({ failure: { kind: "user", message: "denied", status: 403, template: "/v1/users" } })).toBe(
      "answered 403 — denied",
    );
  });

  it("says the read failed before any answer when there was no status", () => {
    expect(failureWords({ failure: { kind: "user", message: "reset", status: null, template: "/v1/users" } })).toBe(
      "failed before KnowBe4 answered — reset",
    );
  });
});

describe("pathCell", () => {
  it("is synced for a complete read", () => {
    const cell = pathCell({
      call: USERS_CALL,
      fill: observation({ failed: [], usersTruncatedBy: null }),
      prior: NO_PRIOR,
    });
    expect([cell.state, cell.scope, cell.surface, cell.unblockedBy]).toEqual([
      "synced",
      "/v1/users",
      "reporting-api-v1",
      null,
    ]);
  });

  it("is deferred, naming the bound, for a read that stopped short", () => {
    const cell = pathCell({
      call: USERS_CALL,
      fill: observation({ failed: [], usersTruncatedBy: "the 20-page bound" }),
      prior: NO_PRIOR,
    });
    expect([cell.state, cell.reason, cell.lastSuccessAt, cell.latestAttemptFailed]).toEqual([
      "deferred",
      "/v1/users answered 0 row(s) and stopped at the 20-page bound with more to read",
      null,
      true,
    ]);
  });

  it("is unreadable and names the subscription tier for a 403", () => {
    const failed = [{ kind: "user" as const, message: "denied", status: 403, template: "/v1/users" as const }];
    const cell = pathCell({ call: USERS_CALL, fill: observation({ failed, usersTruncatedBy: null }), prior: NO_PRIOR });
    expect([cell.state, cell.unblockedBy, cell.latestAttemptFailed]).toEqual([
      "unreadable",
      SUBSCRIPTION_UNBLOCKED_BY,
      true,
    ]);
  });
});

describe("buildKnowbe4Generation", () => {
  it("leaves a kind that failed on its first read with no success and no permission block", () => {
    const failed = [{ kind: "user" as const, message: "socket reset", status: null, template: "/v1/users" as const }];
    const { manifest } = buildKnowbe4Generation({
      fill: observation({ failed, usersTruncatedBy: null }),
      prior: NO_PRIOR,
    });
    expect([manifest.kinds.user.lastSuccessAt, manifest.kinds.user.permissionBlocked]).toEqual([null, undefined]);
    expect(manifest.kinds.group.lastSuccessAt).toBe(AT);
  });

  it("stamps a 403 on a first read as permission-blocked, so the kit reads a boundary rather than a broken atlas", () => {
    const failed = [{ kind: "user" as const, message: "denied", status: 403, template: "/v1/users" as const }];
    const { files, manifest } = buildKnowbe4Generation({
      fill: observation({ failed, usersTruncatedBy: null }),
      prior: NO_PRIOR,
    });
    expect(manifest.kinds.user.permissionBlocked).toEqual({
      at: AT,
      detail: "/v1/users answered 403 — denied",
      unblockedBy: SUBSCRIPTION_UNBLOCKED_BY,
    });
    expect(files.user.entities).toEqual([]);
  });
});
