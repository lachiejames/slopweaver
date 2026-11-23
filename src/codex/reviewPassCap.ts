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
 * Pure: the caller folds the ledger, so every rule here is a plain-value test.
 */

import type { LedgerEntry } from "./ledger.js";

/** At most this many review passes on one branch. The owner's number, never a session's to raise. */
export const REVIEW_PASS_CAP = 2;

/** The verdicts that make a reviewed diff a PASS: anything else concluded nothing. */
const PASS_VERDICTS: ReadonlySet<string> = new Set(["CLEAN", "BROKEN"]);

/**
 * Every distinct diff a review reached a verdict on, oldest first.
 *
 * @param entries the ledger for the branch, newest first — Codex rows and fallback receipts in one list
 * @returns one sha256 per review pass, in the order the passes were first taken
 */
export function reviewedDiffs({ entries }: { entries: readonly LedgerEntry[] }): readonly string[] {
  const seen: string[] = [];
  for (const entry of entries.toReversed()) {
    const digest = entry.diffSha256;
    if (entry.mode === "review" && digest !== undefined && PASS_VERDICTS.has(entry.verdict) && !seen.includes(digest)) {
      seen.push(digest);
    }
  }
  return seen;
}

/** Whether a review over one more diff may run. */
export type ReviewCapDecision =
  /** The diff is already one of the branch's passes, or a pass slot is still open; `pass` is its 1-based number. */
  | { readonly kind: "allowed"; readonly pass: number }
  /** Both passes are spent on other diffs: this would be a third. */
  | { readonly kind: "capped"; readonly reviewed: readonly string[] };

/**
 * Decide whether a review of `candidateDiffSha256` may run on this branch.
 *
 * @param entries the ledger for the branch, newest first
 * @param candidateDiffSha256 the sha256 of the diff about to be reviewed
 * @returns allowed with the pass number it would be, or capped with the two diffs already reviewed
 */
export function reviewCapDecision({
  entries,
  candidateDiffSha256,
}: {
  entries: readonly LedgerEntry[];
  candidateDiffSha256: string;
}): ReviewCapDecision {
  const reviewed = reviewedDiffs({ entries });
  const known = reviewed.indexOf(candidateDiffSha256);
  if (known >= 0) {
    return { kind: "allowed", pass: known + 1 };
  }
  if (reviewed.length < REVIEW_PASS_CAP) {
    return { kind: "allowed", pass: reviewed.length + 1 };
  }
  return { kind: "capped", reviewed };
}
