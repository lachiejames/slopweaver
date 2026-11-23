/**
 * The one false green nothing else in this repository refuses: a REQUIRED status-check context that never
 * ran at all.
 *
 * ## Why the rollup cannot see it
 *
 * `statusCheckRollup` summarises the check runs and commit statuses PRESENT on a head commit. It knows
 * nothing about which contexts the base branch's protection or rulesets REQUIRE, so a required context that
 * never registered is not a `FAILURE` or a `PENDING` in the rollup — it is simply not there, and the rollup
 * reads `SUCCESS` over whatever else did run.
 *
 * The reverse case is already covered and is a different shape: a rollup reading `FAILURE` while the
 * latest-per-name view is clean is a SUPERSEDED run still pinning the aggregate, which
 * `./checks.ts`'s `rollupMismatchClause` explains by name. That one is a stale red. This one is a false
 * green, and a false green is what gets merged.
 *
 * MEASURED (`slopweaver github enqueue --pr <number> --repo lachiejames/slopweaver --dry-run --json`):
 * `lachiejames/slopweaver` `main` requires exactly `build` and `integration` — both jobs of the one `ci.yml`
 * workflow. A pull request GitHub reports as `CONFLICTING` runs no `ci.yml` at all, so neither name appears
 * on its head, while `CodeQL` and the two `Analyze` runs still pass and carry the rollup to `SUCCESS`. That
 * is the whole failure in one sentence, and it is why presence is judged by NAME against the required set
 * rather than by anything the rollup reports.
 *
 * That set is still `build` and `integration` and is now GOVERNED through a verb rather than only read:
 * `slopweaver github required-contexts`. It refuses to require a name no merge-group entry has been
 * seen to run, which is the mirror of this module's guard — this one catches a required context missing from a
 * HEAD, that one catches a required context that could never reach a queue ENTRY.
 *
 * ## Why the refusal names the cause instead of listing candidates
 *
 * MEASURED, on the finding that made this a measurement rather than a guess list. `ci.yml`'s
 * `pull_request` run did not fire on four consecutive heads of one `lachiejames/slopweaver` pull request or on another's
 * head, while a third pull request's head got a full lap inside the same window — so it was never a
 * repo-wide outage and never the larger runner pool, which scheduled that third pull request's whole lap. Both
 * stuck pull requests answered `mergeable: CONFLICTING`. Reproduce the discriminator with `git merge-tree`,
 * head against the base tip that existed when the head was PUSHED rather than against a local `origin/main`:
 *
 *     git merge-tree --write-tree <base-tip-at-push> <head>   # the stuck pull request's last head: CONFLICT src/admit/coverage.ts
 *     git merge-tree --write-tree <tip-rebased-onto> <head>   # the tip it was REBASED onto: clean
 *     git merge-tree --write-tree <base-tip> <running-head>   # the one that ran: clean
 *
 * That gap between "rebased onto what I fetched" and "mergeable against what `main` actually is" is the
 * whole failure, and it is invisible from the rollup. Two more shapes are ruled out by the same evidence and
 * should not be re-investigated: the probe head's parent is the previous head, so it was a
 * fast-forward push rather than a force update, and it still produced no run; and `pr-body-gate.yml` — the
 * other `pull_request` workflow — did not fire either, so nothing about `ci.yml` in particular is involved.
 *
 * **The A/B that settles it ran on the same tree**, by the session landing the stuck pull request: resolving the
 * real conflicts (`src/admit/coverage.ts`, `yarn.lock`) against the base tip and pushing the result flipped
 * the pull request to `MERGEABLE` and it immediately took a FULL lap — 10/10 checks, both required contexts
 * present, where the same branch had carried three CodeQL checks and nothing else. One variable changed.
 * That push was itself a `--force-with-lease`, which kills the force-update hypothesis from the other side:
 * a fast-forward did not fire while conflicting, and a force update did fire once clean.
 *
 * ## Why absence is only absence when the read saw the whole head
 *
 * MEASURED, on an `acme/acme-admin` pull request (base `staging`, which requires
 * `Required CI`). This module reported the false green's mirror image — a false RED — and named a cause
 * that did not exist:
 *
 *     slopweaver github checks --number 16367
 *       → 50/50 checks passed (rollup SUCCESS), 1 REQUIRED CONTEXT NEVER RAN: Required CI
 *     slopweaver github checks --number 16367 --limit 100
 *       → 93/93 checks passed (rollup SUCCESS), 2/2 required present
 *
 * One variable changed. The head carries 93 contexts; the default `--limit` was 50. `Required CI` had run
 * and passed the whole time, `branch-pr.yml` was correct (`pull_request`, `branches-ignore: [main]`, no
 * paths filter, default `types`, base `staging`), and none of the three causes the MERGEABLE branch of
 * {@link neverRanCauseClause} lists were involved. The refusal sent a session to edit CI that was fine.
 *
 * The defect was one inference: `contexts(first: $limit)` returns a PAGE, and absence from a page is not
 * absence from the commit. `./checks.ts` already knew — it reads `pageInfo.hasNextPage` — but the fact went
 * only into an advisory `residue` string nothing consumed. It is now `GithubChecksSnapshot.truncated`, and
 * this module splits the absent set on it: {@link RequiredContextGate}'s `missing` (measured, earns the
 * refusal and its cause) apart from `unproven` (not measured, earns "re-read wider" and NO cause).
 *
 * **Stated residue.** The default read limit is now the connection's own maximum of 100, so the case above
 * is decidable rather than merely honest about not knowing — but a head above 100 contexts falls back to
 * `unproven`, and acme-admin's 93 is close. Paginating the connection is the complete fix and is deliberately
 * not in this change: `./checksRead.ts`'s `CHECKS_ROLLUP_SELECTION` is shared with `./mergeQueue.ts`'s own
 * composed query, so a cursor lands in two readers at once and belongs in its own diff.
 *
 * This module is pure. The required set is read live by `./mergeQueue.ts`'s `requiredContexts` seam — both
 * classic branch protection and rulesets, unioned, because a branch may be governed by either.
 */

