/**
 * The console server's change broker: the one place that learns a Queue register moved, so the page re-reads that
 * register instead of re-running every register's verb every twenty seconds.
 *
 * Two signals feed it. **Files**: an `fs.watch` on each directory a file-kept register lives in
 * (`queueWatchRoots`), never the whole home, because the corpus alone takes a resync's thousands of writes. **Store**:
 * a Postgres `LISTEN` on the notify triggers' channel, held in this process (`./storeQueuePostgres.ts`) — never a
 * child, because the console server holds no long-lived child process (AGENTS.md rule 2). Either can be down, and the
 * page is told which is up (`ready`), because a register whose signal is down goes back to its old poll: a quiet
 * stream must never read as "nothing changed" when it means "nobody is watching".
 *
 * The broker's state and its batching are in `./liveChangesBroker.ts`. It starts with the first page listening and
 * stops shortly after the last leaves, so a console nobody has open watches nothing.
 */
import { existsSync, watch } from "node:fs";
import { join } from "node:path";

import { consoleWatchedDir } from "./consoleHome";
import {
  BACKOFF_FIRST_MS,
  type Broker,
  broadcast,
  broker,
  gather,
  type Listener,
  nextBackoff,
  readyEvent,
  signalMoved,
} from "./liveChangesBroker";
import { queueSlugsForHomePath, queueSlugsForSource, queueWatchRoots } from "./queueLiveChanges";
import { type StoreQueueEvent, storeEventEffect } from "./storeQueueCore";
import { watchConsoleStoreQueue } from "./storeQueuePostgres";

/** How often the page is told the stream is alive, and missing roots are looked for again. */
const HEARTBEAT_MS = 15_000;
/** How long the store listener may go without a heartbeat (it sends one every 15s) before it counts as gone. */
const STORE_SILENCE_MS = 45_000;
/** How long the broker outlives its last listener, so a page reload does not tear down and rebuild every watch. */
const LINGER_MS = 30_000;

/**
 * Watch one root, or record it missing when its directory does not exist yet. A missing root leaves the file signal
 * up: `adoptAppearedRoots` looks for it on every heartbeat, inside every register's old poll, and re-reads its
 * registers the moment it appears.
 */
function watchRoot({ state, dir, recursive }: { state: Broker; dir: string; recursive: boolean }): void {
  const absolute = consoleWatchedDir({ dir });
  if (!existsSync(absolute)) {
    state.missingRoots.add(dir);
    return;
  }
  const watcher = watch(absolute, { persistent: false, recursive }, (_event, filename) => {
    const relativePath = filename === null ? null : join(dir, filename);
    gather({ slugs: queueSlugsForHomePath({ relativePath }), state });
  });
  watcher.on("error", () => {
    filesFailed({ state });
  });
  state.missingRoots.delete(dir);
  state.watchers.set(dir, watcher);
}

/** Close every file watch. */
function closeFiles({ state }: { state: Broker }): void {
  for (const watcher of state.watchers.values()) {
    watcher.close();
  }
  state.watchers.clear();
  state.missingRoots.clear();
}

/** Start every file watch; a register kept in files changed while nobody watched is owed a re-read, so all are told. */
function startFiles({ state }: { state: Broker }): void {
  state.filesRetryTimer = undefined;
  try {
    for (const root of queueWatchRoots()) {
      watchRoot({ dir: root.dir, recursive: root.recursive, state });
    }
  } catch {
    filesFailed({ state });
    return;
  }
  state.files = true;
  state.filesBackoffMs = BACKOFF_FIRST_MS;
  signalMoved({ state });
  gather({ slugs: queueSlugsForSource({ source: "files" }), state });
}

/** A file watch failed: every file-kept register goes back to polling until the watches are rebuilt. */
function filesFailed({ state }: { state: Broker }): void {
  closeFiles({ state });
  if (state.files) {
    state.files = false;
    signalMoved({ state });
  }
  if (state.running && state.filesRetryTimer === undefined) {
    state.filesRetryTimer = setTimeout(() => {
      startFiles({ state });
    }, state.filesBackoffMs);
    state.filesBackoffMs = nextBackoff({ ms: state.filesBackoffMs });
  }
}

/** Watch any root whose directory has appeared since, and tell the page its registers may have moved. */
function adoptAppearedRoots({ state }: { state: Broker }): void {
  if (!state.files) {
    return;
  }
  for (const root of queueWatchRoots().filter((one) => state.missingRoots.has(one.dir))) {
    try {
      watchRoot({ dir: root.dir, recursive: root.recursive, state });
    } catch {
      filesFailed({ state });
      return;
    }
    if (state.watchers.has(root.dir)) {
      gather({ slugs: queueSlugsForHomePath({ relativePath: root.dir }), state });
    }
  }
}

/**
 * The store signal went down: detach the listener and end its connection, say so, and try again after the backoff.
 * Detached FIRST, so nothing the old listener says afterwards — a late `ready` above all — reaches the broker.
 */
