/**
 * `github repo --apply-manifest <path>`: load the apply artifact, read a repository's live settings, plan the steps
 * to the artifact's (`./repoManifestPlan.ts`), and build the write the shared shell previews or sends. The send,
 * one step at a time with each confirmed by its own read before the next, is `./repoManifestApply.ts`.
 */

import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubRepoManifestApi, RepoManifestRepositoryState } from "../../../outbound/github/repoManifest.js";
import type { GithubVerbResult } from "./errors.js";
import { type ApprovedRepoWrite, upstreamRefusedOf } from "./repoApprovedWrite.js";
import { applyRepoManifestSteps } from "./repoManifestApply.js";
import {
  MANIFEST_PROTECTED_BRANCH,
  manifestStepLabel,
  type PublicOnlyRead,
  planRepoManifestApply,
  type RepoManifestCurrentState,
  type RepoManifestStep,
  repoManifestPlanView,
} from "./repoManifestPlan.js";
import { parseRepoSettingsApplyManifest, type RepoSettingsApplyManifest } from "./repoManifestSchema.js";

/** One repository address. */
interface Address {
  readonly owner: string;
  readonly repo: string;
}

/** Read the public-only settings, but only on a public repository: a private free-plan one has none of them. */
async function readPublicOnly({
  api,
  address,
  visibility,
}: {
  api: GithubRepoManifestApi;
  address: Address;
  visibility: string;
}): Promise<GithubVerbResult<PublicOnlyRead>> {
  if (visibility !== "public") {
    return ok({ kind: "waiting-for-public" });
  }
  const where = `${address.owner}/${address.repo}`;
  const protection = await api.branchProtection({ ...address, branch: MANIFEST_PROTECTED_BRANCH });
  if (protection.isErr()) {
    return err(upstreamRefusedOf({ error: protection.error, operation: `read ${where}'s protection on main` }));
  }
  const scanning = await api.secretScanning(address);
  if (scanning.isErr()) {
    return err(upstreamRefusedOf({ error: scanning.error, operation: `read ${where}'s secret scanning` }));
  }
  const reporting = await api.privateVulnerabilityReporting(address);
  if (reporting.isErr()) {
    const operation = `read ${where}'s private vulnerability reporting`;
    return err(upstreamRefusedOf({ error: reporting.error, operation }));
  }
  return ok({
    branchProtection: protection.value,
    kind: "read",
    privateVulnerabilityReporting: reporting.value,
    secretScanning: scanning.value,
  });
}

/** The public-only read, with the repository read it was judged against. */
interface PublicOnlyJudged {
  readonly publicOnly: PublicOnlyRead;
  readonly repository: RepoManifestRepositoryState;
}

/**
 * Read the public-only settings, and when one of those reads fails, read the repository again: the SAME repository
 * made private since its first read has none of them, so they wait, judged against the fresh read. A 403 alone is
 * never taken as private, since a scope gap or a rate limit answers 403 too; a re-read that fails, still reads
 * public, or names another repository id (one replaced at the address) carries the original refusal, so the state
 * judged is never two repositories' reads mixed. This is identity-consistent, not an atomic snapshot.
 */
async function readPublicOnlyJudged({
  api,
  address,
  repository,
}: {
  api: GithubRepoManifestApi;
  address: Address;
  repository: RepoManifestRepositoryState;
}): Promise<GithubVerbResult<PublicOnlyJudged>> {
  const publicOnly = await readPublicOnly({ address, api, visibility: repository.visibility });
  if (publicOnly.isOk()) {
    return ok({ publicOnly: publicOnly.value, repository });
  }
  const reread = await api.repository(address);
  if (reread.isErr() || reread.value.id !== repository.id || reread.value.visibility === "public") {
    return err(publicOnly.error);
  }
  return ok({ publicOnly: { kind: "waiting-for-public" }, repository: reread.value });
}

/** Read every input the apply is judged against: the live state, or the first read's failure. */
async function readRepoManifestCurrentState({
  api,
  address,
}: {
  api: GithubRepoManifestApi;
  address: Address;
}): Promise<GithubVerbResult<RepoManifestCurrentState>> {
  const where = `${address.owner}/${address.repo}`;
  const repository = await api.repository(address);
  if (repository.isErr()) {
    return err(upstreamRefusedOf({ error: repository.error, operation: `read ${where}` }));
  }
  const topics = await api.topics(address);
  if (topics.isErr()) {
    return err(upstreamRefusedOf({ error: topics.error, operation: `read ${where}'s topics` }));
  }
  const labels = await api.labels(address);
  if (labels.isErr()) {
    return err(upstreamRefusedOf({ error: labels.error, operation: `read ${where}'s labels` }));
  }
  const dependabot = await api.dependabotAlerts(address);
  if (dependabot.isErr()) {
    return err(upstreamRefusedOf({ error: dependabot.error, operation: `read ${where}'s Dependabot alerts` }));
  }
  const judged = await readPublicOnlyJudged({ address, api, repository: repository.value });
  if (judged.isErr()) {
    return err(judged.error);
  }
  return ok({
    dependabotAlerts: dependabot.value,
    labels: labels.value,
    publicOnly: judged.value.publicOnly,
    repository: judged.value.repository,
    topics: topics.value,
  });
}

