/**
 * The pure half of the merge-rate measurement: which commit subjects on a base branch are a landed squash
 * merge. The method itself is not new — it is the exact one the fill-to-cap capacity measurement used
 * (`skills/supervisor/reference/fleet-capacity.md`'s "Throughput, by time of day" table), lifted out of a
 * one-off shell pipeline into something this verb can run every time: `git log <ref> --since <a> --until
 * <b> --pretty=%s | grep -cE '\(#[0-9]+\)'`. This module is the `grep` half; `./gitEdge.ts` is the `git
 * log` half.
 */

/** A squash-merge commit subject carries its PR number in parens, e.g. `fix(x): … (#N)`. */
const MERGE_SUBJECT_PATTERN = /\(#\d+\)/;

/**
 * How many commit subjects look like a landed squash merge.
 *
 * @param subjects each commit subject line, in any order
 * @returns the count matching `\(#N\)`
 */
export function countMergeSubjects({ subjects }: { subjects: readonly string[] }): number {
  return subjects.filter((subject) => MERGE_SUBJECT_PATTERN.test(subject)).length;
}
