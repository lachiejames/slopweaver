/**
 * The PURE half of the bronze-vs-store drift measure: what a scan counts, what "missing" means, and how
 * the report reads.
 *
 * ## What is being measured, stated before any number
 *
 * `missing = distinct native ids the ingest pipeline would OFFER from the scanned bronze files − the ids
 * the store already holds for that source`. Three things follow from that sentence and each is a property
 * of the report rather than a caveat on it:
 *
 * - It measures **absence of a row**, never staleness of one. A row whose bronze capture is newer than
 *   the stored one is not missing and is not reported here.
 * - A **line count subtraction cannot compute it.** Bronze lines include blanks, duplicates of the same
 *   id across window files, rows the denylist excludes and rows the projection refuses; the store also
 *   holds rows written by paths that never touched bronze. Subtracting the two totals answers a different
 *   question and answers it wrongly.
 * - A refusal is **not** a missing id. Refused and excluded lines are counted and printed separately,
 *   because folding them in would let a data-shape problem read as a loading problem.
 *
 * The scope is the other half of the claim. A `windows` scan omits the canonical `compact.jsonl`, so a
 * zero means "nothing missing in the scanned windows" and never "the corpus is synchronised" —
 * `./bronzeWindows.ts` carries why the omission is a cost decision. The renderer prints the omission on
 * every line, including a zero one, so a reader cannot take the stronger reading by accident.
 */
import type { CorpusSource } from "../corpus/types.js";

import type { ContentRow } from "./schema/content.js";

/**
 * How many missing ids a report keeps as examples, however many it counted.
 *
 * @internal named by this module and its test only — the cap is a property of the report, not a knob.
 */
export const MAX_DRIFT_EXAMPLES = 10;

/** What one source's scan observed, before the report is rendered. */
export interface BronzeDriftReport {
  readonly source: CorpusSource;
  /** Which scope ran — what the counts below are a claim ABOUT. */
  readonly scope: "windows" | "full";
  /** How many bronze files the scan read. */
  readonly filesScanned: number;
  /** How many files the scope left out, and their size, so the report states its own boundary. */
  readonly filesOmitted: number;
  readonly bytesOmitted: number;
  /** Non-blank lines the scan examined. */
  readonly linesRead: number;
  /** Distinct native ids the pipeline would offer from those files. */
  readonly candidates: number;
  /** How many of those the store already holds. */
  readonly present: number;
  /** How many it does not — `candidates - present`, by construction. */
  readonly missing: number;
  /** Lines the author denylist removed before projection — never counted as missing. */
  readonly excluded: number;
  /** Lines the parse or projection refused — never counted as missing. */
  readonly refused: number;
  /** Up to {@link MAX_DRIFT_EXAMPLES} of the missing ids, for a reader to check one by hand. */
  readonly examples: readonly string[];
}

/**
 * What the store is actually keyed by, and therefore what a presence check has to ask about.
 *
 * BOTH halves, because `content` is unique on `(source, source_id)` and the PROJECTED source is what the
 * loader writes — not the bronze directory the line was read from. Those two can differ: a line carrying
 * `source: "calendar"` sitting in `bronze/slack/` is stored as a calendar row, and a scan that probed
 * slack for its id would report a row missing that the loader had already written. A module that
 * carried the id alone has exactly that failure, with a counterexample.
 */
export interface ContentKey {
  readonly source: ContentRow["source"];
  readonly sourceId: string;
}

/**
 * One key as the string a `Set` can hold — source and id, separated by a byte neither contains.
 *
 * `NUL` rather than `:` because a Slack native id is itself `<channel>:<ts>`, so a `:` join makes
 * `("slack", "C1:1.2")` and a hypothetical `("slack:C1", "1.2")` the same string.
 *
 * @param key the source and native id pair
 * @returns the joined key
 */
export function contentKeyOf({ key }: { key: ContentKey }): string {
  return `${key.source}\u0000${key.sourceId}`;
}

/**
 * The keys a scan offered that the store does not hold, and a bounded sample of them.
 *
 * `candidates` arrives already deduplicated by the caller, so this is a set difference and nothing else —
 * deliberately, because counting duplicates as separate misses is the arithmetic this whole module exists
 * to avoid. An example whose projected source is NOT the scanned one is printed `source:id` rather than
 * bare, because that row is an anomaly a reader should see rather than a plain miss. Pure.
 *
 * @param candidates the distinct keys the scan offered, in scan order
 * @param present the keys the store answered for, joined by {@link contentKeyOf}
 * @param scanned the source whose bronze directory was read, which the examples are written relative to
 * @returns how many are missing, and the first {@link MAX_DRIFT_EXAMPLES} of them in scan order
 */
export function missingContentIds({
  candidates,
  present,
  scanned,
}: {
  candidates: readonly ContentKey[];
  present: ReadonlySet<string>;
  scanned: CorpusSource;
}): { missing: number; examples: readonly string[] } {
  const absent = candidates.filter((key) => !present.has(contentKeyOf({ key })));
  const examples = absent
    .slice(0, MAX_DRIFT_EXAMPLES)
    .map((key) => (key.source === scanned ? key.sourceId : `${key.source}:${key.sourceId}`));
  return { examples, missing: absent.length };
}

/**
 * The command that repairs one source, printed BESIDE the count rather than left for a reader to derive.
 *
 * A report naming a gap and not the act that closes it is the shape this whole change replaces — the
 * defect it was found by stood for days because nobody knew there was a verb for it.
 *
 * @param source the source to repair
 * @returns the exact command line
 */
export function driftRepairCommand({ source }: { source: CorpusSource }): string {
  return `slopweaver store ingest --source ${source} --limit 2000 --all`;
}

/**
 * The lines one source's report prints.
 *
 * The scope boundary is on the FIRST line in both directions, so a zero and a non-zero carry the same
 * claim; the repair command appears only when there is something to repair.
 *
 * @param report what the scan observed
 * @returns the rendered lines, in print order
 */
export function driftLines({ report }: { report: BronzeDriftReport }): readonly string[] {
  const scanned =
    `${report.source}: ${String(report.missing)} of ${String(report.candidates)} bronze id(s) missing ` +
    `from the store · ${String(report.filesScanned)} file(s), ${String(report.linesRead)} line(s) read` +
    omissionClause({ report });
  const detail =
    `  examined: ${String(report.present)} present · ${String(report.excluded)} line(s) excluded by the ` +
    `denylist · ${String(report.refused)} refused — neither is a missing id`;
  const lines = [scanned, detail];
  if (report.missing > 0) {
    lines.push(`  e.g. ${report.examples.join(", ")}`);
    lines.push(`  repair: ${driftRepairCommand({ source: report.source })}`);
  }
  return lines;
}

/**
 * What the scan did NOT read, as a clause on the count line.
 *
 * @param report what the scan observed
 * @returns the clause, empty under a scope that omitted nothing
 */
function omissionClause({ report }: { report: BronzeDriftReport }): string {
  if (report.filesOmitted === 0) {
    return " · nothing omitted";
  }
  return ` · ${String(report.filesOmitted)} file(s) not scanned (${String(report.bytesOmitted)} bytes)`;
}
