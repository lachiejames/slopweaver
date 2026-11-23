/*
 * Where the corpus IS, and what is there before anything is read.
 *
 * Two answers over the same scan, deliberately not one. {@link resolveCorpusDir} collapses "empty" and
 * "unreadable" into a single failure, which is what a caller that only checks `ok` wants.
 * {@link resolveCorpusScan} keeps them apart, which is what the query path needs: it refuses on one and
 * shrugs at the other.
 */

import { slopweaverHome } from "../config.js";
import { err, ok, type Result } from "../lib/result.js";
import type { OwnerProtectionResolver } from "./bronzeProtection.js";
import { bronzeDir } from "./corpusPaths.js";
import { type CorpusStoreError, CorpusStoreErrors } from "./corpusStore.errors.js";
import { scanJsonlProtected } from "./corpusStore.js";

/**
 * Resolve a readable corpus dir. `corpus` (an explicit dir) is used verbatim; otherwise the bronze dir
 * under `home`. Either way it must exist and hold ≥1 `.jsonl`, else `err` — so a wrong path fails loudly
 * instead of masquerading as an empty corpus.
 *
 * An UNREADABLE tree gets its own error text. Both used to say "no corpus found — run `slopweaver refresh`",
 * which sent a reader to re-fetch 112 MB when the actual fix was a `chmod`.
 *
 * @param home the Slopweaver home (used when `corpus` is absent)
 * @param corpus an explicit corpus directory override
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the resolved dir, or an error when it's absent/empty/unreadable or the owner's protect list refuses it
 */
export function resolveCorpusDir({
  home,
  corpus,
  protection,
}: {
  home?: string;
  corpus?: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<string, CorpusStoreError> {
  const resolved = resolveCorpusScan({
    ...(home !== undefined ? { home } : {}),
    ...(corpus !== undefined ? { corpus } : {}),
    protection,
  });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const resolution = resolved.value;
  if (resolution.unreadableDirs.length > 0) {
    return err(
      CorpusStoreErrors.dirUnreadable({ dir: resolution.dir, unreadableCount: resolution.unreadableDirs.length }),
    );
  }
  if (resolution.fileCount === 0) {
    return err(CorpusStoreErrors.dirNotFound({ dir: resolution.dir }));
  }
  return ok(resolution.dir);
}

/** What a corpus location looks like before anything is read: where it is, how much is there, what is unreadable. */
export interface CorpusResolution {
  readonly dir: string;
  readonly fileCount: number;
  /** Bytes of `.jsonl` under the root — what the heap guard projects from. */
  readonly diskBytes: number;
  readonly unreadableDirs: readonly string[];
}

/**
 * The directory a resolution reads, said out loud rather than through a chain of fallbacks.
 *
 * @param corpus an explicit override, which wins over the home whenever one was given
 * @returns the explicit corpus directory, or this home's bronze directory
 */
function corpusRootFor({ corpus, home }: { corpus: string | undefined; home: string }): string {
  if (corpus !== undefined) {
    return corpus;
  }
  return bronzeDir({ home });
}

/**
 * Locate a corpus dir and describe what is there, WITHOUT collapsing "empty" and "unreadable" into one
 * failure. {@link resolveCorpusDir} does collapse them — it returns a single `Result<string>`, so both
 * branches read as "no corpus" to a caller that only checks `ok`. A caller that must tell an absence from a
 * failure (the query path, which refuses on one and shrugs at the other) needs the two facts separately.
 *
 * The walk is judged by the owner's protect list (`scanJsonlProtected`), so a protected tree is `CORPUS_PROTECTED`
 * before a single entry under it is listed — never the empty or unreadable resolution it would otherwise read as.
 *
 * @param home the Slopweaver home (used when `corpus` is absent), whose protect list applies beside the account's own
 * @param corpus an explicit corpus directory override
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the resolved dir, how many `.jsonl` files it holds, and any directory that could not be listed, or the
 *   protect list's refusal
 */
export function resolveCorpusScan({
  home = slopweaverHome(),
  corpus,
  protection,
}: {
  home?: string;
  corpus?: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<CorpusResolution, CorpusStoreError> {
  const dir = corpusRootFor({ corpus, home });
  const scanned = scanJsonlProtected({ dir, home, operation: { target: "the corpus", verb: "read" }, protection });
  if (scanned.isErr()) {
    return err(CorpusStoreErrors.protectedRead({ dir, lines: scanned.error }));
  }
  const scan = scanned.value;
  return ok({
    dir,
    diskBytes: scan.files.reduce((sum, file) => sum + file.bytes, 0),
    fileCount: scan.files.length,
    unreadableDirs: scan.unreadableDirs,
  });
}