import type { GithubMergeable } from "../../review/reviewState.js";
import type { GithubCheck } from "./checksDedupe.js";

/**
 * What the required-context gate concluded for one head commit.
 *
 * `unreadable` is its own member rather than an empty `required`, because "the base requires nothing" and
 * "this run could not find out what the base requires" are different facts and only the second one leaves
 * the false green unruled-out. A caller prints the reason and carries on; it never reads as satisfied.
 */
export type RequiredContextGate =
  | { readonly kind: "unreadable"; readonly reason: string }
  | {
      readonly kind: "read";
      /** The branch whose protection and rulesets were read. */
      readonly branch: string;
      /** Every context that branch requires, sorted and deduped by the live read. */
      readonly required: readonly string[];
      /**
       * The required names with no context of that name on the head at all — the false green, by name.
       *
       * Only ever populated from a COMPLETE view of the head. A name absent from a truncated page lands in
       * {@link unproven} instead, because the two have opposite remedies and this one is stated as a fact.
       */
      readonly missing: readonly string[];
      /**
       * The required names absent from a TRUNCATED context page — not a measurement of anything.
       *
       * The name may be sitting on the head in the page this read never asked for, so the remedy is to
       * re-read wider, never to go looking for a paths filter. Kept apart from {@link missing} rather than
       * folded into it because {@link requiredContextRefusal}'s whole value is naming the cause, and a
       * refusal that names the wrong one sends a session to edit CI that is already correct.
       *
       * Non-empty implies {@link missing} is empty: the same absent set goes to one field or the other.
       */
      readonly unproven: readonly string[];
      /**
       * What GitHub reports about building this pull request's merge ref, when this read selected it —
       * the discriminator {@link requiredContextRefusal} names the CAUSE from. `undefined` means no read
       * measured it, and the refusal says so rather than guessing.
       */
      readonly mergeable: GithubMergeable | undefined;
    };

/**
 * The required contexts with no check of that name among the ones this read SAW.
 *
 * Named for what it actually computes. Absence from a set of checks is only absence from the HEAD when that
 * set is the whole head — which is `truncated`'s job to say, and {@link requiredContextGate}'s to act on.
 * The old name said `missing`, and that gap between "absent from what I looked at" and "absent from the
 * commit" is the whole defect this split exists to close.
 *
 * Presence is judged by NAME and nothing else. A required context that is present but still running, or
 * present and failing, is not absent — those are already counted by `summarizeChecks` and named by the
 * status line, and double-reporting them here would make the one thing this guard exists to say harder to
 * see. Check runs and legacy commit statuses share one name namespace, exactly as GitHub's required-contexts
 * setting does, so the comparison ignores a check's `kind`.
 *
 * @param required every context the base branch requires
 * @param checks the head's latest-per-name checks, after `dedupeLatestByName`
 * @returns the required names absent from those checks, sorted, deduped
 */
export function absentRequiredContexts({
  required,
  checks,
}: {
  required: readonly string[];
  checks: readonly GithubCheck[];
}): readonly string[] {
  const present = new Set(checks.map((check) => check.name));
  return [...new Set(required.filter((context) => !present.has(context)))].toSorted();
}

