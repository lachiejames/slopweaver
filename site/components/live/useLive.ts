"use client";

import { useEffect, useRef, useState } from "react";

import { joinReads } from "../../lib/liveJoin";
import { holdQuiet } from "../../lib/liveQuiet";
import { firstArrival, forget, retire, take } from "../../lib/liveRetained";
import { type LiveState, liveStateAfter } from "../../lib/liveState";
import { wantedOf } from "./useLiveChangeHealth";
import {
  answeredPressOf,
  channels,
  heldOf,
  intervals,
  isReading,
  liveDeliveries,
  markPressed,
  pressesOf,
  quiet,
  retained,
} from "./useLiveChannels";
import { fetchInto, holdTicks, rearm, requestSaved } from "./useLiveFetch";
import { type Arrival, keyOf, type Subscriber, stateOf, urlOf } from "./useLiveWire";

export type { LiveState } from "../../lib/liveState";

/**
 * A channel's value once it has arrived, else `undefined` — loading and not measured are both "not in", for a
 * reader that joins this value to another and names the gap itself rather than drawing this channel's state.
 *
 * @returns the value, or `undefined`
 */
export function readyValueOf<T>({ state }: { state: LiveState<T> }): T | undefined {
  if (state.phase !== "ready") {
    return undefined;
  }
  return state.value;
}

/**
 * How many answers one verb has delivered on this page, never reset by a channel's teardown.
 *
 * @param slug the verb's allowlist slug
 * @param fixture the frozen reading's name when the page is on one
 * @returns the count, 0 before the first answer
 */
export function liveDeliveriesOf({ slug, fixture }: { slug: string; fixture?: string }): number {
  return liveDeliveries({ key: keyOf({ fixture, slug }) });
}

/**
 * Where one verb's presses and answers stand on this page: how many presses it has had, and the latest of them a
 * read that left after it has LANDED an answer for. A press is answered once `answered` reaches its own count.
 *
 * @param slug the verb's allowlist slug
 * @param fixture the frozen reading's name when the page is on one
 * @returns both counts, 0 before any press or answer
 */
export function livePressOrderOf({ slug, fixture }: { slug: string; fixture?: string }): {
  pressed: number;
  answered: number;
} {
  const key = keyOf({ fixture, slug });
  return { answered: answeredPressOf({ key }), pressed: pressesOf({ key }) };
}

/**
 * Whether a voice call holds the page quiet now — for a read that is not a channel, such as the queue's lookup
 * prefetch, to stay out of the call's way too.
 *
 * @returns true while a call holds the gate
 */
export function liveQuietHeld(): boolean {
  return quiet.holds > 0;
}

/**
 * Hold every channel's timer ticks until the returned release is called, which reads each held channel once.
 * The voice call takes this from the moment it starts connecting until it ends.
 *
 * @returns the release
 */
export function quietLiveTicks(): () => void {
  // Spaced rather than together: six catch-up reads at once are the same burst the hold kept out of the call.
  return holdTicks({ spacingMs: CATCH_UP_SPACING_MS });
}

/** How far apart the held channels' catch-up reads start after a call ends. */
const CATCH_UP_SPACING_MS = 1_500;

/** The hold a hidden tab takes, while it is hidden. */
let hiddenRelease: (() => void) | undefined;

/**
 * A tab the owner is not looking at keeps no poll going. A tab left open made every sidebar click dead,
 * because every console tab's polls share the origin's six connections (`site/lib/liveSlots.ts`) — a background
 * tab's tiles are read by nobody, yet each held a connection every twenty seconds. While hidden its ticks are held
 * on the same gate a call holds. Showing it again reads NOTHING at once — a freshness indicator is enough, with no read on every focus — so each channel
 * reads again on its own next tick, and until then the page draws its last reading with that reading's own age. A
 * first read and a press are never held, so a tab opened in the background still draws.
 */
function onVisibility(): void {
  const hidden = document.visibilityState === "hidden";
  if (hidden && hiddenRelease !== undefined) {
    // Already held: a second `hidden` event takes no second hold.
    return;
  }
  if (hidden) {
    const release = holdQuiet({ gate: quiet });
    // The held keys are dropped, not caught up: the timers resume on their own interval.
    hiddenRelease = () => {
      release();
    };
    return;
  }
  const release = hiddenRelease;
  hiddenRelease = undefined;
  release?.();
}

