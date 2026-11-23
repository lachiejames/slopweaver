/**
 * The pure half of `slopweaver store measurement-list`, `measurement-show` and `measurement-restore`: what
 * their flags mean, which stored copy each reads, and the lines each prints.
 *
 * No I/O, no clock, no store. `./measurementRun.ts`, `./measurementShowRun.ts` and `./measurementRestoreRun.ts` open the store, read the bodies and write
 * the files.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type MeasurementClass, parseMeasurementClass } from "../../../store/fleet/measurement.js";
import type { StoredMeasurementLocation } from "../../../store/fleet/measurementStore.js";
import { MEASUREMENT_CLASSES } from "../../../store/schema/measurement.js";
import { parseFlagTail } from "../../optionParsers.js";

/** The import every "the store holds nothing" line names — the one path by which a measurement reaches it. */
const MEASUREMENT_IMPORT_COMMAND = "slopweaver store import-fleet --only measurements";

export const MEASUREMENT_LIST_USAGE =
  "usage: slopweaver store measurement-list [--class <c>] [--prefix <path>] [--home <dir>] [--json]\n" +
  "\n" +
  "Lists every measurement location the store holds — one line per (path, body), newest body first within a\n" +
  `path — FROM THE STORE, never from disk. --class is one of ${MEASUREMENT_CLASSES.join(", ")}; --prefix is a\n` +
  "home-relative path prefix matched literally (`proof/1263`). Exits 3 when nothing matches.\n" +
  "\n" +
  "example: slopweaver store measurement-list --class proof --prefix proof/1263";

export const MEASUREMENT_SHOW_USAGE =
  "usage: slopweaver store measurement-show --ref <anchor|path|sha256> [--out <file>] [--home <dir>] [--json]\n" +
  "\n" +
  "Prints one measurement FROM THE STORE — never from disk, so a file the home no longer has still reads.\n" +
  "--ref takes an anchor in any spelling canon uses (`~/.slopweaver/evidence/…`, `$SLOPWEAVER_HOME/…`,\n" +
  "`state:…`, an absolute path, a trailing #fragment), a home-relative path, or a body's 64-hex sha-256. An\n" +
  "inline text body prints to stdout; a body held in Storage (an image, a non-UTF-8 file) needs --out, which\n" +
  "writes its exact bytes to <file>. --json prints where the body was found and, when inline, the body.\n" +
  "\n" +
  "example: slopweaver store measurement-show --ref ~/.slopweaver/proof/1263/gold.md";

export const MEASUREMENT_RESTORE_USAGE =
  "usage: slopweaver store measurement-restore --into <dir> [--class <c>] [--prefix <path>] [--dry-run] [--home <dir>] [--json]\n" +
  "\n" +
  "Writes the newest stored body of every selected path under <dir>, at its home-relative path, with its\n" +
  "recorded mtime — reading the store and Storage only. A file already there with the same bytes is skipped;\n" +
  "one with DIFFERENT bytes is never overwritten, named, and makes the verb exit 1. --dry-run reads no body\n" +
  "and writes nothing. Pointing --into at the home itself restores what a reclaim took.\n" +
  "\n" +
  "example: slopweaver store measurement-restore --into /tmp/restored --class evidence";