/**
 * Judge one head commit against the contexts its base branch requires.
 *
 * `truncated` is required rather than optional on purpose: every caller holds a snapshot that knows it, and
 * a default would let the next call site silently re-acquire the bug this parameter exists to kill.
 *
 * @param branch the base branch the required set was read for
 * @param required every context that branch requires
 * @param checks the head's latest-per-name checks
 * @param truncated whether the head carries more contexts than this read returned — when `true`, absence
 *   proves nothing and every absent name is reported as unproven rather than as never having run
 * @param mergeable what the same read measured about the merge ref, or `undefined` when it did not
 * @returns the gate, carrying the required set and whichever names never ran or could not be proven
 */
export function requiredContextGate({
  branch,
  required,
  checks,
  truncated,
  mergeable,
}: {
  branch: string;
  required: readonly string[];
  checks: readonly GithubCheck[];
  truncated: boolean;
  mergeable: GithubMergeable | undefined;
}): RequiredContextGate {
  const absent = absentRequiredContexts({ checks, required });
  return {
    branch,
    kind: "read",
    mergeable,
    missing: truncated ? [] : absent,
    required,
    unproven: truncated ? absent : [],
  };
}

/**
 * What one base branch's required-context read answered — the half that is genuinely per BASE.
 *
 * It exists because the two halves of a {@link RequiredContextGate} have different scopes and were once
 * computed together at the wrong one. The REQUIRED SET is a property of the base branch: one live
 * protection-plus-rulesets union per branch, correctly cached and shared. `missing`, `unproven` and
 * `mergeable` are properties of ONE HEAD, and a gate that shares them across pull requests describes a pull
 * request nobody asked about.
 *
 * MEASURED on `lachiejames/slopweaver`, which is what made this a type rather than a tuple:
 * `slopweaver github review-state --repo lachiejames/slopweaver --include-drafts --no-slack-live --json`
 * stamped `missing: ["build"]` on 18 of 23 open pull requests — several among them, each
 * reporting `11/11 passed, 0 failed` with `build` present and green — and stamped `mergeable: MERGEABLE` on
 * several other rows while each row's own `conflict.mergeable` read `CONFLICTING`. One sample row on `main`
 * was mid-lap when the gate was built, and every row sharing that base inherited its answer.
 * `../../review/landing.ts`'s `ci-green` test takes a non-empty `missing` as `fail` before it reads anything
 * else, so the fleet's own landing read called all 18 unlandable and `tally.ready` was zero. Reproduce with
 * the command above and compare each row's `requiredContexts.mergeable` against its own
 * `conflict.mergeable`.
 */
export type RequiredSetRead =
  | { readonly kind: "read"; readonly required: readonly string[] }
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * Build ONE head's gate from its base's required set and that head's own facts.
 *
 * The composition {@link requiredContextGate} always needed and did not enforce: a caller holding a shared
 * {@link RequiredSetRead} cannot reach a gate without also handing over the head it is judging. An
 * `unreadable` set stays unreadable, because a head's checks say nothing about what its base demands.
 *
 * @param set what the base branch's own read answered, shared across every head on that base
 * @param checks this head's latest-per-name checks
 * @param truncated whether this head carries more contexts than its read returned
 * @param mergeable what this head's read measured about its merge ref
 * @returns the gate for this head alone
 */
export function gateForHead({
  branch,
  checks,
  mergeable,
  set,
  truncated,
}: {
  branch: string;
  checks: readonly GithubCheck[];
  mergeable: GithubMergeable | undefined;
  set: RequiredSetRead;
  truncated: boolean;
}): RequiredContextGate {
  if (set.kind === "unreadable") {
    return { kind: "unreadable", reason: set.reason };
  }
  return requiredContextGate({ branch, checks, mergeable, required: set.required, truncated });
}

/**
 * The clause naming the required set beside a check count — printed on every line, never only a failing one.
 *
 * The same reason `formatChecksLine` carries the rollup state on every line: a reader who only ever sees the
 * required set when it is violated cannot tell "this run checked and the gate is satisfied" from "this run
 * never looked". A base that requires nothing says so explicitly for the same reason.
 *
 * @param gate the gate this read concluded
 * @returns one clause, always
 */
export function requiredContextClause({ gate }: { gate: RequiredContextGate }): string {
  if (gate.kind === "unreadable") {
    return `required contexts UNREAD (${gate.reason}) — a required gate that never ran cannot be ruled out here`;
  }
  if (gate.required.length === 0) {
    return `${gate.branch} requires no status-check contexts`;
  }
  if (gate.unproven.length > 0) {
    return `${String(gate.unproven.length)} REQUIRED CONTEXT${gate.unproven.length === 1 ? "" : "S"} UNPROVEN: ${gate.unproven.join(", ")}`;
  }
  if (gate.missing.length === 0) {
    return `${String(gate.required.length)}/${String(gate.required.length)} required present`;
  }
  return `${String(gate.missing.length)} REQUIRED CONTEXT${gate.missing.length === 1 ? "" : "S"} NEVER RAN: ${gate.missing.join(", ")}`;
}

