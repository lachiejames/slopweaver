"use client";

/**
 * The page's half of the Queue's change push: hears which registers moved and re-reads just those, and tells every
 * channel which signals are up so a register whose signal is down goes back to its old poll (`useLive.ts`).
 *
 * **One stream per browser, not per tab.** Every console tab shares the origin's six connections, three of them
 * already the live reads' (`site/lib/liveSlots.ts`), and a stream holds one for as long as it is open. So the tabs
 * elect one holder with a Web Lock; it relays every message to the others on a `BroadcastChannel`, and when it closes
 * the lock passes to the next tab, which opens the stream. A browser without Web Locks opens none, and stays on the old
 * poll: a stream per tab there would spend a connection per tab, the thing the election exists to prevent.
 *
 * **Never faster than the old poll.** A register is re-read for a change at most once per its old interval
 * (`eventRefreshDelayMs`), a later change inside that window folding into one re-read at its end. While a voice call
 * or a hidden tab holds the page quiet, changes are noted and read when the hold ends, the call's way.
 *
 * **A quiet stream is not "nothing changed".** The holder counts every signal down the moment its stream drops or it
 * takes the stream over, and tells the other tabs; a tab that hears nothing for 45 seconds, though the server beats
 * every 15, does the same on its own. Every stream that opens re-reads every register once, since a change made
 * before it opened was never sent to it.
 */
import { type ReactElement, useEffect, useSyncExternalStore } from "react";

import { LIVE_CHANGE_EVENT_KINDS, type LiveChangeEvent, liveChangeEventOf } from "../../lib/liveChangeWire";
import {
  eventRefreshDelayMs,
  liveChangesNotice,
  QUEUE_CHANGE_HEALTH_DOWN,
  QUEUE_LIVE_SLUGS,
  type QueueChangeHealth,
  type QueueLiveSlug,
} from "../../lib/queueLiveChanges";
import { liveQuietHeld } from "./useLive";
import { refreshSubscribedLive, setLiveChangeHealth } from "./useLiveChangeHealth";

/** The stream's route. */
const STREAM_URL = "/api/live-changes";
/** The lock the tabs elect the stream's holder with, and the channel the holder relays on. */
const LEADER_LOCK = "sw-live-changes";
/** How long a tab may hear nothing before it counts every signal down. */
const SILENCE_MS = 45_000;
/** How often the watchdog looks. */
const WATCHDOG_MS = 5_000;
/** How long after a broken stream the holder opens it again. */
const REOPEN_MS = 5_000;

/** What a tab knows about the stream, shared with the notice that draws it. */
interface ChangeView {
  readonly health: QueueChangeHealth;
  /**
   * Whether this tab has heard the stream, or waited long enough to say it has not: a notice never flashes during the
   * first connection, and a page that never connects still says so.
   */
  readonly settled: boolean;
}

let view: ChangeView = { settled: false, health: QUEUE_CHANGE_HEALTH_DOWN };
const viewListeners = new Set<() => void>();

/** Publish a new view to the hook and to every channel's poll. */
function setView({ next }: { next: ChangeView }): void {
  view = next;
  setLiveChangeHealth({ health: next.health });
  for (const listener of viewListeners) {
    listener();
  }
}

/**
 * What this tab knows about the change stream: which signals are up, and whether it has heard it at all.
 *
 * @returns the current view, re-rendering when it moves
 */
export function useLiveChangeView(): ChangeView {
  return useSyncExternalStore(
    (listener) => {
      viewListeners.add(listener);
      return () => {
        viewListeners.delete(listener);
      };
    },
    () => view,
    () => view,
  );
}

