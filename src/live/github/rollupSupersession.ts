/**
 * The one tension worth naming between GitHub's aggregate `statusCheckRollup` and the latest-per-name view
 * {@link GithubChecksSnapshot} counts from — and what a single read can PROVE about it.
 *
 * The rollup is computed over EVERY check suite on the head commit, superseded ones included, so a re-run
 * that fixed the one failing thing still leaves it reading `FAILURE` while nothing failing remains to look
 * at. `pr-body-gate` re-runs `dev-gate` on every body edit, which makes that the routine shape here rather
 * than a rarity: it refused every green merge-now row `github landing --press` touched.
 *
 * Its own module rather than a section of `./checks.js` because the two halves answer different questions.
 * That file parses a read and counts it; this one JUDGES the disagreement — which is the half two callers
 * outside `src/live/` act on ({@link rollupContradictsChecks} for `github enqueue`'s `ci-rollup-superseded`
 * finding, {@link rollupSupersessionProof} for the press that may answer it). Every import here is a TYPE
 * import, so the split leaves no runtime cycle for the judging half to be dragged back through.
 */

import type { GithubChecksSnapshot, GithubChecksSummary } from "./checks.js";
import type { SupersededGithubCheck } from "./checksDedupe.js";

/**
 * One superseded failure, described as `<name> <runId> completed <HH:MM:SSZ>` — whatever of those is known.
 *
 * Exported so the guard that REFUSES on a rollup disagreement (`github enqueue`'s `ci-rollup-superseded`
 * finding) names the pinning run in the same words `github checks` does. Two hand-written spellings of the
 * same evidence is how one surface starts describing a state the other cannot.
 *
 * @param check one discarded duplicate
 * @returns the one-line description
 */
export function describeSupersededCheck({ check }: { check: SupersededGithubCheck }): string {
  const parts = [check.name];
  if (check.runId !== undefined) {
    parts.push(check.runId);
  }
  if (check.completedAt !== undefined) {
    // completedAt is GitHub's own ISO-8601 UTC instant (e.g. "<date>T<time>Z"); slicing off the date
    // is string surgery on an already-formatted timestamp, not epoch arithmetic — epoch-arithmetic exempts it.
    parts.push(`completed ${check.completedAt.slice(11)}`);
  }
  return parts.join(" ");
}

/**
 * The discarded duplicates that FAILED — the only ones that can explain a rollup pinned at `FAILURE` while
 * the latest-per-name view is entirely green.
 *
 * Empty is a real answer rather than a missing one: it means the disagreement has no superseded failure
 * behind it, which is the shape no caller may treat as explained.
 *
 * @param snapshot the checks snapshot whose discards are being explained
 * @returns every superseded check whose own state was `failed`
 */
export function supersededFailures({ snapshot }: { snapshot: GithubChecksSnapshot }): readonly SupersededGithubCheck[] {
  return snapshot.supersededChecks.filter((check) => check.state === "failed");
}

/**
 * What this read can establish about a rollup pinned by a superseded failure.
 *
 * Three arms rather than a boolean, because "the shape is not present at all" and "the shape is present and
 * this read cannot prove it" are opposite answers for the one caller that acts on this: a press may name
 * `ci-rollup-superseded` for itself on `proven` only, and an `unproven` carries the sentence a reader needs
 * to see beside `github enqueue`'s own refusal.
 *
 * @internal read through {@link rollupSupersessionProof}; the press is its only consumer.
 */
export type RollupSupersessionProof =
  | { readonly kind: "absent" }
  | { readonly kind: "proven"; readonly reason: string }
  | { readonly kind: "unproven"; readonly why: string };

/**
 * One pinning failure and its established replacement, in the same words `github checks` spells the
 * evidence.
 *
 * @param check one superseded failure whose {@link SupersededGithubCheck.replacedBy} is known
 * @param runId the Actions run that took its slot, already established as present
 * @param completedAt when that replacing run finished, when GitHub reported one
 * @returns the clause naming both runs
 */
function describeProvenReplacement({
  check,
  runId,
  completedAt,
}: {
  check: SupersededGithubCheck;
  runId: string;
  completedAt: string | undefined;
}): string {
  const parts = [`${describeSupersededCheck({ check })} superseded by run ${runId}`];
  if (completedAt !== undefined) {
    // Same string surgery on the same already-formatted ISO-8601 instant `describeSupersededCheck` does.
    parts.push(`completed ${completedAt.slice(11)}`);
  }
  return parts.join(" ");
}

/**
 * Whether a green head's failing rollup is PROVEN to be pinned by runs a later run of the same name
 * replaced on that same head — the one question that lets `github landing --press` answer
 * `ci-rollup-superseded` for itself instead of a seat re-running the enqueue by hand.
 *
 * Every arm is computed from facts GitHub published, and three of them are refusals in the safe direction:
 *
 * - a TRUNCATED page can only ever LOSE a failing check, so it produces the false green this whole family
 *   of guards exists to refuse — it is `unproven` however clean the part that arrived looks;
 * - a disagreement with NO superseded failure behind it is unexplained, which is the shape
 *   {@link supersededFailures} already says no caller may treat as explained;
 * - a pinning failure whose {@link SupersededGithubCheck.replacedBy} is absent is a run nothing ORDERED
 *   against the one still counting, and one whose replacement carries no run id cannot be NAMED in the
 *   reason the door ledger records. Both stay `unproven`, and on this repository neither is the routine
 *   case: `pr-body-gate` re-runs `dev-gate` as a Check Run, which carries both a suite instant and a
 *   workflow run id.
 *
 * What a `proven` reason does NOT claim is the immediate replacement's own conclusion: in a chain of three
 * runs the one that took a failure's slot may itself have been replaced. The claim is the pair of facts
 * that are jointly sufficient — a strictly later run of that name exists on this head, and every check in
 * the latest-per-name view on it passed — so the LATEST run of every pinning name passed without the
 * sentence asserting anything about a middle one.
 *
 * @param snapshot the checks snapshot the rollup and the count both came from
 * @param summary that same snapshot's per-state count, passed in rather than recomputed so this module
 *   needs nothing from `./checks.js` at run time
 * @returns `absent` when the rollup and the count are not in tension, `proven` with the reason to record, or
 *   `unproven` with the sentence saying why this read could not establish it
 */
