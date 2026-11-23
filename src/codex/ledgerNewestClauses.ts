/**
 * What an arm's NEWEST row says about why the floor refuses, as the clauses `./ledger.ts`'s `loopFailures`
 * appends to a refusal — beside `./ledgerCapClauses.ts`, which says what the way through is while capped.
 *
 * Only the newest row, because that is the one a session re-running the pass is about to repeat.
 */
import type { LedgerEntry } from "./ledger.js";

/**
 * Whether a pass actually reached a verdict — asked of both halves of the floor.
 *
 * `NO_VERDICT:<reason>` and `FATAL:<kind>` mean the pass RAN and concluded nothing — a transport failure, a
 * bound hit, an off-track abort. `skills/codex/SKILL.md` states plainly that no-verdict "is not a clean result",
 * and the gate must agree: counting one as satisfying the floor would let a pass that produced nothing stand
 * in for a pass that approved something. Found by a review of this gate, which is the ideal place to find it.
 *
 * @param entry the ledger row
 * @returns true only for a verdict a human could act on
 */
export function concluded({ entry }: { entry: LedgerEntry }): boolean {
  return !entry.verdict.startsWith("NO_VERDICT") && !entry.verdict.startsWith("FATAL");
}

/**
 * What the arm's newest pass said when it concluded nothing, as a clause to append — or nothing.
 *
 * A newer no-verdict is named as itself rather than hidden behind an older fault. Measured: this
 * refusal said "none reached a verdict" over twenty-plus spend-cap failures, and four sessions narrowed diffs
 * against it before anyone established the transport itself was refusing.
 *
 * @param entries one arm's rows, newest first
 * @returns ` — the newest, <pass>, failed outright: <cause>` for a fault, ` — the newest, <pass>, concluded
 *   nothing: <context>` for a no-verdict, or `""` when the newest row reached a verdict
 */
export function newestFaultClause({ entries }: { entries: readonly LedgerEntry[] }): string {
  const newest = entries[0];
  if (newest === undefined || concluded({ entry: newest })) {
    return "";
  }
  const how = newest.verdict.startsWith("FATAL") ? "failed outright" : "concluded nothing";
  // No outcome context means a first-try result with nothing to add, so the verdict token names the cause.
  if (newest.outcomeContext === undefined) {
    return ` — the newest, ${newest.pass}, ${how}: ${newest.verdict}`;
  }
  return ` — the newest, ${newest.pass}, ${how}: ${newest.outcomeContext}`;
}

/**
 * Why the arm's newest pass does not count when it DID conclude, as a clause to append — or nothing.
 *
 * The twin of {@link newestFaultClause}, which speaks only for a pass that concluded nothing. Without it the
 * review refusal listed three possibilities and named none: measured on a landing
 * where `github enqueue` refused over a CLEAN review that `codex status` printed CURRENT, and nothing on either
 * page said the review had read an uncommitted `yarn.lock` hunk the commit did not carry.
 *
 * @param entries one arm's rows, newest first
 * @returns ` — the newest, <pass> (<property>), is STALE: <reason>` (or UNKNOWN), or `""` when the newest row
 *   concluded nothing, or is current
 */
export function newestDriftClause({ entries }: { entries: readonly LedgerEntry[] }): string {
  const newest = entries[0];
  if (newest === undefined || !concluded({ entry: newest }) || newest.freshness.kind === "current") {
    return "";
  }
  const property = newest.propertyId === undefined ? "" : ` (${newest.propertyId})`;
  return ` — the newest, ${newest.pass}${property}, is ${newest.freshness.kind.toUpperCase()}: ${newest.freshness.reason}`;
}
