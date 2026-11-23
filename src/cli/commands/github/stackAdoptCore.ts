/**
 * `slopweaver github stack adopt` — the pure decisions behind pulling an EXISTING pull request into local
 * stack state and GitHub's native stack.
 *
 * Deliberately narrow, matching the owner's own design: adopt never retargets a base, never inserts at a
 * position, never touches the description. It requires exactly the shape `stack push` already produces —
 * one commit, checked out, matching what GitHub reports as this PR's own head — and then reuses the same
 * safe squash-rebase primitive (`stackSquash.ts`) that `stack sync` already trusts. Every refusal here has
 * one job: catch drift EARLY, before the door or the network, per the owner's "fail loud and early" doctrine
 * for anything that touches stack state.
 *
 * ## The three replay preconditions have a named way past them, and it is not a waiver
 *
 * There is still no `SLOPWEAVER_ALLOW_REMOTE_AHEAD`-style override that makes the REPLAY run anyway.
 * `stackSquash.ts`'s own preflight refuses a HEAD that does not match GitHub's reported head SHA with no
 * escape hatch at all — it is exactly the ambiguity that caused the original corruption bug — so an
 * adopt-level override would either do nothing or require re-interpreting which SHA is authoritative.
 *
 * What the checkout, commit-count and head-SHA refusals now carry instead is `--register-only`, which
 * selects a DIFFERENT operation rather than waiving this one: register the native stack membership and the
 * local enrolment, rebase and push nothing (`./stackAdoptRegistrationCore.ts`). That is the hatch the
 * `stack-adopt-register-only` row names, and it exists because without it a drifted chained pull request
 * could be neither pushed nor adopted — measured on two chained pull requests in acme/acme-admin.
 *
 * The dirty-worktree override below stays what it was: a genuinely safe, local-only condition.
 */

import type { DoorRequest } from "../../../admit/types.js";
import type { WrittenPr } from "../../../corpus/github/write.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { type EffectiveCommits, rebaseWouldLeaveOneCommit } from "./stackAdoptEffectiveCommits.js";
import { adoptableShapeRefusal } from "./stackAdoptRegistrationRefusals.js";
import { remoteFlag } from "./stackCommonArgs.js";
import type { Authorisation, Freshness } from "./updateCore.js";

/**
 * One replay precondition, refused in the register's own four-line shape.
 *
 * All three replay refusals share a hatch because they share a CAUSE: `stackSquash.ts` replays the one
 * checked-out commit GitHub reports as this pull request's head, and each of them says that commit is not
 * identifiable. The way past all three is the same, and it is an operation rather than a waiver.
 *
 * @param detail what this invocation observed, which is what makes one refusal read differently from another
 * @returns the four-line refusal
 */
function replayRefusal({ detail }: { detail: string }): string {
  return hatchRefusal({ detail, hatch: hatchFor({ id: "stack-adopt-register-only" }) });
}

/** The environment variable that lets adopt proceed with uncommitted changes in the worktree. */
export const ALLOW_DIRTY_TREE = "SLOPWEAVER_ALLOW_DIRTY_TREE";

/** The flags this verb accepts; the help-truth ratchet reads the names derived from it below. */
const GITHUB_STACK_ADOPT_FLAGS: FlagSpec = {
  boolean: ["dry-run", "register-only"],
  string: ["pr", "cwd", "remote", "home"],
};

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_STACK_ADOPT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_STACK_ADOPT_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_STACK_ADOPT_FLAGS }),
].map((name) => `--${name}`);

/** The parsed, side-effect-free invocation. */
export interface GithubStackAdoptArgs {
  readonly prNumber: number;
  readonly cwd: string | undefined;
  readonly dryRun: boolean;
  readonly remote: string;
  readonly home: string | undefined;
  /**
   * Register the native stack membership and the local enrolment, and replay nothing.
   *
   * The mode, not a waiver: it selects an operation that never rebases or pushes, so it can never waive
   * replay safety while still replaying. See `./stackAdoptRegistrationCore.ts` for the deadlock it ends.
   */
  readonly registerOnly: boolean;
}

