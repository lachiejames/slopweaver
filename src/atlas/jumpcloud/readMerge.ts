/**
 * One operation's answer, assembled from the walks its contract split it into.
 *
 * JumpCloud's graph association endpoints take exactly one `targets` value per request
 * (`requestContracts.ts` has the measurement), so `/api/v2/systems/{id}/associations` is read once for
 * `user`, once for `policy`, and so on. What the rest of the sync stores and grades is still ONE operation's
 * read — its records, whether it finished, and why not — so the walks are merged here, pure, before anything
 * downstream sees them.
 *
 * Every flag merges in the direction that claims less: the merged read is complete only when every walk was,
 * and it carries a flag such as `pagingRefused` or `incompleteIsClearable` when any walk did.
 */
import type { JumpcloudOperationRead } from "./syncRead.js";

/**
 * Merge one operation's per-contract walks into its single answer.
 *
 * @param reads every walk, in the contract's own order — one when the operation is not split
 * @returns the operation's answer; a single walk comes back unchanged
 */
export function mergeOperationReads({ reads }: { reads: readonly JumpcloudOperationRead[] }): JumpcloudOperationRead {
  const [first, ...rest] = reads;
  if (first === undefined) {
    return {
      complete: false,
      declaredTotal: null,
      empty: true,
      endpoint: "",
      incompleteIsClearable: true,
      pagesExhausted: false,
      paginationDisagreed: false,
      pagingRefused: false,
      reason: "no walk was made for this operation, so nothing it holds was read",
      records: [],
      unsorted: false,
    };
  }
  if (rest.length === 0) {
    return first;
  }
  const totals = reads.map((read) => read.declaredTotal);
  const everyTotal = totals.every((total): total is number => total !== null);
  return {
    complete: reads.every((read) => read.complete),
    declaredTotal: everyTotal ? totals.reduce((sum, total) => sum + total, 0) : null,
    empty: reads.every((read) => read.empty),
    endpoint: first.endpoint,
    incompleteIsClearable: reads.some((read) => read.incompleteIsClearable),
    pagesExhausted: reads.every((read) => read.pagesExhausted),
    paginationDisagreed: reads.some((read) => read.paginationDisagreed),
    pagingRefused: reads.some((read) => read.pagingRefused),
    reason: reads.map((read) => read.reason).join("; "),
    records: reads.flatMap((read) => read.records),
    unsorted: reads.some((read) => read.unsorted),
  };
}
