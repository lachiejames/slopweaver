/**
 * THE SUBSTRATE SEAM — how the reflection loop's collectors touch the filesystem, and the two helpers every
 * one of them shares.
 *
 * ## Why the seam is a plain object of functions
 *
 * Every collector takes its path AND its {@link SubstrateReader} as arguments, so a test runs against an
 * in-memory fixture and never the operator's real ledgers. That is an injected seam, not a mock — the
 * testing rule bans `vi.mock`/`vi.spyOn`/`vi.fn` and permits exactly this. {@link createFsReader} is the one
 * production implementation and it is a dozen lines, which is the point: everything worth testing is on the
 * other side of it.
 *
 * ## Residue is not an error
 *
 * A {@link CollectorReading} carries what the read could NOT establish alongside what it found. An absent
 * ledger, a line that did not decode, a substrate known to be poisoned — none of those is a failure of the
 * read, and reporting them as errors would collapse them into the same bucket as a genuine fault. They
 * become the brief's mandatory could-not-verify section instead, because silence is never evidence of
 * correctness.
 */
import { readdirSync, readFileSync } from "node:fs";

import { isRecord } from "../lib/parsers.js";
import {
  clampDial,
  classKeyOf,
  type FrictionFinding,
  namedClassOf,
  namedClassOrOther,
  type ReflectSource,
} from "./finding.js";

/**
 * The filesystem seam every collector reads through.
 *
 * Both members return an EMPTY answer for something that is not there, rather than throwing: a home whose
 * loop has never run is missing most of these paths, and a first run must read as "nothing to see" rather
 * than as a broken installation.
 */
export interface SubstrateReader {
  /** One file's text, or `undefined` when it is absent or unreadable. */
  readonly readText: (path: string) => string | undefined;
  /** The entry names directly under a directory, or `[]` when it is absent or unreadable. */
  readonly listNames: (dir: string) => readonly string[];
}

/**
 * The production reader. The whole of the loop's filesystem contact, kept this small on purpose.
 *
 * @returns a reader over the real filesystem
 */
