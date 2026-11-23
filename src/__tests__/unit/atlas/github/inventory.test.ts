/**
 * The closed read inventory, and the invariant that keeps a row from silently dropping its records.
 *
 * The table and the projector map are two halves of one contract kept in two files. Nothing in the type
 * system joins them — a row added to `inventory.ts` with no entry in `syncProjectors.ts` compiles, runs,
 * and reads zero records forever — so the join is asserted here instead.
 */
import { describe, expect, it } from "vitest";

import { GithubRefusalErrors } from "../../../../atlas/github/errors.js";
import {
  GITHUB_CALLS,
  GITHUB_DISCOVERY_CALL_IDS,
  type GithubCallId,
  type GithubProjectedCallId,
  githubCallById,
  githubCallsAt,
  isGithubDiscoveryCallId,
} from "../../../../atlas/github/inventory.js";
import { type GithubCall, githubCallRoute } from "../../../../atlas/github/inventoryShape.js";
import { GITHUB_KINDS } from "../../../../atlas/github/model.js";
import type { ProjectionContext } from "../../../../atlas/github/projection.js";
import { GITHUB_COMPANION_CALLS, projectCallOutcome, projectorFor } from "../../../../atlas/github/syncProjectors.js";
import type { CallOutcome } from "../../../../atlas/github/syncRead.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

type SucceededOutcome = Extract<CallOutcome, { readonly error: null }>;

const CONTEXT: ProjectionContext = {
  at: "2026-09-05T00:00:00.000Z",
  source: { endpoint: "/x", observedAt: "2026-09-05T00:00:00.000Z", surface: "rest-live" },
};

describe("GITHUB_CALLS", () => {
  it("admits only GETs, so nothing in this atlas can change a byte of GitHub", () => {
    expect(GITHUB_CALLS.every((call) => call.method === "GET")).toBe(true);
  });

  it("gives every call a distinct id, which is what the projector map is keyed on", () => {
    const ids = GITHUB_CALLS.map((call) => call.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes every call name a kind this atlas actually stores", () => {
    for (const call of GITHUB_CALLS) {
      expect(GITHUB_KINDS).toContain(call.kind);
    }
  });

  it("gives every call a whyRead a reviewer can check against the table", () => {
    for (const call of GITHUB_CALLS) {
      expect(call.whyRead.length).toBeGreaterThan(0);
    }
  });
});

/** A successful read of one call, carrying the records it returned. */
function succeeded({ call, records }: { call: GithubCall; records: readonly unknown[] }): SucceededOutcome {
  const outcome = { pagesExhausted: true, records, reportedTotal: null };
  return { call, error: null, outcome, route: "/x", scopeRef: "example-org" };
}

describe("projectorFor", () => {
  // The projector table is typed `Record<GithubProjectedCallId, …>`, so a missing row is a compile error;
  // this proves the runtime half: every call the sync walks resolves to a projector.
  it("has a projector for EVERY call the sync walks, so no row silently drops its records", () => {
    const walked = (["account", "organization", "repository"] as const).flatMap((level) => githubCallsAt({ level }));
    expect(walked.length).toBe(GITHUB_CALLS.length - GITHUB_DISCOVERY_CALL_IDS.length);
    const projectedCounts = walked.map(
      (call) =>
        unwrap(projectCallOutcome({ at: CONTEXT.at, companion: [], outcome: succeeded({ call, records: [] }) })).length,
    );
    expect(projectedCounts.filter((count) => count !== 0)).toStrictEqual([]);
  });

  it("is keyed on a projected call id only, so a discovery id cannot reach the table", () => {
    // @ts-expect-error -- a discovery call has no projector, so its id is not a projected call id
    const discovery: GithubProjectedCallId = "account-organisations";
    expect(GITHUB_DISCOVERY_CALL_IDS).toContain(discovery);
    const projected = projectorFor({ callId: "org-settings" })({
      companion: [],
      context: CONTEXT,
      records: [],
      scopeRef: "example-org",
    });
    expect(projected).toStrictEqual([]);
  });
});

describe("projectCallOutcome", () => {
  // Before: a lookup miss was handed `() => []`, so a discovery call and a malformed id were the same silent
  // empty list. They are different facts: the first is absence by design, the second a refusal.
  it("projects no records for a discovery call, by design, whatever it returned", () => {
    const call = githubCallById({ id: "account-organisations" });
    const result = projectCallOutcome({
      at: CONTEXT.at,
      companion: [],
      outcome: succeeded({ call, records: [{ id: 1, login: "example-org" }] }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toStrictEqual([]);
    expect(isGithubDiscoveryCallId(call.id)).toBe(true);
  });

  it("refuses a call id outside the closed inventory with CALL_UNREGISTERED, naming the id", () => {
    const stray = { ...githubCallById({ id: "org-settings" }), id: "org-settingz" };
    const result = projectCallOutcome({
      at: CONTEXT.at,
      companion: [],
      outcome: succeeded({ call: stray, records: [] }),
    });
    expect(unwrapErr(result)).toStrictEqual(GithubRefusalErrors.callUnregistered({ callId: "org-settingz" }));
    expect(unwrapErr(result).code).toBe("CALL_UNREGISTERED");
    expect(unwrapErr(result).message).toBe(
      'github call "org-settingz" is neither a discovery call nor a projected call in the closed inventory, so its records have no projection — refusing to publish rather than drop them',
    );
    expect(isGithubDiscoveryCallId("org-settingz")).toBe(false);
  });
});

describe("githubCallRoute", () => {
  it("fills an organisation route from a login", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "org-settings")!;
    expect(githubCallRoute({ call, scopeRef: "example-org" })).toBe("/orgs/example-org");
  });

  it("fills a repository route from a coordinate", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "repo-settings")!;
    expect(githubCallRoute({ call, scopeRef: "example-org/example-repo" })).toBe("/repos/example-org/example-repo");
  });

  it("refuses a coordinate handed to an organisation-level call", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "org-settings")!;
    expect(githubCallRoute({ call, scopeRef: "example-org/example-repo" })).toBe(null);
  });

  it("refuses a bare name handed to a repository-level call", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "repo-settings")!;
    expect(githubCallRoute({ call, scopeRef: "example-org" })).toBe(null);
  });
});

