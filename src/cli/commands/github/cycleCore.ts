/**
 * Pure parser, refusals, merge-ref freshness verdict and door request for `slopweaver github cycle`.
 *
 * The verb exists because neither a re-run nor a bare close-and-reopen is enough when the base has moved. A
 * `pull_request` run checks out `refs/pull/N/merge`, which GitHub recomputes lazily: `github rerun` and a first
 * reopen both ran the merge onto a stale base after staging had moved, and only a reopen AFTER GitHub
 * recomputed the ref ran on the current base. So this verb confirms the ref is fresh first, and cycles only then.
 *
 * Unlike `github close`, no comment is required: the pull request is open again a moment later, and the
 * timeline records both events under the token's account.
 */

import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { CyclePr } from "../../../outbound/github/cycle.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { GithubVerbErrors } from "./errors.js";

const GITHUB_CYCLE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json", "prime"],
  string: ["repo", "number", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_CYCLE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_CYCLE_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_CYCLE_FLAGS }),
].map((name) => `--${name}`);

/** How many characters of a sha a refusal prints — enough to open, short enough to compare by eye. */
const SHORT_SHA_LENGTH = 12;

/** The resolved cycle request. */
export interface GithubCycleArgs {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly dryRun: boolean;
  readonly json: boolean;
  /** Cycle a SETTLED stale merge anyway, so GitHub recomputes it; that cycle's CI runs on the old merge. */
  readonly prime: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the cycle request before resolving a credential.
 *
 * @param rest argv after `github cycle`
 * @returns the resolved repository and pull request, or every usage problem
 */
export function parseGithubCycleArgs({ rest }: { rest: readonly string[] }): Result<GithubCycleArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_CYCLE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = parsed.value.values;
  const errors: string[] = [];
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const numberValue = values["number"];
  const valid = typeof numberValue === "string" && /^[1-9]\d*$/u.test(numberValue);
  if (!valid) {
    errors.push(GithubVerbErrors.notPositiveWholeNumber({ flag: "--number", got: String(numberValue) }).message);
  }
  if (repo === undefined || !valid) {
    return err(errors);
  }
  const home = values["home"];
  return ok({
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    number: Number(numberValue),
    owner: repo.owner,
    prime: values["prime"] === true,
    repo: repo.repo,
  });
}

/**
 * A sha as a refusal prints it.
 *
 * @param sha the full commit sha
 * @returns its first twelve characters
 */
export function shortSha({ sha }: { sha: string }): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

/**
 * Why the live pull request must not be cycled at all, whatever its merge ref says — or undefined when it may.
 *
 * Each is a state a close-and-reopen would damage or could not undo: a merged or closed pull request is not
 * this verb's to reopen, a deleted head fork makes the reopen fail and leave it closed, closing switches
 * auto-merge off and drops a pull request out of the merge queue, a stack member's close has effects this verb does not model, and a conflicted one has no
 * merge commit for CI to run on.
 *
 * @param pr the live pull request
 * @returns the refusal reason, or undefined
 */
export function cycleStateRefusal({ pr }: { pr: CyclePr }): string | undefined {
  const label = `#${String(pr.number)}`;
  if (pr.mergedAtIso !== undefined) {
    return `${label} was merged at ${pr.mergedAtIso} — there is nothing to re-run CI on`;
  }
  if (pr.state.toLowerCase() !== "open") {
    return `${label} is ${pr.state}; this verb cycles an OPEN pull request and never reopens a closed one`;
  }
  if (pr.headRepoFullName === undefined) {
    return `${label}'s head repository is gone, so a reopen would fail and leave it closed`;
  }
  if (pr.autoMerge) {
    return `${label} has auto-merge enabled, and closing it would switch that off; disable it first if a cycle is still wanted`;
  }
  if (pr.inMergeQueue) {
    return `${label} is in the merge queue, and closing it would drop it out; dequeue it first if a cycle is still wanted`;
  }
  if (pr.stacked) {
    return `${label} is in a native GitHub stack, and closing a stack member has effects this verb does not model`;
  }
  if (pr.mergeable === false) {
    return `${label} conflicts with ${pr.baseRef}, so there is no merge commit for CI to run on; rebase it first`;
  }
  return undefined;
}

/**
 * Whether `refs/pull/N/merge` is the merge of the current head onto the base's live tip. Not fresh comes in
 * two kinds, because reading again helps only one of them: `computing` is GitHub mid-way through a test merge
 * (a head push starts one at once), while `settled` is a FINISHED merge onto a base that has since moved —
 * measured once, every open pull request still merged onto staging's old tip
 * 45 minutes after staging moved, across repeated reads.
 */
