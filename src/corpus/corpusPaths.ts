/**
 * Leaf paths within the corpus (per-source, per-window). The corpus ROOTS (bronze/silver/gold/cache/
 * watermark) come from the one home-path contract, {@link stateHomePaths} — this module only builds the
 * finer paths under them, so the writer and reader can never disagree and no home path is derived twice.
 *
 *   $SLOPWEAVER_HOME/corpus/
 *   ├── bronze/<source>/<since>_<until>.jsonl   # CorpusRecord lines
 *   ├── silver/index/{directory,opportunities,identities}.json
 *   ├── silver/digests/<source>.json            # distilled per-source digests
 *   ├── gold/{overview,where-to-look}.md + gold/by-source/<source>.md
 *   ├── .cache/                                 # rebuildable scratch (distil digests)
 *   ├── .cache/distil/batches.json              # content-hash digest cache (rebuildable)
 *   └── .watermark.json                         # per-source resume cursor
 */
import { join } from "node:path";

import { slopweaverHome } from "../config.js";
import type { IdentitySource } from "../silver/identity.js";
import { stateHomePaths } from "../stateHome.js";
import type { CorpusSource, ExportWindow } from "./types.js";

/**
 * The bronze root (all sources) under the home.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute bronze directory path
 */
export function bronzeDir({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).corpus.bronze;
}

/**
 * The bronze dir for one source.
 *
 * @param source the corpus source
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute per-source bronze directory path
 */
export function bronzeSourceDir({ source, home = slopweaverHome() }: { source: CorpusSource; home?: string }): string {
  return join(bronzeDir({ home }), source);
}

/**
 * The member (person) bronze root — a SIBLING of `bronze` (see {@link stateHomePaths}). Member rows never
 * enter the `CorpusRecord` reader, which recurses `bronze/`.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute member bronze directory path
 */
function memberDir({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).corpus.members;
}

/**
 * The member bronze JSONL file for one source (`members/<source>.jsonl`). One file per source, appended.
 *
 * @param source the identity source
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute member JSONL file path
 */
export function memberFile({ source, home = slopweaverHome() }: { source: IdentitySource; home?: string }): string {
  return join(memberDir({ home }), `${source}.jsonl`);
}

/**
 * The structural (person-scaffolding) bronze root — a SIBLING of `bronze` (see {@link stateHomePaths}).
 * Structure rows (org/team/repo/channel/…) never enter the `CorpusRecord` reader, which recurses `bronze/`.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute structure bronze directory path
 */
function structureDir({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).corpus.structures;
}

/**
 * The structure bronze JSONL file for one source (`structures/<source>.jsonl`). One file per source, appended.
 *
 * @param source the identity source
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute structure JSONL file path
 */
export function structureFile({ source, home = slopweaverHome() }: { source: IdentitySource; home?: string }): string {
  return join(structureDir({ home }), `${source}.jsonl`);
}

/**
 * The ACTIVITY-HISTORY bronze root — a SIBLING of `bronze` (see {@link stateHomePaths}). History events never
 * enter the `CorpusRecord` reader, which recurses `bronze/`, and here that is the correctness guarantee rather
 * than a tidiness one: a one-line event can outrank the issue it belongs to under BM25 × recency.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute history directory path
 */
export function historyDir({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).corpus.history;
}

/**
 * The history JSONL file for one source (`history/<source>.jsonl`). One file per source, appended.
 *
 * @param source the corpus source
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute history JSONL file path
 */
export function historyFile({ source, home = slopweaverHome() }: { source: CorpusSource; home?: string }): string {
  return join(historyDir({ home }), `${source}.jsonl`);
}

/**
 * The per-repo GitHub org-mode watermark file (`owner/repo` → cursor). Separate from the per-source
 * watermark so a busy repo can't advance the whole org (see {@link stateHomePaths}.githubReposWatermark).
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute per-repo watermark file path
 */
export function githubReposWatermarkPath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).corpus.githubReposWatermark;
}

/**
 * The consolidated silver structure directory/graph derive writes (`silver/index/structures.json`) — the
 * org-graph surface (orgs/teams/repos/channels/workflow-states/cycles + their relations) for PR10/PR18.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute structures JSON file path
 */
export function silverStructuresPath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return join(silverIndexDir({ home }), "structures.json");
}

/**
 * The consolidated silver person dossier derive writes (`silver/index/people.json`) — the richer PR10/PR18
 * substrate (per canonical Person: identities + emails + aliases + attrs + raw member payloads), distinct
 * from the resolver-facing {@link silverIdentitiesPath}.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute people-dossier JSON file path
 */
export function silverPeoplePath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return join(silverIndexDir({ home }), "people.json");
}

/** Make an ISO/date string safe as a filename segment (`:` and `.` are illegal on some filesystems). */
function safeSegment({ value }: { value: string }): string {
  return value.replace(/[:.]/g, "-");
}

/**
 * The bronze JSONL file for one source + window.
 *
 * @param source the corpus source
 * @param window the export window
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute bronze JSONL file path
 */
export function bronzeFile({
  source,
  window,
  home = slopweaverHome(),
}: {
  source: CorpusSource;
  window: ExportWindow;
  home?: string;
}): string {
  const name = `${safeSegment({ value: window.since })}_${safeSegment({ value: window.until })}.jsonl`;
  return join(bronzeSourceDir({ home, source }), name);
}

/** The basename {@link bronzeCompactFile} gives every source's canonical compacted file. */
export const BRONZE_COMPACT_BASENAME = "compact.jsonl";