export function createFsReader(): SubstrateReader {
  return {
    listNames: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    readText: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}

/** The bounded slice of time one run reads. One calendar day by default; never unbounded. */
export interface ReflectWindow {
  readonly fromIso: string;
  readonly toIso: string;
}

/** An ISO-8601 date-time that names one instant: a `Z` or a `±hh:mm` offset, never a zoneless local time. */
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/**
 * Whether a timestamp names one real instant: the ISO shape, AND a calendar date that exists. `Date.parse` rolls
 * day 30 of February over into March rather than refusing it, so the date is rebuilt
 * and compared field by field.
 *
 * @param tsIso the timestamp as a record stored it
 * @returns whether it names one real instant every window test and duration may use
 */
export function namesAnInstant({ tsIso }: { tsIso: string }): boolean {
  const match = ISO_INSTANT.exec(tsIso);
  if (match === null) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Whether an instant falls inside the window, inclusive of both ends.
 *
 * Compared as INSTANTS, and only for an ISO-8601 date-time carrying `Z` or an explicit offset. A bare `Date`
 * round-trip would accept a timestamp in some other shape (a slash-separated date, a zoneless local time) and place it
 * wherever the parser landed, so any other shape is outside every window. String order was the earlier rule and
 * is wrong for an offset-form instant: a late-evening time at a negative offset sorts inside a window ending at midnight Z
 * while naming a time after that window's end.
 *
 * @param tsIso the instant to test
 * @param window the run's bounds
 * @returns whether the instant is inside them
 */
export function inWindow({ tsIso, window }: { tsIso: string; window: ReflectWindow }): boolean {
  if (!namesAnInstant({ tsIso })) {
    return false;
  }
  const at = Date.parse(tsIso);
  return at >= Date.parse(window.fromIso) && at <= Date.parse(window.toIso);
}

/** What reading one substrate produced, including everything it could not see. */
export interface CollectorReading {
  readonly source: ReflectSource;
  readonly findings: readonly FrictionFinding[];
  /** How many rows or files the collector looked at, so an empty result can be told from an absent one. */
  readonly rowsRead: number;
  /**
   * What this read could NOT establish, in the collector's own words. Never an error — these are the
   * mandatory could-not-verify lines, and silence is never evidence of correctness.
   */
  readonly residue: readonly string[];
}

/** How many evidence lines one finding carries below the fold. Bounded here, never by the renderer. */
export const EVIDENCE_LINES = 4;

/**
 * One raw observation, before anything is grouped.
 *
 * @internal
 */
export interface Sighting<TMeasure = never> {
  readonly classKey: string;
  readonly locus: string;
  readonly tsIso: string;
  readonly evidence: string;
  /** What this one observation measured, for a collector whose consequence is computed from its sightings. */
  readonly measure?: TMeasure;
}

/**
 * One class-and-locus group, as the two describers see it.
 *
 * @internal
 */
export interface SightingGroup<TMeasure> {
  readonly classKey: string;
  readonly locus: string;
  readonly count: number;
  readonly sample: string;
  readonly sightings: readonly Sighting<TMeasure>[];
}

/**
 * Group sightings into findings by class and locus, bounding the evidence each one carries.
 *
 * @internal
 * @param source which collector produced these
 * @param sightings the raw observations, in any order
 * @param impact the class's base cost of continuing to have this problem
 * @param safety how mechanically checkable a fix would be
 * @param cost how much a fix costs; it divides, so it is never zero
 * @param describe how to word what happened
 * @param consequence how to word what it measurably cost — absent, every finding it folds is unmeasured
 * @returns one finding per distinct class and locus
 */
export function foldSightings<TMeasure = never>({
  source,
  sightings,
  impact,
  safety,
  cost,
  describe,
  consequence,
}: {
  source: ReflectSource;
  sightings: readonly Sighting<TMeasure>[];
  impact: number;
  safety: number;
  cost: number;
  describe: (group: SightingGroup<TMeasure>) => string;
  consequence?: (group: SightingGroup<TMeasure>) => string | undefined;
}): readonly FrictionFinding[] {
  const groups = new Map<string, Sighting<TMeasure>[]>();
  for (const sighting of sightings) {
    const key = JSON.stringify([sighting.classKey, sighting.locus]);
    // The first sighting of a class and locus opens its group; every later one joins it.
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(sighting);
  }
  return [...groups.values()].map((group) => {
    const stamps = group.map((sighting) => sighting.tsIso).toSorted((a, b) => a.localeCompare(b));
    const first = group[0]!;
    const described: SightingGroup<TMeasure> = {
      classKey: first.classKey,
      count: group.length,
      locus: first.locus,
      sample: first.evidence,
      sightings: group,
    };
    return {
      classKey: first.classKey,
      consequence: consequence === undefined ? undefined : consequence(described),
      cost: clampDial({ value: cost }),
      coveredBy: [],
      evidence: [...new Set(group.map((sighting) => sighting.evidence))].slice(0, EVIDENCE_LINES),
      firstSeenIso: stamps[0]!,
      impact: clampDial({ value: impact }),
      knownBy: [],
      refutedBy: [],
      lastSeenIso: stamps[stamps.length - 1]!,
      locus: first.locus,
      occurrences: group.length,
      safety: clampDial({ value: safety }),
      source,
      summary: describe(described),
    };
  });
}

/**
 * Trim prose to one line of a bounded width, so evidence stays a line rather than a wall.
 *
 * @internal
 * @param text the prose to flatten
 * @param width the longest line to emit before eliding
 * @returns the flattened, bounded line
 */
export function oneLine({ text, width = 160 }: { text: string; width?: number }): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}

/**
 * The named class, or a stated fallback when the prose held nothing classifiable at all.
 *
 * @internal
 * @param text the prose to classify
 * @param fallback the class to use when the prose held no words at all
 * @returns the class key
 */
export function classOr({ text, fallback }: { text: string; fallback: string }): string {
  const key = namedClassOf({ text });
  return key.length > 0 ? key : fallback;
}

/**
 * The named class, or one of two stated fallbacks — never the per-event token mash {@link classOr} falls
 * back to. See {@link namedClassOrOther} for why: a substrate whose prose is free-written each time must not
 * fall back to a key built from its own one-off words, or every unmatched sighting mints a class that can
 * never recur.
 *
 * @internal
 * @param text the prose to classify
 * @param empty the class to use when the prose held no words at all
 * @param other the class to use when the prose held words but none matched a named class
 * @returns the class key
 */
export function classOrOther({ text, empty, other }: { text: string; empty: string; other: string }): string {
  const named = namedClassOrOther({ other: "", text });
  if (named.length > 0) {
    return named;
  }
  return classKeyOf({ text }).length > 0 ? other : empty;
}

/**
 * Every `.jsonl` name under a directory, sorted so two runs read in the same order.
 *
 * @internal
 * @param dir the directory to list
 * @param reader the filesystem seam
 * @returns the sorted names
 */
export function jsonlNames({ dir, reader }: { dir: string; reader: SubstrateReader }): readonly string[] {
  return reader
    .listNames(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .toSorted((a, b) => a.localeCompare(b));
}

/**
 * Decode one non-blank JSONL line, recovering from exactly one truncation shape: a line that stops one byte
 * short, missing only its closing `}`. MEASURED against the operator's real `loop-breakage.jsonl` (a
 * hand-appended ledger, per `collectAskedForMissing.ts`'s module header): 7 of 117 lines failed to decode,
 * and all seven shared this exact shape — a well-formed object whose last string value closes with a
 * real quote and then nothing, never a `}`. Reproduce:
 * `python3 -c "import json;[print(i) for i,l in
 * enumerate(open('$HOME/.slopweaver/ledgers/loop-breakage.jsonl'),1) if l.strip() and
 * (lambda: (json.loads(l),0))() ]" 2>&1 | grep -B0 'Expecting .,. delimiter'` then check each reported line's
 * last five characters end `."` rather than `"}`. The recovery is narrow on purpose: it only ever fires once
 * the untouched line has already failed to parse, and it only accepts the repair when appending a single `}`
 * makes the WHOLE line valid JSON — a line broken any other way still counts as unreadable rather than being
 * silently reinterpreted.
 *
 * @internal
 * @param line one raw JSONL line, already known non-blank
 * @returns the decoded record, or `undefined` when neither the line nor its one-brace repair parses
 */
function decodeJsonlLine({ line }: { line: string }): Readonly<Record<string, unknown>> | undefined {
  for (const candidate of [line, `${line}}`]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (isRecord(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Parse a JSONL text into records, skipping what does not decode, and count what was skipped.
 *
 * @internal
 * @param text the raw ledger contents
 * @returns the decoded records in file order, and how many lines were skipped
 */
export function jsonlRecords({ text }: { text: string }): {
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly skipped: number;
} {
  const records: Readonly<Record<string, unknown>>[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const decoded = decodeJsonlLine({ line });
    if (decoded === undefined) {
      skipped += 1;
      continue;
    }
    records.push(decoded);
  }
  return { records, skipped };
}

/**
 * A string field of a decoded record, or the empty string when it is absent or not a string.
 *
 * @internal
 * @param record the decoded row
 * @param key which field to read
 * @returns the string value, or the empty string
 */
export function field({ record, key }: { record: Readonly<Record<string, unknown>>; key: string }): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
