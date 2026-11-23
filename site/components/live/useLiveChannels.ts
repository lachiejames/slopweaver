/**
 * The page-scoped live channel register — every channel, and the deliveries, presses, fresh debt, retained readings
 * and quiet gate kept beside them — and the admission of a reading an earlier console process saved.
 */
import { openQuietGate } from "../../lib/liveQuiet";
import { forget, openRetained } from "../../lib/liveRetained";
import { savedOutlived, savedReadingDraw } from "../../lib/savedReadingDraw";
import { type Arrival, type Held, type Subscriber, type WireResult } from "./useLiveWire";

/**
 * One verb's poll, shared by every component reading it.
 *
 * The console's sidebar badges read the same fast-lane verbs its pages do, and a hook that polled per
 * component would launch `hand list` twice every twenty seconds for one number. So a slug is polled ONCE
 * per page, on the shortest interval any subscriber asked for, and every subscriber is handed the same
 * arrival. A subscriber that asked for a single read still receives the later ticks another subscriber
 * caused — a fresher value is never the wrong one to show.
 *
 * A channel lives while anyone reads it. When the last reader leaves, its last arrival is handed to
 * {@link retained} and the next channel for the key starts from it (`site/lib/liveRetained.ts`), so a page
 * revisited draws its tiles at once, marked as re-reading, rather than as "loading" for a whole first read.
 */
export interface Channel {
  readonly key: string;
  /**
   * Handed each arrival. `provisional` is false for every one a read delivers, and true only for a reading an earlier
   * console process saved, drawn into a channel still waiting on its first read ({@link admitSaved}).
   */
  readonly subscribers: Set<Subscriber>;
  /**
   * The subscribers that are a page's primary content (`useLive`'s `primary`): while any is joined, a read of the
   * channel that goes ahead of poll ticks goes ahead of the shell's first reads too (`liveReadPriority`).
   */
  readonly primaryReaders: Set<Subscriber>;
  /**
   * Told when a press supersedes the key, so a subscriber still drawing a handed-over reading drops it rather
   * than keep a reading from before the write on screen, marked re-reading, until the re-read lands.
   */
  readonly superseded: Set<() => void>;
  /** The shortest interval a live subscriber asked for; `undefined` while every subscriber reads once. */
  everyMs: number | undefined;
  timer: ReturnType<typeof setInterval> | undefined;
  inflight: boolean;
  /** The latest read this channel started, in page order, so a catch-up can tell whether one followed the hold. */
  startedSeq: number;
  /**
   * A read asked for while one was in flight. Set instead of dropped, because the asker is a press that may
   * have moved the register AFTER the in-flight read left: answering that press with the older reading
   * would show a row the verb already settled. The in-flight read runs again the moment it lands.
   */
  pending: boolean;
  /**
   * A hang-up catch-up that found a read in flight. That read's answer is shown as usual, then the catch-up
   * asks the quiet gate again, so a call started meanwhile holds it rather than being read over.
   */
  owed: boolean;
  /**
   * The re-read owed after the server, not the verb, failed a read — a restart killing the reads a page reload had
   * just started. Read-once channels have no timer to recover on, so without this they stayed NOT MEASURED.
   */
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** How many re-reads have been scheduled since this channel last received a wire answer, for the backoff. */
  retryAttempts: number;
  /**
   * The last arrival, handed to a new subscriber at once so a page change does not blank a badge. Seeded from
   * {@link retained} when the channel is created, handed back to it at teardown, and cleared by a press — the
   * one source of truth for the key while the channel lives, because the register holds nothing for it then.
   */
  last: Arrival | undefined;
  /**
   * The latest arrival a tile's own reader DREW, kept beside {@link last} when a later read failed, so a page draws it
   * marked stale. Set by the subscriber, never by the read: a route answering `ok` with a payload the tile refuses is a
   * failed read too, and must not displace the reading before it. Cleared by a press with `last`, so a
   * reading from before a write never comes back over a failed re-read.
   */
  lastAnswered: Arrival | undefined;
  /**
   * Whether a tile has drawn a CURRENT reading on this channel: one delivered not provisional — a read of this channel
   * answered it, or a join handed over the answer of a channel another component keeps polled. A reading kept from an
   * earlier channel or saved by an earlier console process sets {@link lastAnswered} but never this, because nothing
   * bounds its age. What decides a read's line for a slot: until it is true, every read of the channel goes ahead of
   * this tab's poll ticks (`liveReadPriority`). Cleared with {@link lastAnswered} by a press.
   */
  drewCurrent: boolean;
  /**
   * When THIS channel received `last`, on the page's monotonic clock (`performance.now`) — what lets a mount ride a
   * channel another component keeps current (`site/lib/liveJoin.ts`). The channel's own,
   * never the key's, so a torn-down channel's read landing late cannot make a live channel's older answer look young;
   * and monotonic, so a wall-clock step back cannot either. `undefined` for a reading kept from an earlier channel,
   * whose age nothing has bounded.
   */
  answeredAtMs: number | undefined;
}