describe("the repository reads a reproduction of the repository needs", () => {
  it("routes the workflow defaults and the label set at repository scope", () => {
    const defaults = githubCallById({ id: "repo-actions-workflow-defaults" });
    const labels = githubCallById({ id: "repo-labels" });
    expect(githubCallRoute({ call: defaults, scopeRef: "example-org/example-repo" })).toBe(
      "/repos/example-org/example-repo/actions/permissions/workflow",
    );
    expect(githubCallRoute({ call: labels, scopeRef: "example-org/example-repo" })).toBe(
      "/repos/example-org/example-repo/labels",
    );
    expect(defaults.kind).toBe("actions-policy");
    expect(labels.kind).toBe("repository-label");
  });

  it("folds the repository workflow defaults into the repository Actions policy, as the organisation pair does", () => {
    expect(GITHUB_COMPANION_CALLS).toStrictEqual({
      "org-actions-workflow-defaults": "org-actions-policy",
      "repo-actions-workflow-defaults": "repo-actions-policy",
    });
  });

  it("projects one repository policy carrying both documents' fields, and nothing for the absorbed call", () => {
    const policy = projectorFor({ callId: "repo-actions-policy" })({
      companion: [{ can_approve_pull_request_reviews: false, default_workflow_permissions: "read" }],
      context: CONTEXT,
      records: [{ allowed_actions: "selected", enabled: true }],
      scopeRef: "example-org/example-repo",
    });
    const absorbed = projectorFor({ callId: "repo-actions-workflow-defaults" })({
      companion: [],
      context: CONTEXT,
      records: [{ can_approve_pull_request_reviews: false, default_workflow_permissions: "read" }],
      scopeRef: "example-org/example-repo",
    });
    expect(policy.length).toBe(1);
    expect(policy[0]).toMatchObject({
      allowedActions: "selected",
      canApprovePullRequestReviews: false,
      defaultWorkflowPermissions: "read",
      enabled: true,
      scopeLevel: "repository",
    });
    expect(absorbed).toStrictEqual([]);
  });

  it("projects every label of a listing, one entity per label name", () => {
    const labels = projectorFor({ callId: "repo-labels" })({
      companion: [],
      context: CONTEXT,
      records: [
        { color: "a2eeef", description: null, name: "kind: feature" },
        { color: "d73a4a", description: "Something is broken", name: "kind: bug fix" },
      ],
      scopeRef: "example-org/example-repo",
    });
    expect(labels.map((entity) => entity.providerId)).toStrictEqual(["kind: feature", "kind: bug fix"]);
  });
});

describe("githubCallsAt", () => {
  it("splits the table by level, holding back exactly the discovery calls", () => {
    const walked =
      githubCallsAt({ level: "account" }).length +
      githubCallsAt({ level: "organization" }).length +
      githubCallsAt({ level: "repository" }).length;
    expect(walked).toBe(GITHUB_CALLS.length - GITHUB_DISCOVERY_CALL_IDS.length);
  });

  it("never returns a discovery call, because a scope's own read must not re-enumerate", () => {
    for (const level of ["account", "organization", "repository"] as const) {
      for (const call of githubCallsAt({ level })) {
        expect(GITHUB_DISCOVERY_CALL_IDS).not.toContain(call.id);
      }
    }
  });
});

describe("the discovery calls", () => {
  it("names both, and both are in the closed table", () => {
    expect(GITHUB_DISCOVERY_CALL_IDS).toEqual(["account-organisations", "org-repositories"]);
    for (const id of GITHUB_DISCOVERY_CALL_IDS) {
      expect(githubCallById({ id }).id).toBe(id);
    }
  });

  it("builds the account-level route with no scope, because the token IS the scope", () => {
    const call = githubCallById({ id: "account-organisations" });
    expect(githubCallRoute({ call, scopeRef: "" })).toBe("/user/orgs");
  });

  it("builds the repository listing route from an organisation login", () => {
    const call = githubCallById({ id: "org-repositories" });
    expect(githubCallRoute({ call, scopeRef: "example-org" })).toBe("/orgs/example-org/repos");
  });

  // Before: an unknown id answered null at run time; the id is now closed, so it cannot be asked at all.
  it("refuses a call the table does not carry at compile time", () => {
    // @ts-expect-error -- "not-a-call" is not an admitted call id
    const unknown: GithubCallId = "not-a-call";
    expect(GITHUB_CALLS.some((call) => call.id === unknown)).toBe(false);
  });

  it("resolves every admitted id to the row that declares it", () => {
    expect(GITHUB_CALLS.filter((call) => githubCallById({ id: call.id }) !== call).map((call) => call.id)).toEqual([]);
  });
});
