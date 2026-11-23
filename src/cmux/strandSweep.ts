/**
 * Which composers across the whole fleet are holding a line nobody submitted — the instrument behind the
 * owner's own question, and the half of the typed-unsent class `./reach.ts` cannot reach.
 *
 * ## Why a sweep exists beside the send-side fix
 *
 * `./reach.ts` stops NEW strands: it reads the composer back after every send and presses one bare Enter on
 * a line that never left it. It can do nothing about the ones already sitting there, and it never sees a
 * strand produced by a path other than `cmux send` — a spawn whose pickup went through `./spawn.ts`, a line
 * a person typed and walked away from, a host neither module was watching.
 *
 * A peer message typed into another session's composer and left unsent is not intended, and no verb asked
 * after it until this one. MEASURED by walking
 * `slopweaver cmux read-screen` over all 20 live workspaces by hand: **2 of 20 held `kind: "typed"` text**.
 * Reproduce with `slopweaver cmux strands`.
 *
 * ## The decision this module owns, and the one it does not
 *
 * Pure: workspaces and their composer readings in, a classified report out. The reading itself is
 * `./composer.ts`'s — decided on the FAINT attribute, so a `suggestion` Claude Code wrote itself is never
 * counted as a stranded line and is never a candidate for rescue. The socket
 * calls live in the verb.
 */
import type { ComposerReading } from "./composer.js";

/** One workspace's composer, as the sweep found it. */
export interface StrandRow {
  readonly workspaceRef: string;
  readonly workspaceId: string;
  /** The workspace's sidebar title, for a report a person reads. */
  readonly title: string | undefined;
  /** What `readComposer` said about the box. */
  readonly reading: ComposerReading;
}

/** What one sweep found, counted by the only distinction that decides an action. */
export interface StrandReport {
  /** Every row, in the order the workspaces were listed. */
  readonly rows: readonly StrandRow[];
  /** The rows holding a line a person's keystrokes (or a peer's send) put there and nothing submitted. */
  readonly stranded: readonly StrandRow[];
  /** How many workspaces were looked at at all — the denominator of the measurement. */
  readonly examined: number;
}

/**
 * Classify a sweep's raw readings into the report a caller prints or acts on.
 *
 * @param rows every workspace's composer reading
 * @returns the rows, the stranded subset, and the denominator
 */
export function classifyStrands({ rows }: { rows: readonly StrandRow[] }): StrandReport {
  return {
    examined: rows.length,
    rows,
    stranded: rows.filter((row) => row.reading.kind === "typed"),
  };
}

/**
 * The one summary line a sweep prints, naming the denominator so a zero is falsifiable.
 *
 * A bare "no stranded composers" is true of a fleet with no workspaces in it and of one the sweep could not
 * read, which is the over-claim every count in this repository is written to avoid.
 *
 * @param report what the sweep found
 * @returns the line to print
 */
export function describeStrandReport({ report }: { report: StrandReport }): string {
  const denominator = `${String(report.stranded.length)} of ${String(report.examined)} composer(s)`;
  if (report.stranded.length === 0) {
    return `cmux strands: ${denominator} are holding an unsubmitted line — nothing to press through`;
  }
  return (
    `cmux strands: ${denominator} are holding an unsubmitted line. Press one through with ` +
    `\`slopweaver cmux submit --workspace <ref>\`, or every one of them with \`--submit\``
  );
}

/**
 * The one line a report prints per row — every workspace, not only the stranded ones.
 *
 * An `unreadable` row is printed rather than dropped: it is a workspace whose composer this sweep could not
 * judge, and collapsing it into the clean ones would make the denominator a lie.
 *
 * @param row one workspace's reading
 * @returns the line to print
 */
export function describeStrandRow({ row }: { row: StrandRow }): string {
  const name = row.title === undefined ? row.workspaceRef : `${row.workspaceRef} (${row.title})`;
  if (row.reading.kind !== "typed") {
    return `  ${name}: ${row.reading.kind}`;
  }
  return `  ${name}: TYPED, unsubmitted — ${row.reading.text}`;
}
