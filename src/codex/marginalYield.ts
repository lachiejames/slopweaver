/**
 * The marginal-pass reading: which review invocation this would be on THIS diff, what the earlier ones
 * found, and what a pass at that ordinal has historically found across other diffs.
 *
 * The owner asked for visibility rather than a heuristic, and the difference is the whole design. Nothing
 * here decides anything: it cannot refuse a pass, cannot rank one, and returns no recommendation. It prints
 * what the ledger already knows so that a human or a session deciding whether a sixth review pass on one
 * diff is worth its tokens is deciding against counts rather than against a feeling.
 *
 * Three shapes in it exist because the obvious version of each is wrong:
 *
 *  1. **The ordinal counts INVOCATIONS, not conclusions.** A pass that went fatal on a spend cap still cost
 *     wall-clock and still happened, so it takes an ordinal. Conclusive counts are reported separately, as
 *     their own denominator, rather than by quietly renumbering.
 *  2. **The ordinal is not the pass number.** `r3` is the third review ARM; ordinal 3 is the third
 *     invocation on this diff, which may belong to another arm's numbering. Both are displayed on every row for
 *     exactly that reason — conflated, the numbers would look plausible and be wrong.
 *  3. **Ties are named, never broken silently.** Two properties fanned out at `--concurrency 5` start
 *     within milliseconds of each other and their causal order is not a fact the ledger holds. The sort is
 *     deterministic (start, then creation, then artifact id) so the output is stable, and any row sharing a
 *     start instant with its neighbour is reported as tied rather than presented as having come after it.
 *
 * Pure. The caller supplies the scanned records; every rule here is testable without a filesystem.
 */

import { verdictOf } from "./ledger.js";
import type { CodexArtifactRecord, CodexPassId, ReviewPassId } from "./types.js";

/** Which diff, in which checkout, the reading is about. */
export interface MarginalTarget {
  readonly repoRoot: string;
  readonly diffSha256: string;
}

/**
 * The four outcome families a pass can land in, counted rather than scored.
 *
 * @internal a field of the exported reading, never imported by name.
 */
export interface OutcomeTally {
  readonly broken: number;
  readonly clean: number;
  readonly noVerdict: number;
  readonly fatal: number;
}

/**
 * One earlier review invocation on the target diff.
 *
 * @internal a field of the exported reading, never imported by name.
 */
export interface PriorInvocation {
  /** 1-based position in the invocation sequence on this diff. */
  readonly ordinal: number;
  readonly artifactId: string;
  readonly pass: ReviewPassId;
  readonly propertyId: string;
  readonly verdict: string;
  /** The recorded summary, or the counterexample when the pass found one. Empty when it concluded nothing. */
  readonly recorded: string;
  /** The instant the sort used — the earliest attempt start, falling back to the record's creation. */
  readonly orderedAtIso: string;
  /** True when another invocation shares {@link orderedAtIso}, so this row's position is arbitrary. */
  readonly tiedStart: boolean;
}

/**
 * What passes at one ordinal have found, historically, on OTHER diffs.
 *
 * @internal a field of the exported reading, never imported by name.
 */
export interface OrdinalYield {
  readonly ordinal: number;
  readonly tally: OutcomeTally;
  /** How many prior diff sequences contributed an invocation at this ordinal. */
  readonly sampleDiffs: number;
  /** The earliest and latest contributing invocation, or `undefined` when nothing contributed. */
  readonly earliestIso: string | undefined;
  readonly latestIso: string | undefined;
}

/**
 * A per-pass-arm breakdown, so "later passes find nothing" cannot be claimed from mixed properties.
 *
 * @internal a field of the exported reading, never imported by name.
 */
export interface PassStratum {
  readonly pass: ReviewPassId;
  readonly tally: OutcomeTally;
}

/**
 * Why a reading cannot claim to have seen the whole history.
 *
 * Reported rather than silently absorbed: a ledger scan counts sidecar-less and unparseable run directories,
 * and an ordinal computed without them is a RECORDED ordinal — the position among passes that left a record —
 * which is a weaker claim than the position among passes that ran.
 */
