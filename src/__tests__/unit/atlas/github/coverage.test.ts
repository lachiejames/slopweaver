/**
 * The coverage judgements that are GitHub's own: how a failure is graded, and what lets a sync exit zero.
 *
 * The success predicate is the one worth pinning hardest. The kit's own `hasUsableCoverage` is
 * `cells.some(...)`, so a run in which every kind but one failed reports success — this atlas's bar is
 * universal over its mandatory kinds, and a test is what keeps it that way.
 */
import { describe, expect, it } from "vitest";

import {
  githubCoverageStateFor,
  githubKindScope,
  githubUnblockedBy,
  githubUncoveredMandatoryKinds,
  replaceGithubCoverageCell,
  succeededGithubCoverageCell,
} from "../../../../atlas/github/coverage.js";
import { GithubAtlasErrors } from "../../../../atlas/github/errors.js";
import type { GithubCoverageCell } from "../../../../atlas/github/kindFiles.js";

const AT = "2026-09-05T00:00:00.000Z";

/** A cell with the fields the predicate reads, overridable. */
function cell({
  state,
  role = "authoritative",
  scope = "example-org/ruleset",
  surface = "rest-live",
}: {
  state: GithubCoverageCell["state"];
  role?: GithubCoverageCell["role"];
  scope?: string;
  surface?: GithubCoverageCell["surface"];
}): GithubCoverageCell {
  return {
    artifacts: [],
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason: "test",
    role,
    scope,
    state,
    surface,
    unblockedBy: null,
    visibilityScope: "test",
  };
}

describe("githubKindScope", () => {
  it("names the kind and the place it was read at", () => {
    expect(githubKindScope({ kind: "ruleset", scopeRef: "example-org" })).toBe("example-org/ruleset");
  });
});

describe("githubCoverageStateFor", () => {
  it("grades a permission refusal as unreadable, never as not-configured", () => {
    expect(
      githubCoverageStateFor({ error: GithubAtlasErrors.scopeRefused({ route: "/orgs/x", scope: "admin:org" }) }),
    ).toBe("unreadable");
  });

  it("grades a plan gap as unavailable, because no grant opens it", () => {
    expect(githubCoverageStateFor({ error: GithubAtlasErrors.planUnavailable({ feature: "Advanced Security" }) })).toBe(
      "unavailable",
    );
  });

  it("grades an absent route as unavailable", () => {
    expect(githubCoverageStateFor({ error: GithubAtlasErrors.routeAbsent({ route: "/orgs/x/y" }) })).toBe(
      "unavailable",
    );
  });

  it("grades a rejected credential as invalid-configuration", () => {
    expect(githubCoverageStateFor({ error: GithubAtlasErrors.authFailed({ reason: "401" }) })).toBe(
      "invalid-configuration",
    );
  });

  it("grades a truncated read as deferred", () => {
    expect(githubCoverageStateFor({ error: GithubAtlasErrors.incompleteRead({ observed: 5, route: "/x" }) })).toBe(
      "deferred",
    );
  });
});

describe("githubUnblockedBy", () => {
  it("names the missing permission when GitHub named one", () => {
    expect(githubUnblockedBy({ error: GithubAtlasErrors.scopeRefused({ route: "/orgs/x", scope: "admin:org" }) })).toBe(
      "grant this token the admin:org permission",
    );
  });

  it("explains the two usual causes when GitHub named none", () => {
    expect(githubUnblockedBy({ error: GithubAtlasErrors.scopeRefused({ route: "/orgs/x", scope: null }) })).toContain(
      "SSO authorisation",
    );
  });

  it("offers nothing for a plan gap, because there is nothing to grant", () => {
    expect(githubUnblockedBy({ error: GithubAtlasErrors.planUnavailable({ feature: "Advanced Security" }) })).toBe(
      null,
    );
  });
});

describe("replaceGithubCoverageCell", () => {
  it("replaces one surface's cell without touching the other surface's", () => {
    const cells = [cell({ state: "synced", surface: "rest-live" }), cell({ state: "synced", surface: "github-web" })];
    const replaced = replaceGithubCoverageCell({
      cell: cell({ state: "unreadable", surface: "rest-live" }),
      cells,
    });
    expect(replaced.find((entry) => entry.surface === "github-web")!.state).toBe("synced");
    expect(replaced.find((entry) => entry.surface === "rest-live")!.state).toBe("unreadable");
  });
});

describe("githubUncoveredMandatoryKinds", () => {
  it("reports nothing when every mandatory kind synced", () => {
    expect(githubUncoveredMandatoryKinds({ cells: { ruleset: [cell({ state: "synced" })] } })).toEqual([]);
  });

  it("accepts a kind whose every cell says the platform cannot offer it here", () => {
    expect(githubUncoveredMandatoryKinds({ cells: { ruleset: [cell({ state: "unavailable" })] } })).toEqual([]);
  });

  it("REFUSES a kind that is merely unreadable, which is a boundary the reader has to see", () => {
    expect(githubUncoveredMandatoryKinds({ cells: { ruleset: [cell({ state: "unreadable" })] } })).toEqual(["ruleset"]);
  });

  it("refuses a kind whose read was only deferred", () => {
    expect(githubUncoveredMandatoryKinds({ cells: { webhook: [cell({ state: "deferred" })] } })).toEqual(["webhook"]);
  });

  it("is UNIVERSAL: one synced kind does not cover a second failed one", () => {
    expect(
      githubUncoveredMandatoryKinds({
        cells: { ruleset: [cell({ state: "synced" })], webhook: [cell({ state: "unreadable" })] },
      }),
    ).toEqual(["webhook"]);
  });

  it("demands the repository label set like any other API kind", () => {
    expect(githubUncoveredMandatoryKinds({ cells: { "repository-label": [cell({ state: "unreadable" })] } })).toEqual([
      "repository-label",
    ]);
  });

  it("never demands the browser kinds of an API sync", () => {
    expect(githubUncoveredMandatoryKinds({ cells: { "admin-page": [cell({ state: "unreadable" })] } })).toEqual([]);
  });

  it("refuses a kind whose only cell is corroborating rather than a source of record", () => {
    expect(
      githubUncoveredMandatoryKinds({ cells: { ruleset: [cell({ role: "corroborating", state: "synced" })] } }),
    ).toEqual(["ruleset"]);
  });
});

describe("succeededGithubCoverageCell", () => {
  it("carries the state it was given, so a partial walk cannot report as synced", () => {
    const built = succeededGithubCoverageCell({
      artifacts: [],
      at: AT,
      reason: "partial",
      role: "authoritative",
      scope: "github/admin-page",
      state: "deferred",
      surface: "github-web",
    });
    expect(built.state).toBe("deferred");
    expect(built.lastSuccessAt).toBe(AT);
  });
});
