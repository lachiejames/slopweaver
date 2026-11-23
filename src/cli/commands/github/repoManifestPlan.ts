/**
 * The pure half of `github repo --apply-manifest`: the ordered steps from a repository's live settings to an apply
 * artifact's, the sections that wait for the repository to be public, and the view the digest binds.
 *
 * TWO PASSES, by design. Branch protection, secret scanning and private vulnerability reporting exist only on a
 * public repository of a free personal plan: GitHub answers a private one's protection read 403 with its plan
 * sentence (`src/corpus/github/protectionRead.ts`). So while the repository is private they are never read and
 * never sent; they are listed as waiting, and the same artifact is previewed again after `--set-public`. That
 * second preview reads a different visibility and different live state, so it prints a new digest, and it plans
 * only what is still different.
 *
 * Labels are CREATE-ONLY. An existing label of the same name, compared without case, is either already the label
 * asked for or a conflict, and a conflict refuses the whole apply before anything is sent: a label is somebody's,
 * and overwriting it is not a setting.
 */

import { err, ok, type Result } from "#lib/result.js";
import type {
  BranchProtectionSettings,
  BranchProtectionState,
  RepoFeatureSettings,
  RepoLabel,
  RepoManifestRepositoryState,
  RepoMergeSettings,
  SecretScanningSettings,
} from "../../../outbound/github/repoManifest.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";
import type { LabelConflict } from "./repoManifestErrors.js";
import type { RepoSettingsApplyManifest } from "./repoManifestSchema.js";

/** The branch the manifest's protection names. */
export const MANIFEST_PROTECTED_BRANCH = "main";

/** The sections GitHub offers only on a public repository of a free personal plan. */
export type PublicOnlySection = "branch-protection-main" | "secret-scanning" | "private-vulnerability-reporting";

/** Every public-only section, in the order it is applied. */
export const PUBLIC_ONLY_SECTIONS: readonly PublicOnlySection[] = [
  "branch-protection-main",
  "secret-scanning",
  "private-vulnerability-reporting",
];

/** The public-only settings as read, or the fact that the repository is not public and they were not asked. */
export type PublicOnlyRead =
  | { readonly kind: "waiting-for-public" }
  | {
      readonly kind: "read";
      readonly branchProtection: BranchProtectionState;
      readonly secretScanning: SecretScanningSettings;
      readonly privateVulnerabilityReporting: boolean;
    };

/** Everything the apply is judged against, read live. */
export interface RepoManifestCurrentState {
  readonly repository: RepoManifestRepositoryState;
  readonly topics: readonly string[];
  readonly labels: readonly RepoLabel[];
  readonly dependabotAlerts: boolean;
  readonly publicOnly: PublicOnlyRead;
}

/** One write toward the artifact, in the order it is sent. */
export type RepoManifestStep =
  | { readonly kind: "description"; readonly description: string | null }
  | { readonly kind: "topics"; readonly topics: readonly string[] }
  | { readonly kind: "features"; readonly features: RepoFeatureSettings }
  | { readonly kind: "merge-settings"; readonly merge: RepoMergeSettings }
  | { readonly kind: "label-create"; readonly label: RepoLabel }
  | { readonly kind: "dependabot-alerts"; readonly enabled: boolean }
  | { readonly kind: "branch-protection-main"; readonly protection: BranchProtectionSettings }
  | { readonly kind: "secret-scanning"; readonly settings: SecretScanningSettings }
  | { readonly kind: "private-vulnerability-reporting"; readonly enabled: boolean };

/** The planned apply. */
export interface RepoManifestPlan {
  readonly steps: readonly RepoManifestStep[];
  /** Public-only sections not read or sent because the repository is not public. */
  readonly waiting: readonly PublicOnlySection[];
}

/**
 * One human label for a step, as the preview and a partial stop name it.
 *
 * @returns a short line naming the section, and the label for a label create
 */