export type MergeRefFreshness =
  | { readonly verdict: "fresh"; readonly mergeSha: string }
  | { readonly verdict: "computing"; readonly reason: string }
  | { readonly verdict: "settled"; readonly mergeSha: string; readonly reason: string };

/**
 * Judge whether a close-and-reopen now would run CI on the current base.
 *
 * Fresh means four reads agree: GitHub has finished computing the test merge (`mergeable` is not null), the
 * ref exists and is the commit `merge_commit_sha` names, and that commit's parents are exactly the base's
 * live tip and then the pull request's head — the order a GitHub test merge records them in.
 *
 * @param pr the live pull request
 * @param mergeRef the commit `refs/pull/N/merge` names, or undefined when there is none
 * @param parents that commit's parents in order, or undefined when there is no ref to read them from
 * @param baseTip the base branch's live tip, read AFTER the ref so a base that moves mid-judgement reads stale
 * @returns fresh with the merge sha, or computing or settled with every sha that disagreed
 */
export function mergeRefFreshness({
  pr,
  mergeRef,
  parents,
  baseTip,
}: {
  pr: CyclePr;
  mergeRef: string | undefined;
  parents: readonly string[] | undefined;
  baseTip: string;
}): MergeRefFreshness {
  if (pr.mergeable === null) {
    return { reason: "GitHub has not finished computing the test merge (mergeable is null)", verdict: "computing" };
  }
  if (mergeRef === undefined || parents === undefined) {
    return { reason: `refs/pull/${String(pr.number)}/merge does not exist yet`, verdict: "computing" };
  }
  if (pr.mergeCommitSha !== mergeRef) {
    const named = pr.mergeCommitSha === null ? "none" : shortSha({ sha: pr.mergeCommitSha });
    return {
      reason: `refs/pull/${String(pr.number)}/merge is ${shortSha({ sha: mergeRef })} but the pull request names ${named}`,
      verdict: "computing",
    };
  }
  const [onto, merged] = parents;
  if (parents.length !== 2 || onto === undefined || merged === undefined) {
    return {
      mergeSha: mergeRef,
      reason: `${shortSha({ sha: mergeRef })} has ${String(parents.length)} parent(s), not a test merge's two`,
      verdict: "settled",
    };
  }
  if (merged !== pr.headSha) {
    return {
      reason: `${shortSha({ sha: mergeRef })} merges head ${shortSha({ sha: merged })}, but the head is now ${shortSha({ sha: pr.headSha })}`,
      verdict: "computing",
    };
  }
  if (onto !== baseTip) {
    return {
      mergeSha: mergeRef,
      reason: `${shortSha({ sha: mergeRef })} merges onto ${shortSha({ sha: onto })}, but ${pr.baseRef} is now at ${shortSha({ sha: baseTip })}`,
      verdict: "settled",
    };
  }
  return { mergeSha: mergeRef, verdict: "fresh" };
}

/**
 * Why the pull request read just before the close no longer carries the merge this run judged — or undefined
 * when it still does. `cycleStateRefusal` lets `mergeable: null` through on purpose, because the freshness
 * judgement owns it; that judgement runs once, before the door, so a head push or a recompute landing after it
 * is caught here instead of being cycled onto a merge the success line would misname.
 *
 * @param judged the pull request as the freshness judgement read it
 * @param latest the same pull request read again immediately before the close
 * @returns what moved, or undefined
 */
export function mergeMovedSinceJudged({ judged, latest }: { judged: CyclePr; latest: CyclePr }): string | undefined {
  if (latest.mergeable === null) {
    return "GitHub is computing the test merge again (mergeable is null)";
  }
  if (latest.headSha !== judged.headSha) {
    return `the head moved from ${shortSha({ sha: judged.headSha })} to ${shortSha({ sha: latest.headSha })}`;
  }
  if (latest.baseRef !== judged.baseRef) {
    return `the base was retargeted from ${judged.baseRef} to ${latest.baseRef}`;
  }
  if (latest.mergeCommitSha !== judged.mergeCommitSha) {
    const was = judged.mergeCommitSha === null ? "none" : shortSha({ sha: judged.mergeCommitSha });
    const now = latest.mergeCommitSha === null ? "none" : shortSha({ sha: latest.mergeCommitSha });
    return `the pull request's merge commit moved from ${was} to ${now}`;
  }
  return undefined;
}

/**
 * The external-write door request for one pull request's close-and-reopen.
 *
 * @param args the parsed repository and pull-request identity
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function cycleDoorRequest({ args, home }: { args: GithubCycleArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "cycle" },
    artifact: { id: `${args.owner}/${args.repo}#${String(args.number)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
