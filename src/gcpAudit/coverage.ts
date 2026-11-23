/**
 * Which log sinks route copies a pull cannot see. Pure.
 *
 * A sink into a Logging bucket of a container the pull searched is READ: `entries:list` over that container
 * reads every bucket it holds, so the copy arrives with its origin's `logName` and the event identity counts it
 * once. In a typical org nearly every enabled sink is the per-container `_Required`/`_Default` pair or a
 * project's sink into a central long-retention Logging bucket — all read, provided the pull searched the
 * project holding that bucket. What remains is the short list this function returns.
 * Repro: `slopweaver google audit-log pull …` then read `.sinks` in `<generation>/manifest.json`.
 */
import type { GcpContainer } from "./transport.js";

/** `logging.googleapis.com/<container>/locations/<loc>/buckets/<bucket>` — a sink into a Logging bucket. */
const LOGGING_BUCKET_DESTINATION =
  /^logging\.googleapis\.com\/((?:organizations|folders|projects)\/[^/]+)\/locations\/[^/]+\/buckets\/[^/]+$/;

/**
 * The enabled sinks whose copies leave the containers the pull searched — Pub/Sub, Cloud Storage, BigQuery, or a
 * bucket outside the org.
 *
 * @param sinks every sink the inventory read, with its destination and whether it is disabled
 * @param searched every container the pull's `entries:list` calls named
 * @returns the sinks a reader of Logging alone cannot see the copies of, in input order
 */
export function unreadSinks<T extends { readonly destination: string; readonly disabled: boolean | null }>({
  sinks,
  searched,
}: {
  sinks: readonly T[];
  searched: readonly GcpContainer[];
}): readonly T[] {
  const read = new Set<string>(searched);
  return sinks.filter((sink) => {
    if (sink.disabled === true) {
      return false;
    }
    const bucket = LOGGING_BUCKET_DESTINATION.exec(sink.destination);
    return bucket === null || !read.has(bucket[1]!);
  });
}
