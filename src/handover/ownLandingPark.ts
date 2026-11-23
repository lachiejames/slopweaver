/**
 * Whether `handover park --wake-on-checks` may close a seat — never while the pull request it names is the run's
 * OWN, still open. Pure: the head read and the run's branches arrive as arguments; `../cli/commands/handover/
 * parkRun.ts` owns the read and the refusal.
 *
 * A session that does nearly all of a pull request's work and then closes before the last step is a bug: waiting for
 * CI, rebasing, fixing red CI and landing the pull request are all part of doing the work. MEASURED: a run parked
 * ITSELF on its own pull request's checks seven times over about a day, each park waiting two to
 * six hours for `handover wake` to reseat it (three reseats a tick, forty-odd parks due) against a nine-minute CI lap,
 * and each reseat found main moved, rebased, pushed and parked again. Repro: `grep -oE '"(kind|atIso)":"[^"]+"'
 * $SLOPWEAVER_HOME/runs/a-talk-relay-made-*.jsonl`.
 *
 * "Own" is the head branch: the pull request's head is a branch this run records — the one it started on, or the one
 * its worktree has out now. A pull request on any other branch (a stack parent, another team's fix) is somebody
 * else's work, and waiting on it is genuinely idle, so that park still closes the seat. A head that could not be
 * read keeps the seat: absence never reads as somebody else's.
 *
 * A `--wake-at` park names no pull request, so it asks close-done's question instead — any OPEN pull request on the
 * run's branches — and only the refusal's wording lives here ({@link clockParkRefusalDetail}).
 */

import type { Result } from "../lib/result.js";
import type { GithubLiveError } from "../live/github/errors.js";
import type { PrHead } from "../live/github/prHead.js";
import type { ParkWake } from "./parkWake.js";

/** What the head read says about parking on a checks wake. */
export type ChecksParkJudgement =
  /** No checks wake, a pull request on another branch, or one already merged or closed — the park may proceed. */
  | { readonly kind: "may-park" }
  /** The run's own open pull request: its CI, rebase, red-CI fix and landing are the seat's work. */
  | { readonly kind: "own-landing"; readonly target: string; readonly branch: string }
  /** The head, or the run's branch, could not be read, so whose it is is unknown and the seat stays. */
  | { readonly kind: "unread"; readonly target: string; readonly reason: string };

/**
 * Judge a park's wake against the head of the pull request it names.
 *
 * @param wake the wake the park names, when it names one
 * @param head the one head read, taken only for a checks wake
 * @param runBranches the branches this run records — its `start` branch and its worktree's current one
 * @param branchUnread why a branch the run may hold could not be read (its worktree's), when one could not
 * @returns whether the park may close the seat
 */
export function judgeChecksPark({
  wake,
  head,
  runBranches,
  branchUnread,
}: {
  wake: ParkWake | undefined;
  head: Result<PrHead, GithubLiveError> | undefined;
  runBranches: readonly string[];
  branchUnread: string | undefined;
}): ChecksParkJudgement {
  if (wake?.kind !== "checks") {
    return { kind: "may-park" };
  }
  const target = `${wake.repo}#${String(wake.number)}`;
  if (head === undefined) {
    return { kind: "unread", reason: "its head was never read", target };
  }
  if (head.isErr()) {
    return { kind: "unread", reason: head.error.message, target };
  }
  if (head.value.state !== "OPEN") {
    return { kind: "may-park" };
  }
  const branch = head.value.headRefName;
  // The worktree read trims git's output, so a branch name ending in whitespace JavaScript trims
  // (a no-break space, say) is compared trimmed on both sides — a wider match only refuses more.
  if (runBranches.some((own) => own.trim() === branch.trim())) {
    return { branch, kind: "own-landing", target };
  }
  // A branch that failed to read may be exactly the head, so an unmatched head proves nothing then.
  if (branchUnread !== undefined) {
    return { kind: "unread", reason: branchUnread, target };
  }
  if (runBranches.length === 0) {
    // With no branch to compare, nothing proves the pull request is somebody else's.
    return { kind: "unread", reason: "this run records no branch to compare its head with", target };
  }
  return { kind: "may-park" };
}

/**
 * The detail line a refusal prints: what the read found, and the one move that keeps the seat working.
 *
 * @param judgement a refusing judgement
 * @returns the detail folded into the hatch refusal
 */
export function checksParkRefusalDetail({
  judgement,
}: {
  judgement: Exclude<ChecksParkJudgement, { kind: "may-park" }>;
}): string {
  const [repo, number] = judgement.target.split("#");
  const wait = `run slopweaver github checks --number ${number!} --repo ${repo!} --wait as a background job, or --until merge once it is queued`;
  if (judgement.kind === "unread") {
    return `${judgement.target} could not be told apart from this run's own landing (${judgement.reason}) — keep the seat and ${wait}`;
  }
  return `${judgement.target} is open on ${judgement.branch}, this run's own branch — its CI, a rebase, a red-CI fix and the landing are the work, so keep the seat and ${wait}`;
}

/**
 * The detail line a `--wake-at` refusal prints. A clock names no pull request, so the reason is close-done's own
 * keep (`../sessions/parkSeat.ts`'s `ownPullRequestKeep`), which names every open one, or why none could be read.
 *
 * @param why the keep's reason, verbatim
 * @returns the detail folded into the hatch refusal
 */
export function clockParkRefusalDetail({ why }: { why: string }): string {
  return (
    `a clock park would close this seat, but ${why} — keep the seat and run slopweaver github checks --number <n> ` +
    `--repo <owner/name> --wait as a background job, or --until merge once it is queued`
  );
}
