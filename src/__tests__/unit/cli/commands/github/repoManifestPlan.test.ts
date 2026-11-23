import { describe, expect, it } from "vitest";

import {
  descriptionMatches,
  labelMatches,
  manifestStepLabel,
  planRepoManifestApply,
  protectionMatches,
  type RepoManifestCurrentState,
  repoManifestPlanView,
  topicsMatch,
} from "../../../../../cli/commands/github/repoManifestPlan.js";
import {
  parseRepoSettingsApplyManifest,
  type RepoSettingsApplyManifest,
} from "../../../../../cli/commands/github/repoManifestSchema.js";
import { githubRepoViewDigest } from "../../../../../cli/commands/github/repoPlan.js";
import type { BranchProtectionState } from "../../../../../corpus/github/repoManifestProtection.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { applyManifestValue, manifestWorld } from "../../../../githubRepoManifestWorld.js";

/** The default artifact, parsed. */
function manifestOf(settings: Readonly<Record<string, unknown>> = {}): RepoSettingsApplyManifest {
  return unwrap(parseRepoSettingsApplyManifest({ value: applyManifestValue(settings) }));
}

/** A fresh private repository's live state, as the run reads it. */
function freshPrivate(): RepoManifestCurrentState {
  const world = manifestWorld();
  return {
    dependabotAlerts: world.dependabotAlerts,
    labels: world.labels,
    publicOnly: { kind: "waiting-for-public" },
    repository: world.repository,
    topics: world.topics,
  };
}

/** The same repository once public and fully applied: every section already matches the default artifact. */
function protectedMain(): Extract<BranchProtectionState, { kind: "protected" }> {
  return {
    allowDeletions: false,
    allowForcePushes: false,
    allowForkSyncing: undefined,
    enforceAdmins: true,
    kind: "protected",
    lockBranch: false,
    pushRestrictions: null,
    requiredConversationResolution: true,
    requiredLinearHistory: true,
    requiredStatusChecks: { contexts: ["ci"], strict: true },
    requiresPullRequestReviews: false,
  };
}

function compliantPublic(): RepoManifestCurrentState {
  const { settings } = manifestOf();
  return {
    dependabotAlerts: true,
    labels: [{ color: "0E8A16", description: "Ready to land", name: "Ready" }],
    publicOnly: {
      branchProtection: protectedMain(),
      kind: "read",
      privateVulnerabilityReporting: true,
      secretScanning: { pushProtection: true, secretScanning: true },
    },
    repository: {
      description: settings.description,
      features: settings.features,
      fullName: "acme/widget",
      id: 101,
      merge: settings.mergeSettings,
      visibility: "public",
    },
    topics: ["widgets", "CLI"],
  };
}

describe("planRepoManifestApply", () => {
  it("plans every private-safe section on a fresh private repository and leaves the public-only ones waiting", () => {
    const plan = unwrap(planRepoManifestApply({ current: freshPrivate(), manifest: manifestOf() }));

    expect(plan.steps.map((step) => manifestStepLabel({ step }))).toEqual([
      "set the description",
      "set the topics",
      "set the repository features",
      "set the merge settings",
      'create the label "ready"',
      "turn Dependabot alerts on",
    ]);
    expect(plan.waiting).toEqual(["branch-protection-main", "secret-scanning", "private-vulnerability-reporting"]);
  });

  it("plans nothing on a public repository that already matches, ignoring case and order", () => {
    const plan = unwrap(planRepoManifestApply({ current: compliantPublic(), manifest: manifestOf() }));

    expect(plan.steps).toEqual([]);
    expect(plan.waiting).toEqual([]);
  });

  it("plans only the public-only sections still different once the repository is public", () => {
    const current = compliantPublic();
    const plan = unwrap(
      planRepoManifestApply({
        current: {
          ...current,
          publicOnly: {
            branchProtection: { kind: "unprotected" },
            kind: "read",
            privateVulnerabilityReporting: true,
            secretScanning: { pushProtection: false, secretScanning: true },
          },
        },
        manifest: manifestOf(),
      }),
    );

    expect(plan.steps.map((step) => step.kind)).toEqual(["branch-protection-main", "secret-scanning"]);
  });

  it("refuses the whole apply when a label of the same name already differs", () => {
    const current = { ...freshPrivate(), labels: [{ color: "ffffff", description: null, name: "READY" }] };
    const planned = planRepoManifestApply({ current, manifest: manifestOf() });

    expect(planned.isErr()).toBe(true);
    expect(unwrapErr(planned).code).toBe("FACT_REFUSED");
    expect(unwrapErr(planned).message).toContain("READY");
  });

  it("sends the topics in one canonical order", () => {
    const plan = unwrap(
      planRepoManifestApply({ current: freshPrivate(), manifest: manifestOf({ topics: ["zeta", "alpha"] }) }),
    );

    expect(plan.steps[1]).toEqual({ kind: "topics", topics: ["alpha", "zeta"] });
  });
});

