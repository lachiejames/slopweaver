/**
 * Building a subset home — the effectful half of {@link ./subset}.
 *
 * ## It is a COPY, not a second pipeline
 *
 * Every byte written here came off the source home unchanged: the same JSONL lines, in the same per-source
 * layout, under the same {@link ../stateHome} contract. Nothing is re-projected, re-fingerprinted or
 * re-ordered, so a subset home is readable by exactly the readers a full home is — `derive`, `store read`,
 * `store cite`, `audit` — with no code of theirs knowing it exists. That is the constraint the whole
 * feature turns on: the moment a subset needed its own reader it would stop being a way to test the real
 * pipeline and become a second pipeline to test instead.
 *
 * ## What is time-filtered and what is copied whole
 *
 * Filtered by the window: `bronze/` (activity) and `history/` (activity events). Both are streams of dated
 * things, and a dated thing outside the window is exactly what a subset is for excluding.
 *
 * Copied whole: `members/`, `structures/`, the watermark family, and the small root files the query path
 * reads (`profile.json`, `judgement/`). These are SCAFFOLDING, not activity — a person who joined two years
 * ago is still a person, and a channel that existed before the window still explains the `container` on a
 * record inside it. Time-filtering them would give the subset a roster it could not resolve mentions against,
 * which reads as a retrieval defect and is not one. The human identity roster is not a file to copy: it lives
 * in the store, so a subset home reads the same row its store resolves to.
 *
 * NOT copied at all: `gold/`. Gold is distilled FROM the full corpus, so importing it would let a subset
 * answer from claims mined outside its own window while the manifest promised otherwise — the exact
 * confusion the banner exists to end. A subset's gold leg reports `absent`, which is true.
 *
 * ## Streaming, because the source runs to gigabytes
 *
 * Every read goes line-at-a-time through {@link readJsonlLines} and every write is a batched append, so peak
 * heap is one batch rather than one file. A single bronze file in a real corpus runs to several GB —
 * `readFileSync` on it does not merely cost memory, it exceeds V8's string limit outright.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { ALL_CORPUS_SOURCES, BRONZE_SOURCES } from "../integrations/corpusSources.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { stateHomePaths } from "../stateHome.js";
import { bronzeFile, bronzeSourceDir, historyDir, historyFile } from "./corpusPaths.js";
import { readJsonlLines } from "./corpusStore.js";
import {
  buildSubsetManifest,
  type SubsetManifest,
  type SubsetSourceTally,
  subsetWindow,
  windowVerdict,
} from "./subset.js";
import { type SubsetBuildError, SubsetBuildErrors } from "./subsetBuild.errors.js";
import { type LineSink, openCappedSink, openSink } from "./subsetSink.js";
import { writeSubsetManifest } from "./subsetStore.js";
import { type CorpusSource } from "./types.js";

/** The root-level home entries the query path reads, copied verbatim so a subset home can answer at all. */
const COPIED_ROOT_ENTRIES: readonly string[] = ["profile.json", "capability-profile.json", "judgement"];

/** What a caller watching a build is told as each source finishes. */
export interface SubsetProgress {
  readonly source: CorpusSource;
  readonly scanned: number;
  readonly kept: number;
}

/** What one filtered file contributed. */
interface FilterTally {
  readonly scanned: number;
  readonly kept: number;
  readonly undated: number;
  readonly newestIso: string | undefined;
}

/** The zero tally — the starting accumulator, and what an absent file contributes. */
const EMPTY_TALLY: FilterTally = { kept: 0, newestIso: undefined, scanned: 0, undated: 0 };

/**
 * Fold one file's tally into a running total, carrying the newer of the two `newestIso` values. The first
 * branch takes `add`'s value as it stands: either `into` has none, so `add`'s (or its absence) is the newest
 * there is, or `add`'s was tested present and newer.
 */
function addTally({ into, add }: { into: FilterTally; add: FilterTally }): FilterTally {
  const newestIso =
    into.newestIso === undefined || (add.newestIso !== undefined && add.newestIso > into.newestIso)
      ? add.newestIso
      : into.newestIso;
  return {
    kept: into.kept + add.kept,
    newestIso,
    scanned: into.scanned + add.scanned,
    undated: into.undated + add.undated,
  };
}

/**
 * Stream one JSONL file, writing every line inside the window to `sink`.
 *
 * A line that does not parse as JSON is counted as `undated` and dropped rather than copied blind: copying it
 * would put a row the window decision could not be made about into a home whose whole claim is a known window.
 */
