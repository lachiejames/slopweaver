/**
 * The PURE rendering of what a `store ingest` run did — one file's report, a whole source's per-file progress,
 * and what the sync denylist kept out — split out of `./core.ts` along the rendering boundary, so the parsers
 * there and the lines here each stay a file a reader can hold.
 */

import type { IngestReport } from "../../../store/ingest.js";
import type { SourceIngestReport } from "../../../store/ingestSource.js";

/**
 * What the sync denylist kept out of this run, and what rule D put back.
 *
 * Silent when nothing was excluded, because a line reading "excluded 0" on every ordinary ingest teaches a
 * reader to stop looking at it — and this is precisely the line that must still be read on the run where it
 * finally says something. An exclusion is deliberately NOT reported as a refusal: a refusal is a row the
 * store could not hold, and folding a policy decision into that count would make a working denylist look
 * like a corpus full of malformed bronze.
 *
 * @param report the counters an ingest or a write produced
 * @returns the lines to print, or none when no record was excluded
 */
export function exclusionLines({
  report,
}: {
  report: Pick<IngestReport, "recordsExcluded" | "recordsRescued" | "deferralOverflow">;
}): readonly string[] {
  if (report.recordsExcluded === 0 && report.recordsRescued === 0 && report.deferralOverflow === 0) {
    return [];
  }
  return [
    `excluded ${String(report.recordsExcluded)} record(s) by the sync denylist, ` +
      `${String(report.recordsRescued)} kept by rule D (a human replied in the thread)`,
    ...(report.deferralOverflow === 0
      ? []
      : [
          `  ${String(report.deferralOverflow)} candidate(s) were ADMITTED because the rule-D hold was full — ` +
            `policy relaxed towards keeping data, which is the safe direction and is not what was asked for`,
        ]),
  ];
}

/**
 * Render what an ingest run did, refusals included.
 *
 * The refusal count is on the FIRST line rather than buried, because a run that stored nine hundred rows
 * and refused a hundred is a different fact from one that stored nine hundred, and only one of those is
 * worth investigating.
 *
 * ## Why the first line says "row version(s)" rather than "rows"
 *
 * MEASURED on a file of hundreds of MB: taken in ONE slice it reported tens of thousands stored, taken
 * in hundreds of slices of 500 it reported about half as many again — and the table held **the one-slice
 * count either way**. The counter is write operations returned by the upsert, and dedup happens WITHIN a
 * slice, so a record that appears in two slices is written twice. Both numbers were always true; "stored
 * <the larger number> rows" was the false reading
 * of one of them, which is the same class as the facet percentage that was of the page rather than of the
 * corpus. The extra line appears only for a multi-slice run, where the two numbers can differ.
 *
 * @param report what the run did
 * @param file which bronze file it read
 * @returns the lines to print
 */
export function ingestLines({ report, file }: { report: IngestReport; file: string }): readonly string[] {
  const rate = report.elapsedMs === 0 ? 0 : Math.round((report.recordsStored / report.elapsedMs) * 1000);
  const lines = [
    `wrote ${String(report.recordsStored)} row version(s) from ${file} in ${String(report.elapsedMs)} ms (${String(rate)}/s)`,
    ...(report.slices > 1
      ? ["a record seen in more than one slice is written once per slice; the table holds one row per (source, id)"]
      : []),
    `read ${String(report.linesRead)} line(s), ${String(report.bytesRead)} byte(s) over ${String(report.slices)} slice(s)`,
    report.reachedEnd
      ? "reached the end of the file"
      : `stopped on the ceiling — resume with --from ${String(report.resumeByteOffset)}`,
    `${String(report.containersSeen)} container(s)`,
    `authors: ${String(report.authorsResolved)} resolved to a person, ${String(report.authorsUnresolved)} kept on author_native_id only (a bot, or nobody the directory holds yet — store identity points them later)`,
    ...(report.duplicatesCollapsed === 0
      ? []
      : [`${String(report.duplicatesCollapsed)} repeated (source, id) line(s) collapsed to their latest capture`]),
    // Printed whenever anything was excluded, because a run that silently held back half its input is the
    // failure mode the whole denylist has to avoid being: a corpus quietly smaller than its operator thinks.
    ...exclusionLines({ report }),
  ];
  if (report.refusalsCounted === 0) {
    return lines;
  }
  // The COUNT is exact and the breakdown is of the retained EXAMPLES, and the line says which is which when
  // they differ. Printing `refusals.length` as the count read "REFUSED 200 record(s)" for a run that
  // refused two million, and the per-reason tallies under it silently became a sample rather than a census.
  const capped = report.refusalsCounted > report.refusals.length;
  return [
    ...lines,
    `REFUSED ${String(report.refusalsCounted)} record(s), each counted rather than sinking the run:`,
    ...refusalSummary({ refusals: report.refusals }),
    ...(capped
      ? [
          `  (the breakdown above is of the ${String(report.refusals.length)} retained example(s) — the ${String(report.refusalsCounted)} is the whole count)`,
        ]
      : []),
  ];
}

