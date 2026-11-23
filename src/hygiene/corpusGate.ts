/**
 * The corpus hygiene scan, rendered for a LINT PLAN rather than for an operator.
 *
 * The difference from {@link ../hygiene/corpusScan.renderCorpusScan} is the audience, not the content.
 * `slopweaver audit hygiene` is read by someone who asked the question and wants the identifier
 * locations in front of them; the `corpus-hygiene` check runs on every `pre-push` beside twenty
 * other gates, and a gate that prints a hundred lines of things it explicitly does not fail on is a gate
 * whose real failure gets scrolled past.
 *
 * Pure — the scan itself is done by the time these lines are chosen.
 */
import { absentAs } from "#lib/absent.js";
import { type CorpusScanResult, protectedSkipLines } from "./corpusScan.js";

/** One hit as `<file>:<line>  <label>  <sourceId>` — a LOCATION, never the matched text. */
function locationLine({
  hit,
}: {
  hit: { file: string; line: number; label: string; sourceId: string | undefined };
}): string {
  return `    ${hit.file}:${String(hit.line)}  ${hit.label}  ${absentAs({ value: hit.sourceId, whenAbsent: "(unparsed)" })}`;
}

/**
 * The gate's output: one line when the corpus is clean or absent, the whole failing arm when it is not, and in
 * either case a `NOT CHECKED` line naming every path the owner's protect list kept the scan from.
 *
 * @param result what the scan established
 * @param bronze the bronze root, named when there is nothing under it to scan
 * @returns the lines to print, in order
 */
export function renderCorpusHygieneGate({
  result,
  bronze,
}: {
  result: CorpusScanResult;
  bronze: string;
}): readonly string[] {
  const skipped = protectedSkipLines({ result });
  if (result.filesScanned === 0 && result.unreadable.length === 0 && skipped.length === 0) {
    // Not a failure, and saying WHY is the point: CI, a fresh checkout and a fork all reach this branch, and
    // a bare `clean` from a run that scanned nothing is the false green this whole family of gates is about.
    return [`corpus-hygiene: no bronze under ${bronze} — nothing to scan (a fresh checkout and CI have none)`];
  }
  const denylist = result.denylistLoaded ? `denylist ${String(result.denylistWords)} word(s)` : "denylist NOT LOADED";
  const scale =
    `${String(result.filesScanned)} file(s), ${String(result.linesScanned)} record(s), ` +
    `${String(result.identifiers.total)} identifier(s), ${denylist}`;
  if (result.leaks.length === 0 && result.unreadable.length === 0) {
    // A protected skip passes, because the owner's own ruling put that path out of every session's reach; the line
    // names it on every run, so the narrowing is never mistaken for a scan of the whole corpus.
    const verdict = skipped.length === 0 ? "clean" : "clean over what it may read";
    return [`corpus-hygiene: ${verdict} — ${scale}`, ...skipped];
  }
  return [
    `corpus-hygiene: FAILED — ${scale}`,
    ...(result.unreadable.length === 0 ? [] : [`  NOT CHECKED, unreadable: ${result.unreadable.join(", ")}`]),
    ...skipped,
    ...(result.leaks.length === 0
      ? []
      : [
          `  ${String(result.leaks.length)} secret(s) survived the redaction pass — locations only,`,
          "  because on a corpus record the matched text IS the content:",
          ...result.leaks.map((hit) => locationLine({ hit })),
          "  Repair with `slopweaver audit hygiene --scrub`, which rewrites exactly these lines.",
        ]),
  ];
}
