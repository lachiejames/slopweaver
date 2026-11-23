/**
 * Round-trip fidelity — whether the bytes the renderer emitted are the bytes Linear actually stored.
 *
 * The verb already reads the issue back, and until now it used that read for one thing only: proving the
 * issue exists at the id we chose. The description it returned was passed straight into the ledger digest
 * and otherwise discarded. So a normalisation on ingest was absorbed in silence and became the new
 * baseline. An operator shown exact bytes by `--dry-run` had no way to learn the bytes had changed.
 *
 * MEASURED live against real Linear (issue SECU-66, 3 of 18 lines rewritten on create):
 *
 *  - every `-` bullet marker is rewritten to `*`;
 *  - a bare autolink `<url>` is expanded to `[url](<url>)` — note the brackets are KEPT, inside the link
 *    target. An earlier note recorded this as "angle brackets stripped", which direct measurement refutes.
 *
 * A fourth `+++` line, observed during the PR6 build, did not reproduce on that run — which is exactly why
 * this reports whatever it finds rather than checking a fixed list of known rewrites.
 *
 * ## Why this REPORTS rather than enforces
 *
 * "The bytes we send are the bytes Linear stores" is simply false, and a check asserting it would fail on
 * every well-formed issue. Linear owns its storage format. What the operator is entitled to is not
 * equality — it is *knowing*, so the useful question is "what did Linear change?", answered out loud.
 *
 * That also keeps the existing conflict guard correct rather than fighting it: the ledger goes on digesting
 * the STORED form, because comparing a later read against the sent form would report a phantom conflict on
 * every issue Linear normalised. Detection and the overwrite guard are different jobs.
 *
 * Pure and provider-free: no Linear call, no clock, no I/O.
 */

/** One line on which the sent and stored bodies disagree. Line numbers are 1-indexed. */
interface BodyDifference {
  readonly line: number;
  readonly sent: string | undefined;
  readonly stored: string | undefined;
}

/** What a round-trip did to the body. */
export interface FidelityReport {
  readonly identical: boolean;
  /** True when the read-back carried no description at all — a different thing from an empty one. */
  readonly missing: boolean;
  readonly sentLines: number;
  readonly storedLines: number;
  readonly differences: readonly BodyDifference[];
}

/** How many differing lines the operator report names individually before summarising the rest. */
export const MAX_REPORTED_DIFFERENCES = 5;

/**
 * Compare the body we sent against the body Linear stored, line by line.
 *
 * A `stored` of `undefined` is NOT collapsed into `""`: the read-back distinguishes "Linear stored an empty
 * description" from "the read returned none at all", and so does this. The second is reported as `missing`,
 * because treating a failed read as an emptied ticket is how a write gets reported against the wrong state.
 *
 * @param sent the markdown the renderer emitted and the mutation carried
 * @param stored the description the read-back returned, or `undefined` when it returned none
 * @returns the fidelity report; `identical` is true only for an exact byte match
 */
export function compareStoredBody({ sent, stored }: { sent: string; stored: string | undefined }): FidelityReport {
  const sentLines = sent.split("\n");
  if (stored === undefined) {
    return {
      differences: [],
      identical: false,
      missing: true,
      sentLines: sentLines.length,
      storedLines: 0,
    };
  }
  const storedLines = stored.split("\n");
  const differences: BodyDifference[] = [];
  const span = Math.max(sentLines.length, storedLines.length);
  for (let index = 0; index < span; index += 1) {
    const sentLine = sentLines[index];
    const storedLine = storedLines[index];
    if (sentLine !== storedLine) {
      differences.push({ line: index + 1, sent: sentLine, stored: storedLine });
    }
  }
  return {
    differences,
    identical: differences.length === 0,
    missing: false,
    sentLines: sentLines.length,
    storedLines: storedLines.length,
  };
}

/** Render one line for the report, making an absent line visibly absent rather than blank. */
function show({ text }: { text: string | undefined }): string {
  return text === undefined ? "(no such line)" : JSON.stringify(text);
}

/**
 * The operator-facing lines for a fidelity report. An identical round-trip says so in one line, because
 * silence would be indistinguishable from the check not having run.
 *
 * @param report what the round-trip did to the body
 * @returns the lines to print
 */
export function fidelityLines({ report }: { report: FidelityReport }): readonly string[] {
  if (report.missing) {
    return ["Linear returned no description on read-back, so the stored body could NOT be verified."];
  }
  if (report.identical) {
    return [`body verified: Linear stored all ${String(report.sentLines)} line(s) exactly as sent`];
  }
  const named = report.differences.slice(0, MAX_REPORTED_DIFFERENCES);
  const rest = report.differences.length - named.length;
  return [
    `Linear normalised the body: ${String(report.differences.length)} of ` +
      `${String(Math.max(report.sentLines, report.storedLines))} line(s) differ from what was sent.`,
    ...named.map(
      (d) => `  line ${String(d.line)}: sent ${show({ text: d.sent })} → stored ${show({ text: d.stored })}`,
    ),
    ...(rest > 0 ? [`  …and ${String(rest)} more`] : []),
    "The issue is filed; this is Linear's storage format, not an error. The ledger tracks the STORED form.",
  ];
}
