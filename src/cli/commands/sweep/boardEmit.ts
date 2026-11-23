/**
 * What `sweep board` prints: the census always, and the candidates a selection shows — the findings by default, or
 * one named verdict. The terminal half of `./boardRun.ts`, split along that seam so the verb's file holds the pass.
 */
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type SweepCandidate, type SweepVerdict, verdictCensus } from "../../../sweep/classify.js";
import { EXIT_OK } from "../../exitCodes.js";

/** The order verdicts print in — most actionable first, matching the classifier's own test order. */
const VERDICT_ORDER: readonly SweepVerdict[] = [
  "CONTRADICTED",
  "SHIPPED",
  "PR_ENDED",
  "UNCARDED",
  "ORPHANED",
  "SUPERSEDED",
  "OVERTAKEN",
  "UNWITNESSED",
  "KEEP",
];

/** Verdicts the default view prints in full — the FINDINGS, whether or not a verb can act on them. */
const FINDINGS: ReadonlySet<SweepVerdict> = new Set([
  "CONTRADICTED",
  "SHIPPED",
  "PR_ENDED",
  "UNCARDED",
  "ORPHANED",
  "SUPERSEDED",
  "OVERTAKEN",
]);

/** One printable block per candidate. */
function humanLines({ candidate }: { candidate: SweepCandidate }): readonly string[] {
  return [`  ${candidate.slug}  [${candidate.act}]`, `      ${candidate.witness}`];
}

/**
 * The selection's canonical JSON lines — what `--json` prints and what `--write` publishes, one object per
 * shown candidate, in the order they were classified.
 *
 * @param candidates the rows the selection shows, already filtered by verdict
 * @returns one serialised candidate per line, without newlines
 */
export function sweepBoardJsonLines({
  candidates,
}: {
  readonly candidates: readonly SweepCandidate[];
}): readonly string[] {
  return candidates.map((candidate) => safeJsonStringify({ label: "a sweep candidate", value: candidate }));
}

/**
 * Which candidates print as rows rather than only as a census number.
 *
 * `CONTRADICTED` is in the default view while carrying no act, and that is the point of separating the two:
 * a contradiction is a finding somebody has to look at, and filtering the default view by actability would
 * have hidden exactly the rows most worth reading.
 *
 * @param candidates every classified row
 * @param verdict the requested verdict, or undefined for the findings
 * @returns the rows to print
 */
export function selectCandidates({
  candidates,
  verdict,
}: {
  candidates: readonly SweepCandidate[];
  verdict: string | undefined;
}): readonly SweepCandidate[] {
  if (verdict === undefined) {
    return candidates.filter((candidate) => FINDINGS.has(candidate.verdict));
  }
  return candidates.filter((candidate) => candidate.verdict === verdict);
}

/** Print each shown candidate under its verdict's heading, in {@link VERDICT_ORDER}. */
function printGroups({
  shown,
  writeOut,
}: {
  shown: readonly SweepCandidate[];
  writeOut: (line: string) => void;
}): void {
  VERDICT_ORDER.forEach((name) => {
    const group = shown.filter((candidate) => candidate.verdict === name);
    if (group.length === 0) {
      return;
    }
    writeOut("");
    writeOut(`${name} — ${String(group.length)}:`);
    group
      .flatMap((candidate) => humanLines({ candidate }))
      .forEach((line) => {
        writeOut(line);
      });
  });
}

/**
 * Print the census and the filtered candidates.
 *
 * The census prints ALWAYS and the rows print filtered, which is rule 7's shape rather than a preference.
 * MEASURED on the live board (`slopweaver sweep board`): 814 live rows, of which **657 are
 * UNWITNESSED** — a verb that listed them would be the wall of text the rule refuses. The number is the
 * finding; the rows are what a filter asks for.
 *
 * @param candidates every classified row
 * @param shown the rows the selection shows, which is what `--json` prints
 * @param json whether to emit one object per line instead
 * @param scanned how many docs the scan read
 * @param writeOut the stdout channel
 * @returns the process exit code
 */
export function emit({
  candidates,
  shown,
  json,
  scanned,
  writeOut,
}: {
  candidates: readonly SweepCandidate[];
  shown: readonly SweepCandidate[];
  json: boolean;
  scanned: number;
  writeOut: (line: string) => void;
}): number {
  if (json) {
    sweepBoardJsonLines({ candidates: shown }).forEach((line) => {
      writeOut(line);
    });
    return EXIT_OK;
  }
  const census = verdictCensus({ candidates });
  // UNCARDED is the one verdict over CLOSED rows, so the live count leaves it out and it is said on its own.
  const closedNote = census.UNCARDED > 0 ? `, ${String(census.UNCARDED)} closed row(s) uncarded` : "";
  writeOut(
    `sweep board: ${String(scanned)} doc(s) scanned, ${String(candidates.length - census.UNCARDED)} live row(s) swept${closedNote}`,
  );
  VERDICT_ORDER.forEach((name) => {
    writeOut(`  ${name.padEnd(13)} ${String(census[name])}`);
  });
  if (shown.length === 0) {
    writeOut("");
    writeOut("Nothing to act on.");
    return EXIT_OK;
  }
  printGroups({ shown, writeOut });
  writeOut("");
  writeOut(
    "Act on one with `slopweaver sweep apply <slug> --session <text>`; every act is journalled and findable. " +
      "ORPHANED and SUPERSEDED settle as declined, their alone: they need their --reason and --anchor.",
  );
  return EXIT_OK;
}
