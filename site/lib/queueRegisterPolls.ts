/**
 * How often an open Queue re-reads each of the seven registers its cards are built from. Pure data, so the cadence is
 * a unit test rather than an argument buried in a hook.
 *
 * A Queue read once when the page mounts and never again shows "updated 18 hours ago" while asks were recorded inside
 * the hour, and a queue that stale is not worth reacting to. The board's verb is on the slow lane (`./liveVerbs.ts`), so
 * without a poll a Queue left open draws asks as old as the window. Every register here has an interval, and one with
 * none is a test failure.
 *
 * It imports NOTHING, for the reason `./queueFreshness.ts` states: the unit lane reaches this file from a root that
 * resolves modules differently from the site.
 */

/** The fast lane's poll interval, shared by every page and badge subscribed to the same channels. */
export const FAST_POLL_MS = 20_000;

/**
 * The board's interval on an open Queue: once a minute, not the fast lane's twenty seconds, because the read's cost
 * rules twenty out. MEASURED on the owner's machine: 9.11s wall and 6,095,910 bytes
 * (`/usr/bin/time -p slopweaver handover list --json | wc -c`), and 22–33s under load (`./liveSlots.ts`). Live reads
 * share three slots across the origin, so a twenty-second poll would hold one of them all the time, and up to half of
 * every minute under load. The build row's once-a-minute poll is the precedent (`./liveVerbs.ts`).
 */
export const BOARD_POLL_MS = 60_000;

/** Each register the Queue counts, by its live verb's slug, with the interval an open page re-reads it at. */
export const QUEUE_REGISTER_POLLS = {
  board: BOARD_POLL_MS,
  drafts: FAST_POLL_MS,
  hands: FAST_POLL_MS,
  "import-questions": FAST_POLL_MS,
  "landing-reading": FAST_POLL_MS,
  "review-drafts": FAST_POLL_MS,
  "slack-drafts": FAST_POLL_MS,
} as const satisfies Record<string, number | undefined>;

/**
 * How long an open Queue waits for each reading's FIRST answer before it names that reading unread
 * (`boundedFirstRead`, `./registerFreshness.ts`): each verb's own route timeout (`./liveVerbs.ts`), since a read
 * that has not answered by then is not going to. The seven registers, the overlays that can take a card off the list
 * and the readings that decide a card on or off it. Restated rather than imported, for the reason above; a unit test
 * pins each to its verb.
 */
export const QUEUE_FIRST_READ_BOUNDS_MS = {
  board: 90_000,
  drafts: 20_000,
  hands: 20_000,
  "import-questions": 20_000,
  "landing-reading": 20_000,
  "review-drafts": 20_000,
  reviewers: 20_000,
  "slack-drafts": 20_000,
  "standing-asks": 20_000,
  "talk-cards": 20_000,
  "talk-steers": 20_000,
  workstreams: 20_000,
} as const satisfies Record<string, number>;

/** A reading the Queue holds to a first-read bound, by its live verb's slug. */
export type QueueFirstReadSlug = keyof typeof QUEUE_FIRST_READ_BOUNDS_MS;