/** One optional string flag. */
function stringFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse a stack-adopt invocation without touching Git or the network.
 *
 * @param argv the verb's own argument tail, after `github stack adopt`
 * @returns the parsed options or every usage error
 */
export function parseGithubStackAdoptArgs({
  argv,
}: {
  argv: readonly string[];
}): GithubVerbResult<GithubStackAdoptArgs> {
  const parsed = parseFlags({ args: argv, spec: GITHUB_STACK_ADOPT_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const rawPr = stringFlag({ name: "pr", values });
  if (rawPr === undefined) {
    return err(GithubVerbErrors.prRequired());
  }
  const prNumber = Number(rawPr);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return err(GithubVerbErrors.notPositiveWholeNumber({ flag: "--pr", got: rawPr }));
  }
  const remote = remoteFlag({ values });
  if (remote.trim().length === 0) {
    return err(GithubVerbErrors.remoteBlank({ got: remote }));
  }
  return ok({
    cwd: stringFlag({ name: "cwd", values }),
    dryRun: values["dry-run"] === true,
    home: stringFlag({ name: "home", values }),
    prNumber,
    registerOnly: values["register-only"] === true,
    remote,
  });
}

/** The live facts the shell measured before asking this core for a plan. */
export interface GithubStackAdoptFacts {
  readonly repoRoot: string;
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
  readonly checkedOutBranch: string;
  readonly localHeadSha: string;
  readonly dirty: boolean;
  readonly pr: WrittenPr;
  /**
   * What a rebase onto the base's fresh tip would leave behind, when the shell could measure it.
   *
   * Present so that a pull request GitHub reports as more than one commit purely because it carries a stale
   * COPY of something its base has since landed is adopted rather than refused — the ordering defect
   * `./stackAdoptEffectiveCommits.ts` names and measures. `undefined` keeps the plain count refusal exactly
   * as it was.
   */
  readonly effectiveCommits: EffectiveCommits | undefined;
}

/** The one safe stack-adopt shape this verb can execute. */
export interface GithubStackAdoptPlan {
  readonly repoRoot: string;
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly branch: string;
  readonly baseBranch: string;
  readonly defaultBranch: string;
  readonly headSha: string;
  readonly overrideNotices: readonly string[];
}

/**
 * The notice that a pull request GitHub counts as several commits will replay as its tip alone, because every
 * other commit is patch-equivalent to one its base already landed.
 *
 * @param commits GitHub's own count; a list read omits it, and the notice then says so rather than "0"
 * @returns the notice line
 */
export function patchEquivalentNotice({ commits }: { commits: number | undefined }): string {
  const reported = commits === undefined ? "no commit count" : String(commits);
  return (
    `commits: GitHub reports ${reported}, but every other commit on this branch is ` +
    "patch-equivalent to one its base already landed — the rebase will leave exactly its tip"
  );
}

/**
 * The commit-count refusal, or `undefined` when this pull request is one commit — as GitHub counts it today,
 * or as a rebase onto its base's fresh tip would leave it.
 *
 * Its own function so {@link prShapeRefusal} stays under the complexity gate: the measured case has three
 * outcomes to word (unmeasured, still-multiple, one-that-is-not-the-tip) and none of them is a shape check.
 */
function commitCountRefusal({
  effective,
  label,
  pr,
}: {
  effective: EffectiveCommits | undefined;
  label: string;
  pr: WrittenPr;
}): string | undefined {
  if (pr.commits === 1 || rebaseWouldLeaveOneCommit({ effective })) {
    return undefined;
  }
  const count = pr.commits === undefined ? "an unknown number of" : String(pr.commits);
  const notTheTip = effective?.count === 1 ? ", but the surviving commit is not its tip" : "";
  const after =
    effective?.measured === true
      ? ` — rebased onto its base's fresh tip it would still be ${String(effective.count)}${notTheTip}`
      : "";
  return replayRefusal({ detail: `${label} has ${count} commits${after}` });
}

/**
 * Every refusal this verb can decide from the pull request's own shape, before authorisation or the
 * worktree's cleanliness are even considered.
 */
function prShapeRefusal({ facts }: { facts: GithubStackAdoptFacts }): string | undefined {
  const { pr, owner, repo, defaultBranch, checkedOutBranch, localHeadSha } = facts;
  const label = `PR #${String(pr.number)}`;
  const shape = adoptableShapeRefusal({ owner, pr, repo });
  if (shape !== undefined) {
    return shape;
  }
  if (checkedOutBranch !== pr.head.ref) {
    return replayRefusal({
      detail: `checked out ${checkedOutBranch}, but ${label}'s head branch is ${pr.head.ref}`,
    });
  }
  if (pr.head.ref === defaultBranch) {
    return `${label}'s head branch is the repository default (${defaultBranch}) — there is nothing to adopt`;
  }
  const commitRefusal = commitCountRefusal({ effective: facts.effectiveCommits, label, pr });
  if (commitRefusal !== undefined) {
    return commitRefusal;
  }
  if (localHeadSha !== pr.head.sha) {
    return replayRefusal({
      detail:
        `the checked-out HEAD (${localHeadSha}) does not match GitHub's reported head SHA for ${label} ` +
        `(${pr.head.sha})`,
    });
  }
  return undefined;
}

/** Whether a dirty worktree may proceed, and the notice or refusal it produces. */
type DirtyDecision =
  | { readonly kind: "clean" }
  | { readonly kind: "overridden"; readonly notice: string }
  | { readonly kind: "refused"; readonly reason: string };

/** Decide whether uncommitted changes in the worktree block this adopt. */
function dirtyDecisionFor({ dirty, allowDirty }: { dirty: boolean; allowDirty: boolean }): DirtyDecision {
  if (!dirty) {
    return { kind: "clean" };
  }
  if (allowDirty) {
    return {
      kind: "overridden",
      notice: `OVERRIDDEN via ${ALLOW_DIRTY_TREE}=1 — adopting with uncommitted changes in the worktree.`,
    };
  }
  return {
    kind: "refused",
    reason:
      "the worktree has uncommitted changes, and adopt rebases the checked-out branch — commit, stash, or " +
      `discard them first. Re-run with ${ALLOW_DIRTY_TREE}=1 if you really mean to`,
  };
}

/**
 * Decide whether a stack adopt may proceed, before any Git or network effect beyond the reads that produced
 * `facts` and `authorisation`.
 *
 * @param facts the live facts the shell measured, including the pull request GitHub reported
 * @param authorisation whether the authed account may act on a foreign-authored pull request
 * @param allowDirty whether the dirty-worktree break-glass variable is set for this run
 * @returns the adopt plan, or the safety reason it was refused
 */
export function githubStackAdoptPlan({
  facts,
  authorisation,
  allowDirty,
}: {
  facts: GithubStackAdoptFacts;
  authorisation: Authorisation;
  allowDirty: boolean;
}): Result<GithubStackAdoptPlan, string> {
  const shapeRefusal = prShapeRefusal({ facts });
  if (shapeRefusal !== undefined) {
    return err(shapeRefusal);
  }
  if (authorisation.kind === "refused") {
    return err(authorisation.reason);
  }
  const dirtyDecision = dirtyDecisionFor({ allowDirty, dirty: facts.dirty });
  if (dirtyDecision.kind === "refused") {
    return err(dirtyDecision.reason);
  }
  const overrideNotices = [
    ...(authorisation.kind === "overridden" ? [authorisation.notice] : []),
    ...(dirtyDecision.kind === "overridden" ? [dirtyDecision.notice] : []),
  ];
  return ok({
    baseBranch: facts.pr.baseRef,
    branch: facts.checkedOutBranch,
    defaultBranch: facts.defaultBranch,
    headSha: facts.pr.head.sha,
    overrideNotices,
    owner: facts.owner,
    prNumber: facts.pr.number,
    repo: facts.repo,
    repoRoot: facts.repoRoot,
  });
}

/**
 * Whether the pull request read at plan time is still what the door is about to act on — the same
 * re-confirm-before-write discipline `pr update` uses, applied to the fields adopt actually depends on.
 *
 * @param previewed the pull request as read while building the plan
 * @param current the pull request as re-read immediately before the destructive rewrite
 * @returns fresh, or the one field that moved
 */
export function githubStackAdoptFreshness({
  previewed,
  current,
}: {
  previewed: WrittenPr;
  current: WrittenPr;
}): Freshness {
  const checks: readonly { readonly same: boolean; readonly what: string }[] = [
    { same: previewed.number === current.number, what: "the pull-request number" },
    { same: previewed.authorId === current.authorId, what: "the author" },
    { same: previewed.state === current.state, what: "the open/closed state" },
    { same: previewed.baseRef === current.baseRef, what: "the base branch" },
    { same: previewed.head.ref === current.head.ref, what: "the head branch" },
    { same: previewed.head.repoFullName === current.head.repoFullName, what: "the head repository" },
    { same: previewed.head.sha === current.head.sha, what: "the head commit" },
    // The base branch moving (independently of this PR's own branch) can change GitHub's live commit count
    // without touching head.sha at all — e.g. the base force-pushed backward makes a commit that used to BE
    // the base look like part of the PR's own diff. `commits` is the one field the whole design treats as
    // authoritative for the one-commit invariant, so a re-check that skipped it would leave exactly the gap
    // this invariant exists to close.
    { same: previewed.commits === current.commits, what: "the commit count" },
  ];
  const changed = checks.find((check) => !check.same);
  if (changed === undefined) {
    return { fresh: true };
  }
  return {
    fresh: false,
    reason: `${changed.what} changed between reading this pull request and adopting it, so nothing was sent. Re-run to work from the current state`,
  };
}

/**
 * Describe the external write to the admit door.
 *
 * @param home the state home whose door ledger records the attempt
 * @param plan the exact stack-adopt plan being admitted
 * @returns the external-write door request
 */
export function githubStackAdoptDoorRequest({ home, plan }: { home: string; plan: GithubStackAdoptPlan }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "stack adopt" },
    artifact: {
      baseBranch: plan.baseBranch,
      branch: plan.branch,
      headSha: plan.headSha,
      prNumber: plan.prNumber,
      repo: `${plan.owner}/${plan.repo}`,
    },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}

