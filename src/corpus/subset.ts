/**
 * The SUBSET — a time-bounded copy of the real corpus, in its own home, that the whole pipeline runs
 * against in minutes instead of a day.
 *
 * ## Why this exists
 *
 * Everything downstream of ingest — derive, the vector build, `store read`, the frozen eval set — is priced
 * against the full corpus, and the full corpus is 2.1 million records across 8.2 GB. Measured, `vectors status` against that home does not report a number at all: it REFUSES, because loading it
 * needs more live heap than the process ceiling allows. So the loop that matters — change the approach,
 * re-run, see whether it got better — costs a day, and a mistake costs the same day again before anyone
 * even knows it was a mistake.
 *
 * A subset makes that loop cost minutes. It is REAL data, sliced by time and nothing else: no sampling, no
 * synthesis, no per-source quota. `seed --demo` already owns the synthetic lane and this is deliberately not
 * that — a subset answers from the same records the full corpus would, it simply has fewer of them.
 *
 * ## Why the label is not optional
 *
 * A subset that answers without saying it is a subset is worse than no subset, because "we have no record of
 * that" and "that record is older than this home" are different facts and only one of them is about the
 * world. Every path that answers off a home carries {@link subsetBanner} — the coverage manifest, the
 * fan-out prompt the composing session reads, and the `store cite` slice — so a partial answer is never mistaken for the
 * full model. That is the whole reason the manifest is written into the home rather than passed as a flag: a
 * flag is something a caller can forget, and the home is something a reader cannot avoid.
 *
 * ## The ladder
 *
 * `--days` is the graduation: 7 days first, then 30, then 90, then all-time, each
 * rung gated on the owner actually dogfooding the one below, because running before crawling hides what the
 * smaller rung would have shown. So a wider window is a different value for one flag, never new work, and nothing in this module
 * knows or cares which rung it is on.
 *
 * Pure module — no I/O, no clock. The caller supplies the records, the window and the capture time.
 */
import { ALL_CORPUS_SOURCES } from "../integrations/corpusSources.js";
import { isRecord } from "../lib/parsers.js";
import { type CorpusSource } from "./types.js";

/** The manifest schema version. Bumped when a field changes meaning, never when a subset is rebuilt. */
export const SUBSET_MANIFEST_VERSION = 1;

/** Milliseconds in a day — the unit `--days` is converted through. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The window width a COUNT-ONLY build records.
 *
 * Ten years, which is past the oldest record any connector here has ever written, so the cap is the only
 * thing that binds. It exists because `--limit 100` has to mean what the owner meant by it — _"the most
 * recent 100 records from each corpus"_ — rather than "the most recent 100 that also fall inside a 7-day
 * window", which would quietly return fewer than 100 and read as a broken cap.
 *
 * A sentinel rather than an optional `days`, deliberately: every subset then has ONE description of what it
 * cut on, and a reader never has to work out what an absent window meant. {@link subsetBanner} phrases a
 * build at this width by its cap, because "the last 3,650 days" is true and useless.
 */
export const LIMIT_ONLY_DAYS = 3650;

/** What one source contributed to a subset, and what it declined. */
export interface SubsetSourceTally {
  readonly source: CorpusSource;
  /** Rows read off the source home for this source. */
  readonly scanned: number;
  /** Rows inside the window, written to the subset home. */
  readonly kept: number;
  /**
   * Rows inside the window BEFORE a `--limit` cap, when one was applied.
   *
   * Optional and additive: absent on an uncapped build, where it would equal `kept` and say nothing. Present
   * on a capped one, because "kept 500" without "of 12,200 in the window" is a count that hides its own
   * selection.
   */
  readonly inWindow?: number;
  /** Rows whose `tsIso` was missing or unparseable — kept OUT of the window decision, and counted. */
  readonly undated: number;
  /** The newest `tsIso` this source contributed, when it contributed anything. */
  readonly newestIso?: string;
}

/**
 * The record written to `<home>/corpus/.subset.json`, and the thing every answer path reads to find out it
 * is answering off a subset.
 */
