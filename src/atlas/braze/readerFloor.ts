/**
 * The floors on this build's ability to READ Braze's published sources, whatever Braze has edited.
 *
 * Split out of `sync.ts` along the seam it already had: this is the one pure judgement the sync makes before
 * it publishes, and it is driven by its own test without a network fetch. `specLock.ts` carries why the census
 * is recorded and the reader is what is enforced.
 */
import type { BrazeDocsOperationRow } from "./docsCatalogue.js";
import { BRAZE_READER_FLOOR } from "./specLock.js";

/**
 * Every way this build's ability to READ can have broken, whatever Braze has edited.
 *
 * These are the assertions that stand in for the digest a moving document cannot have, and a check reachable
 * only through the network is a check nothing exercises.
 *
 * @param rows the operation rows the reference produced
 * @param servedOperationPages how many declared operation pages Braze serves at an operation address — a
 *   declared page it redirects off the tree owes no row
 * @param collectionRequests how many requests the collection declared
 * @returns every way the reader looks broken, or `null` when it does not
 */
export function brazeReaderFloorFailure({
  rows,
  servedOperationPages,
  collectionRequests,
}: {
  rows: readonly BrazeDocsOperationRow[];
  servedOperationPages: number;
  collectionRequests: number;
}): readonly string[] | null {
  const problems: string[] = [];
  if (servedOperationPages < BRAZE_READER_FLOOR.minOperationPages) {
    problems.push(
      `Braze served ${String(servedOperationPages)} operation page(s), below the floor of ${String(BRAZE_READER_FLOOR.minOperationPages)}`,
    );
  }
  if (rows.length !== servedOperationPages) {
    problems.push(
      `${String(servedOperationPages)} operation page(s) were served and ${String(rows.length)} were read — every served page must yield an operation`,
    );
  }
  const withParameters = rows.filter((row) => row.parameters.length > 0).length;
  if (withParameters < BRAZE_READER_FLOOR.minPagesWithParameters) {
    problems.push(
      `only ${String(withParameters)} page(s) yielded a request-parameter table, below the floor of ${String(BRAZE_READER_FLOOR.minPagesWithParameters)} — the table extraction has stopped matching Braze's markup`,
    );
  }
  const withFields = rows.filter((row) => row.responseFields.length > 0).length;
  if (withFields < BRAZE_READER_FLOOR.minPagesWithResponseFields) {
    problems.push(
      `only ${String(withFields)} page(s) yielded response field names, below the floor of ${String(BRAZE_READER_FLOOR.minPagesWithResponseFields)} — the example-response extraction has stopped matching Braze's markup`,
    );
  }
  if (collectionRequests < BRAZE_READER_FLOOR.minCollectionRequests) {
    problems.push(
      `the collection declared ${String(collectionRequests)} request(s), below the floor of ${String(BRAZE_READER_FLOOR.minCollectionRequests)}`,
    );
  }
  if (problems.length === 0) {
    return null;
  }
  return [
    "this build can no longer read Braze's published sources well enough to publish, so nothing was written",
    ...problems,
    "these are floors on the READER rather than on Braze's numbers — see `specLock.ts` on why the census is recorded and the reader is enforced",
  ];
}