function storeFailed({ state }: { state: Broker }): void {
  const listener = state.storeAbort;
  state.storeAbort = undefined;
  clearTimeout(state.storeSilenceTimer);
  state.storeSilenceTimer = undefined;
  listener?.abort();
  if (state.store) {
    state.store = false;
    signalMoved({ state });
  }
  if (state.running && state.storeRetryTimer === undefined) {
    state.storeRetryTimer = setTimeout(() => {
      startStore({ state });
    }, state.storeBackoffMs);
    state.storeBackoffMs = nextBackoff({ ms: state.storeBackoffMs });
  }
}

/**
 * Give the current store listener the silence limit from now: if it says nothing alive by then it is marked down at
 * that instant and ended. A deadline rather than a check on the page heartbeat, so the store never reads up for longer
 * than the limit; and here rather than when the listener's run settles, because a round trip to a store that stopped
 * answering never settles on its own.
 */
function armStoreSilence({ state, listener }: { state: Broker; listener: AbortController }): void {
  clearTimeout(state.storeSilenceTimer);
  state.storeSilenceTimer = setTimeout(() => {
    state.storeSilenceTimer = undefined;
    if (state.storeAbort === listener) {
      storeFailed({ state });
    }
  }, STORE_SILENCE_MS);
}

/** Act on one event from the current store listener. */
function onStoreEvent({
  state,
  listener,
  event,
}: {
  state: Broker;
  listener: AbortController;
  event: StoreQueueEvent;
}): void {
  const effect = storeEventEffect({ event });
  if (effect.alive) {
    armStoreSilence({ listener, state });
  }
  if (effect.up) {
    state.store = true;
    state.storeBackoffMs = BACKOFF_FIRST_MS;
    signalMoved({ state });
  }
  gather({ slugs: effect.slugs, state });
}

/**
 * Start a store listener in this process. It opens only once the previous listener's connection is ended, so a
 * linger's stop and start, or a retry, never holds two connections at once. A listener that ends while still the
 * current one ended on its own — the store stopped answering, lacked a trigger, or had none selected — and the store
 * signal goes down.
 */
function startStore({ state }: { state: Broker }): void {
  state.storeRetryTimer = undefined;
  const listener = new AbortController();
  state.storeAbort = listener;
  armStoreSilence({ listener, state });
  state.storeRun = state.storeRun.then(() => runStoreListener({ listener, state }));
}

/** Run one store listener to its end, reporting the store down when it ended while still the current one. */
async function runStoreListener({ state, listener }: { state: Broker; listener: AbortController }): Promise<void> {
  if (listener.signal.aborted) {
    return;
  }
  try {
    await watchConsoleStoreQueue({
      emit: (event) => {
        if (state.storeAbort === listener) {
          onStoreEvent({ event, listener, state });
        }
      },
      signal: listener.signal,
    });
  } catch {
    // A throw is the same fact as an `err`: this listener is over, and the check below reports it.
  }
  if (state.storeAbort === listener) {
    storeFailed({ state });
  }
}

/** Every heartbeat: tell the page the stream lives, and adopt appeared roots. */
function beat({ state }: { state: Broker }): void {
  broadcast({ event: { atIso: new Date().toISOString(), kind: "heartbeat" }, state });
  adoptAppearedRoots({ state });
}

/** Start both signals and the heartbeat. */
function start({ state }: { state: Broker }): void {
  state.running = true;
  startFiles({ state });
  startStore({ state });
  state.heartbeatTimer = setInterval(() => {
    beat({ state });
  }, HEARTBEAT_MS);
}

/** Stop everything: nobody is listening. */
function stop({ state }: { state: Broker }): void {
  state.running = false;
  clearInterval(state.heartbeatTimer);
  clearTimeout(state.flushTimer);
  clearTimeout(state.filesRetryTimer);
  clearTimeout(state.storeRetryTimer);
  state.heartbeatTimer = undefined;
  state.flushTimer = undefined;
  state.filesRetryTimer = undefined;
  state.storeRetryTimer = undefined;
  state.batchStartedAtMs = undefined;
  state.pending.clear();
  closeFiles({ state });
  const listener = state.storeAbort;
  state.storeAbort = undefined;
  clearTimeout(state.storeSilenceTimer);
  state.storeSilenceTimer = undefined;
  listener?.abort();
  state.files = false;
  state.store = false;
  state.filesBackoffMs = BACKOFF_FIRST_MS;
  state.storeBackoffMs = BACKOFF_FIRST_MS;
}

/**
 * Listen to the broker: told at once which signals are up, then every change and heartbeat until the returned
 * function is called. The first listener starts the watches; the last one leaving stops them after a short linger.
 *
 * @param listener the page's handler
 * @returns the function that stops listening
 */
export function listenForLiveChanges({ listener }: { listener: Listener }): () => void {
  const state = broker();
  clearTimeout(state.lingerTimer);
  state.lingerTimer = undefined;
  state.listeners.add(listener);
  if (!state.running) {
    start({ state });
  }
  listener(readyEvent({ state }));
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0 && state.lingerTimer === undefined) {
      state.lingerTimer = setTimeout(() => {
        state.lingerTimer = undefined;
        if (state.listeners.size === 0) {
          stop({ state });
        }
      }, LINGER_MS);
    }
  };
}
