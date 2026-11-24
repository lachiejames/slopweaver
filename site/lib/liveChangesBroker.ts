/**
 * The change broker's state and its batching: what one console server holds while pages listen, and how a burst of
 * register changes becomes one `changed` message. The two signals that feed it — the file watch and the in-process
 * store listener — and its start and stop are in `./liveChangesServer.ts`.
 *
 * One broker per server process, kept on `globalThis` so a dev-server module reload does not leave the old watchers
 * running beside new ones.
 */
import type { FSWatcher } from "node:fs";

import type { LiveChangeEvent } from "./liveChangeWire";
import type { QueueLiveSlug } from "./queueLiveChanges";

/** How long a burst of changes is gathered before the page is told, so one save is one re-read. */
const SETTLE_MS = 750;
/** The longest a steady stream of changes is held before the page is told anyway. */
const MAX_BATCH_MS = 5_000;
/** The first wait before a failed signal is tried again; it doubles on each failure, up to the cap. */
export const BACKOFF_FIRST_MS = 5_000;
/** The longest wait between tries. */
const BACKOFF_CAP_MS = 300_000;

/** One page's handler for what the broker says. */
export type Listener = (event: LiveChangeEvent) => void;

/** Everything one server's broker holds. */
export interface Broker {
  readonly listeners: Set<Listener>;
  files: boolean;
  store: boolean;
  readonly watchers: Map<string, FSWatcher>;
  readonly missingRoots: Set<string>;
  readonly pending: Set<QueueLiveSlug>;
  batchStartedAtMs: number | undefined;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  lingerTimer: ReturnType<typeof setTimeout> | undefined;
  /** The current store listener's abort; only events from the listener it belongs to reach the broker. */
  storeAbort: AbortController | undefined;
  /** The latest store listener's run, settling once its connection is ended, so the next one opens after it. */
  storeRun: Promise<void>;
  /** Ends the current store listener once it has said nothing alive for the silence limit; re-armed on each heartbeat. */
  storeSilenceTimer: ReturnType<typeof setTimeout> | undefined;
  storeBackoffMs: number;
  storeRetryTimer: ReturnType<typeof setTimeout> | undefined;
  filesBackoffMs: number;
  filesRetryTimer: ReturnType<typeof setTimeout> | undefined;
  running: boolean;
}

const BROKER_KEY = Symbol.for("slopweaver.liveChangesBroker");

/**
 * This server's broker, made on first use.
 *
 * @returns the one broker this process holds, the same object on every call
 */
export function broker(): Broker {
  const holder = globalThis as typeof globalThis & { [BROKER_KEY]?: Broker };
  const existing = holder[BROKER_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const made: Broker = {
    batchStartedAtMs: undefined,
    files: false,
    filesBackoffMs: BACKOFF_FIRST_MS,
    filesRetryTimer: undefined,
    flushTimer: undefined,
    heartbeatTimer: undefined,
    lingerTimer: undefined,
    listeners: new Set(),
    missingRoots: new Set(),
    pending: new Set(),
    running: false,
    store: false,
    storeAbort: undefined,
    storeBackoffMs: BACKOFF_FIRST_MS,
    storeSilenceTimer: undefined,
    storeRetryTimer: undefined,
    storeRun: Promise.resolve(),
    watchers: new Map(),
  };
  holder[BROKER_KEY] = made;
  return made;
}

/**
 * Tell every listening page one thing. A listener that throws (a closed stream) is dropped, never fatal.
 *
 * @param event the message every page receives
 */
export function broadcast({ state, event }: { state: Broker; event: LiveChangeEvent }): void {
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch {
      state.listeners.delete(listener);
    }
  }
}

/**
 * The `ready` message for the signals up now.
 *
 * @returns which of the two signals are up, as the page reads them
 */
export function readyEvent({ state }: { state: Broker }): LiveChangeEvent {
  return { files: state.files, kind: "ready", store: state.store };
}

/** Send what has gathered, as one `changed`. */
function flush({ state }: { state: Broker }): void {
  state.flushTimer = undefined;
  state.batchStartedAtMs = undefined;
  if (state.pending.size === 0) {
    return;
  }
  const slugs = [...state.pending];
  state.pending.clear();
  broadcast({ event: { kind: "changed", slugs }, state });
}

/**
 * Gather changed registers, telling the page once the burst settles or the batch has waited long enough.
 *
 * @param slugs the registers a change moved; an empty list starts no batch
 */
export function gather({ state, slugs }: { state: Broker; slugs: readonly QueueLiveSlug[] }): void {
  if (slugs.length === 0) {
    return;
  }
  for (const slug of slugs) {
    state.pending.add(slug);
  }
  const now = Date.now();
  state.batchStartedAtMs ??= now;
  clearTimeout(state.flushTimer);
  const left = Math.max(0, state.batchStartedAtMs + MAX_BATCH_MS - now);
  state.flushTimer = setTimeout(
    () => {
      flush({ state });
    },
    Math.min(SETTLE_MS, left),
  );
}

/** Say a signal changed state, so each page re-arms its polls for it. */
export function signalMoved({ state }: { state: Broker }): void {
  broadcast({ event: readyEvent({ state }), state });
}

/**
 * The next wait after a failure, doubled and capped.
 *
 * @param ms the wait just used
 * @returns the wait before the next try
 */
export function nextBackoff({ ms }: { ms: number }): number {
  return Math.min(BACKOFF_CAP_MS, ms * 2);
}