export function rollupSupersessionProof({
  snapshot,
  summary,
}: {
  snapshot: GithubChecksSnapshot;
  summary: GithubChecksSummary;
}): RollupSupersessionProof {
  if (!rollupContradictsChecks({ snapshot, summary })) {
    return { kind: "absent" };
  }
  if (snapshot.truncated) {
    return {
      kind: "unproven",
      why:
        `the head carries more check contexts than this read's page returned, so a failing check may be ` +
        `missing from the ${String(summary.total)} that arrived`,
    };
  }
  const pinning = supersededFailures({ snapshot });
  if (pinning.length === 0) {
    return {
      kind: "unproven",
      why: `nothing in this read explains the ${snapshot.rollupState} rollup — no superseded run on ${snapshot.headSha} failed`,
    };
  }
  const clauses: string[] = [];
  const unnamed: SupersededGithubCheck[] = [];
  for (const check of pinning) {
    const replaced = check.replacedBy;
    if (replaced?.runId === undefined) {
      unnamed.push(check);
      continue;
    }
    clauses.push(describeProvenReplacement({ check, completedAt: replaced.completedAt, runId: replaced.runId }));
  }
  if (unnamed.length > 0) {
    return {
      kind: "unproven",
      why:
        `${String(unnamed.length)} of ${String(pinning.length)} superseded failure(s) on ${snapshot.headSha} ` +
        `carry no LATER run of the same name this read can name: ` +
        unnamed.map((check) => describeSupersededCheck({ check })).join("; "),
    };
  }
  return {
    kind: "proven",
    reason:
      `GitHub's rollup on ${snapshot.headSha} reads ${snapshot.rollupState} and all ${String(summary.total)} ` +
      `checks in the latest-per-name view on that head PASSED; every run pinning it was replaced on the same ` +
      `head by a later run of its own name — ${clauses.join("; ")}`,
  };
}

/** Every superseded duplicate that failed, described for the one clause a rollup-mismatch line gets. */
function describeSupersededFailures({ checks }: { checks: readonly SupersededGithubCheck[] }): string {
  const failed = checks.filter((check) => check.state === "failed");
  if (failed.length === 0) {
    return "no failed check in the latest-per-name view";
  }
  if (failed.length === 1) {
    return `1 superseded run, ${describeSupersededCheck({ check: failed[0]! })}`;
  }
  return `${String(failed.length)} superseded runs, ${failed.map((check) => check.name).join(", ")}`;
}

/** GitHub's own rollup states that mean an unambiguous failure — never `PENDING`, which is merely unsettled. */
const FAILING_ROLLUP_STATES = new Set(["FAILURE", "ERROR"]);

/**
 * Explain a rollup/count disagreement in one clause, or `undefined` when there is none to explain.
 *
 * Exported for `./checks.js`'s own status line, the one caller that renders it.
 *
 * The disagreement this guards against is the one that cost a p0 registration on one pull request: GitHub's aggregate
 * `rollupState` folds in EVERY check suite on the head commit, superseded ones included, so a re-run that
 * fixed a failure still pins the rollup at `FAILURE` even once the latest-per-name view — what the count in
 * this line is built from — reports every check passed. That combination is flagged; a `PENDING` rollup next
 * to an all-passed count is NOT — the rollup simply has not caught up yet, which is routine mid-poll and
 * never the ambiguity that case turned on — and neither is the reverse (rollup `SUCCESS` while the count shows a
 * failure), because the count already surfaces that failure by name.
 *
 * @param snapshot the checks snapshot the count and the rollup both came from
 * @param summary the same snapshot's per-state count
 * @returns the explanatory clause, or `undefined` when the rollup and the count are not in tension
 */
export function rollupMismatchClause({
  snapshot,
  summary,
}: {
  snapshot: GithubChecksSnapshot;
  summary: GithubChecksSummary;
}): string | undefined {
  if (!rollupContradictsChecks({ snapshot, summary })) {
    return undefined;
  }
  return `rollup ${snapshot.rollupState}: ${describeSupersededFailures({ checks: snapshot.supersededChecks })}`;
}

/**
 * Whether GitHub's aggregate rollup and the latest-per-name count are in the one tension worth naming:
 * every check on the head settled green, and the rollup still reads an unambiguous failure.
 *
 * Exported because the LINE that explains this ({@link formatChecksLine}) and the GUARD that refuses on it
 * (`../../cli/commands/github/enqueueCore.ts`) have to agree on when the shape is present. A `PENDING`
 * rollup beside an all-passed count is not it — the rollup has merely not caught up — and neither is the
 * reverse, where the count already names the failure itself.
 *
 * @param snapshot the checks snapshot the count came from
 * @param summary that same snapshot's per-state count
 * @returns true when a green head carries a failing rollup
 */
export function rollupContradictsChecks({
  snapshot,
  summary,
}: {
  snapshot: GithubChecksSnapshot;
  summary: GithubChecksSummary;
}): boolean {
  const looksGreen = summary.total > 0 && summary.failed === 0 && summary.running === 0 && summary.queued === 0;
  return looksGreen && FAILING_ROLLUP_STATES.has(snapshot.rollupState);
}
