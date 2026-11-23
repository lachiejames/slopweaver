/**
 * The gate's debt list, and the partition that makes it a gate rather than a nuisance. Pure — findings in,
 * findings sorted into three buckets, no filesystem.
 *
 * ## Why a blocking gate needs one at all
 *
 * MEASURED: the first working install of the pre-push hook refused every push out of the state
 * repository, on five findings that were already standing — one prefixed name and four dangling wikilinks,
 * all of them in the auto-memory corpora of two OTHER projects. Reproduce with `slopweaver memory gate`.
 * None of them was introduced by the push, none of them was fixable from the tree being pushed, and the
 * gate never repairs a memory: it refuses and explains, never silently repairs.
 * A gate whose refusal the operator must hatch past on every single push has
 * trained the operator to hatch past it, which is strictly worse than not shipping one.
 *
 * So the criterion is NOT "the corpus is clean". It is **"this run introduced nothing new"** — the same
 * shape `error-shape-threshold` and `whole-file-json` already use here, a debt list that only shrinks.
 *
 * ## Three buckets, and why `stale` is one of them
 *
 * A finding is `fresh` (not on the list — it BLOCKS), `standing` (on the list — reported, does not block),
 * or `stale` (on the list and no longer firing). Stale entries are what make this shrink rather than rot:
 * every run rewrites the list without them, so a defect that is fixed can never come back for free. The
 * repo's other debt lists FAIL when an entry stops firing, deliberately, because their entries name code
 * under review. This one names the operator's own live memory corpus, which another session may legitimately
 * be rewriting at any moment — so a vanished entry is quietly dropped rather than reported as a defect.
 *
 * **Only a check this build runs can call its own entry stale.** Every checkout on the machine shares one list,
 * and a build that predates a check never sees its findings: MEASURED, a `memory gate` from a checkout
 * without `why-always-loaded-missing` and `dated-addendum` pruned six accepted entries for them, and the next run
 * of a current build re-reported all six as new. An entry naming a check id outside `MEMORY_CHECK_IDS` is kept.
 */

import { MEMORY_CHECK_IDS, type MemoryFinding } from "./types.js";

/** The check ids this build runs, and so the only ones whose accepted entries it may judge stale. */
const RUN_CHECKS: ReadonlySet<string> = new Set(MEMORY_CHECK_IDS);

/** Whether a key's check id — its second field — is one this build runs. */
function judgedHere({ key }: { key: string }): boolean {
  const check = key.split("\u0000")[1];
  return check !== undefined && RUN_CHECKS.has(check);
}

/**
 * One corpus's findings, keyed by the directory they belong to.
 *
 * Declared here rather than in the verb because the partition below is what actually consumes it, and the
 * baseline file's own shape is derived from it.
 */
export interface MemoryGateResult {
  readonly dir: string;
  readonly findings: readonly MemoryFinding[];
}

/**
 * A finding's identity on the debt list.
 *
 * The MESSAGE is part of the key on purpose. A check id plus a file would let a defect mutate underneath an
 * accepted entry — `name-format` on one file reports a different rule break after a rename, and keying it
 * loosely would wave the new one through as already-accepted. The line number is deliberately NOT in the
 * key: an unrelated edit above a dangling wikilink shifts it and would otherwise re-block a push for a
 * defect nobody touched.
 *
 * @param dir the corpus directory the finding came from
 * @param finding the finding itself
 * @returns a stable single-line key
 */
export function findingKey({ dir, finding }: { dir: string; finding: MemoryFinding }): string {
  return [dir, finding.check, finding.file, finding.message].join("\u0000");
}

/** What one run's findings look like against the accepted list. */
export interface MemoryGatePartition {
  /** Not on the list — these are what a refusal is about. */
  readonly fresh: readonly MemoryGateResult[];
  /** On the list and still firing — reported, never blocking. */
  readonly standing: readonly MemoryGateResult[];
  /** On the list and no longer firing — dropped when the list is rewritten. */
  readonly staleKeys: readonly string[];
}

/**
 * Sort a run's findings against the accepted list.
 *
 * Every corpus keeps its own entry in both `fresh` and `standing`, including the empty ones, so a report can
 * still name a corpus it found nothing in — "3 corpora checked" is part of what makes this run loud.
 *
 * @param results one entry per discovered corpus
 * @param accepted the keys currently on the debt list
 * @returns the three buckets
 */
export function partitionAgainstBaseline({
  results,
  accepted,
}: {
  results: readonly MemoryGateResult[];
  accepted: readonly string[];
}): MemoryGatePartition {
  const acceptedSet = new Set(accepted);
  const seen = new Set<string>();
  const fresh: MemoryGateResult[] = [];
  const standing: MemoryGateResult[] = [];
  for (const result of results) {
    const freshFindings: MemoryFinding[] = [];
    const standingFindings: MemoryFinding[] = [];
    for (const finding of result.findings) {
      const key = findingKey({ dir: result.dir, finding });
      seen.add(key);
      if (acceptedSet.has(key)) {
        standingFindings.push(finding);
      } else {
        freshFindings.push(finding);
      }
    }
    fresh.push({ dir: result.dir, findings: freshFindings });
    standing.push({ dir: result.dir, findings: standingFindings });
  }
  const staleKeys = accepted.filter((key) => !seen.has(key) && judgedHere({ key }));
  return { fresh, staleKeys: staleKeys.toSorted(), standing };
}

/**
 * Every key a run saw, sorted — what `--accept` writes and what a rewrite narrows the list to.
 *
 * @param results one entry per discovered corpus
 * @returns the keys, sorted and deduplicated
 */
export function keysFromResults({ results }: { results: readonly MemoryGateResult[] }): readonly string[] {
  const keys = new Set<string>();
  for (const result of results) {
    for (const finding of result.findings) {
      keys.add(findingKey({ dir: result.dir, finding }));
    }
  }
  return [...keys].toSorted();
}

/**
 * What `--accept` writes: every key this run saw, plus every accepted key for a check this build does not run —
 * which it cannot see, so replacing the list outright would erase a newer build's entries.
 *
 * @param accepted the keys currently on the debt list
 * @param results one entry per discovered corpus
 * @returns the keys, sorted and deduplicated
 */
export function acceptedKeys({
  accepted,
  results,
}: {
  accepted: readonly string[];
  results: readonly MemoryGateResult[];
}): readonly string[] {
  const kept = accepted.filter((key) => !judgedHere({ key }));
  return [...new Set([...keysFromResults({ results }), ...kept])].toSorted();
}

/**
 * The list a run should leave behind: what was accepted, minus what stopped firing.
 *
 * @param accepted the keys currently on the debt list
 * @param staleKeys the accepted keys this run did not see
 * @returns the narrowed list, sorted
 */
export function shrunkBaseline({
  accepted,
  staleKeys,
}: {
  accepted: readonly string[];
  staleKeys: readonly string[];
}): readonly string[] {
  const gone = new Set(staleKeys);
  return accepted.filter((key) => !gone.has(key)).toSorted();
}

/**
 * How many findings a bucket holds across every corpus.
 *
 * @param results the bucket
 * @returns the total count
 */
export function countFindings({ results }: { results: readonly MemoryGateResult[] }): number {
  return results.reduce((count, result) => count + result.findings.length, 0);
}
