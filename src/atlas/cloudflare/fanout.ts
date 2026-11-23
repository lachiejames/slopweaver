/**
 * Bounded parent-collection fan-out: read one child collection per parent (e.g. one Access application's
 * policies), under a shared concurrency ceiling, with every parent's attempt reported independently. A
 * failed parent never blocks or slows another — `Promise.all` over per-parent thunks, not a loop that stops
 * on the first rejection.
 *
 * Uses `createConcurrencyLimiter` (`src/lib/resilience.ts`), the repository's maintained `p-limit` seam —
 * never a bespoke worker pool, per the resilience ratchet.
 */
import { createConcurrencyLimiter } from "../../lib/resilience.js";
import type { Result } from "../../lib/result.js";
import type { CloudflareClientError } from "./errors.js";

/** One parent's fan-out read attempt. */
export interface ParentCollectionAttempt<TItem> {
  readonly parentId: string;
  readonly result: Result<readonly TItem[], CloudflareClientError>;
}

/**
 * Read one child collection per parent, under a bounded concurrency ceiling.
 *
 * @param parentIds every parent to read a collection for
 * @param concurrency the shared concurrency ceiling
 * @param read reads one parent's collection, given its id
 * @returns every parent's attempt, in the same order as `parentIds`
 */
export async function readParentCollections<TItem>({
  parentIds,
  concurrency,
  read,
}: {
  parentIds: readonly string[];
  concurrency: number;
  read: (args: { parentId: string }) => Promise<Result<readonly TItem[], CloudflareClientError>>;
}): Promise<readonly ParentCollectionAttempt<TItem>[]> {
  const limit = createConcurrencyLimiter({ concurrency });
  return Promise.all(
    parentIds.map((parentId) =>
      limit(async (): Promise<ParentCollectionAttempt<TItem>> => ({ parentId, result: await read({ parentId }) })),
    ),
  );
}