/** Every channel alive on this page, by slug and fixture. */
export const channels = new Map<string, Channel>();

/**
 * How many answers each key has delivered on this page, across every channel it has had — kept apart from the
 * channel so a count taken before a teardown still compares with one taken after it.
 */
export const deliveries = new Map<string, number>();

/**
 * For each key, the latest press a LANDED answer's read left after — its {@link presses} count when it left. A press's
 * settling mark clears only once this reaches that press: never on a re-read that failed, and never on an answer
 * from a read that left before the press, a torn-down channel's still in flight included.
 */
export const answeredPress = new Map<string, number>();

/**
 * Every key a press moved whose fresh read has not yet LANDED an answer: each read of it goes out `fresh` until one
 * does — a retry after the press's read failed, and the first read of a channel mounted after the press's page was
 * left, included — so none rides a server flight from before the write. Kept apart from the channel, like
 * {@link deliveries}, because a press made with no channel alive still owes its key's next read.
 */
export const freshOwed = new Set<string>();

/** How many presses each key has had on this page, so a read can tell whether one came after it left. */
const presses = new Map<string, number>();

/**
 * Record a press on a key: its next reads owe freshness until one started after this lands an answer.
 *
 * @param key the channel key the press moved
 */
export function markPressed({ key }: { key: string }): void {
  freshOwed.add(key);
  presses.set(key, pressesOf({ key }) + 1);
}

/**
 * How many presses a key has had on this page.
 *
 * @returns the count, zero for a key never pressed
 */
export function pressesOf({ key }: { key: string }): number {
  const count = presses.get(key);
  if (count === undefined) {
    return 0;
  }
  return count;
}

/**
 * The last arrival of every channel torn down on this page, by key, until a channel for that key takes it or a
 * press forgets it (`site/lib/liveRetained.ts`). Never holds a key whose channel is alive.
 */
export const retained = openRetained<Held>();

/**
 * Whether what a channel held is an honest last word to show on the next mount: every wire answer, a NOT MEASURED
 * with the route's reason included, and a fetch that failed only over an earlier answer — which is also what bounds
 * the register to the slugs and fixtures the route accepts, since a key is built client-side before the route
 * checks the fixture.
 *
 * @returns true to keep it
 */
export const isReading: (held: Held) => boolean = (held) => held.last.kind === "wire" || held.answered !== undefined;

/**
 * What a channel holds for a mount, or nothing when no read has landed on it since it was created or pressed.
 *
 * @returns the latest arrival with the latest answered one, or `undefined`
 */
export function heldOf({ channel }: { channel: Channel }): Held | undefined {
  if (channel.last === undefined) {
    return undefined;
  }
  return { answered: channel.lastAnswered, last: channel.last };
}

/** Held while the owner is on a voice call, so the polls stay out of its way (`site/lib/liveQuiet.ts`). */
export const quiet = openQuietGate();

/**
 * How many answers one verb has delivered on this page, across every channel it has had — a count, not a stamp, so
 * a caller that asked for a read can tell it landed even when the answer carries the stamp of the one before it.
 *
 * @param key the channel key (`keyOf`), slug and fixture
 * @returns the count, 0 before the first answer
 */