export interface SubsetManifest {
  readonly version: number;
  /** The window width as the caller asked for it — the rung on the ladder. */
  readonly days: number;
  /** Records at or after this instant were kept. */
  readonly sinceIso: string;
  /** The instant the window was measured back from (the build's "now"). */
  readonly untilIso: string;
  /** When the subset was built. */
  readonly builtAtIso: string;
  /** The home the records were sliced OUT of — so a reader can find the full corpus. */
  readonly sourceHome: string;
  /** One tally per source that had bronze in the source home, in {@link ALL_CORPUS_SOURCES} order. */
  readonly sources: readonly SubsetSourceTally[];
  /**
   * The per-source record cap, when `--limit` was given.
   *
   * The need is a count limit as well as a date limit, for fast feedback loops that unblock dogfooding. A window is a statement
   * about the world and its size is whatever the world did that week; a cap is a statement about the BUILD,
   * and it makes slice time, disk and embed time deterministic before anything runs. Both are here because
   * they answer different questions, and a dogfood loop wants the second one.
   *
   * Optional and additive: absent means uncapped, which is what every window-only build is.
   */
  readonly limit?: number;
}

/**
 * The window a `--days` value names, measured back from an injected instant. Pure — the clock enters at the
 * shell and never below it, so the boundary is testable against a fixed `now`.
 *
 * @param days how many days back the window reaches
 * @param now the instant to measure back from
 * @returns the inclusive `[sinceIso, untilIso]` window
 */
export function subsetWindow({ days, now }: { days: number; now: Date }): { sinceIso: string; untilIso: string } {
  return {
    sinceIso: new Date(now.getTime() - days * MS_PER_DAY).toISOString(),
    untilIso: now.toISOString(),
  };
}

/**
 * Whether a record's timestamp falls inside the window.
 *
 * An UNDATED record (no `tsIso`, or one that does not parse) is excluded and counted separately rather than
 * silently kept or silently dropped. Keeping it would put a record of unknown age into a home whose whole
 * claim is that it holds a known age range; dropping it uncounted would make the subset quietly lossier than
 * its own manifest says.
 *
 * The upper bound is checked as well as the lower one, because a corpus really does carry records stamped in
 * the future (a provider clock, a bad projection), and a subset that silently admits them is a subset whose
 * stated window is false.
 *
 * @param tsIso the record's timestamp, as read off the line
 * @param sinceIso the window's inclusive start
 * @param untilIso the window's inclusive end
 * @returns `in-window`, `out-of-window`, or `undated`
 */
export function windowVerdict({
  tsIso,
  sinceIso,
  untilIso,
}: {
  tsIso: unknown;
  sinceIso: string;
  untilIso: string;
}): "in-window" | "out-of-window" | "undated" {
  if (typeof tsIso !== "string" || Number.isNaN(Date.parse(tsIso))) {
    return "undated";
  }
  return tsIso >= sinceIso && tsIso <= untilIso ? "in-window" : "out-of-window";
}

/**
 * Build the manifest for a completed subset. Pure.
 *
 * @param days the window width the caller asked for
 * @param limit the per-source record cap, when one was applied
 * @param sinceIso the window's inclusive start
 * @param untilIso the window's inclusive end
 * @param builtAtIso when the build finished
 * @param sourceHome the home the records were sliced out of
 * @param sources one tally per source with bronze in the source home
 * @returns the manifest to write into the subset home
 */
export function buildSubsetManifest({
  days,
  sinceIso,
  untilIso,
  builtAtIso,
  sourceHome,
  sources,
  limit,
}: {
  days: number;
  sinceIso: string;
  untilIso: string;
  builtAtIso: string;
  sourceHome: string;
  sources: readonly SubsetSourceTally[];
  limit?: number | undefined;
}): SubsetManifest {
  return {
    builtAtIso,
    days,
    sinceIso,
    sourceHome,
    sources,
    untilIso,
    version: SUBSET_MANIFEST_VERSION,
    ...(limit !== undefined ? { limit } : {}),
  };
}

