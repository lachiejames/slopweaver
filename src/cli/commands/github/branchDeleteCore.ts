/**
 * Pure parser, decision and door request for `slopweaver github branch delete`.
 *
 * The owner never clicks in a provider UI, and no other governed verb deletes a remote branch,
 * so retiring one would otherwise dead-end into a click or a raw `git push --delete`, both outside rule 3. This is that
 * door, dry-run first.
 *
 * A delete is the one ref write that loses something, so the verb refuses every case where it would take more
 * than the branch: the default branch, and a branch any OPEN pull request names as its base or head (deleting
 * either closes them). `--keep-as-tag` tags the LIVE tip in the same atomic write as the delete, so the whole
 * branch stays recoverable by name.
 */
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";

const BRANCH_BOOLEAN_FLAGS = ["dry-run", "json"] as const;
const BRANCH_STRING_FLAGS = ["repo", "branch", "keep-as-tag", "expect-tip", "home"] as const;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const GITHUB_BRANCH_FLAGS: FlagSpec = { boolean: [...BRANCH_BOOLEAN_FLAGS], string: [...BRANCH_STRING_FLAGS] };

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_BRANCH_FLAG_NAMES: readonly string[] = [...BRANCH_STRING_FLAGS, ...BRANCH_BOOLEAN_FLAGS].map(
  (name) => `--${name}`,
);

/** The resolved delete request. */
export interface GithubBranchArgs {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly keepAsTag: string | undefined;
  readonly expectTip: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** Every usage problem in the parsed flags, in flag order — empty when the request is well formed. */
function branchArgProblems({ values }: { values: Record<string, unknown> }): string[] {
  const errors: string[] = [];
  const repoValue = values["repo"];
  if (typeof repoValue !== "string" || parseRepoSlug({ slug: repoValue }) === undefined) {
    errors.push("--repo owner/name is required");
  }
  const branch = values["branch"];
  if (typeof branch !== "string" || branch.trim().length === 0) {
    errors.push("--branch is required");
  }
  if (typeof branch === "string" && branch.startsWith("refs/")) {
    errors.push("--branch takes the bare branch name, not a refs/ path");
  }
  const keepAsTag = values["keep-as-tag"];
  if (typeof keepAsTag === "string" && keepAsTag.trim().length === 0) {
    errors.push("--keep-as-tag must not be blank");
  }
  const expectTip = values["expect-tip"];
  if (typeof expectTip === "string" && !FULL_SHA.test(expectTip)) {
    errors.push("--expect-tip must be a full 40-character lowercase commit sha");
  }
  if (expectTip === undefined && values["dry-run"] !== true) {
    errors.push("--expect-tip <sha> is required for a real delete; --dry-run prints the tip to pass");
  }
  return errors;
}

/**
 * Parse the delete request before resolving a credential.
 *
 * @param argv the verb's own argument tail, after `github branch`
 * @returns the resolved address and modes, or every usage problem
 */
export function parseGithubBranchArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<GithubBranchArgs, GithubVerbError> {
  if (argv[0] !== "delete") {
    return err(GithubVerbErrors.usage({ command: "branch", shape: "delete" }));
  }
  const parsed = parseFlags({ allowPositionals: false, args: argv.slice(1), spec: GITHUB_BRANCH_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const errors = branchArgProblems({ values });
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  const branch = values["branch"];
  if (errors.length > 0 || repo === undefined || typeof branch !== "string") {
    return err(GithubVerbErrors.argumentsRefused({ reasons: errors }));
  }
  const { home, "keep-as-tag": keepAsTag, "expect-tip": expectTip } = values;
  return ok({
    branch,
    dryRun: values["dry-run"] === true,
    expectTip: typeof expectTip === "string" ? expectTip : undefined,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    keepAsTag: typeof keepAsTag === "string" ? keepAsTag : undefined,
    owner: repo.owner,
    repo: repo.repo,
  });
}

/** What a branch delete does, decided from the live remote before the door is asked. */
export type BranchDeletePlan =
  | { readonly kind: "delete"; readonly tip: string; readonly tagFirst: boolean }
  | { readonly kind: "refuse"; readonly reason: string };

/**
 * Decide the delete from what the remote holds now.
 *
 * @param branch the branch to delete
 * @param tip its live tip, or undefined when the remote has no such branch
 * @param defaultBranch the repository's default branch
 * @param openPrs the open pull requests naming the branch as base or head
 * @param keepAsTag the tag to keep the tip under, when one was asked for
 * @param keepTagCommit the commit that tag already points at on the remote, peeled, or undefined
 * @param expectTip the tip the caller's dry run printed; a real delete is bound to it
 * @returns delete (tagging the tip first when needed), or a refusal naming the live state
 */
export function planBranchDelete({
  branch,
  tip,
  defaultBranch,
  openPrs,
  keepAsTag,
  keepTagCommit,
  expectTip,
}: {
  branch: string;
  tip: string | undefined;
  defaultBranch: string;
  openPrs: readonly number[];
  keepAsTag: string | undefined;
  keepTagCommit: string | undefined;
  expectTip: string | undefined;
}): BranchDeletePlan {
  if (branch === defaultBranch) {
    return { kind: "refuse", reason: `${branch} is the repository's default branch` };
  }
  if (tip === undefined) {
    return { kind: "refuse", reason: `the remote has no branch ${branch} — nothing to delete` };
  }
  if (expectTip !== undefined && tip !== expectTip) {
    return { kind: "refuse", reason: `${branch} is at ${tip}, not the --expect-tip ${expectTip}; dry-run again` };
  }
  if (openPrs.length > 0) {
    const numbers = openPrs.map((number) => `#${String(number)}`).join(", ");
    return { kind: "refuse", reason: `open pull request(s) ${numbers} name ${branch} as base or head` };
  }
  if (keepAsTag === undefined) {
    return { kind: "delete", tagFirst: false, tip };
  }
  if (keepTagCommit !== undefined && keepTagCommit !== tip) {
    return { kind: "refuse", reason: `tag ${keepAsTag} already points at ${keepTagCommit}, not the tip ${tip}` };
  }
  return { kind: "delete", tagFirst: keepTagCommit === undefined, tip };
}

/**
 * The line a dry run prints: the tip, and every write the real run would make.
 *
 * @param args the parsed request
 * @param plan the delete plan the live read produced
 * @returns one human-readable transition line
 */
export function branchDeleteDryRunLine({
  args,
  plan,
}: {
  args: GithubBranchArgs;
  plan: Extract<BranchDeletePlan, { kind: "delete" }>;
}): string {
  const where = `${args.owner}/${args.repo}`;
  if (args.keepAsTag === undefined) {
    return `would delete ${where} ${args.branch} at ${plan.tip}; to perform it, pass --expect-tip ${plan.tip}`;
  }
  const tagStep = plan.tagFirst
    ? `tag ${plan.tip} as ${args.keepAsTag}, then `
    : `(tag ${args.keepAsTag} already at the tip) `;
  return `would ${tagStep}delete ${where} ${args.branch} at ${plan.tip}; to perform it, pass --expect-tip ${plan.tip}`;
}

/**
 * The external-write door request for one branch delete.
 *
 * @param args the parsed repository and branch
 * @param home the Slopweaver state home whose door records the transition
 * @returns the exact external-write request admitted by the door
 */
export function branchDeleteDoorRequest({ args, home }: { args: GithubBranchArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "branch" },
    artifact: { id: `${args.owner}/${args.repo}:refs/heads/${args.branch}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
