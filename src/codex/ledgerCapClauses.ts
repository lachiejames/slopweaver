/**
 * The way through the landing floor while Codex is capped, as the clauses `./ledger.ts`'s `loopFailures`
 * appends to a refusal. A cap never changes WHETHER the floor refuses — only whether the refusal names the
 * visible Claude substitute the owner's ruling puts in its place.
 */
import type { LedgerEntry } from "./ledger.js";
import type { CodexQuotaEvidence } from "./quotaTypes.js";

/**
 * The way through when the newest review FAILED ON A CAP, as a clause to append — or nothing.
 *
 * A cap is never review evidence, and this clause does not soften that: the floor still refuses. What it
 * adds is the concrete next step the owner's ruling names, so a session reading the refusal is told to have a
 * visible Claude session take the review rather than left to narrow a diff against a transport that is
 * refusing everything (`./fallbackReview.ts`). {@link cappedPlanNextStep} is the plan half's counterpart.
 *
 * @param entries the review arm's rows, newest first
 * @param cap the live quota gate's evidence when Codex is currently capped
 * @returns the next-step clause when the newest review is a cap or the gate is refusing now, `""` otherwise
 */
export function cappedNextStep({
  entries,
  cap,
}: {
  entries: readonly LedgerEntry[];
  cap: CodexQuotaEvidence | undefined;
}): string {
  const newest = entries[0];
  if (cap === undefined && (newest === undefined || !newest.capped)) {
    return "";
  }
  return (
    `. Codex is CAPPED${capWitnessClause({ cap })}, so a visible Claude session takes this review (rule 9): ` +
    "`slopweaver codex review-fallback prepare`, answer the packet, then `codex review-fallback record`"
  );
}

/**
 * What the LIVE quota gate saw, as a parenthesis — or nothing when the witness is a ledger row instead.
 *
 * Named rather than implied, because the two witnesses are checked in different places: a row is in
 * `slopweaver codex status`, and a live cap is in `slopweaver codex quota show`. A reader who is told which
 * one is speaking can go and re-check it; one told only "CAPPED" has to guess where to look.
 *
 * @param cap the live quota gate's evidence when Codex is currently capped
 * @returns ` (the quota gate reports <kind>, observed <instant>)`, or `""` when no live cap was supplied
 */
function capWitnessClause({ cap }: { cap: CodexQuotaEvidence | undefined }): string {
  if (cap === undefined) {
    return "";
  }
  return ` (the quota gate reports ${cap.kind}, observed ${cap.observedAtIso} — \`slopweaver codex quota show\`)`;
}

/**
 * The way through for the PLAN half while Codex is capped, as a clause to append — or nothing.
 *
 * The owner's rule: when Codex is unavailable, Claude does the work rather than holding everything up, and
 * nothing stops at the limit. Each half has a visible Claude substitute. The plan half's is a fallback PLAN
 * receipt (`./fallbackPlan.ts`), recorded BEFORE the work so the work turns it STALE, run visibly while Codex is
 * capped. So this clause names
 * that verb first. Work that already began without one cannot get one — a plan recorded now would be CURRENT
 * and prove nothing about order — so it still rides the `codex-loop-incomplete` acknowledgement both landing
 * verbs take, with a reason citing the owner's ruling, and a waived plan stays countable in the door ledger. A cap
 * on its own still refuses, exactly as it does on the review half.
 *
 * There are TWO witnesses, and the second was the whole defect. The first is the NEWEST row on the branch,
 * whichever arm: a capped attempt, or a CAP-grounded Claude fallback receipt, which exists only because
 * Codex was capped when the review was needed — a refusal-grounded or provider-unregistered one witnesses no
 * cap and is not read as one. A session routed away from Codex before it planned has no plan row to be capped, which is why the
 * plan arm alone cannot answer. The second is the LIVE quota gate, supplied by the caller — and it is what a
 * branch with NO ROWS AT ALL has, which used to print nothing here and leave a session to read `no planning
 * pass has run` while the transport was refusing every pass on the machine.
 *
 * **The residue, stated rather than discovered**: a receipt prepared under
 * `SLOPWEAVER_ALLOW_FALLBACK_REVIEW_UNCAPPED=1` witnesses a cap the GAUGE did not show, so this clause can
 * name a cap on an operator's assertion. That hatch exists for a pass that just failed FATAL on a cap Codex
 * has not yet written to its own rollout log — so a real cap is its premise — and the row prints its own
 * `blockedBy` verbatim beside this line, which says the gauge showed none. The reader sees both.
 *
 * @param entries the ledger for the branch, newest first
 * @param cap the live quota gate's evidence when Codex is currently capped — the witness a branch with no
 *   rows at all has, and the one the row witness could never supply
 * @returns the acknowledgement clause when a cap is witnessed, `""` otherwise
 */
export function cappedPlanNextStep({
  entries,
  cap,
}: {
  entries: readonly LedgerEntry[];
  cap: CodexQuotaEvidence | undefined;
}): string {
  const newest = entries[0];
  const rowWitnessesACap =
    newest !== undefined && (newest.capped || (newest.provider === "claude-code" && newest.fallbackGround === "cap"));
  if (cap === undefined && !rowWitnessesACap) {
    return "";
  }
  return (
    `. Codex is CAPPED${capWitnessClause({ cap })}, and nothing waits on it (the owner's ruling): BEFORE the work, a ` +
    "visible Claude session takes the plan — `slopweaver codex plan-fallback prepare`, answer the packet, then " +
    "`codex plan-fallback record` before any edit; work that already began without one rides " +
    '`--acknowledge codex-loop-incomplete --reason "…"` on the landing verb, the reason citing ' +
    "$SLOPWEAVER_HOME/supervisor-scratch/handoff-9257/owner-turn-253-2.txt and written to the door ledger"
  );
}
