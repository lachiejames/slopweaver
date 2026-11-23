/**
 * The bronze ON-DISK view: which window files a source actually has, and how many bytes they occupy.
 * Read-only (no write primitive lives here, so it needs no seam sanction) and shared by the two callers
 * that must agree on "what is on disk": the compactor ({@link ./compact}) rewrites exactly this file set,
 * and `slopweaver audit` reports exactly this size — so the before/after measure and the thing that
 * changed can never be counting different files.
 *
 * The listing RECURSES, exactly as the reader ({@link ./corpusStore.readCorpusDir}) does. That matters:
 * if the two disagreed, `audit` could count a duplicate living in a nested file that `compact` never
 * reads — reporting a reduction that would never happen. The writer only ever creates flat per-window
 * files, so recursion normally finds the same set; when it doesn't, compaction folds the strays into the
 * canonical file rather than leaving records the reader can see and the compactor can't.
 *
 * The listing is JUDGED by the owner's protect list (`./bronzeProtection.ts`): the source directory and every entry
 * the walk meets as a search before it is listed or followed, each `.jsonl` as a read before it is handed out. A
 * refusal, or a protect list that cannot be read, is an `Err` — never an empty source, which every caller would
 * otherwise read as "nothing here" and carry on. It refuses the SOURCE rather than skipping inside it, on purpose:
 * the compactor rewrites exactly this file set, and a set missing a covered file would fold the rest into a canonical
 * file beside it. The refusal is per source, so {@link bronzeStorageBySource} names a protected source and measures
 * every other.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { slopweaverHome } from "../config.js";
import { BRONZE_SOURCES } from "../integrations/corpusSources.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  type CorpusJudge,
  corpusJudgeFor,
  type OwnerProtectionResolver,
  protectionResolver,
} from "./bronzeProtection.js";
import { bronzeSourceDir, sortBronzeEntries } from "./corpusPaths.js";
import { type CorpusSource } from "./types.js";

/** One bronze window file on disk. */
export interface BronzeFileStat {
  /** Absolute path to the `.jsonl` file. */
  readonly path: string;
  /** Its size in bytes. */
  readonly bytes: number;
}

/** What one source occupies on disk: how many window files, and their total bytes. */
export interface SourceStorage {
  readonly source: CorpusSource;
  readonly files: number;
  readonly bytes: number;
}

/**
 * The owner's protect list refuses part of the source, or cannot be read, so nothing under it was listed.
 *
 * @internal
 */
export interface BronzeListProtectedError {
  readonly code: "BRONZE_LIST_PROTECTED";
  /** The judge's own line (`./bronzeProtection.ts`), carried rather than reworded. */
  readonly message: string;
}

/**
 * A directory or entry under the source exists and could not be listed or statted.
 *
 * @internal
 */
