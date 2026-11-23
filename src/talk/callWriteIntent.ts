/**
 * A call append's intent, published before it waits for the call's lock, so a fence that reads the owner's words
 * (`./callFence.ts`) gives way to every append already waiting rather than winning the lock's polling race and
 * approving words a batch the page already sent would cut. The lock (`./callLock.ts`) has no
 * queue, so without this an append polling for it could lose to the fence and land its retroactively ordered line
 * just after the approval was recorded.
 *
 * One file per waiting append, `<callId>.jsonl.intent.<pid>.<n>` beside the call, naming its holder as a lock does.
 * The name does not end `.jsonl`, so no reader of the calls directory takes it for a call. An intent whose holder is
 * gone — killed mid-wait — never holds a fence back: only a running holder's counts. An append announced after the
 * fence's check is one the record had not admitted when the words were read, the same as speech not yet sent.
 *
 * The one exception is the transcript route's HANDOFF (`<callId>.jsonl.intent.handoff.<pid>.<n>`,
 * `site/lib/writerIntent.ts`): the verb it spawns can outlive it, so a handoff counts after its route is gone until
 * it is {@link HANDOFF_MS} old, and the verb writes nothing once it has lapsed ({@link handoffOpen}).
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { sleepSync } from "../lib/sleepSync.js";

import { holdCallLock } from "./callLock.js";
import { holderLine, holderOf, holderRunning, type StartOf } from "./relayLease.js";

/** The intent files' infix, after the call file's own name. */
const INTENT_INFIX = ".intent.";

/** How long a fence pauses, lock let go, for a waiting append to take it. */
const DRAIN_POLL_MS = 20;

/** What marks a route's handoff intent (`site/lib/writerIntent.ts`), after {@link INTENT_INFIX}. */
const HANDOFF_INFIX = `${INTENT_INFIX}handoff.`;

/**
 * How long a route's handoff counts once the route that wrote it is gone: the route's own bound on the verb it spawned
 * (`site/lib/talkCallAppend.ts`'s `TRANSCRIPT_TIMEOUT_MS`, bound to this by `writerRunIntent.test.ts`). A run starting
 * later than this refuses to write ({@link handoffOpen}), so a fence never has to wait on it.
 */
export const HANDOFF_MS = 120_000;

/** A counter keeping two intents of one process apart. */
let issued = 0;

/**
 * Publish that an append of this call is about to wait for its lock.
 *
 * @param path the call file
 * @param pid the pid the appending process names itself by
 * @param start that process's start stamp, or `undefined` when `ps` gave none
 * @returns what withdraws the intent, run once the append is done or has given up
 */
export function announceCallWrite({
  path,
  pid,
  start,
}: {
  path: string;
  pid: number;
  start: string | undefined;
}): () => void {
  issued += 1;
  const intent = `${path}${INTENT_INFIX}${String(pid)}.${String(issued)}`;
  writeFileSync(intent, `${holderLine({ pid, start })}\n`, { flag: "wx", mode: 0o600 });
  return () => {
    rmSync(intent, { force: true });
  };
}

/**
 * How many appends of this call are waiting for its lock. An intent whose holder is gone is not counted; one whose line
 * does not read is — it may be mid-write, and a fence that waits on it fails closed. A calls directory that is not
 * there holds no append; one that cannot be listed throws, since what it holds is unknown.
 *
 * @param path the call file
 * @param startOf a pid's current start time — injected so a dead holder is a fixture, not a process
 * @param now the clock a handoff's age is judged by
 * @returns the number of intents beside the call that may still be waiting
 */
export function pendingCallWrites({
  path,
  startOf,
  now = Date.now,
}: {
  path: string;
  startOf: StartOf;
  now?: () => number;
}): number {
  const prefix = `${basename(path)}${INTENT_INFIX}`;
  return pendingIn({ dir: dirname(path), named: (name) => name.startsWith(prefix), now, startOf });
}

