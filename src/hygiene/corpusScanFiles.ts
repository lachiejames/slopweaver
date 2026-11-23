/**
 * Which bronze files the corpus hygiene scan (`./corpusScan.ts`) reads: the one-level walk of the bronze layout, and
 * the owner's protect list judging every directory before it is listed and every file before it is opened, skipping
 * and naming what an entry covers.
 *
 * Its own module because the walk is the scan's only filesystem decision, and the one a protect-list refusal can stop:
 * the scan itself only reads what this hands it.
 */
import { join } from "node:path";

import {
  corpusWalkJudgeFor,
  type OwnerProtectionResolver,
  type ProtectedSkip,
  protectionResolver,
} from "../corpus/bronzeProtection.js";
import type { CorpusSource } from "../corpus/types.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * Whether a bronze path belongs to a source.
 *
 * Bronze is laid out `bronze/<source>/<window>.jsonl`, so the source is the FIRST path segment. Compared as
 * a whole segment rather than by prefix, so `gmail` can never match a future source whose name merely
 * starts the same way. Pure.
 *
 * @param file the bronze path, relative to the bronze root
 * @param source the source to filter to, or undefined for every source
 * @returns true when the file should be scanned
 */
export function fileMatchesSource({ file, source }: { file: string; source: CorpusSource | undefined }): boolean {
  if (!file.endsWith(".jsonl")) {
    return false;
  }
  return source === undefined || file.slice(0, file.indexOf("/")) === source;
}

/**
 * Every bronze JSONL path under the bronze root, as `<source>/<window>.jsonl`.
 *
 * Walks exactly ONE level down, which is the whole of the layout: a deeper walk would be inventing a shape
 * the writer does not produce, and a flat listing — the first version of this — enumerated the source
 * DIRECTORIES, matched none of them against `.jsonl`, and reported a clean scan over zero files. Caught by
 * running the verb, which is the only way that class of nothing-happened is ever caught.
 *
 * @param bronze the bronze root
 * @param listFiles the injected directory lister
 * @returns the relative paths, unsorted
 */
function bronzeFiles({
  bronze,
  listFiles,
}: {
  bronze: string;
  listFiles: (args: { dir: string }) => readonly string[];
}): readonly string[] {
  let sources: readonly string[];
  try {
    sources = listFiles({ dir: bronze });
  } catch {
    return [];
  }
  return sources.flatMap((source) => {
    try {
      return listFiles({ dir: join(bronze, source) }).map((file) => `${source}/${file}`);
    } catch {
      return [];
    }
  });
}

/**
 * What one scan may read, and what the owner's protect list kept it from.
 *
 * @internal — the declared shape of {@link judgedBronzeFiles}'s success.
 */
export interface JudgedBronzeFiles {
  /** The relative paths to scan, sorted. */
  readonly files: readonly string[];
  /** Every path the walk left out because an entry covers it — never listed, never opened, always reported. */
  readonly protectedSkipped: readonly ProtectedSkip[];
}

/**
 * The bronze files one scan reads, sorted, every one judged by the owner's protect list first.
 *
 * The bronze root is judged as a `list` and REFUSED when an entry covers it. Each source directory is then judged as
 * a `list` BEFORE it is listed, under its resolved spelling too, and each file as a read before it is handed out; a
 * covered one is SKIPPED and named, so a source symlinked into a protected tree is never listed and one `no-access`
 * source never refuses the scan of every other.
 *
 * @param bronze the bronze root
 * @param home the Slopweaver home whose protect list applies, beside the account's own
 * @param listFiles the injected directory lister
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @param source the source to filter to, or undefined for every source
 * @returns the relative paths to scan and what was skipped, or the protect list's refusal of the root
 */
export function judgedBronzeFiles({
  bronze,
  home,
  listFiles,
  protection,
  source,
}: {
  bronze: string;
  home: string;
  listFiles: (args: { dir: string }) => readonly string[];
  protection: OwnerProtectionResolver | undefined;
  source: CorpusSource | undefined;
}): Result<JudgedBronzeFiles> {
  const judged = corpusWalkJudgeFor({
    operation: { target: "the corpus", verb: "scan" },
    protection: protectionResolver({ home, protection }),
  }).andThen((walk) => walk.judge({ access: "list", path: bronze }).map(() => walk));
  if (judged.isErr()) {
    return err(judged.error);
  }
  const walk = judged.value;
  const protectedSkipped: ProtectedSkip[] = [];
  const judgedList = ({ dir }: { dir: string }): readonly string[] => {
    if (dir === bronze) {
      return listFiles({ dir });
    }
    // A source the filter leaves out is never listed, so a skip is only ever reported for a source the scan wanted.
    if (source !== undefined && dir !== join(bronze, source)) {
      return [];
    }
    const entry = walk.coverOf({ access: "list", path: dir });
    if (entry !== undefined) {
      protectedSkipped.push({ entry, path: dir });
      return [];
    }
    return listFiles({ dir });
  };
  const listed = bronzeFiles({ bronze, listFiles: judgedList }).filter((file) => fileMatchesSource({ file, source }));
  const files: string[] = [];
  for (const file of listed.toSorted()) {
    const path = join(bronze, file);
    const entry = walk.coverOf({ access: "read", path });
    if (entry === undefined) {
      files.push(file);
    } else {
      protectedSkipped.push({ entry, path });
    }
  }
  return ok({ files, protectedSkipped: protectedSkipped.toSorted((a, b) => a.path.localeCompare(b.path)) });
}
