/**
 * The rate limits every page-owned reading shares, whichever sync verb takes it (`syncVerbs.ts`): the pull-requests
 * page's landing reading (`landingFreshness.ts`) and the Queue's currency check (`currencyOpeningRefresh.ts`).
 *
 * Bounded two ways, neither of them a timer:
 *
 * - the sync route runs ONE automatic attempt per reading per {@link AUTO_RETRY_MINUTES}, however many tabs,
 *   remounts or reloads ask ({@link autoAttemptRefusedUntil}; a page-local memory would reset on a
 *   remount), so a failed run is retried on a backoff rather than never or in a loop;
 * - a page never asks again over the reading still on screen after its own run returned ({@link pageMayAsk}).
 *
 * The route also joins a run already in flight rather than starting a second (`app/api/sync/[verb]/route.ts`).
 *
 * Pure: the facts and the instant in, the decision out.
 */

/** How long the sync route waits before another automatic attempt over a reading one attempt did not replace. */
export const AUTO_RETRY_MINUTES = 10;

/** Who a reading taken by a page's own refresh is recorded as — every `syncVerbs.ts` row's `--record-reading` value. */
export const SYNC_NOW_BY = "sync-now";

/** The query parameter a page's own refresh carries: the reading id it would replace. */
export const FOR_READING_PARAM = "for-reading";

/**
 * The reading id an automatic request names when the page has no reading it can show — none recorded, or one it
 * refuses — so the route's per-reading backoff covers establishing a first one exactly as it covers replacing one.
 */
export const NO_READING_ID = "none";

/**
 * The most attempts the route remembers at once. Far above what a real console makes in one backoff window — one per
 * page-owned reading per reading id shown — so it only bites when something sends ids nothing on screen showed, and
 * then the oldest attempt goes first.
 */
export const MAX_TRIED_ENTRIES = 256;

/**
 * Decide, on the server that runs it, whether an automatic request over one reading may run now — and record it
 * when it may.
 *
 * The server process outlives every tab, so the memory lives here: the first automatic request naming a reading
 * runs, and every later one naming the same reading is refused without running until
 * {@link AUTO_RETRY_MINUTES} have passed since the last that ran. A press names no reading and is never asked
 * about. Every entry whose backoff has passed is deleted before the request is judged, since it can refuse nothing
 * any more: without that the map kept one key for every reading any page ever showed, for the server's lifetime.
 *
 * @param tried each `<slug> <reading id>` and the instant its last automatic attempt ran, pruned and updated here
 * @param slug the sync verb's slug, so two verbs never share an attempt
 * @param readingId the reading shown when the page decided to refresh
 * @param nowMs the instant the request arrived
 * @returns `undefined` when this request may run, else the instant (epoch ms) from which the next one may
 */
export function autoAttemptRefusedUntil({
  tried,
  slug,
  readingId,
  nowMs,
}: {
  tried: Map<string, number>;
  slug: string;
  readingId: string;
  nowMs: number;
}): number | undefined {
  const backoffMs = AUTO_RETRY_MINUTES * 60_000;
  for (const [entry, atMs] of tried) {
    if (nowMs - atMs >= backoffMs) {
      tried.delete(entry);
    }
  }
  const key = `${slug} ${readingId}`;
  const last = tried.get(key);
  if (last !== undefined) {
    return last + backoffMs;
  }
  // The reading id is request input, so ten minutes of distinct ids would otherwise grow the map without bound
  // (Codex s3-one-honest-refresh). A Map iterates in insertion order, so the first key is the oldest attempt.
  for (const oldest of tried.keys()) {
    if (tried.size < MAX_TRIED_ENTRIES) {
      break;
    }
    tried.delete(oldest);
  }
  tried.set(key, nowMs);
  return undefined;
}

/**
 * Whether the page may ask for an automatic reading over the one it shows, given every reading it has asked over.
 *
 * A finished run leaves the OLD reading on screen until the ledger re-read lands, so without this the page
 * re-armed at once and asked again over it — a second full run after a press, or the route's refusal printed over
 * a run that succeeded. A press or an automatic run both mark the reading asked; the page asks over it
 * again only after the route's own backoff plus a minute of request latency, so its retry is never refused by the
 * route it mirrors. A different reading may be asked about at once. Every reading asked over is remembered, not
 * only the last, so a request over another reading in between never re-opens one already asked over.
 *
 * @param asked when the page last took a run over each reading, keyed by reading id — empty when it has not
 * @param readingId the reading shown now
 * @param nowMs the instant the page is asking at
 * @returns whether an automatic run may be asked for now
 */
export function pageMayAsk({
  asked,
  readingId,
  nowMs,
}: {
  asked: Readonly<Partial<Record<string, number>>>;
  readingId: string;
  nowMs: number;
}): boolean {
  const atMs = nextPageAskAtOf({ asked, readingId });
  if (atMs === undefined) {
    return true;
  }
  return nowMs >= atMs;
}

/**
 * The instant {@link pageMayAsk} next admits an automatic ask over a reading it has asked over: the route's backoff
 * plus the minute of request latency. One function, so the runner wakes and the badge says "tries again" at the very
 * instant the admission decision opens.
 *
 * @param asked when the page last took a run over each reading, keyed by reading id
 * @param readingId the reading the ask would be over
 * @returns the epoch-ms instant, or `undefined` when it has never asked over that reading
 */
export function nextPageAskAtOf({
  asked,
  readingId,
}: {
  asked: Readonly<Partial<Record<string, number>>>;
  readingId: string;
}): number | undefined {
  const atMs = asked[readingId];
  if (atMs === undefined) {
    return undefined;
  }
  return atMs + (AUTO_RETRY_MINUTES + 1) * 60_000;
}