// The module is evaluated on the server too, where there is no document and nothing to hold.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();
}

/**
 * Subscribe to a verb's shared poll.
 *
 * @returns the unsubscribe, and whether the channel handed this subscriber a reading as it joined — which is
 *   current, with no read started, when the join rides a channel kept polled by another subscriber
 */
function subscribe({
  slug,
  fixture,
  everyMs,
  primary,
  deliver,
  onSuperseded,
  supersede,
}: {
  slug: string;
  fixture: string | undefined;
  everyMs: number | undefined;
  /** Whether this subscriber is a page's primary content, whose reads go ahead of the shell's first reads. */
  primary: boolean;
  /**
   * Handed each arrival. `provisional` is true for the one handed over on join — the channel's last, which a
   * read this join starts or rides is about to replace — and false for every arrival a read delivers. Answers
   * whether the subscriber's own reader drew it, which is what makes it the channel's last answered reading.
   */
  deliver: (delivery: { arrival: Arrival; provisional: boolean }) => boolean;
  /** Called when a press supersedes the key while this subscriber is joined (`refreshLive`). */
  onSuperseded: () => void;
  /** True when the subscriber knows the register moved (a page's own refresh), so the cached arrival is not handed over. */
  supersede: boolean;
}): { unsubscribe: () => void; handedOver: boolean } {
  requestSaved();
  const key = keyOf({ fixture, slug });
  const url = urlOf({ fixture, slug });
  let channel = channels.get(key);
  // Read before this subscriber joins: whether something ELSE already keeps the channel current.
  const joinedLive = channel !== undefined && channel.subscribers.size > 0;
  // The poll something ELSE already runs, read before this subscriber's own interval is armed: a mount's own poll is
  // no guarantee about an answer that landed before it joined.
  const polledBefore = channel?.everyMs;
  if (channel === undefined) {
    // A reading kept from this key's last channel, so a revisited page does not start from "loading".
    const kept = take({ key, retained });
    channel = {
      answeredAtMs: undefined,
      drewCurrent: false,
      everyMs: undefined,
      inflight: false,
      startedSeq: 0,
      key,
      last: kept?.last,
      lastAnswered: kept?.answered,
      owed: false,
      pending: false,
      primaryReaders: new Set(),
      retryAttempts: 0,
      retryTimer: undefined,
      subscribers: new Set(),
      superseded: new Set(),
      timer: undefined,
    };
    channels.set(key, channel);
    intervals.set(key, new Map());
  }
  const held = channel;
  const asked = intervals.get(key)!;
  // Only the channel's latest arrival is recorded as drawn, so a handover of an earlier one never moves it backwards.
  // Only a delivery that is not provisional makes the channel current: a kept or saved reading drawn on mount is
  // provisional, so the read replacing it still waits in the foreground line (`liveReadPriority`).
  const drawnBy = ({ arrival, drew, provisional }: { arrival: Arrival; drew: boolean; provisional: boolean }): void => {
    if (drew && held.last === arrival) {
      held.lastAnswered = arrival;
      if (!provisional) {
        held.drewCurrent = true;
      }
    }
  };
  const onArrival: Subscriber = (delivery) => {
    drawnBy({ arrival: delivery.arrival, drew: deliver(delivery), provisional: delivery.provisional });
  };
  held.subscribers.add(onArrival);
  if (primary) {
    held.primaryReaders.add(onArrival);
  }
  held.superseded.add(onSuperseded);
  asked.set(onArrival, everyMs);
  rearm({ channel: held, url, wanted: wantedOf({ asked, key }) });
  if (supersede) {
    held.last = undefined;
    held.lastAnswered = undefined;
    held.drewCurrent = false;
    forget({ key, retained });
  }
  const handedOver = held.last !== undefined;
  const reads = joinReads({
    answeredAtMs: held.answeredAtMs,
    askedEveryMs: everyMs,
    everyMs: polledBefore,
    // Only an answer the route gave is ridden; a fetch that failed is owed a re-read of its own (`owe`).
    hasLast: held.last?.kind === "wire",
    joinedLive,
    nowMs: performance.now(),
    supersede,
  });
  if (held.last !== undefined) {
    // Provisional when this join starts a read or rides the one in flight — the quiet gate never holds a first read
    // (`site/lib/liveQuiet.ts`), so what is handed over is replaced by the next delivery. Current when the join rides
    // a channel another component keeps polled and its answer is younger than that poll promises. The last answered
    // reading goes first when a later read failed, so the failure lands on it and the mount draws it marked stale.
    const provisional = reads || held.inflight;
    if (held.lastAnswered !== undefined && held.lastAnswered !== held.last) {
      deliver({ arrival: held.lastAnswered, provisional });
    }
    const last = held.last;
    drawnBy({ arrival: last, drew: deliver({ arrival: last, provisional }), provisional });
  }
  if (reads) {
    void fetchInto({ cause: "mount", channel: held, supersede, url });
  }
  const unsubscribe = (): void => {
    held.subscribers.delete(onArrival);
    held.primaryReaders.delete(onArrival);
    held.superseded.delete(onSuperseded);
    asked.delete(onArrival);
    if (held.subscribers.size === 0) {
      if (held.timer !== undefined) {
        clearInterval(held.timer);
      }
      if (held.retryTimer !== undefined) {
        clearTimeout(held.retryTimer);
      }
      // Handed off here, never written on every arrival: a read still in flight lands on this dead channel
      // object, so one that began before a press can never refill what the press cleared.
      retire({ keeps: isReading, key, last: heldOf({ channel: held }), retained });
      channels.delete(key);
      intervals.delete(key);
      return;
    }
    rearm({ channel: held, url, wanted: wantedOf({ asked, key }) });
  };
  return { handedOver, unsubscribe };
}