/**
 * Wait, holding no lock, until no append of ANY call in the directory is waiting — what a reader whose call is found by
 * reading every call (a relay turn's, `./approvalRelayRead.ts`'s `approvalCallId`) owes before it picks one: an append
 * waiting on another call could move the relay there. Bounded by `waitMs`, after which it throws.
 *
 * @param dir the calls directory
 * @param startOf a pid's current start time — injected so a holder is a fixture, not a process
 * @param waitMs how long to wait for every waiting append to land
 * @param now the deadline's clock, injected so a test can tick it
 * @param pause what runs between tries, the poll's sleep — injected so a test can be the waiting append
 */
export function awaitCallsDrained({
  dir,
  startOf,
  waitMs,
  now = Date.now,
  pause = () => {
    sleepSync({ ms: DRAIN_POLL_MS });
  },
}: {
  dir: string;
  startOf: StartOf;
  waitMs: number;
  now?: () => number;
  pause?: () => void;
}): void {
  awaitNone({
    count: () => pendingAnyCallWrites({ dir, now, startOf }),
    now,
    pause,
    waitMs,
    what: `call append(s) in ${dir}`,
  });
}

/**
 * Wait, holding no lock, until no write of one file is waiting — what a fence that holds no lock on the card-landing
 * ledger owes it LAST, since every transcript or landing run announces on the ledger first (`./writerRunIntent.ts`):
 * so any run already admitted is seen by this check. Bounded by `waitMs`, after which it throws.
 *
 * @param path the file whose writes are waited for
 * @param startOf a pid's current start time — injected so a holder is a fixture, not a process
 * @param waitMs how long to wait for every waiting write to land
 * @param now the deadline's clock, injected so a test can tick it
 * @param pause what runs between tries, the poll's sleep — injected so a test can be the waiting writer
 */
export function awaitWritesDrained({
  path,
  startOf,
  waitMs,
  now = Date.now,
  pause = () => {
    sleepSync({ ms: DRAIN_POLL_MS });
  },
}: {
  path: string;
  startOf: StartOf;
  waitMs: number;
  now?: () => number;
  pause?: () => void;
}): void {
  awaitNone({
    count: () => pendingCallWrites({ now, path, startOf }),
    now,
    pause,
    waitMs,
    what: `write(s) of ${path}`,
  });
}

/** Poll `count` until it is zero, pausing between tries, and throw once it is still not past `waitMs`. */
function awaitNone({
  count,
  now,
  pause,
  waitMs,
  what,
}: {
  count: () => number;
  now: () => number;
  pause: () => void;
  waitMs: number;
  what: string;
}): void {
  const deadline = now() + waitMs;
  for (;;) {
    const waiting = count();
    if (waiting === 0) {
      return;
    }
    if (now() > deadline) {
      throw new Error(`${String(waiting)} ${what} were still waiting after ${String(waitMs)} ms`);
    }
    pause();
  }
}

/**
 * How many appends of ANY call in the directory may still be waiting — what a relay's fence re-reads last, under its
 * locks, before the approval is recorded.
 *
 * @param dir the calls directory
 * @param startOf a pid's current start time — injected so a holder is a fixture, not a process
 * @param now the clock a handoff's age is judged by
 * @returns the number of call intents in the directory that may still be waiting
 */
export function pendingAnyCallWrites({
  dir,
  startOf,
  now = Date.now,
}: {
  dir: string;
  startOf: StartOf;
  now?: () => number;
}): number {
  return pendingIn({ dir, named: (name) => name.includes(`.jsonl${INTENT_INFIX}`), now, startOf });
}

/** How many intents in a directory, of the names `named` admits, may still be a waiting append. */
function pendingIn({
  dir,
  named,
  now,
  startOf,
}: {
  dir: string;
  named: (name: string) => boolean;
  now: () => number;
  startOf: StartOf;
}): number {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return 0;
    }
    throw cause;
  }
  return names.filter((name) => named(name) && intentWaiting({ intent: join(dir, name), now, startOf })).length;
}

/**
 * A writer's hold on a call's or the landing ledger's lock: its intent announced before the wait and withdrawn while it
 * still holds the lock, so a drained hold ({@link holdDrainedCallLock}) never overtakes it and never waits on it once
 * it is done.
 *
 * @param path the file the lock guards
 * @param pid the pid the writer names itself by
 * @param startOf a pid's current start time — injected so a holder is a fixture, not a process
 * @param waitMs how long to wait for the lock
 * @returns what withdraws the intent and releases the lock
 */