/**
 * The clause that names the CAUSE, from what the read measured rather than from a list of candidates.
 *
 * The guess list this replaced named three causes with two different remedies and left the reader to pick.
 * MEASURED, which is why it is a measurement now: a session read that list on a stuck pull request, checked
 * conflict against a `origin/main` its own fetch had left stale, concluded "not conflicting", and spent the
 * rest of the session on two hypotheses that were both wrong — then applied the guess list's OTHER remedy
 * and pushed an empty commit to re-trigger, which cannot work for this cause. GitHub had been answering
 * `mergeable: CONFLICTING` on the same node the rollup was read from for the whole four-head sequence.
 */
function neverRanCauseClause({ mergeable }: { mergeable: GithubMergeable | undefined }): string {
  if (mergeable === "CONFLICTING") {
    return (
      "GitHub reports this pull request CONFLICTING, so it cannot build the merge ref a `pull_request` run " +
      "is checked out from and creates NO run for any `pull_request`-triggered workflow at all — while a " +
      "check configured outside this repository's workflow files (CodeQL default setup, measured) still " +
      "lands and carries the rollup. Re-triggering cannot fix this: rebase onto the base's CURRENT tip and " +
      "force-push. Note that a local rebase proves nothing unless the `origin/<base>` it rebased onto was " +
      "fetched after the last landing"
    );
  }
  if (mergeable === "MERGEABLE") {
    return (
      "GitHub reports this pull request MERGEABLE, so a conflict is ruled out by measurement rather than by " +
      "inspection — look instead at a paths filter, a trigger whose `types` exclude the event that pushed " +
      "this head, or a run cancelled before it registered. A rebase is not the remedy here"
    );
  }
  if (mergeable === "UNKNOWN") {
    return (
      "GitHub has not finished computing this pull request's mergeability, and it creates no `pull_request` " +
      "run while it cannot build the merge ref — so re-read before concluding anything about the cause"
    );
  }
  return (
    "this read did not measure mergeability, so the cause is NOT established here — a workflow that is " +
    "paths-filtered, cancelled before it registered, or skipped because the pull request is CONFLICTING all " +
    "look identical from the rollup alone"
  );
}

/**
 * The refusal a missing required context earns, or `undefined` when there is none to raise.
 *
 * Stated as a refusal rather than a warning because the head this describes is exactly as unmergeable as one
 * with a failing check — the difference is only that GitHub reports the failure and reports nothing at all
 * for this. The remedy is named from what was MEASURED, because the causes have opposite ones and a session
 * that cannot tell them apart re-triggers CI on a branch that needs a rebase.
 *
 * @param gate the gate this read concluded
 * @returns the refusal line, or `undefined` when every required context is on the head
 */
export function requiredContextRefusal({ gate }: { gate: RequiredContextGate }): string | undefined {
  if (gate.kind === "unreadable") {
    return undefined;
  }
  if (gate.unproven.length > 0) {
    return (
      `${gate.branch} requires ${gate.unproven.join(", ")}, and this read did not see ` +
      `${gate.unproven.length === 1 ? "it" : "them"} — but it did not see the head's whole context list ` +
      "either, because GitHub reported more contexts than the requested `--limit` returned. Absence here " +
      "is NOT a measurement and no cause is named from it: re-read with a larger `--limit` before " +
      "concluding anything. Do not go looking for a paths filter, a `types` list or a cancelled run on the " +
      "strength of this line."
    );
  }
  if (gate.missing.length === 0) {
    return undefined;
  }
  return (
    `${gate.branch} requires ${gate.missing.join(", ")}, and ${gate.missing.length === 1 ? "it is" : "they are"} ` +
    "not on this head at all — the rollup summarises only the runs that are PRESENT, so it reads green over a " +
    `gate holding no verdict. ${neverRanCauseClause({ mergeable: gate.mergeable })}.`
  );
}

/**
 * One check line with the required-context clause appended.
 *
 * @param line the status or verdict line the clause rides beside
 * @param gate the gate this read concluded
 * @returns the composed line
 */
export function withRequiredContextClause({ line, gate }: { line: string; gate: RequiredContextGate }): string {
  return `${line}, ${requiredContextClause({ gate })}`;
}
