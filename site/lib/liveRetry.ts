/**
 * When a console read that never reached its verb is read again — pure, so the rule and the backoff are unit tests.
 *
 * MEASURED in the docs-site refresh log under the cache root: the owner hung up, the build swap reloaded their page,
 * and every tile started its first read. Some forty seconds later the next round swapped to a newer build, stopping
 * the old one on its port and killing the server and the verb children answering those reads. Each `fetch` rejected,
 * each tile drew NOT MEASURED, and a read-once tile (the board under the Queue badge, the earlier calls) never read
 * again: the Queue badge sat on a dash and the earlier calls stayed missing until two hard refreshes.
 *
 * The route answers 200 with a LiveResult for every outcome of the verb, the verb's own failure included, and a 404
 * for a slug or fixture the page should never have asked for (`app/api/live/[verb]/route.ts`). So a fetch that threw,
 * or a 5xx, is never the verb's answer: it is the server restarting or gone, and the read is owed again. A 404 is a
 * page bug that no amount of asking fixes.
 */

/** The first re-read's wait: long enough for a port the swap just closed to be listening again. */
export const LIVE_RETRY_FIRST_MS = 1_000;

/**
 * The longest wait between re-reads. A swap is down for a restart, not a build (`docs/docs-site/runtime.md` § Two
 * build slots), so a reading owed longer than this is a server that is down, and a request to a closed port spawns
 * nothing — so the re-reads never stop while a tile still wants the reading.
 */
export const LIVE_RETRY_CEILING_MS = 15_000;

/**
 * Whether a read that brought back no LiveResult is owed again.
 *
 * @param threw true when `fetch` itself rejected — the server refused or reset the connection
 * @param status the HTTP status the server answered with, when it answered at all
 * @returns true when the server, not the page, is why no reading came back
 */
export function fetchFailureRetries({ threw, status }: { threw: boolean; status: number | undefined }): boolean {
  if (threw) {
    return true;
  }
  if (status === undefined) {
    return false;
  }
  return status >= 500;
}

/**
 * How long to wait before re-read number `attempt` (zero-based): doubling from {@link LIVE_RETRY_FIRST_MS}, held
 * at {@link LIVE_RETRY_CEILING_MS}.
 *
 * @param attempt how many re-reads this channel has already scheduled since its last reading landed
 * @returns the wait in milliseconds
 */
export function retryDelayMs({ attempt }: { attempt: number }): number {
  return Math.min(LIVE_RETRY_FIRST_MS * 2 ** attempt, LIVE_RETRY_CEILING_MS);
}
