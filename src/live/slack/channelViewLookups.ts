/**
 * How the console's live channel window (`./channelView.ts`) spends its Slack calls: how many Block Kit file
 * references one read may look up, and how many lookups and preview downloads it keeps in flight at once. Held apart
 * from the window's shaping so each bound sits beside the seam it wraps.
 */
import { createConcurrencyLimiter } from "../../lib/resilience.js";
import { err } from "../../lib/result.js";
import type { LookupSlackFile } from "./blockFiles.js";
import { SlackFileLookupErrors } from "./fileLookupErrors.js";

/**
 * How many Block Kit file references one read looks up through `files.info`, newest message first. `files.info`
 * has no batch form, so without a bound a page rich in references spends the route's whole time on lookups before
 * drawing anything. A reference past it is a card saying it was not looked up.
 */
export const CHANNEL_VIEW_LOOKUPS = 16;

/**
 * How many `files.info` lookups, and separately how many preview downloads, one read has in flight at once. The
 * counts bound how MANY a read asks; this bounds how LONG: sixteen lookups and then sixteen downloads one after
 * another could outrun the route's 45s kill on a slow link, where four at a time is four rounds of each. Four keeps a hover a small, polite burst against Slack's per-method limits.
 */
export const CHANNEL_VIEW_PARALLEL = 4;

/**
 * A lookup that asks `files.info` at most `limit` times, then answers every further id as withheld without asking.
 * `resolveBlockFileRefs` already asks once per distinct id, so the bound counts distinct files.
 *
 * @param lookup the real `files.info` seam
 * @param limit how many ids may be asked about
 * @returns the bounded lookup
 */
export function boundedLookup({ lookup, limit }: { lookup: LookupSlackFile; limit: number }): LookupSlackFile {
  let asked = 0;
  return async ({ fileId }) => {
    if (asked >= limit) {
      return err(SlackFileLookupErrors.withheld({ fileId, limit }));
    }
    asked += 1;
    return lookup({ fileId });
  };
}

/**
 * A lookup with every id in `ids` already asked, at most `parallel` at once and started in the order given, so the
 * serial resolver it is handed (`resolveBlockFileRefs`, shared with `read-thread` and left serial) waits on answers
 * already in flight instead of asking one after another. The limiter starts tasks first in, first out, so a bounded
 * lookup inside it still spends its budget in `ids` order. An id outside `ids` is asked when the resolver reaches it.
 *
 * @param ids each referenced file id, newest message first, as the resolver will reach them
 * @param parallel how many lookups may be in flight at once
 * @returns the lookup the resolver takes
 */
export function prefetchedLookup({
  ids,
  lookup,
  parallel,
}: {
  ids: readonly string[];
  lookup: LookupSlackFile;
  parallel: number;
}): LookupSlackFile {
  const limiter = createConcurrencyLimiter({ concurrency: parallel });
  const started = new Map<string, ReturnType<LookupSlackFile>>();
  for (const fileId of ids) {
    if (!started.has(fileId)) {
      started.set(
        fileId,
        limiter(() => lookup({ fileId })),
      );
    }
  }
  return async ({ fileId }) => {
    const running = started.get(fileId);
    if (running !== undefined) {
      return running;
    }
    return lookup({ fileId });
  };
}
