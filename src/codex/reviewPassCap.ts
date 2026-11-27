/**
 * The two-pass review cap, the owner's ruling: one Codex plan, at most TWO review passes, then the change lands
 * with any remaining finding named in the pull request body. A landing rate of about four pull requests a day
 * against about eighty was not acceptable to the owner, who named seven review passes on one change.
 *
 * ## What one review PASS is
 *
 * **One distinct reviewed DIFF on the branch** — the `diffSha256` a review row judged — that reached a verdict a
 * review can give (`CLEAN` or `BROKEN`). Not a model call, a property, a pass id, a commit or a ledger row:
 *
 * - every property of one fan-out shares the diff, so a fan-out is one pass;
 * - `r1`, `r2` and `r3` over one diff are one pass — they are review PROFILES, never ordinals;
 * - a conflict-free rebase leaves the diff's sha256 unchanged (`./diffCarry.ts` carries a review across it on
 *   exactly that key), so it is not another pass;
 * - a `NO_VERDICT` or `FATAL` over a diff established nothing and spends no slot, and a retry over a diff that
 *   already has a verdict is part of that pass;
 * - a Claude fallback receipt counts exactly as a Codex row does — the cap is on review, not on a provider;
 * - a SUPERSEDED row still counts: a retirement changes what the floor reads, never what was spent.
 *
 * A fix that changes the diff and is reviewed again is the next pass. The floor (`./ledger.ts`'s
 * `assessCodexLoop`) reads {@link reviewedDiffs} to decide when a BROKEN finding becomes a leftover; review
 * admission (`../cli/commands/codex/reviewCapGate.ts`) reads {@link reviewCapDecision} to refuse a third.
 *
 * ## Two lanes, each with its own count
 *
 * Every rule above is per LANE (`./reviewLane.ts`). The general lane is every review there has always been, and
 * its two passes stay the owner's base number. The baseline-bump witness lane holds only the exact
 * adversarial review a ratchet bump's landing requires, admitted one property at a time; its rows spend no general
 * pass and never serve the pairing floor, and it has its own {@link WITNESS_REVIEW_PASS_CAP}. So a branch that
 * spent its two general passes can still take its witness, and the witness can never buy a third general review.
 *
 * ## Past the cap: a supervisor-approved extension
 *
 * A pass past the cap is the pinned supervisor's to approve, and reaches the owner only when the approach itself
 * carries a big trade-off. The supervisor approves one exact diff (`./passExtension.ts`), and
 * {@link reviewCapDecision} admits a diff past the cap only when the caller found such a row for THAT diff — so a
 * later fix, a diff the supervisor never saw, is refused again. The landing floor's leftover rule
 * (`./ledgerReviewHalf.ts`) still reads {@link REVIEW_PASS_CAP}: an extension permits a pass, it never obliges one.
 *
 * Pure: the caller folds the ledger, so every rule here is a plain-value test.
 */

import type { LedgerEntry } from "./ledger.js";
import { type ReviewLane, reviewLaneOfEntry } from "./reviewLane.js";

/**
 * At most this many general review passes on one branch, before any extension. The owner's number, never a
 * session's to raise: only the pinned supervisor admits a pass past it, one exact diff at a time (`./passExtension.ts`).
 */
export const REVIEW_PASS_CAP = 2;

/**
 * At most this many baseline-bump witness passes on one branch: the owner's number again, so a second witness
 * runs only when the diff changed under the first (a fix, a material rebase), and an identical diff is the same
 * pass.
 */
const WITNESS_REVIEW_PASS_CAP = 2;

/** The cap each lane is held to. */
export const LANE_PASS_CAP: Readonly<Record<ReviewLane, number>> = {
  "baseline-bump-witness": WITNESS_REVIEW_PASS_CAP,
  general: REVIEW_PASS_CAP,
};

/** The verdicts that make a reviewed diff a PASS: anything else concluded nothing. */
const PASS_VERDICTS: ReadonlySet<string> = new Set(["CLEAN", "BROKEN"]);

/**
 * Every distinct diff a review in one lane reached a verdict on, oldest first.
 *
 * @param entries the ledger for the branch, newest first — Codex rows and fallback receipts in one list
 * @param lane the lane whose passes are counted; rows in the other lane are not read
 * @returns one sha256 per review pass in that lane, in the order the passes were first taken
 */
export function reviewedDiffs({
  entries,
  lane,
}: {
  entries: readonly LedgerEntry[];
  lane: ReviewLane;
}): readonly string[] {
  const seen: string[] = [];
  for (const entry of entries.toReversed()) {
    const digest = entry.diffSha256;
    const counts = entry.mode === "review" && PASS_VERDICTS.has(entry.verdict) && reviewLaneOfEntry({ entry }) === lane;
    if (counts && digest !== undefined && !seen.includes(digest)) {
      seen.push(digest);
    }
  }
  return seen;
}

/** Whether a review over one more diff may run in a lane. */
export type ReviewCapDecision =
  /**
   * The diff is already one of the lane's passes, a slot under the cap is open, or the supervisor approved this
   * exact diff past it; `pass` is its 1-based number and `pastCap` says which of the last it was.
   */
  | { readonly kind: "allowed"; readonly pass: number; readonly pastCap: boolean }
  /** The cap is spent on other diffs and nothing approved this one: it would be one past it. */
  | { readonly kind: "capped"; readonly reviewed: readonly string[] };

/**
 * Decide whether a review of `candidateDiffSha256` may run in one lane on this branch.
 *
 * @param entries the ledger for the branch, newest first
 * @param candidateDiffSha256 the sha256 of the diff about to be reviewed
 * @param lane the lane admission put the review in
 * @param approvedPastCap whether a supervisor-approved extension names this exact diff in this lane on this branch
 *   of this repository (`./passExtension.ts`'s `approvalFor`)
 * @returns allowed with the pass number it would be, or capped with the diffs already reviewed in that lane
 */
export function reviewCapDecision({
  entries,
  candidateDiffSha256,
  lane,
  approvedPastCap,
}: {
  entries: readonly LedgerEntry[];
  candidateDiffSha256: string;
  lane: ReviewLane;
  approvedPastCap: boolean;
}): ReviewCapDecision {
  const reviewed = reviewedDiffs({ entries, lane });
  const known = reviewed.indexOf(candidateDiffSha256);
  if (known >= 0) {
    return { kind: "allowed", pass: known + 1, pastCap: known >= LANE_PASS_CAP[lane] };
  }
  if (reviewed.length < LANE_PASS_CAP[lane]) {
    return { kind: "allowed", pass: reviewed.length + 1, pastCap: false };
  }
  if (approvedPastCap) {
    return { kind: "allowed", pass: reviewed.length + 1, pastCap: true };
  }
  return { kind: "capped", reviewed };
}