describe("the match helpers", () => {
  it("reads a null and an empty description as the same absence", () => {
    expect(descriptionMatches({ desired: null, live: "" })).toBe(true);
    expect(descriptionMatches({ desired: "a", live: null })).toBe(false);
  });

  it("compares topics as a set without case", () => {
    expect(topicsMatch({ desired: ["a", "b"], live: ["B", "a"] })).toBe(true);
    expect(topicsMatch({ desired: ["a"], live: ["a", "b"] })).toBe(false);
  });

  it("compares labels by name and colour without case", () => {
    const desired = { color: "0e8a16", description: null, name: "ready" };

    expect(labelMatches({ desired, live: { color: "0E8A16", description: "", name: "Ready" } })).toBe(true);
    expect(labelMatches({ desired, live: { color: "0e8a17", description: null, name: "ready" } })).toBe(false);
  });

  it("never reads an unprotected branch as matching protection", () => {
    const { settings } = manifestOf();

    expect(protectionMatches({ desired: settings.branchProtectionMain, live: { kind: "unprotected" } })).toBe(false);
  });

  it("does not read protection that also requires reviews as matching", () => {
    const { settings } = manifestOf();
    const live = { ...protectedMain(), lockBranch: undefined };

    expect(protectionMatches({ desired: settings.branchProtectionMain, live })).toBe(true);
    expect(
      protectionMatches({
        desired: settings.branchProtectionMain,
        live: { ...live, requiresPullRequestReviews: true },
      }),
    ).toBe(false);
  });

  it("does not read protection carrying anything the replacing write would clear as matching", () => {
    const { settings } = manifestOf();
    const live = protectedMain();

    expect(
      protectionMatches({
        desired: settings.branchProtectionMain,
        live: { ...live, pushRestrictions: { apps: [], teams: ["release"], users: [] } },
      }),
    ).toBe(false);
    expect(protectionMatches({ desired: settings.branchProtectionMain, live: { ...live, lockBranch: true } })).toBe(
      false,
    );
    expect(
      protectionMatches({ desired: settings.branchProtectionMain, live: { ...live, allowForkSyncing: true } }),
    ).toBe(false);
  });
});

describe("repoManifestPlanView", () => {
  it("binds the live visibility, so the second pass after --set-public carries a different digest", () => {
    const manifest = manifestOf();
    const privateView = repoManifestPlanView({
      current: freshPrivate(),
      manifest,
      plan: unwrap(planRepoManifestApply({ current: freshPrivate(), manifest })),
      source: "acme/widget",
    });
    const publicCurrent = compliantPublic();
    const publicView = repoManifestPlanView({
      current: publicCurrent,
      manifest,
      plan: unwrap(planRepoManifestApply({ current: publicCurrent, manifest })),
      source: "acme/widget",
    });

    expect((privateView["current"] as { visibility: string }).visibility).toBe("private");
    expect((publicView["current"] as { visibility: string }).visibility).toBe("public");
  });

  it("binds only the live labels the artifact names", () => {
    const manifest = manifestOf();
    const current = freshPrivate();
    const view = repoManifestPlanView({
      current,
      manifest,
      plan: unwrap(planRepoManifestApply({ current, manifest })),
      source: "acme/widget",
    });

    expect((view["current"] as { labels: unknown[] }).labels).toEqual([]);
  });

  it("binds a push restriction the replacing write would clear, so one added after the preview holds the approval", () => {
    const manifest = manifestOf();
    const unrestricted = compliantPublic();
    const restricted: RepoManifestCurrentState = {
      ...unrestricted,
      publicOnly: {
        ...(unrestricted.publicOnly as Extract<RepoManifestCurrentState["publicOnly"], { kind: "read" }>),
        branchProtection: { ...protectedMain(), enforceAdmins: false, pushRestrictions: null },
      },
    };
    const drifted: RepoManifestCurrentState = {
      ...restricted,
      publicOnly: {
        ...(restricted.publicOnly as Extract<RepoManifestCurrentState["publicOnly"], { kind: "read" }>),
        branchProtection: {
          ...protectedMain(),
          enforceAdmins: false,
          pushRestrictions: { apps: [], teams: ["release"], users: [] },
        },
      },
    };
    const digestOf = ({ current }: { current: RepoManifestCurrentState }): string =>
      githubRepoViewDigest({
        view: repoManifestPlanView({
          current,
          manifest,
          plan: unwrap(planRepoManifestApply({ current, manifest })),
          source: "acme/widget",
        }),
      });

    expect(digestOf({ current: drifted })).not.toBe(digestOf({ current: restricted }));
  });
});