function filterFile({
  from,
  sink,
  sinceIso,
  untilIso,
}: {
  from: string;
  sink: LineSink;
  sinceIso: string;
  untilIso: string;
}): FilterTally {
  let scanned = 0;
  let kept = 0;
  let undated = 0;
  let newestIso: string | undefined;
  readJsonlLines({
    onLine: ({ line }) => {
      if (line.trim().length === 0) {
        return;
      }
      scanned += 1;
      const parsed: unknown = parseOrUndefined({ line });
      const tsIso = isRecord(parsed) ? parsed["tsIso"] : undefined;
      const verdict = windowVerdict({ sinceIso, tsIso, untilIso });
      if (verdict === "undated") {
        undated += 1;
        return;
      }
      if (verdict === "out-of-window") {
        return;
      }
      kept += 1;
      const ts = String(tsIso);
      newestIso = newestIso === undefined || ts > newestIso ? ts : newestIso;
      sink.push({ line, tsIso: ts });
    },
    path: from,
  });
  return { kept, newestIso, scanned, undated };
}

/** `JSON.parse` that answers `undefined` instead of throwing — a malformed line is data, not an exception. */
function parseOrUndefined({ line }: { line: string }): unknown {
  const parsed = safeFs({ execute: (): unknown => JSON.parse(line), operation: "parseSubsetLine" });
  return parsed.isOk() ? parsed.value : undefined;
}

/** Every `.jsonl` file in a directory, sorted, or `[]` when the directory does not exist. */
function jsonlFilesIn({ dir }: { dir: string }): readonly string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .toSorted();
}

/** Copy the non-`.jsonl` sidecars a source directory carries (capture-coverage markers and the like). */
function copySourceSidecars({ from, to }: { from: string; to: string }): void {
  if (!existsSync(from)) {
    return;
  }
  const sidecars = readdirSync(from).filter((name) => !name.endsWith(".jsonl"));
  if (sidecars.length === 0) {
    return;
  }
  mkdirSync(to, { recursive: true });
  for (const name of sidecars) {
    const path = join(from, name);
    if (statSync(path).isFile()) {
      copyFileSync(path, join(to, name));
    }
  }
}

/** Slice one source's bronze into the subset home, returning its tally. */
function sliceSource({
  source,
  sourceHome,
  outHome,
  sinceIso,
  untilIso,
  limit,
}: {
  source: CorpusSource;
  sourceHome: string;
  outHome: string;
  sinceIso: string;
  untilIso: string;
  limit: number | undefined;
}): SubsetSourceTally {
  const from = bronzeSourceDir({ home: sourceHome, source });
  const path = bronzeFile({ home: outHome, source, window: { since: sinceIso, until: untilIso } });
  const sink = limit === undefined ? openSink({ path }) : openCappedSink({ limit, path });
  let tally = EMPTY_TALLY;
  for (const name of jsonlFilesIn({ dir: from })) {
    tally = addTally({ add: filterFile({ from: join(from, name), sinceIso, sink, untilIso }), into: tally });
  }
  const written = sink.written();
  sink.flush();
  copySourceSidecars({ from, to: bronzeSourceDir({ home: outHome, source }) });
  return {
    kept: written,
    scanned: tally.scanned,
    source,
    undated: tally.undated,
    ...(tally.newestIso !== undefined ? { newestIso: tally.newestIso } : {}),
    // Only when the cap actually bit. An `inWindow` equal to `kept` states nothing and would appear on every
    // capped source whether or not it was capped, which is exactly the kind of noise a reader learns to skip.
    ...(limit !== undefined && written < tally.kept ? { inWindow: tally.kept } : {}),
  };
}

/**
 * Slice the activity-history stream, which is dated exactly like bronze and filtered exactly like it —
 * including the cap.
 *
 * The cap matters here for a reason that is easy to miss: `--limit` alone widens the window to ten years, so
 * a window-only filter would copy the ENTIRE history stream into a home whose banner says it holds the newest
 * N records per source. Measured, that was several times more history than bronze. Capping both keeps the
 * home's contents matching its own description.
 */
function sliceHistory({
  sourceHome,
  outHome,
  sinceIso,
  untilIso,
  limit,
}: {
  sourceHome: string;
  outHome: string;
  sinceIso: string;
  untilIso: string;
  limit: number | undefined;
}): void {
  for (const name of jsonlFilesIn({ dir: historyDir({ home: sourceHome }) })) {
    // A history file is named for its source. An unrecognised name is SKIPPED rather than coerced: the
    // reader that consumes these keys on the same union, so copying a file it could never read forward would
    // add bytes to the subset and nothing else.
    const source = ALL_CORPUS_SOURCES.find((candidate) => `${candidate}.jsonl` === name);
    if (source === undefined) {
      continue;
    }
    const path = historyFile({ home: outHome, source });
    const sink = limit === undefined ? openSink({ path }) : openCappedSink({ limit, path });
    filterFile({ from: join(historyDir({ home: sourceHome }), name), sinceIso, sink, untilIso });
    sink.flush();
  }
}

