/**
 * The state a `github repo --apply-manifest` case starts from: a valid apply artifact for the synthetic
 * `acme/widget`, and one freshly created repository's settings as `./githubRepoManifestFake.ts` holds them.
 */
import type {
  BranchProtectionState,
  RepoLabel,
  RepoManifestRepositoryState,
  SecretScanningSettings,
} from "../outbound/github/repoManifest.js";

/**
 * A valid apply artifact for the synthetic `acme/widget`, as a JSON-shaped value; override a section to make a case.
 *
 * @param settings the settings a case changes, merged over the defaults one level deep
 * @returns the artifact, before parsing
 */
export function applyManifestValue(settings: Readonly<Record<string, unknown>> = {}): {
  version: 1;
  repository: string;
  provenance: Record<string, unknown>;
  settings: Record<string, unknown>;
} {
  return {
    provenance: {
      ownerRulings: [{ evidence: "the settings review", id: "merge-style", ruling: "squash only" }],
      sourceManifestSha256: "0".repeat(64),
      unresolvedOwnerCalls: [],
    },
    repository: "acme/widget",
    settings: {
      branchProtectionMain: {
        allowDeletions: false,
        allowForcePushes: false,
        enforceAdmins: true,
        requiredConversationResolution: true,
        requiredLinearHistory: true,
        requiredPullRequestReviews: null,
        requiredStatusChecks: { contexts: ["ci"], strict: true },
      },
      dependabotAlerts: { enabled: true },
      description: "A widget for acme",
      features: { hasDiscussions: false, hasIssues: true, hasProjects: false, hasWiki: false, isTemplate: false },
      labels: { create: [{ color: "0e8a16", description: "Ready to land", name: "ready" }], keepGithubDefaults: true },
      mergeSettings: {
        allowAutoMerge: true,
        allowMergeCommit: false,
        allowRebaseMerge: false,
        allowSquashMerge: true,
        allowUpdateBranch: true,
        deleteBranchOnMerge: true,
        squashMergeCommitMessage: "PR_BODY",
        squashMergeCommitTitle: "PR_TITLE",
        webCommitSignoffRequired: false,
      },
      privateVulnerabilityReporting: { enabled: true },
      secretScanning: { pushProtection: true, secretScanning: true },
      topics: ["cli", "widgets"],
      ...settings,
    },
    version: 1,
  };
}

/**
 * A freshly created private `acme/widget`: GitHub's defaults, nothing the artifact asks for yet.
 *
 * @param over the fields a case sets
 * @returns the world
 */
export function manifestWorld(over: Partial<ManifestWorld> = {}): ManifestWorld {
  return {
    dependabotAlerts: false,
    labels: [{ color: "d73a4a", description: "Something isn't working", name: "bug" }],
    privateVulnerabilityReporting: false,
    protection: { kind: "unprotected" },
    reads: [],
    repository: {
      description: null,
      features: { hasDiscussions: false, hasIssues: true, hasProjects: true, hasWiki: true, isTemplate: false },
      fullName: "acme/widget",
      id: 101,
      merge: {
        allowAutoMerge: false,
        allowMergeCommit: true,
        allowRebaseMerge: true,
        allowSquashMerge: true,
        allowUpdateBranch: false,
        deleteBranchOnMerge: false,
        squashMergeCommitMessage: "COMMIT_MESSAGES",
        squashMergeCommitTitle: "COMMIT_OR_PR_TITLE",
        webCommitSignoffRequired: false,
      },
      visibility: "private",
    },
    secretScanning: { pushProtection: false, secretScanning: false },
    sent: [],
    topics: [],
    ...over,
  };
}

/** One repository's settings, as the fake holds them. */
export interface ManifestWorld {
  repository: RepoManifestRepositoryState;
  topics: string[];
  labels: RepoLabel[];
  dependabotAlerts: boolean;
  protection: BranchProtectionState;
  secretScanning: SecretScanningSettings;
  privateVulnerabilityReporting: boolean;
  /** Every read, by what it read, in order. */
  readonly reads: string[];
  /** Every write, by step (`label-create:<name>` for a label), in order. */
  readonly sent: string[];
  /** A write the fake accepts but does not apply, so its read-back shows it did not land. */
  ignored?: string;
  /** A write the fake refuses with HTTP 422 and does not apply. */
  refused?: string;
  /** A write the fake refuses with HTTP 502 but applies anyway, as a gateway error after GitHub acted would. */
  appliedButErrored?: string;
  /** Another actor changing the repository right after the named step is sent, mid-run. */
  afterSend?: { readonly step: string; readonly change: (args: { world: ManifestWorld }) => void };
  /** Another actor changing the repository right after the named read is answered, mid-preview. */
  afterRead?: { readonly read: string; readonly change: (args: { world: ManifestWorld }) => void };
  /** A public-only read the fake refuses with HTTP 403 even on a public repository, as a scope gap would. */
  refusedRead?: string;
  /**
   * The repository is gone from its address: its read answers 404, while the Dependabot read still answers "off",
   * as the real one maps a 404 to.
   */
  gone?: boolean;
}