/** Why an apply artifact could not be used: unreadable is a failed read, the rest are the caller's to fix. */
export interface ApplyManifestLoadFailure {
  /** `EXIT_ERROR` for a file that could not be read, `EXIT_USAGE` for content that was read and is wrong. */
  readonly kind: "unreadable" | "invalid";
  readonly lines: readonly string[];
}

/**
 * Read, decode and validate an apply artifact, and require it to name the repository typed. Runs before any
 * credential is resolved, so a bad artifact never reaches GitHub.
 *
 * @param path the artifact's path, as typed
 * @param address the repository typed with `--repo`
 * @param readText the file read, a seam so a test needs no disk
 * @returns the artifact, or why it cannot be used
 */
export function loadRepoApplyManifest({
  path,
  address,
  readText,
}: {
  path: string;
  address: Address;
  readText: (args: { path: string }) => Result<string>;
}): Result<RepoSettingsApplyManifest, ApplyManifestLoadFailure> {
  const text = readText({ path });
  if (text.isErr()) {
    return err({ kind: "unreadable", lines: [`could not read the apply artifact ${path}`, ...text.error] });
  }
  const decoded = parseJson({ text: text.value });
  if (decoded.isErr()) {
    return err({ kind: "invalid", lines: [`the apply artifact ${path} is not JSON: ${decoded.error.message}`] });
  }
  const manifest = parseRepoSettingsApplyManifest({ value: decoded.value });
  if (manifest.isErr()) {
    return err({ kind: "invalid", lines: [`the apply artifact ${path} is refused:`, ...manifest.error] });
  }
  const typed = `${address.owner}/${address.repo}`;
  if (manifest.value.repository.toLowerCase() !== typed.toLowerCase()) {
    const line = `the apply artifact names ${manifest.value.repository}, not ${typed}; an artifact applies to the repository it names`;
    return err({ kind: "invalid", lines: [line] });
  }
  return ok(manifest.value);
}

/** What protecting the branch also accepts, said from the protection itself. */
function protectionConsequence({
  step,
}: {
  step: Extract<RepoManifestStep, { kind: "branch-protection-main" }>;
}): string {
  const { contexts } = step.protection.requiredStatusChecks;
  const who = step.protection.enforceAdmins ? "an admin included" : "though an admin may bypass it";
  if (contexts.length === 0) {
    return `${MANIFEST_PROTECTED_BRANCH} is protected with no required status check, ${who}`;
  }
  return `${MANIFEST_PROTECTED_BRANCH} accepts a commit only once the checks ${contexts.join(", ")} pass, ${who}`;
}

/**
 * Read the live settings and build the previewed apply, or the fact that refuses it.
 *
 * @param api the settings client
 * @param owner the owner login typed
 * @param repo the repository name typed
 * @param manifest the parsed apply artifact, already matched to the address typed
 * @param manifestPath the path the artifact was read from, quoted in the preview's command but never in the digest
 * @returns the write the shared shell previews or sends, or the refusal
 */
export async function planRepoManifestWrite({
  api,
  owner,
  repo,
  manifest,
  manifestPath,
}: {
  api: GithubRepoManifestApi;
  owner: string;
  repo: string;
  manifest: RepoSettingsApplyManifest;
  manifestPath: string;
}): Promise<GithubVerbResult<ApprovedRepoWrite>> {
  const address = { owner, repo };
  const read = await readRepoManifestCurrentState({ address, api });
  if (read.isErr()) {
    return err(read.error);
  }
  const current = read.value;
  const planned = planRepoManifestApply({ current, manifest });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const { steps, waiting } = planned.value;
  const { fullName, id } = current.repository;
  const stepLines = steps.map((step) => manifestStepLabel({ step }));
  return ok({
    alreadyDone: steps.length === 0,
    change: `apply the settings manifest to ${fullName} (id ${String(id)}): ${stepLines.length === 0 ? "nothing to send" : stepLines.join("; ")}`,
    consequences: steps.flatMap((step) =>
      step.kind === "branch-protection-main" ? [protectionConsequence({ step })] : [],
    ),
    kind: "apply-manifest",
    perform: () => applyRepoManifestSteps({ address, api, fullName, id, steps, waiting }),
    previewCommand: `slopweaver github repo --repo ${owner}/${repo} --apply-manifest ${manifestPath}`,
    view: repoManifestPlanView({ current, manifest, plan: planned.value, source: `${owner}/${repo}` }),
    waiting,
  });
}