/** One entry below the adopted PR in its native stack, as much as the warning needs. */
export interface GithubStackAdoptLowerEntry {
  readonly number: number;
  readonly merged: boolean;
  readonly registered: boolean;
}

/**
 * Warn — never refuse — when the adopted PR now sits above an unmerged, unregistered entry in its native
 * stack. `stack sync` only ever walks local stack state, so an entry nothing here registered is one `sync`
 * cannot progress past; the fix is to push or adopt that entry too, not to block this adopt on it.
 *
 * @param prNumber the pull request just adopted
 * @param stackNumber the native stack it belongs to
 * @param entriesBelow every entry beneath it in that stack (bottom to top, exclusive of this PR)
 * @returns the warning line, or undefined when nothing below is a blocker
 */
export function githubStackAdoptWarning({
  prNumber,
  stackNumber,
  entriesBelow,
}: {
  prNumber: number;
  stackNumber: number;
  entriesBelow: readonly GithubStackAdoptLowerEntry[];
}): string | undefined {
  const blockers = entriesBelow.filter((entry) => !entry.merged && !entry.registered);
  if (blockers.length === 0) {
    return undefined;
  }
  const plural = blockers.length > 1;
  const numbers = blockers.map((entry) => `#${String(entry.number)}`).join(", ");
  return (
    `warning: PR #${String(prNumber)} sits above ${plural ? "unregistered, unmerged entries" : "an unregistered, unmerged entry"} ` +
    `(${numbers}) in native stack #${String(stackNumber)} — stack sync cannot progress past ` +
    `${plural ? "them" : "it"} until ${plural ? "they are" : "it is"} also pushed or adopted.`
  );
}
