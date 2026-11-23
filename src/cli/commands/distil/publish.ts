/**
 * Writing silver + gold from a COMPLETE digest cache.
 *
 * ## Why this is its own module
 *
 * Two callers need it and they arrive from opposite directions. `distil answer` reaches it when the answer it
 * just accepted was the last outstanding batch. `distil brief` reaches it when there is no outstanding batch
 * at all — every hash already cached, but the derived files missing.
 *
 * That second case is a real regression this module exists to close, and it was found by an adversarial
 * review pass rather than by use. Before the model was removed, a rerun of `distil` mapped the cached digests
 * back through the batch list, passed the completeness check and wrote gold. Afterwards, bare `distil`
 * aliased `distil brief`, which returned "nothing to distil" the moment every hash was cached — so a corpus
 * whose cache was complete but whose gold had never been written, or had been deleted, could never rebuild
 * it. The state is reachable exactly as it always was: kill the process after a per-batch cache checkpoint
 * and before the write.
 *
 * Reduction and rendering are unchanged and deliberately not reimplemented here — this module only decides
 * WHEN to run them and performs the writes.
 */

import type { CorpusSource } from "../../../corpus/types.js";
import type { BatchDigest } from "../../../gold/distil.js";
import { readSilverIndex } from "../../../silver/silverIndexRead.js";
import { buildDistilWritePlan, digestsInBatchOrder, shouldWriteGold, toSourceDigests } from "./core.js";

/**
 * Whether every batch in the plan has a cached digest, so the derived files can be written in full.
 *
 * @param batches every batch in the plan, in grouping order
 * @param cache the digest cache to measure the plan against
 * @returns true when nothing is outstanding and gold can be rendered
 */
export function cacheIsComplete({
  batches,
  cache,
}: {
  batches: readonly { readonly hash: string }[];
  cache: ReadonlyMap<string, BatchDigest>;
}): boolean {
  return shouldWriteGold({
    batchCount: batches.length,
    digestCount: digestsInBatchOrder({ batches, cache }).length,
  });
}

/**
 * Write every silver digest and gold document the cache can produce.
 *
 * The sequence fed to reduction is {@link digestsInBatchOrder}, which maps EVERY batch in `groupForDistil`'s
 * own order — duplicates included. Reducing over unique hashes instead would change multiplicity and order
 * into the reducer's `points.length` sort, and so would silently move a container's rank in gold.
 *
 * @param batches every batch in the plan, in grouping order
 * @param cache the digest cache, which the caller has already checked is complete
 * @param recordCountBySource how many collapsed records each source holds
 * @param home the state home to write under
 * @param builtAtIso the build timestamp to stamp into the written files
 * @param writeText the file-writing seam, injected so a test needs no filesystem
 * @param exists reports whether a path is already present, so a complete set is left alone
 * @returns how many silver and gold files were written; zeroes when the set was already complete
 */
export function publishFromCache({
  batches,
  cache,
  recordCountBySource,
  home,
  builtAtIso,
  writeText,
  exists,
}: {
  batches: readonly { readonly hash: string }[];
  cache: ReadonlyMap<string, BatchDigest>;
  recordCountBySource: ReadonlyMap<CorpusSource, number>;
  home: string;
  builtAtIso: string;
  writeText: ({ path, text }: { path: string; text: string }) => void;
  exists: ({ path }: { path: string }) => boolean;
}): { readonly silver: number; readonly gold: number } {
  const writePlan = buildDistilWritePlan({
    builtAtIso,
    home,
    silverIndex: readSilverIndex({ home }),
    sourceDigests: toSourceDigests({ digests: digestsInBatchOrder({ batches, cache }), recordCountBySource }),
  });
  // Write ALL of it, or none. A complete set is left untouched — rewriting it would churn the `_built`
  // stamp on every invocation and make "gold is unchanged" unobservable. But a set with ANY file missing is
  // rewritten whole rather than patched, because a half-present set of derived files that disagree about
  // when they were built is worse than either extreme.
  const files = [
    ...writePlan.silverDigests.map((file) => ({ path: file.path, text: `${JSON.stringify(file.content, null, 2)}\n` })),
    ...writePlan.goldDocs.map((file) => ({ path: file.path, text: file.content })),
  ];
  if (files.every((file) => exists({ path: file.path }))) {
    return { gold: 0, silver: 0 };
  }
  for (const file of files) {
    writeText({ path: file.path, text: file.text });
  }
  return { gold: writePlan.goldDocs.length, silver: writePlan.silverDigests.length };
}