/** Per register: when its last change-driven read started, and a timer for one owed at the end of its gap. */
const lastReadAtMs = new Map<QueueLiveSlug, number>();
const owedTimers = new Map<QueueLiveSlug, ReturnType<typeof setTimeout>>();
/** Registers that changed while the page was held quiet. */
const heldBack = new Set<QueueLiveSlug>();
/** When this tab last heard anything from the stream. */
let heardAtMs = 0;
/** Whether this tab holds the stream for the others. */
let leading = false;
/** What a tab that has just opened asks the holder, which answers with the signals up now. */
const HELLO = "hello";
/** What the holder tells the others when its stream drops, or what a new holder says as it takes over. */
const LOST = "lost";

/**
 * Count every signal down at once, because no change can reach this tab until the stream says `ready` again. The
 * settled flag is kept, so a tab still opening its first stream shows no notice, while a tab that had heard it does
 * and re-reads every register when it hears again (`hear`).
 */
function deafen(): void {
  if (view.health.transport || view.health.files || view.health.store) {
    setView({ next: { health: QUEUE_CHANGE_HEALTH_DOWN, settled: view.settled } });
  }
}

/** Re-read one register now, or note it for when the quiet hold ends. */
function readNow({ slug }: { slug: QueueLiveSlug }): void {
  owedTimers.delete(slug);
  if (liveQuietHeld()) {
    heldBack.add(slug);
    return;
  }
  heldBack.delete(slug);
  lastReadAtMs.set(slug, performance.now());
  refreshSubscribedLive({ slug });
}

/** Re-read one register for a change, no sooner than its gap allows. */
function changed({ slug }: { slug: QueueLiveSlug }): void {
  if (owedTimers.has(slug)) {
    return;
  }
  const delay = eventRefreshDelayMs({ lastRefreshAtMs: lastReadAtMs.get(slug), nowMs: performance.now(), slug });
  if (delay === 0) {
    readNow({ slug });
    return;
  }
  owedTimers.set(
    slug,
    setTimeout(() => {
      readNow({ slug });
    }, delay),
  );
}

/** Read every register the quiet hold kept back, once it has ended. */
function releaseHeldBack(): void {
  if (liveQuietHeld()) {
    return;
  }
  for (const slug of heldBack) {
    changed({ slug });
  }
}

/** Act on one message, whichever tab's stream it came over. */
function hear({ event }: { event: LiveChangeEvent }): void {
  heardAtMs = performance.now();
  const wasDeaf = view.settled && !view.health.transport;
  if (event.kind === "ready") {
    setView({ next: { settled: true, health: { files: event.files, store: event.store, transport: true } } });
  } else if (!view.health.transport) {
    setView({ next: { settled: true, health: { ...view.health, transport: true } } });
  }
  if (wasDeaf) {
    // Deaf for a while: a change made then was never heard, so every register is owed one read.
    for (const slug of QUEUE_LIVE_SLUGS) {
      changed({ slug });
    }
  }
  if (event.kind === "changed") {
    for (const slug of event.slugs) {
      changed({ slug });
    }
  }
  releaseHeldBack();
}

/**
 * Count every signal down when the stream has been silent too long — a tab that never heard it included, once it has
 * waited as long, so its notice says so.
 */
function watchdog(): void {
  const silent = performance.now() - heardAtMs > SILENCE_MS;
  if (silent && (view.health.transport || !view.settled)) {
    setView({ next: { health: QUEUE_CHANGE_HEALTH_DOWN, settled: true } });
  }
}

/** Parse one message's data, or `undefined` for one the reader cannot vouch for. */
function eventOfData({ data }: { data: unknown }): LiveChangeEvent | undefined {
  if (typeof data !== "string") {
    return undefined;
  }
  try {
    return liveChangeEventOf({ value: JSON.parse(data) as unknown });
  } catch {
    return undefined;
  }
}

/**
 * Hold the stream until `signal` aborts, relaying every message to `relay` as well as hearing it here. A stream the
 * browser gave up on is opened again after a pause.
 */