export function liveDeliveries({ key }: { key: string }): number {
  const count = deliveries.get(key);
  if (count === undefined) {
    return 0;
  }
  return count;
}

/**
 * The latest press one key's landed answers have caught up with.
 *
 * @param key the channel key (`keyOf`), slug and fixture
 * @returns that press's count, 0 before any answer
 */
export function answeredPressOf({ key }: { key: string }): number {
  const count = answeredPress.get(key);
  if (count === undefined) {
    return 0;
  }
  return count;
}

/** The interval each subscriber asked for, so a leaving one can be subtracted. */
export const intervals = new Map<string, Map<Subscriber, number | undefined>>();

/**
 * The saved arrival admitted for each key, so the first answer this page receives can clear it from the retained
 * register, or from a channel a remount opened, wherever a torn-down channel handed it (`savedOutlived`).
 */
const savedArrivals = new Map<string, Arrival>();

/**
 * Clear a key's saved reading once this page has an answer of its own, wherever the saved one went
 * (`savedOutlived`). The channel the answer landed on has its `last` replaced already. A retained entry that is still
 * the saved arrival is forgotten. A different live channel a remount opened meanwhile, still holding it, is handed the
 * answer marked refreshing. So a torn-down channel's answer, which nothing draws, never leaves the older saved reading
 * to be drawn by a later mount.
 *
 * @param on the channel the answer landed on, live or torn down
 * @param arrival what landed
 */
export function outliveSaved({ on, arrival }: { on: Channel; arrival: Arrival }): void {
  const live = channels.get(on.key);
  const otherLive = live === on ? undefined : live;
  const outlived = savedOutlived({
    answered: arrival.kind === "wire" && arrival.wire.ok,
    onAnswered: on.lastAnswered,
    otherLive: otherLive === undefined ? undefined : { answered: otherLive.lastAnswered, last: otherLive.last },
    retained: retained.get(on.key),
    saved: savedArrivals.get(on.key),
  });
  if (outlived.settled) {
    savedArrivals.delete(on.key);
  }
  if (outlived.clearOnAnswered) {
    on.lastAnswered = undefined;
  }
  if (outlived.forgetRetained) {
    forget({ key: on.key, retained });
  }
  if (outlived.replaceLive && otherLive !== undefined) {
    if (outlived.clearLiveAnswered) {
      otherLive.lastAnswered = undefined;
    }
    // Marked refreshing only while that channel's own read is under way; otherwise it is simply the latest answer.
    otherLive.last = arrival;
    for (const deliver of otherLive.subscribers) {
      deliver({ arrival, provisional: otherLive.inflight });
    }
  }
}

/**
 * Draw one saved reading where `site/lib/savedReadingDraw.ts` allows: into a channel still waiting on its first read,
 * handed to its subscribers provisional, or into the retained register for the next mount.
 *
 * It moves nothing a read owns: no delivery is counted, no press answered, no fresh debt paid, and `answeredAtMs`
 * stays `undefined`, so a mount joining this channel still reads (`site/lib/liveJoin.ts`). `lastAnswered` is set only
 * by a subscriber whose reader drew it, as for any arrival.
 *
 * @param key the channel key, never a fixture's
 * @param wire the saved reading
 */
export function admitSaved({ key, wire }: { key: string; wire: WireResult }): void {
  const channel = channels.get(key);
  const draw = savedReadingDraw({
    channel: channel === undefined ? undefined : { hasLast: channel.last !== undefined },
    delivered: liveDeliveries({ key }),
    pressed: pressesOf({ key }),
    retained: retained.has(key),
  });
  const arrival: Arrival = { kind: "wire", wire };
  if (draw === "drop") {
    return;
  }
  savedArrivals.set(key, arrival);
  if (draw === "retained") {
    retained.set(key, { answered: undefined, last: arrival });
    return;
  }
  if (channel !== undefined) {
    channel.last = arrival;
    for (const deliver of channel.subscribers) {
      deliver({ arrival, provisional: true });
    }
  }
}