export interface HistoryGap {
  /** Finished passes written before the sidecar existed — ordinary, not a fault. */
  readonly withoutSidecar: number;
  readonly unreadable: number;
}

/** The whole reading for one target. */
export interface MarginalPassReading {
  readonly target: MarginalTarget;
  /** The ordinal the next review invocation on this diff would take. */
  readonly nextOrdinal: number;
  readonly prior: readonly PriorInvocation[];
  /** Prior invocations that reached a verdict, as their own denominator. */
  readonly priorConclusive: number;
  readonly priorTally: OutcomeTally;
  readonly strata: readonly PassStratum[];
  /** Historical yield at the ordinal the next pass would take, over diffs OTHER than the target. */
  readonly yieldAtNextOrdinal: OrdinalYield;
  readonly historyGap: HistoryGap;
}

/**
 * The reading for a PLANNING pass, which has no diff and therefore no diff ordinal.
 *
 * A separate shape rather than a `MarginalPassReading` with a null ordinal: a plan reads a tree, not a diff,
 * and hashing its task text into a pretend diff key so the same table could hold it would manufacture an
 * identity the record does not have.
 */
export interface PlanPassReading {
  readonly branch: string | null;
  readonly pass: CodexPassId;
  /**
   * `HEAD` at pass start, or null when the pass captured no tree.
   *
   * Nullable rather than coalesced to `""`: an empty string reads as a head, and a plan whose tree capture
   * failed has no head at all (`house-rules` bans the coalesce for exactly this reason).
   */
  readonly headSha: string | null;
  /** Always the same sentence: there is no diff to be the nth pass over. */
  readonly diffOrdinal: "not-applicable";
}

const EMPTY_TALLY: OutcomeTally = { broken: 0, clean: 0, fatal: 0, noVerdict: 0 };

/** Add one verdict token to a tally. */
function tallyVerdict({ tally, verdict }: { tally: OutcomeTally; verdict: string }): OutcomeTally {
  if (verdict === "BROKEN") {
    return { ...tally, broken: tally.broken + 1 };
  }
  if (verdict === "CLEAN") {
    return { ...tally, clean: tally.clean + 1 };
  }
  if (verdict.startsWith("FATAL")) {
    return { ...tally, fatal: tally.fatal + 1 };
  }
  return { ...tally, noVerdict: tally.noVerdict + 1 };
}

/**
 * The instant a record is ordered by: the earliest attempt start, or its creation when it has no attempt.
 *
 * Attempt start rather than creation time because a record is WRITTEN when the pass finishes, so creation
 * order is completion order — and a long pass started first can be recorded last. Ordering five fanned-out
 * properties by completion reverses them whenever one is slower, which is every run.
 *
 * @returns the ISO instant the sort keys on
 */
function orderedAt({ record }: { record: CodexArtifactRecord }): string {
  const starts = record.attempts.map((attempt) => attempt.startedAtIso).filter((value) => value.length > 0);
  const earliest = starts.toSorted()[0];
  if (earliest === undefined) {
    // No attempt ever recorded a start, so creation time is the only instant this record has. Named rather
    // than substituted: ordering by creation is ordering by COMPLETION, which is the weaker position this
    // function exists to avoid, and a reader tracing a surprising order needs to see where it was taken.
    return record.createdAtIso;
  }
  return earliest;
}

/** What a record's outcome recorded in prose — the counterexample when there is one, else the summary. */
function recordedText({ record }: { record: CodexArtifactRecord }): string {
  const outcome = record.outcome;
  if (outcome.kind !== "answered") {
    return "";
  }
  const answer = outcome.answer;
  if ("counterexample" in answer && answer.counterexample.length > 0) {
    return answer.counterexample;
  }
  return answer.summary;
}

/** Every review record in one checkout, ordered as {@link orderedAt} defines. */
function reviewRecordsFor({
  records,
  repoRoot,
}: {
  records: readonly CodexArtifactRecord[];
  repoRoot: string;
}): readonly CodexArtifactRecord[] {
  return records
    .filter((record) => record.repoRoot === repoRoot && record.scope.mode === "review")
    .toSorted((left, right) => {
      const byStart = orderedAt({ record: left }).localeCompare(orderedAt({ record: right }));
      if (byStart !== 0) {
        return byStart;
      }
      const byCreated = left.createdAtIso.localeCompare(right.createdAtIso);
      if (byCreated !== 0) {
        return byCreated;
      }
      return left.artifactId.localeCompare(right.artifactId);
    });
}

