/**
 * The pure half of `slopweaver dev capture-conflicts`: the flag spec, the streaming tally, and the rendering.
 *
 * What it counts is the population {@link ../../../corpus/latestRecords.supersedes}'s first tie-break governs
 * — one logical entity holding, at the SAME instant and with the SAME text, both a row that declares
 * `capture: "partial"` and a row that does not. Bronze is append-only, so both rows are permanently on disk
 * and one of them has to be chosen on the way out; before the marker rule existed the longer row won, and the
 * marker is exactly what makes the truncated row longer.
 *
 * The tally is streaming and holds one small entry per (identity, instant, text) rather than a record, so it
 * measures a corpus far larger than it could load — which is the whole point of running it against the real
 * one rather than a fixture.
 */
import { createHash } from "node:crypto";

import { identityOf } from "../../../corpus/latestRecords.js";
import { CAPTURE_ATTR, CAPTURE_PARTIAL, type CorpusRecord, type CorpusSource } from "../../../corpus/types.js";
import { BRONZE_SOURCES } from "../../../integrations/corpusSources.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

export const DEV_CAPTURE_CONFLICTS_USAGE =
  "usage: slopweaver dev capture-conflicts --source <github|slack|linear|notion|gmail|self> [--home <dir>] [--json]\n" +
  "  Count the rows where one entity holds BOTH a capture that declares itself partial and a complete one at\n" +
  "  the same instant with the same text — the population latestRecords.supersedes's marker tie-break decides.\n" +
  "  Reports how many of those the repaired row now wins, which before the rule the truncated row won because\n" +
  "  the marker is what made it longer. Streams bronze; holds a digest per version, never a record.";

const FLAGS: FlagSpec = { boolean: ["json"], string: ["home", "source"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const DEV_CAPTURE_CONFLICTS_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: FLAGS }),
  ...booleanFlagsOf({ spec: FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `dev capture-conflicts` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseDevCaptureConflictsArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/**
 * The bronze source a `--source` value names. Required rather than defaulted, for the same reason
 * `dev dedup-index` requires it: silently picking one hides the source that would falsify the claim.
 *
 * @param value the flag's raw value (`undefined` when absent)
 * @returns the source, or the errors when the value names none
 */
export function parseCaptureConflictsSource({ value }: { value: string | undefined }): Result<CorpusSource> {
  if (value === undefined) {
    return err([`--source is required (one of ${BRONZE_SOURCES.join("|")})`]);
  }
  const match = BRONZE_SOURCES.find((candidate) => candidate === value);
  return match === undefined ? err([`--source must be one of ${BRONZE_SOURCES.join("|")}, got ${value}`]) : ok(match);
}

/** What one (identity, instant, text) group has been seen carrying. */
interface VersionSeen {
  partial: boolean;
  complete: boolean;
}

/**
 * The running tally, mutated one record at a time as bronze streams past.
 *
 * @internal — {@link emptyCaptureConflictTally} makes it and the verb's scan loop passes it between
 * {@link absorbCaptureRecord} and {@link deriveCaptureConflicts} without naming the shape.
 */
export interface CaptureConflictTally {
  /** Every row absorbed, corrupt lines excluded. */
  rows: number;
  /** Rows whose own attrs declare the capture partial. */
  partialRows: number;
  /** One entry per (identity, instant, text) group — the unit a marker tie-break is decided within. */
  readonly versions: Map<string, VersionSeen>;
}

/**
 * A fresh, empty tally.
 *
 * @returns a tally holding no rows and no version groups
 */
export function emptyCaptureConflictTally(): CaptureConflictTally {
  return { partialRows: 0, rows: 0, versions: new Map() };
}

/** How many hex characters of the sha256 the text digest keeps — 128 bits, as the writer's dedup digest does. */
const TEXT_DIGEST_HEX = 32;

/**
 * The key one version group is tallied under: the logical identity, the instant, and the text.
 *
 * The TEXT is part of the key rather than compared afterwards because that is exactly the guard the rule
 * carries — a partial row and a complete row whose bodies differ are decided on content length, not on the
 * marker, so they are not this population and must not be counted as it. Pure.
 *
 * @param record the record to key
 * @returns the group key
 */
export function captureVersionKey({ record }: { record: CorpusRecord }): string {
  const identity = identityOf({ container: record.container, source: record.source, sourceId: record.sourceId });
  const digest = createHash("sha256").update(record.text, "utf8").digest("hex").slice(0, TEXT_DIGEST_HEX);
  return [identity, record.tsIso, digest].join(" ");
}

/**
 * Absorb one bronze record into the tally. Pure in the sense that matters here — it touches only the tally
 * handed to it, so the whole count is testable without a corpus on disk.
 *
 * @param record the record to absorb
 * @param tally the running tally, mutated in place
 */
export function absorbCaptureRecord({ record, tally }: { record: CorpusRecord; tally: CaptureConflictTally }): void {
  tally.rows += 1;
  const partial = record.attrs?.[CAPTURE_ATTR] === CAPTURE_PARTIAL;
  if (partial) {
    tally.partialRows += 1;
  }
  const seen = versionGroup({ key: captureVersionKey({ record }), tally });
  if (partial) {
    seen.partial = true;
  } else {
    seen.complete = true;
  }
}

/** The version group a key is tallied under, opened with neither kind of row seen on its first row. */
function versionGroup({ key, tally }: { key: string; tally: CaptureConflictTally }): VersionSeen {
  const seen = tally.versions.get(key);
  if (seen !== undefined) {
    return seen;
  }
  const opened: VersionSeen = { complete: false, partial: false };
  tally.versions.set(key, opened);
  return opened;
}

/** The finished count, derived from a tally. */
export interface CaptureConflictCount {
  readonly source: CorpusSource;
  readonly rows: number;
  readonly partialRows: number;
  /** Distinct (identity, instant, text) groups seen. */
  readonly versions: number;
  /** Groups holding BOTH a partial and a complete row — the ones the marker tie-break decides. */
  readonly decidedByMarker: number;
  /** The paths the scan could not read; a count over a partial source is not one. */
  readonly unreadable: readonly string[];
}

/**
 * Derive the finished count from a tally. Pure.
 *
 * @param source the source that was scanned
 * @param tally the streamed tally
 * @param unreadable the bronze paths the scan could not read
 * @returns the count
 */
export function deriveCaptureConflicts({
  source,
  tally,
  unreadable,
}: {
  source: CorpusSource;
  tally: CaptureConflictTally;
  unreadable: readonly string[];
}): CaptureConflictCount {
  let decidedByMarker = 0;
  for (const seen of tally.versions.values()) {
    if (seen.partial && seen.complete) {
      decidedByMarker += 1;
    }
  }
  return {
    decidedByMarker,
    partialRows: tally.partialRows,
    rows: tally.rows,
    source,
    unreadable,
    versions: tally.versions.size,
  };
}

/**
 * Render the count as the lines the verb prints. Pure.
 *
 * @param count the derived count
 * @returns the corpus line, the marker line, and one line per unreadable path
 */
export function renderCaptureConflicts({ count }: { count: CaptureConflictCount }): readonly string[] {
  return [
    `source: ${count.source} — ${String(count.rows)} row(s), ${String(count.partialRows)} declaring capture=partial, ` +
      `${String(count.versions)} distinct (identity, instant, text) group(s)`,
    `marker tie-break: ${String(count.decidedByMarker)} group(s) hold BOTH a partial and a complete row — the ` +
      "repaired row wins each of them, and won none of them before the rule",
    ...count.unreadable.map((path) => `unreadable: ${path} — this count covers less than the source holds`),
  ];
}