/** Rows kept across every source. */
function totalKept({ manifest }: { manifest: SubsetManifest }): number {
  return manifest.sources.reduce((sum, tally) => sum + tally.kept, 0);
}

/**
 * The ONE sentence every answer path prints when the home it read is a subset.
 *
 * Deliberately a single line, and deliberately the same line everywhere: a reader who has seen it once in
 * the coverage manifest recognises it in a prompt, and a caller cannot render a softer version of it by
 * accident. It names the width, the window and the record count, because "this is a subset" on its own does
 * not tell anybody whether the thing they are missing is a week old or two years old.
 *
 * @param manifest the subset manifest read off the home
 * @returns the banner line
 */
export function subsetBanner({ manifest }: { manifest: SubsetManifest }): string {
  const kept = totalKept({ manifest });
  const from = `${String(kept)} record(s) sliced from ${manifest.sourceHome}.`;
  const tail = "Everything else is ABSENT from this home, not absent from the world.";
  if (manifest.limit !== undefined && manifest.days >= LIMIT_ONLY_DAYS) {
    return `SUBSET — this world model holds only the newest ${String(manifest.limit)} record(s) per source, ${from} ${tail}`;
  }
  const capped =
    manifest.limit === undefined ? "" : ` Capped to the newest ${String(manifest.limit)} record(s) per source.`;
  return (
    `SUBSET — this world model holds only the last ${String(manifest.days)} day(s) ` +
    `(${manifest.sinceIso} → ${manifest.untilIso}), ${from}${capped} ${tail}`
  );
}

/**
 * What the window was cut ON, said plainly, because it is not the same field in every source.
 *
 * Measured on the real corpus over a 7-day window: `tsIso` is the record's own observation
 * timestamp, and each connector fills it with whatever that source calls "when this last happened". For
 * Slack messages and GitHub comments/reviews that is CREATION — 11,077 of 11,256 GitHub records in the
 * window were genuinely created in it. For GitHub PR atoms, Linear issues/projects and Notion pages it is
 * LAST-UPDATED, so a page edited this week arrives however old it is: 10,637 of 12,200 Notion records in
 * that window (87%) were re-stamped rather than new, and 874 of 2,364 Linear ones.
 *
 * Stated rather than fixed, deliberately. Cutting on creation instead would need a second timestamp the
 * corpus does not carry ({@link ./types.CorpusRecord} has ONE `tsIso`), and "recently touched" is a
 * defensible thing for a dogfood slice to mean. What is not defensible is leaving a reader to assume it
 * means "recently written".
 *
 * @returns the sentence naming the field and its per-source meaning
 */
function subsetCutFieldNote(): string {
  return (
    "Cut on each record's own `tsIso`, which is CREATION for Slack messages and GitHub comments/reviews and " +
    "LAST-UPDATED for GitHub PR atoms, Linear issues/projects and Notion pages — so an old page edited " +
    "inside the window is in this home, and an old page nobody touched is not."
  );
}

/**
 * The sources that contributed NOTHING to the subset — present in the source home, but with no record inside
 * the window.
 *
 * Reported on its own rather than left to be inferred from a zero, because a source that is structurally
 * absent at this width is the single most misreadable thing about a subset: `self` records carry a file
 * mtime, so a 7-day window over a tree nothing has re-scanned in a fortnight contains none of them, and that
 * is a fact about the scanner rather than about the owner's writing.
 *
 * @param manifest the subset manifest
 * @returns the sources whose kept count is zero, in manifest order
 */
export function emptySubsetSources({ manifest }: { manifest: SubsetManifest }): readonly CorpusSource[] {
  return manifest.sources.filter((tally) => tally.kept === 0).map((tally) => tally.source);
}

/** A source line's newest instant: `newestIso` is set only when the source contributed, so "none" says it did not. */
function newestLabel({ tally }: { tally: SubsetSourceTally }): string {
  const { newestIso } = tally;
  if (newestIso == null) {
    return "none";
  }
  return newestIso;
}

