/**
 * Which held export is the newer snapshot of the owner's account.
 *
 * By the newest activity an export holds (an undatable one last), then by when the owner came by it — never by when it was
 * taken in, which an old archive copied in late would win — then by hash, only so two reads list identically. A tie on
 * the first two is ordered by that last step and refuses nothing: the ingest weighs each conversation by its own
 * newest instant and names the ones it cannot order (`conversationMerge.ts`), and the certified as-of reads only when
 * the newest export was come by, which both tied exports share.
 */
import type { StoredExport } from "./exportStore.js";

/** The newer snapshot first. */
function newestFirst(a: StoredExport, b: StoredExport): number {
  if (a.latestActivityIso !== b.latestActivityIso) {
    if (a.latestActivityIso === null) {
      return 1;
    }
    if (b.latestActivityIso === null) {
      return -1;
    }
    return a.latestActivityIso < b.latestActivityIso ? 1 : -1;
  }
  if (a.acquiredAtIso !== b.acquiredAtIso) {
    return a.acquiredAtIso < b.acquiredAtIso ? 1 : -1;
  }
  return a.contentHash < b.contentHash ? 1 : -1;
}

/**
 * Held exports in chronological order, newest first. Pure.
 *
 * @param exports every held export that stands as its manifest declares
 * @returns the exports, the newest snapshot first and two that tie on both dates in hash order
 */
export function orderByChronology({ exports }: { exports: readonly StoredExport[] }): readonly StoredExport[] {
  return exports.toSorted(newestFirst);
}