/** The diff a review record judged. Non-review records never reach this. */
function diffOf({ record }: { record: CodexArtifactRecord }): string {
  return record.scope.mode === "review" ? record.scope.diffSha256 : "";
}

/**
 * Group one checkout's review records by the diff they judged, each group in invocation order.
 *
 * @returns a map from diff digest to its ordered invocations
 */
function sequencesByDiff({
  records,
}: {
  records: readonly CodexArtifactRecord[];
}): ReadonlyMap<string, readonly CodexArtifactRecord[]> {
  const grouped = new Map<string, CodexArtifactRecord[]>();
  for (const record of records) {
    const key = diffOf({ record });
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, [record]);
      continue;
    }
    existing.push(record);
  }
  return grouped;
}

/**
 * What passes at one ordinal found across every diff sequence except the target's own.
 *
 * Excluding the target is not tidiness: including it would let the diff under consideration vote on how
 * productive a pass at its own ordinal has been, which is the sample contaminating its own comparator.
 *
 * @param ordinal the 1-based invocation position to report on
 * @returns the counted outcomes, sample size and time range at that ordinal
 */
function yieldAtOrdinal({
  ordinal,
  sequences,
  excludeDiffSha256,
}: {
  ordinal: number;
  sequences: ReadonlyMap<string, readonly CodexArtifactRecord[]>;
  excludeDiffSha256: string;
}): OrdinalYield {
  let tally = EMPTY_TALLY;
  let sampleDiffs = 0;
  const instants: string[] = [];
  for (const [diffSha256, sequence] of sequences) {
    if (diffSha256 === excludeDiffSha256) {
      continue;
    }
    const at = sequence[ordinal - 1];
    if (at === undefined) {
      continue;
    }
    sampleDiffs += 1;
    tally = tallyVerdict({ tally, verdict: verdictOf({ record: at }) });
    instants.push(orderedAt({ record: at }));
  }
  const sorted = instants.toSorted();
  return {
    earliestIso: sorted[0],
    latestIso: sorted[sorted.length - 1],
    ordinal,
    sampleDiffs,
    tally,
  };
}

/** The per-arm breakdown of the target diff's own prior invocations. */
function strataOf({ prior }: { prior: readonly PriorInvocation[] }): readonly PassStratum[] {
  const arms: readonly ReviewPassId[] = ["r1", "r2", "r3"];
  return arms
    .map((pass): PassStratum => {
      const rows = prior.filter((row) => row.pass === pass);
      return { pass, tally: rows.reduce((tally, row) => tallyVerdict({ tally, verdict: row.verdict }), EMPTY_TALLY) };
    })
    .filter(
      (stratum) => stratum.tally.broken + stratum.tally.clean + stratum.tally.fatal + stratum.tally.noVerdict > 0,
    );
}

/**
 * The invocations recorded against one diff.
 *
 * A diff nothing has judged yet has no sequence at all, which is the ordinary first-review case rather than
 * a missing one. The empty list is the honest answer, and the next ordinal comes out as 1. Named as its own
 * function so the absence is a case a reader can see rather than an operator's right-hand side.
 *
 * @param diffSha256 the diff to look up
 * @param sequences every diff's ordered invocations in this checkout
 * @returns that diff's invocations, empty when it has none
 */
function invocationsOn({
  diffSha256,
  sequences,
}: {
  diffSha256: string;
  sequences: ReadonlyMap<string, readonly CodexArtifactRecord[]>;
}): readonly CodexArtifactRecord[] {
  const sequence = sequences.get(diffSha256);
  if (sequence === undefined) {
    return [];
  }
  return sequence;
}

