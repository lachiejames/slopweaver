/**
 * The apply artifact `github repo --apply-manifest <path>` reads: the settings a repository should carry, every
 * field typed and every object strict, so an unknown key is refused rather than dropped.
 *
 * It is NOT the evidence manifest the settings row writes. That one carries `current`, `judgement` and values
 * still waiting on the owner ("OWNER CALL — see ownerCalls.<id>"), and a write must never interpret prose. The
 * apply artifact holds only rulings: `provenance.unresolvedOwnerCalls` is an empty tuple, each ruling is named,
 * and a free-text field that still reads like a placeholder is refused, so a lean can never pass for a ruling.
 *
 * Deliberately absent, so no artifact can ask for them: visibility (`--set-public`), the Actions policy
 * (`--enable-actions`), forking and merge queue (neither is a setting on a personal account's repository), and
 * every webhook, deploy key, secret, variable, environment, app installation and Pages write.
 */

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

/** Text an evidence manifest uses for a value nobody has ruled on, or one that is not a setting at all. */
const PLACEHOLDER = /OWNER CALL|ownerCalls\.|— unavailable|ONLY at row/i;

/**
 * A free-text value that must be a ruling, never a placeholder copied out of the evidence manifest. Surrounding
 * whitespace is refused rather than trimmed: GitHub trims a label name it stores, so a padded value would land
 * and then fail its own read-back.
 */
function ruledText({ max }: { max: number }): z.ZodString {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim(), { message: "leading or trailing whitespace, which GitHub trims" })
    .refine((value) => !PLACEHOLDER.test(value), { message: "a placeholder, not a ruling: rule on it first" });
}

/** GitHub's own topic shape: lowercase letters, digits and hyphens, at most 50 characters. */
const TOPIC = /^[a-z0-9][a-z0-9-]{0,49}$/;

const ownerRulingSchema = z.strictObject({
  evidence: ruledText({ max: 500 }),
  id: ruledText({ max: 100 }),
  ruling: ruledText({ max: 500 }),
});

const labelSchema = z.strictObject({
  color: z.string().regex(/^[0-9a-f]{6}$/i, { message: "six hexadecimal characters, no #" }),
  description: ruledText({ max: 100 }).nullable(),
  name: ruledText({ max: 50 }),
});

const settingsSchema = z.strictObject({
  branchProtectionMain: z.strictObject({
    allowDeletions: z.boolean(),
    allowForcePushes: z.boolean(),
    enforceAdmins: z.boolean(),
    requiredConversationResolution: z.boolean(),
    requiredLinearHistory: z.boolean(),
    requiredPullRequestReviews: z.null(),
    requiredStatusChecks: z.strictObject({
      contexts: z.array(ruledText({ max: 255 })).max(50),
      strict: z.boolean(),
    }),
  }),
  dependabotAlerts: z.strictObject({ enabled: z.boolean() }),
  description: ruledText({ max: 350 }).nullable(),
  features: z.strictObject({
    hasDiscussions: z.boolean(),
    hasIssues: z.boolean(),
    hasProjects: z.boolean(),
    hasWiki: z.boolean(),
    isTemplate: z.boolean(),
  }),
  labels: z.strictObject({
    create: z.array(labelSchema).max(100),
    keepGithubDefaults: z.literal(true),
  }),
  mergeSettings: z.strictObject({
    allowAutoMerge: z.boolean(),
    allowMergeCommit: z.boolean(),
    allowRebaseMerge: z.boolean(),
    allowSquashMerge: z.boolean(),
    allowUpdateBranch: z.boolean(),
    deleteBranchOnMerge: z.boolean(),
    squashMergeCommitMessage: z.enum(["PR_BODY", "COMMIT_MESSAGES", "BLANK"]),
    squashMergeCommitTitle: z.enum(["PR_TITLE", "COMMIT_OR_PR_TITLE"]),
    webCommitSignoffRequired: z.boolean(),
  }),
  privateVulnerabilityReporting: z.strictObject({ enabled: z.boolean() }),
  secretScanning: z.strictObject({ pushProtection: z.boolean(), secretScanning: z.boolean() }),
  topics: z.array(z.string().regex(TOPIC, { message: "a GitHub topic: lowercase letters, digits, hyphens" })).max(20),
});

const applyManifestSchema = z.strictObject({
  provenance: z.strictObject({
    ownerRulings: z.array(ownerRulingSchema).max(50),
    sourceManifestSha256: z.string().regex(/^[0-9a-f]{64}$/, { message: "the evidence manifest's sha256" }),
    unresolvedOwnerCalls: z.tuple([], { message: "every owner call is ruled before an apply artifact exists" }),
  }),
  repository: z.string().regex(/^[^\s/]+\/[^\s/]+$/, { message: "owner/name" }),
  settings: settingsSchema,
  version: z.literal(1),
});

/** One parsed apply artifact. */
export type RepoSettingsApplyManifest = z.infer<typeof applyManifestSchema>;

/** Every case-folded value that appears more than once. */
function duplicatesOf({ values }: { values: readonly string[] }): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      repeated.add(key);
    }
    seen.add(key);
  }
  return [...repeated];
}

/** The cross-field rules a per-field schema cannot express. */
function crossFieldProblems({ manifest }: { manifest: RepoSettingsApplyManifest }): string[] {
  const { settings } = manifest;
  const problems: string[] = [];
  for (const topic of duplicatesOf({ values: settings.topics })) {
    problems.push(`settings.topics: "${topic}" appears more than once`);
  }
  const contexts = settings.branchProtectionMain.requiredStatusChecks.contexts;
  for (const context of duplicatesOf({ values: contexts })) {
    // GitHub stores required checks as a set, so a repeat could never read back as sent.
    problems.push(
      `settings.branchProtectionMain.requiredStatusChecks.contexts: "${context}" appears more than once, ignoring case`,
    );
  }
  for (const name of duplicatesOf({ values: settings.labels.create.map((label) => label.name) })) {
    problems.push(`settings.labels.create: "${name}" appears more than once, ignoring case`);
  }
  if (settings.secretScanning.pushProtection && !settings.secretScanning.secretScanning) {
    problems.push("settings.secretScanning: push protection needs secret scanning on");
  }
  const { squashMergeCommitTitle: title, squashMergeCommitMessage: message } = settings.mergeSettings;
  if ((title === "COMMIT_OR_PR_TITLE") !== (message === "COMMIT_MESSAGES")) {
    problems.push(
      "settings.mergeSettings: GitHub pairs COMMIT_OR_PR_TITLE with COMMIT_MESSAGES, and PR_TITLE with PR_BODY or BLANK",
    );
  }
  return problems;
}

/**
 * Parse an apply artifact, refusing an unknown field, an unresolved owner call, a placeholder in a text field, and
 * a value GitHub would refuse anyway.
 *
 * @param value the decoded JSON
 * @returns the typed artifact, or one line per problem, each naming its path
 */
export function parseRepoSettingsApplyManifest({ value }: { value: unknown }): Result<RepoSettingsApplyManifest> {
  const parsed = applyManifestSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const problems = crossFieldProblems({ manifest: parsed.data });
  return problems.length > 0 ? err(problems) : ok(parsed.data);
}