/**
 * Render the manifest as human status lines. Pure — the shell just emits them, so the exact text is
 * unit-testable.
 *
 * @param manifest the subset manifest
 * @returns the lines to emit
 */
export function renderSubsetLines({ manifest }: { manifest: SubsetManifest }): readonly string[] {
  const lines = [subsetBanner({ manifest }), `built ${manifest.builtAtIso} · schema v${String(manifest.version)}`];
  lines.push(subsetCutFieldNote());
  for (const tally of manifest.sources) {
    const newest = newestLabel({ tally });
    const capped = tally.inWindow === undefined ? "" : ` (capped from ${String(tally.inWindow)} in window)`;
    lines.push(
      `  ${tally.source}: kept ${String(tally.kept)}${capped} of ${String(tally.scanned)} scanned` +
        `${tally.undated === 0 ? "" : `, ${String(tally.undated)} undated`} · newest ${newest}`,
    );
  }
  const empty = emptySubsetSources({ manifest });
  if (empty.length > 0) {
    lines.push(
      `  STRUCTURALLY ABSENT at this width: ${empty.join(", ")} — these sources have bronze in the full ` +
        "corpus but nothing inside the window, so an answer that needs them will find nothing here",
    );
  }
  return lines;
}

/** Read one numeric field, or `undefined` when it is absent or not a finite number. */
function num({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Read one string field, or `undefined` when it is absent or not a string. */
function str({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Parse one source tally, or `undefined` when any required field is missing or the wrong shape. */
function parseTally({ value }: { value: unknown }): SubsetSourceTally | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const source = ALL_CORPUS_SOURCES.find((candidate) => candidate === value["source"]);
  const scanned = num({ value: value["scanned"] });
  const kept = num({ value: value["kept"] });
  const undated = num({ value: value["undated"] });
  const newestIso = str({ value: value["newestIso"] });
  const inWindow = num({ value: value["inWindow"] });
  if (source === undefined || scanned === undefined || kept === undefined || undated === undefined) {
    return undefined;
  }
  return {
    kept,
    scanned,
    source,
    undated,
    ...(newestIso !== undefined ? { newestIso } : {}),
    ...(inWindow !== undefined ? { inWindow } : {}),
  };
}

/**
 * Parse a manifest read off disk.
 *
 * Returns `undefined` for anything that is not a well-formed manifest rather than a partially-filled one: a
 * home either states its window or it does not, and a half-read manifest would let a banner claim a window
 * nothing checked. A home with no manifest at all is the ordinary full-corpus case and reaches here as the
 * same `undefined`, which is why the caller treats absence as "not a subset" rather than as an error.
 *
 * @param value the parsed JSON read off the home
 * @returns the manifest, or `undefined` when the value is not one
 */
export function parseSubsetManifest({ value }: { value: unknown }): SubsetManifest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const version = num({ value: value["version"] });
  const days = num({ value: value["days"] });
  const sinceIso = str({ value: value["sinceIso"] });
  const untilIso = str({ value: value["untilIso"] });
  const builtAtIso = str({ value: value["builtAtIso"] });
  const sourceHome = str({ value: value["sourceHome"] });
  const rawSources = value["sources"];
  if (version !== SUBSET_MANIFEST_VERSION || days === undefined || !Array.isArray(rawSources)) {
    return undefined;
  }
  if (sinceIso === undefined || untilIso === undefined || builtAtIso === undefined || sourceHome === undefined) {
    return undefined;
  }
  const sources = rawSources.map((entry: unknown) => parseTally({ value: entry }));
  const limit = num({ value: value["limit"] });
  return sources.some((tally) => tally === undefined)
    ? undefined
    : {
        builtAtIso,
        days,
        sinceIso,
        sourceHome,
        sources: sources.filter((t) => t !== undefined),
        untilIso,
        version,
        ...(limit !== undefined ? { limit } : {}),
      };
}