/**
 * Render what a whole-source pass did: the per-file progress, then the totals.
 *
 * Per file rather than per source alone, because a multi-gigabyte source takes long enough that "which file am I
 * in" is the only question an operator has while it runs — and because a file that stopped on its ceiling
 * is a different fact from a pass that finished, and only the per-file line can say which one did.
 *
 * @param report what the pass accumulated
 * @returns the lines to print
 */
export function sourceIngestLines({ report }: { report: SourceIngestReport }): readonly string[] {
  const rate = report.elapsedMs === 0 ? 0 : Math.round((report.recordsStored / report.elapsedMs) * 1000);
  const perFile = report.files.map((file) => {
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    const ending = file.report.reachedEnd
      ? "end"
      : `stopped on the ceiling at byte ${String(file.report.resumeByteOffset)}`;
    return (
      `  ${name}  ${String(file.bytes)} byte(s)  →  ${String(file.report.recordsStored)} row version(s), ` +
      `${String(file.report.slices)} slice(s), ${ending}`
    );
  });
  return [
    `store ingest --source ${report.source}: ${String(report.files.length)} file(s) in bronze read order` +
      (report.skipped.length === 0 ? "" : `, ${String(report.skipped.length)} skipped by --from-file`),
    ...perFile,
    `wrote ${String(report.recordsStored)} row version(s) in ${String(report.elapsedMs)} ms (${String(rate)}/s)`,
    "a record seen in more than one slice or file is written once per slice; the table holds one row per (source, id)",
    `read ${String(report.linesRead)} line(s), ${String(report.bytesRead)} byte(s) over ${String(report.slices)} slice(s)`,
    report.reachedEnd
      ? "every file read reached its end"
      : "at least one file stopped on its ceiling — see the per-file lines above",
    ...(report.duplicatesCollapsed === 0
      ? []
      : [`${String(report.duplicatesCollapsed)} repeated (source, id) line(s) collapsed to their latest capture`]),
    ...(report.refusalsCounted === 0
      ? []
      : [
          `REFUSED ${String(report.refusalsCounted)} record(s) across the source, each counted rather than sinking the run:`,
          ...refusalSummary({ refusals: report.refusals }),
        ]),
  ];
}

/**
 * Group refusals by reason so a thousand of the same one is a line rather than a thousand.
 *
 * @param refusals every refusal the run recorded
 * @returns one line per distinct reason, with a count and one example
 */
function refusalSummary({ refusals }: { refusals: IngestReport["refusals"] }): readonly string[] {
  const byReason = new Map<string, { count: number; example: string }>();
  for (const refusal of refusals) {
    const seen = byReason.get(refusal.reason);
    if (seen === undefined) {
      byReason.set(refusal.reason, { count: 1, example: `${refusal.source} ${refusal.sourceId}` });
      continue;
    }
    seen.count += 1;
  }
  return [...byReason.entries()]
    .toSorted((left, right) => right[1].count - left[1].count)
    .map(([reason, seen]) => `  ${String(seen.count)}x  ${reason}  (e.g. ${seen.example})`);
}