/**
 * Build the marginal-pass reading for one diff in one checkout.
 *
 * @param records every pass record a ledger scan read, from every checkout
 * @param target the checkout and diff the next review pass would run against
 * @param historyGap the scan's own count of records it could not read, so the ordinal can say "recorded"
 * @returns the reading — prior invocations, their tally, per-arm strata and the historical yield
 */
export function marginalPassReading({
  records,
  target,
  historyGap,
}: {
  records: readonly CodexArtifactRecord[];
  target: MarginalTarget;
  historyGap: HistoryGap;
}): MarginalPassReading {
  const inCheckout = reviewRecordsFor({ records, repoRoot: target.repoRoot });
  const sequences = sequencesByDiff({ records: inCheckout });
  const invocations = invocationsOn({ diffSha256: target.diffSha256, sequences });
  const startCounts = new Map<string, number>();
  for (const record of invocations) {
    const at = orderedAt({ record });
    const seen = startCounts.get(at);
    if (seen === undefined) {
      startCounts.set(at, 1);
      continue;
    }
    startCounts.set(at, seen + 1);
  }
  const prior = invocations.map((record, index): PriorInvocation => {
    const scope = record.scope;
    const at = orderedAt({ record });
    return {
      artifactId: record.artifactId,
      ordinal: index + 1,
      orderedAtIso: at,
      pass: scope.mode === "review" ? scope.pass : "r1",
      propertyId: scope.mode === "review" ? scope.property.id : "",
      recorded: recordedText({ record }),
      // Every instant in this map was put there by the loop above, over this same list, so the lookup
      // cannot miss. An honest assertion rather than a zero that would silently read as "not tied".
      tiedStart: startCounts.get(at)! > 1,
      verdict: verdictOf({ record }),
    };
  });
  const nextOrdinal = prior.length + 1;
  return {
    historyGap,
    nextOrdinal,
    prior,
    priorConclusive: prior.filter((row) => row.verdict === "BROKEN" || row.verdict === "CLEAN").length,
    priorTally: prior.reduce((tally, row) => tallyVerdict({ tally, verdict: row.verdict }), EMPTY_TALLY),
    strata: strataOf({ prior }),
    target,
    yieldAtNextOrdinal: yieldAtOrdinal({
      excludeDiffSha256: target.diffSha256,
      ordinal: nextOrdinal,
      sequences,
    }),
  };
}

/**
 * A captured tree's branch, or the stated absence when no tree was captured.
 *
 * `null` is a real value in this shape, meaning a detached HEAD, so the two absences are named here rather
 * than collapsed by an operator at the call site.
 *
 * @param tree the pass's captured tree, or undefined when the capture failed
 * @returns the branch, or null
 */
function branchOf({ tree }: { tree: CodexArtifactRecord["tree"] }): string | null {
  if (tree === undefined) {
    return null;
  }
  return tree.branch;
}

/**
 * A captured tree's HEAD, or the stated absence when no tree was captured.
 *
 * `headSha` is itself optional on a captured tree, so there are two different absences here and both answer
 * `null`. Written as a function naming each rather than as one operator chain, because `null` is a real
 * value in this shape and a reader has to be able to see which absence produced it.
 *
 * @param tree the pass's captured tree, or undefined when the capture failed
 * @returns the head, or null
 */
function headShaOf({ tree }: { tree: CodexArtifactRecord["tree"] }): string | null {
  const headSha = tree?.headSha;
  if (headSha === undefined) {
    return null;
  }
  return headSha;
}

/**
 * The reading for a planning pass, which is deliberately not a {@link MarginalPassReading}.
 *
 * @param record the plan pass record to describe
 * @returns its branch, arm and HEAD, with the diff ordinal stated as not applicable
 */
export function planPassReading({ record }: { record: CodexArtifactRecord }): PlanPassReading {
  const tree = record.tree;
  return {
    // A pass whose tree capture failed has no branch and no head, and `null` is what this shape already
    // means by that. Read through an explicit local rather than an operator, so "we did not capture a tree"
    // and "the tree had no branch" stay the same stated answer instead of an inferred one.
    branch: branchOf({ tree }),
    diffOrdinal: "not-applicable",
    headSha: headShaOf({ tree }),
    pass: record.scope.pass,
  };
}