/** `measurement-list`'s flag tail — exported so `--help`'s advertised flags and the parser cannot drift. */
export const MEASUREMENT_LIST_FLAG_SPEC = {
  boolean: ["json"],
  value: ["class", "prefix", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** `measurement-show`'s flag tail. */
export const MEASUREMENT_SHOW_FLAG_SPEC = {
  boolean: ["json"],
  value: ["ref", "out", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** `measurement-restore`'s flag tail. */
export const MEASUREMENT_RESTORE_FLAG_SPEC = {
  boolean: ["dry-run", "json"],
  value: ["into", "class", "prefix", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** A parsed `measurement-list`. */
export interface MeasurementListArgs {
  readonly measurementClass: MeasurementClass | undefined;
  readonly prefix: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `measurement-show`. `ref` is checked by the shell, so a missing one is refused as usage. */
export interface MeasurementShowArgs {
  readonly ref: string | undefined;
  readonly out: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `measurement-restore`. `into` is checked by the shell, as `ref` is above. */
export interface MeasurementRestoreArgs {
  readonly into: string | undefined;
  readonly measurementClass: MeasurementClass | undefined;
  readonly prefix: string | undefined;
  readonly dryRun: boolean;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * The `--class` value as a class, refusing a word the table has no row for.
 *
 * @param value the raw `--class` value, when given
 * @returns the class or `undefined` when not given, or the refusal naming the four it may be
 */
function classOf({ value }: { value: string | undefined }): Result<MeasurementClass | undefined> {
  if (value === undefined) {
    return ok(undefined);
  }
  return parseMeasurementClass({ value }).mapErr((error) => [error.message]);
}

/**
 * Parse `measurement-list`'s flag tail.
 *
 * @param rest the argv after `store measurement-list`
 * @returns the arguments, or every rejection
 */
export function parseMeasurementListArgs({ rest }: { rest: readonly string[] }): Result<MeasurementListArgs> {
  const parsed = parseFlagTail({ rest, spec: MEASUREMENT_LIST_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return classOf({ value: values["class"] }).map((measurementClass) => ({
    home: values["home"],
    json: flags.has("json"),
    measurementClass,
    prefix: values["prefix"],
  }));
}

/**
 * Parse `measurement-show`'s flag tail.
 *
 * @param rest the argv after `store measurement-show`
 * @returns the arguments, or the tokeniser's own rejections
 */
export function parseMeasurementShowArgs({ rest }: { rest: readonly string[] }): Result<MeasurementShowArgs> {
  const parsed = parseFlagTail({ rest, spec: MEASUREMENT_SHOW_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({ home: values["home"], json: flags.has("json"), out: values["out"], ref: values["ref"] });
}

/**
 * Parse `measurement-restore`'s flag tail.
 *
 * @param rest the argv after `store measurement-restore`
 * @returns the arguments, or every rejection
 */
export function parseMeasurementRestoreArgs({ rest }: { rest: readonly string[] }): Result<MeasurementRestoreArgs> {
  const parsed = parseFlagTail({ rest, spec: MEASUREMENT_RESTORE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return classOf({ value: values["class"] }).map((measurementClass) => ({
    dryRun: flags.has("dry-run"),
    home: values["home"],
    into: values["into"],
    json: flags.has("json"),
    measurementClass,
    prefix: values["prefix"],
  }));
}

/**
 * One list line: the path, then what a reader needs to choose a body without reading it.
 *
 * @param location one stored location
 * @returns `<path>  <sha12>  <bytes> B  <placement>  <mtime>`
 */
export function measurementListLine({ location }: { location: StoredMeasurementLocation }): string {
  return [
    location.relativePath,
    location.bodySha256.slice(0, 12),
    `${String(location.byteLength)} B`,
    location.placement,
    location.fileModifiedAt.toISOString(),
  ].join("  ");
}

/**
 * The line every read that found nothing prints, naming the import that would have put it there.
 *
 * @param what the ref or filter as typed
 * @returns the diagnostic
 */
export function measurementNothingStoredLine({ what }: { what: string }): string {
  return `the store holds no measurement for ${what} — this verb never reads the disk copy; run \`${MEASUREMENT_IMPORT_COMMAND}\``;
}

/**
 * The newest-written body of each path: the first row per path, since the store reads a path's rows newest
 * first (`readMeasurementLocations`).
 *
 * @param locations every selected location, in the store's order
 * @returns one location per path, in path order
 */
export function newestPerPath({
  locations,
}: {
  locations: readonly StoredMeasurementLocation[];
}): readonly StoredMeasurementLocation[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    if (seen.has(location.relativePath)) {
      return false;
    }
    seen.add(location.relativePath);
    return true;
  });
}

/** What a restore does with one path. */
export type RestoreAction = "write" | "identical" | "differs";

/** One path's restore, decided before any body is read. */
export interface RestoreStep {
  readonly location: StoredMeasurementLocation;
  readonly target: string;
  readonly action: RestoreAction;
}

/**
 * What a restore does with a path, given what is already at its target.
 *
 * The one rule is that a file with DIFFERENT bytes is never replaced: a restore that silently overwrote a
 * newer measurement would destroy exactly the kind of record this table exists to keep.
 *
 * @param bodySha256 the stored body's hash
 * @param existingSha256 the hash of the file already at the target, or `undefined` when there is none
 * @returns `write` when nothing is there, `identical` when the same bytes are, `differs` otherwise
 */
export function restoreAction({
  bodySha256,
  existingSha256,
}: {
  bodySha256: string;
  existingSha256: string | undefined;
}): RestoreAction {
  if (existingSha256 === undefined) {
    return "write";
  }
  if (existingSha256 === bodySha256) {
    return "identical";
  }
  return "differs";
}

/** How many paths a restore wrote, skipped as identical, and refused to overwrite. */
export interface RestoreCounts {
  readonly written: number;
  readonly identical: number;
  readonly differs: number;
}

/**
 * Count a restore's steps by action.
 *
 * @param steps every path's step
 * @returns the three counts
 */
export function restoreCounts({ steps }: { steps: readonly RestoreStep[] }): RestoreCounts {
  return {
    differs: steps.filter((step) => step.action === "differs").length,
    identical: steps.filter((step) => step.action === "identical").length,
    written: steps.filter((step) => step.action === "write").length,
  };
}

/**
 * The summary line a restore ends on.
 *
 * @param into the directory restored into
 * @param counts what the steps came to
 * @param dryRun whether anything was actually written
 * @returns one line naming all three counts
 */
export function restoreSummaryLine({
  into,
  counts,
  dryRun,
}: {
  into: string;
  counts: RestoreCounts;
  dryRun: boolean;
}): string {
  const verb = dryRun ? "would write" : "wrote";
  return (
    `store measurement-restore: ${verb} ${String(counts.written)} file(s) under ${into}, ` +
    `${String(counts.identical)} already identical, ${String(counts.differs)} left alone because the file there differs`
  );
}