/** Copy one path verbatim when it exists — a file or a whole directory. */
function copyIfPresent({ from, to }: { from: string; to: string }): void {
  if (existsSync(from)) {
    cpSync(from, to, { recursive: true });
  }
}

/** Copy the scaffolding a subset home needs to resolve people, containers and the owner lens. */
function copyScaffolding({ sourceHome, outHome }: { sourceHome: string; outHome: string }): void {
  const src = stateHomePaths({ home: sourceHome });
  const out = stateHomePaths({ home: outHome });
  copyIfPresent({ from: src.corpus.members, to: out.corpus.members });
  copyIfPresent({ from: src.corpus.structures, to: out.corpus.structures });
  copyIfPresent({ from: src.corpus.watermark, to: out.corpus.watermark });
  copyIfPresent({ from: src.corpus.githubReposWatermark, to: out.corpus.githubReposWatermark });
  copyIfPresent({ from: src.corpus.slackThreads, to: out.corpus.slackThreads });
  copyIfPresent({ from: src.corpus.slackChannelsWatermark, to: out.corpus.slackChannelsWatermark });
  copyIfPresent({ from: join(src.corpus.root, "watermarks"), to: join(out.corpus.root, "watermarks") });
  copyIfPresent({ from: src.homeVersion, to: out.homeVersion });
  for (const entry of COPIED_ROOT_ENTRIES) {
    copyIfPresent({ from: join(sourceHome, entry), to: join(outHome, entry) });
  }
}

/** The sources that actually have bronze on disk in the source home. */
function sourcesWithBronze({ sourceHome }: { sourceHome: string }): readonly CorpusSource[] {
  return BRONZE_SOURCES.filter(
    (source) => jsonlFilesIn({ dir: bronzeSourceDir({ home: sourceHome, source }) }).length > 0,
  );
}

/** Reject a destination that is the source itself, or that already holds a corpus. */
function checkDestination({
  sourceHome,
  outHome,
}: {
  sourceHome: string;
  outHome: string;
}): SubsetBuildError | undefined {
  if (resolve(outHome) === resolve(sourceHome)) {
    return SubsetBuildErrors.destinationIsSource({ home: resolve(outHome) });
  }
  return existsSync(stateHomePaths({ home: outHome }).corpus.bronze)
    ? SubsetBuildErrors.destinationOccupied({ outHome: resolve(outHome) })
    : undefined;
}

/**
 * Build a time-bounded subset of `sourceHome` into `outHome`.
 *
 * @param sourceHome the full corpus home to slice out of
 * @param outHome the empty home to write the subset into
 * @param days the window width — the rung on the ladder, and the only thing that changes to graduate
 * @param limit the per-source cap: keep only the newest N in-window records. Undefined means uncapped
 * @param now the instant the window is measured back from (injected, so the boundary is testable)
 * @param onProgress called once per source as it finishes, for a live line
 * @returns the manifest written into the subset home, or the typed reason the build did not happen
 */
export function buildSubset({
  sourceHome,
  outHome,
  days,
  now,
  limit,
  onProgress,
}: {
  sourceHome: string;
  outHome: string;
  days: number;
  now: Date;
  limit?: number | undefined;
  onProgress?: (progress: SubsetProgress) => void;
}): Result<SubsetManifest, SubsetBuildError> {
  const rejected = checkDestination({ outHome, sourceHome });
  if (rejected !== undefined) {
    return err(rejected);
  }
  const sources = sourcesWithBronze({ sourceHome });
  if (sources.length === 0) {
    return err(SubsetBuildErrors.noSourceCorpus({ sourceHome: resolve(sourceHome) }));
  }
  const { sinceIso, untilIso } = subsetWindow({ days, now });
  const built = safeFs({
    execute: () => {
      const tallies = sources.map((source) => {
        const tally = sliceSource({ limit, outHome, sinceIso, source, sourceHome, untilIso });
        onProgress?.({ kept: tally.kept, scanned: tally.scanned, source });
        return tally;
      });
      sliceHistory({ limit, outHome, sinceIso, sourceHome, untilIso });
      copyScaffolding({ outHome, sourceHome });
      return tallies;
    },
    operation: "buildSubset",
    path: resolve(outHome),
  });
  if (built.isErr()) {
    return err(SubsetBuildErrors.copyFailed({ cause: built.error.cause, path: built.error.path ?? resolve(outHome) }));
  }
  const manifest = buildSubsetManifest({
    builtAtIso: untilIso,
    days,
    sinceIso,
    sourceHome: resolve(sourceHome),
    sources: built.value,
    untilIso,
    ...(limit !== undefined ? { limit } : {}),
  });
  writeSubsetManifest({ home: outHome, manifest });
  return ok(manifest);
}