/**
 * The canonical compacted file first, then window files by code unit. Positional because
 * `Array.prototype.toSorted` dictates a comparator's signature. Pure.
 */
function byBronzeReadOrder(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a === BRONZE_COMPACT_BASENAME) {
    return -1;
  }
  if (b === BRONZE_COMPACT_BASENAME) {
    return 1;
  }
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Order one bronze directory's entries so READ ORDER IS WRITE ORDER: the canonical compacted file first,
 * then window files by name.
 *
 * A plain sort was wrong, and the error was silent. Bronze's read order is what lets `latestRecords` break
 * a timestamp tie by recency, and a plain sort puts `compact.jsonl` AFTER every `2026-…jsonl` — while
 * compaction folds the OLD files into it and every window written afterwards is NEWER. Measured on the
 * owner's own corpus: a re-projection wrote 41 fresh meeting-transcript rows into
 * `2026-04-01_2026-08-31.jsonl`, and all 60 meetings still resolved to their superseded versions inside
 * `compact.jsonl` — 60 of 60 wrong, with nothing anywhere reporting it. Reproduce with
 * `src/__tests__/unit/corpus/bronzeReadOrder.test.ts`, which lays out that exact shape and reads it back
 * through the real store.
 *
 * Both callers use this: the reader ({@link ../corpus/corpusStore.scanJsonl}) and the on-disk listing the
 * compactor rewrites ({@link ../corpus/bronzeStorage.listBronzeFiles}). They must agree, because the
 * compactor streams its output in the order it read its input — so ordering the two differently would
 * write a canonical file with its newest rows in the middle, destroying the position signal for good. Pure.
 *
 * @param entries one directory's entry names, in any order
 * @returns the same names in bronze read order
 */
export function sortBronzeEntries({ entries }: { entries: readonly string[] }): readonly string[] {
  return entries.toSorted(byBronzeReadOrder);
}

/**
 * The CANONICAL compacted bronze file for one source (`bronze/<source>/compact.jsonl`) — where
 * {@link ../corpus/compact.compactSource} merges that source's overlapping window files. Deliberately NOT
 * a `<since>_<until>` name, so it can never collide with a window file a later refresh writes; the next
 * compaction simply folds those new windows back into it.
 *
 * @param source the corpus source
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute canonical compacted JSONL file path
 */
export function bronzeCompactFile({
  source,
  home = slopweaverHome(),
}: {
  source: CorpusSource;
  home?: string;
}): string {
  return join(bronzeSourceDir({ home, source }), BRONZE_COMPACT_BASENAME);
}

/**
 * The watermark file under the home.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute watermark file path
 */
export function watermarkPath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).corpus.watermark;
}

/**
 * The PER-SOURCE watermark file (`corpus/watermarks/<source>.json`). Each source writes ONLY its own file,
 * so concurrent per-source refreshes (onboard runs them in parallel) can never clobber each other's resume
 * cursor the way a single shared `.watermark.json` read-modify-write would. The legacy combined file stays
 * readable as a migration fallback (see {@link ../corpus/watermark.readWatermark}).
 *
 * @param source the corpus source
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute per-source watermark file path
 */
export function sourceWatermarkPath({
  source,
  home = slopweaverHome(),
}: {
  source: CorpusSource;
  home?: string;
}): string {
  return join(stateHomePaths({ home }).corpus.root, "watermarks", `${source}.json`);
}

/**
 * The silver index dir (directory / opportunities / identities JSON).
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute silver index directory path
 */
export function silverIndexDir({ home = slopweaverHome() }: { home?: string } = {}): string {
  return join(stateHomePaths({ home }).corpus.silver, "index");
}

/**
 * The DERIVED cross-source identity map derive writes (`silver/index/identities.json`) — distinct from the
 * human identity roster the store holds (`src/silver/identityRoster.ts`), which is the human OVERRIDE input. Derive reads the roster and writes this derived artifact for PR10/PR18 to consume.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute derived-identities JSON file path
 */
export function silverIdentitiesPath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return join(silverIndexDir({ home }), "identities.json");
}

/**
 * The silver digests dir (per-source distilled digests).
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute silver digests directory path
 */
export function silverDigestsDir({ home = slopweaverHome() }: { home?: string } = {}): string {
  return join(stateHomePaths({ home }).corpus.silver, "digests");
}

/**
 * The gold markdown dir.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute gold directory path
 */
export function goldDir({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).corpus.gold;
}

/**
 * The rebuildable cache dir (`.cache`, gitignored) — distil digests.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute cache directory path
 */
export function cacheDir({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).corpus.cache;
}

/**
 * The distil batch-cache file (content-hash → digest; rebuildable, gitignored).
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute distil cache file path
 */
export function distilCachePath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return join(cacheDir({ home }), "distil", "batches.json");
}

/**
 * The distil PROMPT-CONTRACT marker (`{ fingerprint }`) — a sibling of the digest cache recording which
 * distil contract the cached digests were produced under. Kept in its OWN file so it is purely additive: an
 * older home with no marker still reads, and the verb treats the absent marker as an unknown prior contract.
 * Without this, a prompt/schema change is undetectable — the batch keys simply all miss, with nothing to say
 * why the run is suddenly about to re-spend the whole corpus.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns the absolute marker path
 */
export function distilPromptMarkerPath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return join(cacheDir({ home }), "distil", "prompt-contract.json");
}