export function holdAnnouncedLock({
  path,
  pid,
  startOf,
  waitMs,
}: {
  path: string;
  pid: number;
  startOf: StartOf;
  waitMs: number;
}): () => void {
  const withdraw = announceCallWrite({ path, pid, start: startOf(pid).start });
  let release: () => void;
  try {
    release = holdCallLock({ path, pid, startOf, waitMs });
  } catch (cause) {
    withdraw();
    throw cause;
  }
  return () => {
    try {
      withdraw();
    } finally {
      release();
    }
  };
}

/**
 * Take a call's lock only once no append is waiting for it: holding the lock, count the waiting appends, and while any
 * is, let the lock go so it can run, pause, and try again — so whatever the page already sent is in the call file
 * before a fence reads it. Bounded by `waitMs` across every try, after which it throws, failing the read closed.
 *
 * @param path the call file
 * @param pid the pid the fencing process names itself by
 * @param startOf a pid's current start time — injected so a holder is a fixture, not a process
 * @param waitMs how long, in all, to wait for the lock and for the appends to drain
 * @param now the deadline's clock, injected so a test can tick it
 * @param pause what runs between tries, the poll's sleep — injected so a test can be the waiting append
 * @returns what releases the lock, taken with no append waiting
 */
export function holdDrainedCallLock({
  path,
  pid,
  startOf,
  waitMs,
  now = Date.now,
  pause = () => {
    sleepSync({ ms: DRAIN_POLL_MS });
  },
}: {
  path: string;
  pid: number;
  startOf: StartOf;
  waitMs: number;
  now?: () => number;
  pause?: () => void;
}): () => void {
  const deadline = now() + waitMs;
  for (;;) {
    const release = holdCallLock({ now, path, pid, startOf, waitMs: Math.max(0, deadline - now()) });
    let waiting: number;
    try {
      waiting = pendingCallWrites({ now, path, startOf });
    } catch (cause) {
      release();
      throw cause;
    }
    if (waiting === 0) {
      return release;
    }
    release();
    if (now() > deadline) {
      throw new Error(`${String(waiting)} append(s) of ${path} were still waiting after ${String(waitMs)} ms`);
    }
    pause();
  }
}

/**
 * Whether a route's handoff is still open: there, and younger than {@link HANDOFF_MS}. A `talk transcript` run checks it
 * AFTER announcing itself, and writes nothing when it is not — so a fence that passed the handoff as lapsed can never be
 * followed by that run's write, and a fence before then saw the handoff or the run.
 *
 * @param intent the handoff intent the route named
 * @param now the clock both sides judge the age by
 * @returns whether the run may write under it
 */
export function handoffOpen({ intent, now = Date.now }: { intent: string; now?: () => number }): boolean {
  if (!basename(intent).includes(HANDOFF_INFIX)) {
    return false;
  }
  const age = intentAge({ intent, now });
  return age !== undefined && age <= HANDOFF_MS;
}

/** How long ago an intent was written, or `undefined` once it is withdrawn. */
function intentAge({ intent, now }: { intent: string; now: () => number }): number | undefined {
  try {
    return now() - statSync(intent).mtimeMs;
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
}

/**
 * Whether one intent file may still be an append waiting: its holder running, its line not yet readable, or — for a
 * route's handoff — younger than {@link HANDOFF_MS}, since the run it spawned can outlive the route.
 */
function intentWaiting({ intent, now, startOf }: { intent: string; now: () => number; startOf: StartOf }): boolean {
  let text: string;
  try {
    text = readFileSync(intent, "utf8");
  } catch (cause) {
    // Withdrawn between the listing and the read: that append is done.
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return false;
    }
    throw cause;
  }
  const holder = holderOf({ text: text.trim() });
  if (holder === undefined || holderRunning({ holder, startOf })) {
    return true;
  }
  return handoffOpen({ intent, now });
}