export interface BronzeListUnreadableError {
  readonly code: "BRONZE_LIST_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way listing one source's bronze fails; a caller branches on which, since their fixes differ. */
export type BronzeListError = BronzeListProtectedError | BronzeListUnreadableError;

/**
 * The one place a {@link BronzeListError} is built.
 *
 * @internal
 */
export const BronzeListErrors = {
  protectedList: ({ lines }: { lines: readonly string[] }): BronzeListProtectedError => ({
    code: "BRONZE_LIST_PROTECTED",
    message: lines.join("; "),
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): BronzeListUnreadableError => ({
    code: "BRONZE_LIST_UNREADABLE",
    message: `could not list ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;

/** Whether a thrown filesystem error is "this path does not exist", which is not the same as "unreadable". */
function isNotFound({ error }: { error: unknown }): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * One step of the walk judged, its refusal typed.
 *
 * @param judge the operation's judge
 * @param access what the walk is about to do
 * @param path the path it is about to do it to
 * @returns nothing, or the typed refusal
 */
function judged({
  judge,
  access,
  path,
}: {
  judge: CorpusJudge;
  access: "read" | "search";
  path: string;
}): Result<void, BronzeListError> {
  return judge({ access, path }).mapErr((lines) => BronzeListErrors.protectedList({ lines }));
}

/**
 * One directory's entry names in bronze READ order, a missing directory listing as empty.
 *
 * What `strict` changes is the OTHER failure: a directory that exists and cannot be read. Lenient it lists as empty,
 * which is what the compactor and the audit report have always wanted; strict it is an `Err`, because a caller
 * measuring how far a store sits behind bronze would otherwise report an unreadable source as one with nothing
 * missing.
 *
 * @param dir the directory, already judged
 * @param strict refuse a directory that exists and cannot be read, instead of listing it as empty
 * @returns the names, sorted as the reader sorts them
 */
function entriesIn({ dir, strict }: { dir: string; strict: boolean }): Result<readonly string[], BronzeListError> {
  try {
    // The SAME order the reader uses ({@link ./corpusPaths.sortBronzeEntries}), because the compactor
    // rewrites exactly this file set and streams it out in the order it read it. Sorting the two differently
    // would let compaction write the canonical file with its newest rows in the middle, which destroys the
    // position signal `latestRecords` reads for good.
    return ok(sortBronzeEntries({ entries: readdirSync(dir) }));
  } catch (error: unknown) {
    if (strict && !isNotFound({ error })) {
      return err(BronzeListErrors.unreadable({ cause: error, path: dir }));
    }
    return ok([]); // never ingested (or, when lenient, unreadable) — an empty source, not a fault
  }
}

/**
 * Every `.jsonl` under `dir`, recursively, in bronze READ order, each step judged before it is taken.
 *
 * @param dir the directory to walk
 * @param strict refuse a directory that exists and cannot be read
 * @param judge refuses a step the owner's protect list covers
 * @returns the files, or the first refusal or failure
 */
function jsonlStatsIn({
  dir,
  strict,
  judge,
}: {
  dir: string;
  strict: boolean;
  judge: CorpusJudge;
}): Result<readonly BronzeFileStat[], BronzeListError> {
  const listed = judged({ access: "search", judge, path: dir }).andThen(() => entriesIn({ dir, strict }));
  if (listed.isErr()) {
    return err(listed.error);
  }
  const files: BronzeFileStat[] = [];
  for (const name of listed.value) {
    const found = entryStats({ judge, name, path: join(dir, name), strict });
    if (found.isErr()) {
      return found;
    }
    for (const file of found.value) {
      files.push(file);
    }
  }
  return ok(files);
}

/**
 * One entry of a walked directory: judged before `statSync` follows it, recursed into, kept as a `.jsonl`, or skipped.
 *
 * @param path the entry's path
 * @param name its basename, which decides whether a file is bronze
 * @param strict refuse a directory that exists and cannot be read
 * @param judge refuses a step the owner's protect list covers
 * @returns the files it contributes, or the first refusal or failure
 */
function entryStats({
  path,
  name,
  strict,
  judge,
}: {
  path: string;
  name: string;
  strict: boolean;
  judge: CorpusJudge;
}): Result<readonly BronzeFileStat[], BronzeListError> {
  const searched = judged({ access: "search", judge, path });
  if (searched.isErr()) {
    return err(searched.error);
  }
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (error: unknown) {
    return err(BronzeListErrors.unreadable({ cause: error, path }));
  }
  if (stat.isDirectory()) {
    return jsonlStatsIn({ dir: path, judge, strict });
  }
  if (!name.endsWith(".jsonl")) {
    return ok([]);
  }
  return judged({ access: "read", judge, path }).map(() => [{ bytes: stat.size, path }]);
}

/**
 * List one source's bronze `.jsonl` files with their sizes, recursively, in bronze READ order — the
 * canonical compacted file first, then window files by name ({@link ./corpusPaths.sortBronzeEntries}) — so
 * every consumer sees the same deterministic order, and the same one the reader sees. A source that was
 * never ingested lists as empty; one the owner's protect list covers is refused before anything is listed.
 *
 * @param source the corpus source
 * @param home the Slopweaver home (defaults to {@link slopweaverHome}), whose registry applies beside the account's
 * @param strict refuse a directory that exists and cannot be read, instead of listing it as empty
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the file stats in bronze read order, or the typed refusal or listing failure
 */
export function listBronzeFiles({
  source,
  home = slopweaverHome(),
  strict = false,
  protection,
}: {
  source: CorpusSource;
  home?: string;
  strict?: boolean;
  protection?: OwnerProtectionResolver | undefined;
}): Result<readonly BronzeFileStat[], BronzeListError> {
  return corpusJudgeFor({
    operation: { target: source, verb: "read" },
    protection: protectionResolver({ home, protection }),
  })
    .mapErr((lines) => BronzeListErrors.protectedList({ lines }))
    .andThen((judge) => jsonlStatsIn({ dir: bronzeSourceDir({ home, source }), judge, strict }));
}

/** One source the owner's protect list kept out of a footprint report, with the judge's own line. */
export interface ProtectedSourceStorage {
  readonly source: CorpusSource;
  /** The refusal line, which names the protect-list entry exactly as `protect list` prints its path. */
  readonly line: string;
}

/**
 * The per-source on-disk footprint across every source that HAS bronze, in {@link BRONZE_SOURCES} order.
 * Sources with no files on disk are omitted, so the report only names sources that actually occupy space.
 *
 * A source the owner's protect list covers, or holds a covered entry under, is never listed: it is reported in
 * `protectedSources`, so one protected source neither refuses the whole report nor reads as one occupying nothing.
 * An unreadable protect list still refuses, since then every source's protection is unknown.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the footprint of every source with bronze and the sources the protect list kept out, or the first failure
 */
export function bronzeStorageBySource({
  home = slopweaverHome(),
  protection,
}: {
  home?: string;
  protection?: OwnerProtectionResolver | undefined;
} = {}): Result<
  { storage: readonly SourceStorage[]; protectedSources: readonly ProtectedSourceStorage[] },
  BronzeListError
> {
  // Read once for the whole report, so an unreadable list refuses it outright rather than reading as every source
  // being protected.
  const known = protectionResolver({ home, protection })();
  const readable = corpusJudgeFor({ operation: { target: "the corpus", verb: "read" }, protection: () => known });
  if (readable.isErr()) {
    return err(BronzeListErrors.protectedList({ lines: readable.error }));
  }
  const storage: SourceStorage[] = [];
  const protectedSources: ProtectedSourceStorage[] = [];
  for (const source of BRONZE_SOURCES) {
    const files = listBronzeFiles({ home, protection: () => known, source });
    if (files.isErr() && files.error.code === "BRONZE_LIST_PROTECTED") {
      protectedSources.push({ line: files.error.message, source });
      continue;
    }
    if (files.isErr()) {
      return err(files.error);
    }
    if (files.value.length > 0) {
      const bytes = files.value.reduce((total, file) => total + file.bytes, 0);
      storage.push({ bytes, files: files.value.length, source });
    }
  }
  return ok({ protectedSources, storage });
}