export function manifestStepLabel({ step }: { step: RepoManifestStep }): string {
  switch (step.kind) {
    case "description":
      return "set the description";
    case "topics":
      return "set the topics";
    case "features":
      return "set the repository features";
    case "merge-settings":
      return "set the merge settings";
    case "label-create":
      return `create the label "${step.label.name}"`;
    case "dependabot-alerts":
      return `turn Dependabot alerts ${step.enabled ? "on" : "off"}`;
    case "branch-protection-main":
      return `protect ${MANIFEST_PROTECTED_BRANCH}`;
    case "secret-scanning":
      return "set secret scanning and push protection";
    case "private-vulnerability-reporting":
      return `turn private vulnerability reporting ${step.enabled ? "on" : "off"}`;
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

/** A description, with GitHub's empty string and null read as the same absence. */
function normalDescription({ value }: { value: string | null }): string {
  if (value === null) {
    return "";
  }
  return value;
}

/**
 * Whether a live description is the one asked for; GitHub stores a cleared description as null or empty.
 *
 * @returns true when they match
 */
export function descriptionMatches({ live, desired }: { live: string | null; desired: string | null }): boolean {
  return normalDescription({ value: live }) === normalDescription({ value: desired });
}

/** A topic set in one canonical order, lowercased as GitHub stores topics. */
function canonicalTopics({ topics }: { topics: readonly string[] }): string[] {
  return [...new Set(topics.map((topic) => topic.toLowerCase()))].toSorted();
}

/**
 * Whether two topic sets are the same set, ignoring order and case.
 *
 * @returns true when they match
 */
export function topicsMatch({ live, desired }: { live: readonly string[]; desired: readonly string[] }): boolean {
  return canonicalTopics({ topics: live }).join("\n") === canonicalTopics({ topics: desired }).join("\n");
}

/**
 * Whether every field of two flat settings objects is equal.
 *
 * @returns true when every key of `desired` has the same value in `live`
 */
export function settingsMatch({
  live,
  desired,
}: {
  live: RepoFeatureSettings | RepoMergeSettings;
  desired: RepoFeatureSettings | RepoMergeSettings;
}): boolean {
  const liveFields = new Map<string, unknown>(Object.entries(live));
  return Object.entries(desired).every(([key, value]) => liveFields.get(key) === value);
}

/**
 * Whether a live label is exactly the one asked for: colour without case, description with null and empty alike.
 *
 * @returns true when name, colour and description all match
 */
export function labelMatches({ live, desired }: { live: RepoLabel; desired: RepoLabel }): boolean {
  return (
    live.name.toLowerCase() === desired.name.toLowerCase() &&
    live.color.toLowerCase() === desired.color.toLowerCase() &&
    normalDescription({ value: live.description }) === normalDescription({ value: desired.description })
  );
}

/** A label as a refusal names it. */
function labelText({ label }: { label: RepoLabel }): string {
  return `#${label.color.toLowerCase()}, ${label.description === null ? "no description" : `"${label.description}"`}`;
}

/**
 * Whether live protection is exactly the protection asked for. The write replaces protection whole, clearing push
 * restrictions, the branch lock and fork syncing, so live protection carrying any of them does not match either.
 *
 * @returns true when every field the apply sets, or clears, matches
 */
export function protectionMatches({
  live,
  desired,
}: {
  live: BranchProtectionState;
  desired: BranchProtectionSettings;
}): boolean {
  if (live.kind !== "protected" || live.requiredStatusChecks === null) {
    return false;
  }
  const sameContexts =
    live.requiredStatusChecks.contexts.toSorted().join("\n") ===
    desired.requiredStatusChecks.contexts.toSorted().join("\n");
  return (
    sameContexts &&
    live.requiredStatusChecks.strict === desired.requiredStatusChecks.strict &&
    !live.requiresPullRequestReviews &&
    live.enforceAdmins === desired.enforceAdmins &&
    live.allowForcePushes === desired.allowForcePushes &&
    live.allowDeletions === desired.allowDeletions &&
    live.requiredLinearHistory === desired.requiredLinearHistory &&
    live.requiredConversationResolution === desired.requiredConversationResolution &&
    live.pushRestrictions === null &&
    live.lockBranch !== true &&
    live.allowForkSyncing !== true
  );
}

/** The label creates, or the conflicts that refuse the apply. */
function labelSteps({ live, desired }: { live: readonly RepoLabel[]; desired: readonly RepoLabel[] }): {
  steps: RepoManifestStep[];
  conflicts: LabelConflict[];
} {
  const steps: RepoManifestStep[] = [];
  const conflicts: LabelConflict[] = [];
  for (const label of desired) {
    const existing = live.find((candidate) => candidate.name.toLowerCase() === label.name.toLowerCase());
    if (existing === undefined) {
      steps.push({ kind: "label-create", label });
    } else if (!labelMatches({ desired: label, live: existing })) {
      conflicts.push({ desired: labelText({ label }), live: labelText({ label: existing }), name: existing.name });
    }
  }
  return { conflicts, steps };
}

/** The public-only steps, given what was read. */
function publicOnlySteps({
  publicOnly,
  settings,
}: {
  publicOnly: Extract<PublicOnlyRead, { kind: "read" }>;
  settings: RepoSettingsApplyManifest["settings"];
}): RepoManifestStep[] {
  const steps: RepoManifestStep[] = [];
  const protection = settings.branchProtectionMain;
  if (!protectionMatches({ desired: protection, live: publicOnly.branchProtection })) {
    steps.push({ kind: "branch-protection-main", protection });
  }
  const scanning = settings.secretScanning;
  if (
    publicOnly.secretScanning.secretScanning !== scanning.secretScanning ||
    publicOnly.secretScanning.pushProtection !== scanning.pushProtection
  ) {
    steps.push({ kind: "secret-scanning", settings: scanning });
  }
  const reporting = settings.privateVulnerabilityReporting.enabled;
  if (publicOnly.privateVulnerabilityReporting !== reporting) {
    steps.push({ enabled: reporting, kind: "private-vulnerability-reporting" });
  }
  return steps;
}

/**
 * Plan the apply: every step from the live state to the artifact, in send order, and the public-only sections
 * that wait. Refuses the whole apply on a label conflict, before anything is sent.
 *
 * @param manifest the parsed apply artifact
 * @param current the live state
 * @returns the plan, or the label conflict that refuses it
 */
export function planRepoManifestApply({
  manifest,
  current,
}: {
  manifest: RepoSettingsApplyManifest;
  current: RepoManifestCurrentState;
}): Result<RepoManifestPlan, GithubVerbError> {
  const { settings } = manifest;
  const { repository } = current;
  const labels = labelSteps({ desired: settings.labels.create, live: current.labels });
  if (labels.conflicts.length > 0) {
    return err(
      GithubVerbErrors.repoManifestLabelConflict({ conflicts: labels.conflicts, fullName: repository.fullName }),
    );
  }
  const steps: RepoManifestStep[] = [];
  if (!descriptionMatches({ desired: settings.description, live: repository.description })) {
    steps.push({ description: settings.description, kind: "description" });
  }
  if (!topicsMatch({ desired: settings.topics, live: current.topics })) {
    steps.push({ kind: "topics", topics: canonicalTopics({ topics: settings.topics }) });
  }
  if (!settingsMatch({ desired: settings.features, live: repository.features })) {
    steps.push({ features: settings.features, kind: "features" });
  }
  if (!settingsMatch({ desired: settings.mergeSettings, live: repository.merge })) {
    steps.push({ kind: "merge-settings", merge: settings.mergeSettings });
  }
  steps.push(...labels.steps);
  if (current.dependabotAlerts !== settings.dependabotAlerts.enabled) {
    steps.push({ enabled: settings.dependabotAlerts.enabled, kind: "dependabot-alerts" });
  }
  if (current.publicOnly.kind === "waiting-for-public") {
    return ok({ steps, waiting: PUBLIC_ONLY_SECTIONS });
  }
  steps.push(...publicOnlySteps({ publicOnly: current.publicOnly, settings }));
  return ok({ steps, waiting: [] });
}

/**
 * The fields the digest binds and a `--json` preview prints: the repository's identity and visibility, the whole
 * artifact bar the path it was read from, every live field a step overwrites or depends on, and the plan.
 *
 * Live labels are bound only where a desired label names them: a label created elsewhere changes nothing sent.
 *
 * @param source the address typed
 * @param manifest the parsed apply artifact
 * @param current the live state
 * @param plan the planned apply
 * @returns a plain, stably stringifiable view
 */
export function repoManifestPlanView({
  source,
  manifest,
  current,
  plan,
}: {
  source: string;
  manifest: RepoSettingsApplyManifest;
  current: RepoManifestCurrentState;
  plan: RepoManifestPlan;
}): Readonly<Record<string, unknown>> {
  const desiredNames = new Set(manifest.settings.labels.create.map((label) => label.name.toLowerCase()));
  return {
    action: "apply-manifest",
    current: {
      dependabotAlerts: current.dependabotAlerts,
      description: current.repository.description,
      features: current.repository.features,
      fullName: current.repository.fullName,
      id: current.repository.id,
      labels: current.labels.filter((label) => desiredNames.has(label.name.toLowerCase())),
      merge: current.repository.merge,
      publicOnly: current.publicOnly,
      topics: canonicalTopics({ topics: current.topics }),
      visibility: current.repository.visibility,
    },
    manifest,
    source,
    steps: plan.steps,
    waiting: plan.waiting,
  };
}