/**
 * Read a verb again now, for every component showing it — what a press that changed a register calls, and
 * what a page's own refresh calls the instant its run has been recorded.
 *
 * SYNCHRONOUS on purpose, and called from the handler rather than from a React effect: the register moved
 * at the moment the press or the run returned, and a poll answer already in flight may predate that write.
 * Marking the channel here, in the same turn of the event loop, is what guarantees that answer is dropped;
 * an effect runs only after React commits, and a poll landing in that gap would be delivered stale.
 *
 * A slug nobody is subscribed to has its retained reading cleared and starts no read: there is no tile to
 * refresh, and the next subscriber fetches on arrival — drawing "loading" meanwhile, never the reading from
 * before the write.
 *
 * @param slug the verb's allowlist slug
 * @param fixture the frozen reading's name when the page is on one, so the same channel is the one marked
 */
export function refreshLive({ slug, fixture }: { slug: string; fixture?: string }): void {
  const key = keyOf({ fixture, slug });
  // Before the early return, because the reading most likely to be retained is exactly the one whose page the
  // press was not made on.
  forget({ key, retained });
  const channel = channels.get(key);
  if (channel === undefined) {
    // No read to start, but the next channel's first read still must not ride a flight from before this write.
    markPressed({ key });
    return;
  }
  // The cached arrival predates the press, so a component mounting before the re-read lands must not be
  // handed it: it waits in "loading" for the reading that reflects what the press wrote.
  channel.last = undefined;
  channel.lastAnswered = undefined;
  channel.drewCurrent = false;
  for (const drop of channel.superseded) {
    drop();
  }
  void fetchInto({ cause: "press", channel, supersede: true, url: urlOf({ fixture, slug }) });
}

/**
 * Poll one allowlisted verb and hand a component its answer.
 *
 * Two properties matter more than the plumbing, and both exist because the alternative is a console that
 * lies quietly:
 *
 * - **A failure is a value, never an empty render.** `not-measured` carries the reason the route gave,
 *   which is the shape `src/measurement/measure.ts` already uses for a read that did not happen. A failure over a
 *   reading already drawn keeps that reading, carrying the reason as `stale` (`site/lib/liveState.ts`).
 * - **The reader `read` is given may refuse the payload.** No vitest lane reaches `site/components/`, so a
 *   verb that changes its `--json` shape breaks nothing here except one tile, which says its shape changed rather
 *   than throwing the page away.
 *
 * The poll itself is shared: every component on the page reading one slug rides one channel, so the
 * sidebar's badge and the page's tile cost one child process between them, not two.
 *
 * A page revisited does not start from "loading": a mount draws its channel's last reading, or the one kept
 * when that channel was torn down, with `refreshing` set until the read the mount started lands. The stamp still
 * states the reading's own age. The first load after a restart draws the reading the console server saved, the same
 * way, for a key this page has neither pressed nor had an answer for ({@link requestSaved}). A press clears both
 * (`refreshLive`), so what it wrote is never drawn over by a
 * reading from before it. A mount reads again at once, unless it joins a channel another component is already
 * keeping polled whose answer is younger than that poll — then it draws that answer as current and rides the
 * channel's timer (`site/lib/liveJoin.ts`), which is what stops a click re-reading every slug the shell holds.
 *
 * @param slug the verb's allowlist slug
 * @param read narrows the payload, returning `undefined` when the shape is not what this tile reads
 * @param everyMs the poll interval; omit for a single read, the slow lane's usual contract (a slow verb whose page
 *   must not age takes a long one, as the Queue's board does — `../../lib/queueRegisterPolls.ts`)
 * @param fixture a frozen reading's name; the route serves it in the verb's place and labels it
 * @param primary set by a reading that decides what the page holds (the Queue's registers and the readings that take a
 *   card on or off it), so its first read and a press go ahead of the shell's badges and the sidebar's first reads
 *   (`../../lib/liveSlots.ts`); omitted, the read waits with the rest
 * @returns the tile's current state
 */