async function holdStream({
  signal,
  relay,
}: {
  signal: AbortSignal;
  relay: BroadcastChannel | undefined;
}): Promise<void> {
  leading = true;
  // Taking over means the stream before this one is gone, however its holder went: every tab is deaf until `ready`.
  deafen();
  relay?.postMessage(LOST);
  await new Promise<void>((resolve) => {
    let source: EventSource | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    const send = (event: LiveChangeEvent): void => {
      hear({ event });
      relay?.postMessage(event);
    };
    const onMessage = (message: MessageEvent): void => {
      const event = eventOfData({ data: message.data });
      if (event !== undefined) {
        send(event);
      }
    };
    const open = (): void => {
      reopen = undefined;
      source = new EventSource(STREAM_URL);
      for (const kind of LIVE_CHANGE_EVENT_KINDS) {
        source.addEventListener(kind, onMessage);
      }
      source.addEventListener("open", () => {
        // Whatever changed before this connection was never sent to it — while the last one was down, or between a tab's
        // first read and its stream, or across a holder handing over — so every register is owed one read. Each is
        // still read no sooner than its old poll gap after its last read.
        send({ kind: "changed", slugs: [...QUEUE_LIVE_SLUGS] });
      });
      source.addEventListener("error", () => {
        // Dropped: nothing reaches any tab until the stream reconnects, so every register goes back to its old poll now
        // rather than when the watchdog notices the silence.
        deafen();
        relay?.postMessage(LOST);
        if (source?.readyState === EventSource.CLOSED && reopen === undefined && !signal.aborted) {
          reopen = setTimeout(open, REOPEN_MS);
        }
      });
    };
    signal.addEventListener(
      "abort",
      () => {
        leading = false;
        clearTimeout(reopen);
        source?.close();
        relay?.postMessage(LOST);
        resolve();
      },
      { once: true },
    );
    open();
  });
}

/**
 * The Queue's line while a change signal is down (`liveChangesNotice`), drawn in its bar beside the freshness mark.
 *
 * @returns the notice, or nothing while every signal is up
 */
export function LiveChangesNotice(): ReactElement | null {
  const { health, settled } = useLiveChangeView();
  const words = liveChangesNotice({ health, settled });
  if (words === undefined) {
    return null;
  }
  return (
    <output className="text-[0.72rem] text-warning" data-live-changes="degraded">
      {words}
    </output>
  );
}

/**
 * Mounted once in the shell: takes part in the election, hears the stream, keeps the watchdog, and reads what a quiet
 * hold kept back once the tab is shown again.
 *
 * @returns nothing visible; the notice is `LiveChangesNotice`
 */
export function LiveChanges(): null {
  useEffect(() => {
    // The silence clock starts at mount, so a tab that never hears the stream settles 45 seconds in.
    heardAtMs = performance.now();
    const stop = new AbortController();
    const relay = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(LEADER_LOCK);
    if (relay !== undefined) {
      relay.addEventListener("message", (message: MessageEvent) => {
        if (message.data === HELLO) {
          // A tab just opened: the holder tells it which signals are up, which it would otherwise not hear until one moved.
          if (leading && view.health.transport) {
            relay.postMessage({ files: view.health.files, kind: "ready", store: view.health.store });
          }
          return;
        }
        if (message.data === LOST) {
          deafen();
          return;
        }
        const event = liveChangeEventOf({ value: message.data as unknown });
        if (event !== undefined) {
          hear({ event });
        }
      });
      relay.postMessage(HELLO);
    }
    // Waits its turn; granted, it holds the stream until this tab unmounts, then the next tab in line takes it. A browser
    // without Web Locks never opens one: its watchdog settles every signal down, so its registers keep the old poll.
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      void navigator.locks
        .request(LEADER_LOCK, { signal: stop.signal }, async () => holdStream({ relay, signal: stop.signal }))
        .catch(() => undefined);
    }
    const timer = setInterval(watchdog, WATCHDOG_MS);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") {
        // The hidden hold ends on this same event, after this listener or before it; read on the next turn.
        setTimeout(releaseHeldBack, 0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop.abort();
      relay?.close();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
