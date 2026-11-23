/**
 * When `github landing --press` re-requests a stuck CodeRabbit review — the pure half.
 *
 * The rule: once every comment is resolved and a good twenty seconds have passed with CodeRabbit still on
 * requested changes rather than approval, it is probably stuck, and forcing that re-review is the desired
 * behaviour under graduated autonomy. The blessed act is `@coderabbitai review` posted on the pull request,
 * which flips a stuck review green.
 *
 * ## Twenty seconds from WHICH instant
 *
 * GitHub records no resolve time: a review thread carries `isResolved` and `resolvedBy`, and no timeline item
 * marks the resolve. The earliest instant a run can PROVE is at or after the last resolve is the moment its
 * own read came back showing every CodeRabbit thread resolved — so the wait is measured from there, which is
 * never shorter than the twenty seconds from the real last resolve and usually longer.
 *
 * The effectful sequence around this — the wait, the fresh read, the post, the ledger row — is
 * `../cli/commands/github/landingCodeRabbitNudge.ts`.
 */

import type { PrLiveState } from "../live/github/reviewState.js";
import { codeRabbitNudgeKey } from "./codeRabbitNudgeJournal.js";
import { codeRabbitVerdict } from "./codeRabbitVerdict.js";
import type { LandingRow } from "./landing.js";

/** The "good twenty seconds" a stuck review waits, in milliseconds. */
export const CODERABBIT_NUDGE_WAIT_MS = 20_000;

/** The comment that re-requests the review — the one proven to work. */
export const CODERABBIT_NUDGE_BODY = "@coderabbitai review";

/**
 * How many re-requests one invocation posts. Each costs up to twenty seconds of wall time and one public
 * comment, so a tick that found a whole family stuck at once spreads them over a few ticks rather than
 * posting a wave; the rest read `failed` with "run it again" and stay dispatchable.
 */
export const CODERABBIT_NUDGE_CAP = 3;

/** How much of a head commit a sentence quotes. */
const HEAD_CHARS = 7;

/** What the fresh read decided about one candidate. */
export type CodeRabbitNudgeDecision =
  | { readonly kind: "nudge"; readonly detail: string }
  | { readonly kind: "flipped"; readonly detail: string }
  | { readonly kind: "refused"; readonly detail: string };

/**
 * How much of the twenty seconds is still to wait, on a monotonic clock.
 *
 * A clock reading EARLIER than the observation cannot happen on a monotonic source, and if it ever did the
 * safe answer is the whole wait rather than none.
 *
 * @param observedAtMonotonicMs when the read that saw every thread resolved came back
 * @param nowMonotonicMs the monotonic clock now
 * @returns the milliseconds still to wait, never negative
 */
export function remainingCodeRabbitWaitMs({
  observedAtMonotonicMs,
  nowMonotonicMs,
}: {
  observedAtMonotonicMs: number;
  nowMonotonicMs: number;
}): number {
  const elapsed = nowMonotonicMs - observedAtMonotonicMs;
  if (elapsed < 0) {
    return CODERABBIT_NUDGE_WAIT_MS;
  }
  return Math.max(0, CODERABBIT_NUDGE_WAIT_MS - elapsed);
}

/**
 * The rows this run may re-request, in a stable order so the cap bites the same rows every time.
 *
 * Only the owner's own pull requests (`--author @me`), only a row the ladder already reads as blocked on CodeRabbit
 * (`spawn-coderabbit`) with the typed `stuck` verdict — so an opt-out label, a draft, a conflict or red CI
 * has already won the ladder and is never re-requested over — and only a head not re-requested before.
 *
 * @param rows every row this read produced
 * @param authoredByOwner whether the read was `--author @me`
 * @param nudgedHeads the heads the register says were already re-requested
 * @returns the candidates, by repository then number
 */
export function codeRabbitNudgeCandidates({
  rows,
  authoredByOwner,
  nudgedHeads,
}: {
  rows: readonly LandingRow[];
  authoredByOwner: boolean;
  nudgedHeads: ReadonlySet<string>;
}): readonly LandingRow[] {
  if (!authoredByOwner) {
    return [];
  }
  return rows
    .filter(
      (row) =>
        row.action === "spawn-coderabbit" &&
        row.codeRabbit === "stuck" &&
        !nudgedHeads.has(codeRabbitNudgeKey({ headOid: row.headOid, number: row.number, repoSlug: row.repoSlug })),
    )
    .toSorted((left, right) => left.repoSlug.localeCompare(right.repoSlug) || left.number - right.number);
}

/**
 * Whether the read taken AFTER the wait still shows the stuck state, and so whether to re-request.
 *
 * The verdict is re-derived from the fresh read rather than trusted from the row: a thread reopened, a new
 * push or CodeRabbit flipping by itself inside the wait each changes the answer, and only the fresh read can
 * say which.
 *
 * @param row the candidate as the fleet read judged it
 * @param fresh the pull request as GitHub reports it after the wait
 * @returns `nudge`, `flipped` when CodeRabbit approved the head by itself, or `refused` naming why
 */
export function codeRabbitNudgeDecision({
  row,
  fresh,
}: {
  row: LandingRow;
  fresh: PrLiveState;
}): CodeRabbitNudgeDecision {
  if (fresh.headOid !== row.headOid) {
    return {
      detail:
        `not re-requested: its head moved from ${row.headOid.slice(0, HEAD_CHARS)} to ` +
        `${fresh.headOid.slice(0, HEAD_CHARS)} during the wait, and a new push starts a new review`,
      kind: "refused",
    };
  }
  // A review list that did not come back whole can hide the approval that ended the stuck state, and the
  // verdict reads only the reviews it was handed.
  if (fresh.reviewsTruncated) {
    return {
      detail:
        "not re-requested: the read after the wait could not see every review, so a newer one may have flipped it",
      kind: "refused",
    };
  }
  const verdict = codeRabbitVerdict({
    headOid: fresh.headOid,
    reviews: fresh.reviews,
    reviewsTruncated: fresh.reviewsTruncated,
    threadCount: fresh.threadCount,
    threads: fresh.threads,
    threadsTruncated: fresh.threadsTruncated,
  });
  if (verdict.verdict === "green") {
    return { detail: "CodeRabbit approved the head by itself during the wait", kind: "flipped" };
  }
  if (verdict.verdict === "stuck") {
    return {
      detail:
        "every CodeRabbit thread was still resolved and its CHANGES_REQUESTED still stood twenty seconds after " +
        "the read that saw it",
      kind: "nudge",
    };
  }
  return { detail: `not re-requested: the read after the wait says ${verdict.detail}`, kind: "refused" };
}