export function useLive<T>({
  slug,
  read,
  everyMs,
  fixture,
  primary,
}: {
  slug: string;
  read: (payload: unknown) => T | undefined;
  everyMs?: number;
  fixture?: string;
  primary?: true;
}): LiveState<T> {
  // What a mount draws first: the live channel's reading, else one kept from this key's last channel, else
  // loading. The initializer only READS — taking or retiring an entry is `subscribe`'s alone, in an effect —
  // so the server, whose maps are always empty because no effect runs there, renders loading.
  const [state, setState] = useState<LiveState<T>>(() => {
    const key = keyOf({ fixture, slug });
    const live = channels.get(key);
    const held = firstArrival({
      key,
      live: live === undefined ? undefined : { last: heldOf({ channel: live }) },
      retained,
    });
    if (held === undefined) {
      return { phase: "loading" };
    }
    const current = stateOf({ arrival: held.last, provisional: true, read, slug });
    if (held.answered === undefined || held.answered === held.last) {
      return current;
    }
    return liveStateAfter({
      current,
      previous: stateOf({ arrival: held.answered, provisional: true, read, slug }),
    });
  });
  // Set by a press on this key until the next read lands: a reading drawn from before the write is never kept over
  // that read failing, so a settled card cannot come back marked stale.
  const pressed = useRef(false);

  // There is deliberately no "read again" input here. A component that knows the register moved (a press,
  // a page's own refresh) calls `refreshLive` from its handler, in the same turn as the write returned; a hook input
  // would reach the channel only after React commits, and a poll landing in that gap would be shown stale.
  useEffect(() => {
    // A handed-over reading predates a press that lands before the re-read, so it goes back to loading. A
    // reading a read delivered is left alone, as it always was: it is current until the re-read replaces it —
    // but it is no longer kept should that re-read fail.
    const dropProvisional = (): void => {
      pressed.current = true;
      setState((drawn) => {
        if (drawn.phase === "ready" && drawn.refreshing === true) {
          return { phase: "loading" };
        }
        return drawn;
      });
    };
    // A failed read keeps the reading drawn, marked stale (`site/lib/liveState.ts`), unless a press moved the
    // register since that reading was taken.
    const deliver = ({ arrival, provisional }: { arrival: Arrival; provisional: boolean }): boolean => {
      const current = stateOf({ arrival, provisional, read, slug });
      const keeps = !pressed.current;
      if (!provisional) {
        pressed.current = false;
      }
      setState((previous) => {
        if (!keeps) {
          return current;
        }
        return liveStateAfter({ current, previous });
      });
      return current.phase === "ready";
    };
    // A resubscribe here is a mount, a fixture change or an interval change — never a known write — so the
    // cached arrival is handed over rather than discarded.
    const { handedOver, unsubscribe } = subscribe({
      deliver,
      everyMs,
      fixture,
      onSuperseded: dropProvisional,
      primary: primary === true,
      slug,
      supersede: false,
    });
    // Nothing handed over means a press cleared the reading the initializer drew, between that render and
    // this effect. Drop it back to loading rather than leave a reading from before the write on screen until
    // the next read lands.
    if (!handedOver) {
      dropProvisional();
    }
    return unsubscribe;
    // `read` is a fresh closure on every render by construction, so it is deliberately not a dependency —
    // including it would resubscribe on each render and turn the poll into a busy loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, everyMs, fixture, primary]);

  return state;
}
