/**
 * The PURE core of `slopweaver subset`: flag parsing and both renderings. No fs, no clock, no console —
 * the shell ({@link ./run}) supplies `now`, does every read and write, and emits what these functions
 * return.
 */
import { emptySubsetSources, LIMIT_ONLY_DAYS, renderSubsetLines, type SubsetManifest } from "../../../corpus/subset.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, parseFlagTail, parsePositiveInteger } from "../../optionParsers.js";

/**
 * The default window width, in days.
 *
 * SEVEN, and it is an owner ruling rather than a round number: start at 7 days while confidence is being built, then graduate to 30
 * days, then 90 days, then all time, rather than running before crawling. The default is the
 * bottom rung on purpose, so the cheap thing is what happens when nobody chooses.
 */
export const DEFAULT_SUBSET_DAYS = 7;

/**
 * `subset build`'s flag SPEC — the repo-wide `--help`-truth ratchet reads the names derived from it below,
 * the same list the parser does. Two copies of a flag list is how a verb starts advertising a flag it does not
 * accept.
 */
const SUBSET_BUILD_FLAG_SPEC = {
  boolean: ["json"],
  value: ["home", "out", "days", "limit"],
} as const;

/** `subset status`'s flag SPEC, read by the ratchet the same way. */
const SUBSET_STATUS_FLAG_SPEC = { boolean: ["json"], value: ["home"] } as const;

/** Every flag `subset build` accepts, as the `--`-prefixed tokens a caller types. */
export const SUBSET_BUILD_FLAG_NAMES: readonly string[] = [
  ...SUBSET_BUILD_FLAG_SPEC.value.map((name) => `--${name}`),
  ...SUBSET_BUILD_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** Every flag `subset status` accepts, as the `--`-prefixed tokens a caller types. */
export const SUBSET_STATUS_FLAG_NAMES: readonly string[] = [
  ...SUBSET_STATUS_FLAG_SPEC.value.map((name) => `--${name}`),
  ...SUBSET_STATUS_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** The validated `subset build` invocation. */
export interface SubsetBuildOptions {
  /** The full corpus home to slice out of. */
  readonly home: string;
  /** The home to write the subset into. */
  readonly out: string;
  readonly days: number;
  /** Keep only the newest N in-window records per source. Absent means uncapped. */
  readonly limit?: number;
  readonly json: boolean;
}

/** The validated `subset status` invocation. */
export interface SubsetStatusOptions {
  readonly home: string;
  readonly json: boolean;
}

/**
 * Parse the `subset build` flag tail. Every rejection is accumulated, so one run reports everything wrong.
 * Pure.
 *
 * @param rest the argv tail (after `slopweaver subset build`)
 * @param defaultHome the source home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseSubsetBuildOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<SubsetBuildOptions> {
  const parsed = parseFlagTail({ rest, spec: SUBSET_BUILD_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const limit =
    values["limit"] === undefined
      ? undefined
      : parsePositiveInteger({ errors, label: "--limit", value: values["limit"] });
  // `--limit` on its own means "the newest N, full stop" — see {@link LIMIT_ONLY_DAYS}. An explicit `--days`
  // still wins, so the two compose: `--days 7 --limit 500` is "the newest 500 of this week".
  let days: number | undefined;
  if (values["days"] !== undefined) {
    days = parsePositiveInteger({ errors, label: "--days", value: values["days"] });
  } else if (limit !== undefined) {
    days = LIMIT_ONLY_DAYS;
  } else {
    days = DEFAULT_SUBSET_DAYS;
  }
  const out = values["out"];
  if (out === undefined) {
    errors.push("--out <dir> is required — a subset is a home of its own, never a mutation of the one it came from");
  }
  if (errors.length > 0 || out === undefined) {
    return err(errors);
  }
  return ok({
    days: days!,
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    out,
    ...(limit !== undefined ? { limit } : {}),
  });
}

/**
 * Parse the `subset status` flag tail. Pure.
 *
 * @param rest the argv tail (after `slopweaver subset status`)
 * @param defaultHome the home to read when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseSubsetStatusOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<SubsetStatusOptions> {
  const parsed = parseFlagTail({ rest, spec: SUBSET_STATUS_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { flags } = parsed.value;
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
  });
}

/** The record cap a subset was built under, or `null` for an uncapped build — one made without `--limit`. */
function manifestLimit({ manifest }: { manifest: SubsetManifest }): number | null {
  if (manifest.limit == null) {
    // Built without --limit: the window alone bounds it.
    return null;
  }
  return manifest.limit;
}

/**
 * The `--json` payload for both verbs — a projection of the same manifest the human lines render, never a
 * second description of it. Pure.
 *
 * @param manifest the subset manifest
 * @param home the home the manifest was read from or written to
 * @returns the JSON-serialisable payload
 */
export function subsetJson({
  manifest,
  home,
}: {
  manifest: SubsetManifest;
  home: string;
}): Readonly<Record<string, unknown>> {
  return {
    builtAtIso: manifest.builtAtIso,
    days: manifest.days,
    emptySources: emptySubsetSources({ manifest }),
    home,
    keptRecords: manifest.sources.reduce((sum, tally) => sum + tally.kept, 0),
    limit: manifestLimit({ manifest }),
    scannedRecords: manifest.sources.reduce((sum, tally) => sum + tally.scanned, 0),
    sinceIso: manifest.sinceIso,
    sourceHome: manifest.sourceHome,
    sources: manifest.sources,
    untilIso: manifest.untilIso,
    version: manifest.version,
  };
}

/**
 * The human report for a finished build: the manifest lines, then the exact next commands. Pure.
 *
 * The next-step lines are part of the output rather than documentation because the whole point of a subset
 * is the loop, and a loop whose next step lives in a doc is a loop somebody has to remember.
 *
 * @param manifest the manifest just written
 * @param out the subset home that was built
 * @param elapsedSeconds how long the slice took
 * @returns the lines to emit
 */
export function subsetBuildLines({
  manifest,
  out,
  elapsedSeconds,
}: {
  manifest: SubsetManifest;
  out: string;
  elapsedSeconds: number;
}): readonly string[] {
  return [
    ...renderSubsetLines({ manifest }),
    `sliced in ${elapsedSeconds.toFixed(1)}s → ${out}`,
    "next, against this home and nothing else:",
    `  slopweaver derive --home ${out}`,
    `  slopweaver store read "<question>" --home ${out}`,
  ];
}
