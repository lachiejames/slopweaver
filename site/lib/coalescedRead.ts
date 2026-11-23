/*
 * One read per key at a time, only so many keys at once, and a settled answer held a short while. A hover window
 * opens and closes as the pointer moves, and each opening asks its route again; the route spawns a CLI child that a
 * closed window's abort cannot reach. So the route REUSES a read already running for the same key rather than
 * spawning a second, answers a revisit inside `holdMs` with the read that just settled, success or failure, rather
 * than spawning again: a pointer passing back over a chip, or a provider that just said "slow
 * down", costs no second child.
 *
 * Past `limit` keys at once a new key WAITS for the read ahead of it rather than being refused outright, because
 * moving from one channel chip to the next is ordinary use. A waiter is answered `busy` only
 * when (a) another waiter took the freed slot first — waiters for different keys are not FIFO, every one wakes on a
 * settle and the first continuation wins — (b) its own request was aborted, a closed window, so no child is ever
 * started for a caller that is gone, or (c) its `waitMs` bound passed. Once a caller has waited,
 * the abort and the bound are checked before it may even JOIN a same-key read another waiter just started, so an
 * abandoned or expired caller never adopts work begun after it gave up, and a caller that aborts
 * after joining is answered `busy` at once. Each call holds one timer and one abort listener,
 * both released by the time it answers. The deadline is read off the caller's `now`, so the
 * route passes a monotonic clock: a wall-clock step cannot end a live wait early.
 *
 * The map hangs off `globalThis` under a symbol, as `./meetingLedger.ts` does: a dev reload re-evaluates the route
 * module while its children keep running, and a module-level map would start empty beside them.
 */

/** One key's read: its answer, and when it settled, absent while it is still running. */
export interface CoalescedEntry<T> {
  readonly answer: Promise<T>;
  settledAtMs: number | undefined;
}

/** Wait `ms`, or less: the promise resolves as soon as `signal` aborts, and an aborted wait holds no timer. */
export type Pause = (args: { ms: number; signal: AbortSignal }) => Promise<void>;

/**
 * The one read map for `name` in this server process, made on first use and surviving a module reload.
 *
 * @param name which route's reads; one name, one map
 * @returns the process-global map
 */
export function processReadMap<T>({ name }: { name: string }): Map<string, CoalescedEntry<T>> {
  const key = Symbol.for(`slopweaver.coalescedRead.${name}`);
  const holder = globalThis as typeof globalThis & { [key: symbol]: Map<string, CoalescedEntry<T>> | undefined };
  let found = holder[key];
  if (found === undefined) {
    found = new Map<string, CoalescedEntry<T>>();
    holder[key] = found;
  }
  return found;
}

/**
 * A {@link Pause} over a timer pair: one timer per call, and on the signal's abort that exact timer is cleared and the
 * wait resolves. The pair is passed in so the clearing is witnessed without a real clock.
 *
 * @param setTimer arm one timer that calls `fire` after `ms`, returning its handle
 * @param clearTimer disarm the timer `setTimer` returned
 * @returns the pause
 */
export function timerPause<H>({
  setTimer,
  clearTimer,
}: {
  setTimer: (args: { ms: number; fire: () => void }) => H;
  clearTimer: (args: { handle: H }) => void;
}): Pause {
  return ({ ms, signal }) =>
    new Promise<void>((resolve) => {
      // Both re-read after `setTimer`, which may fire or abort synchronously — a call TypeScript's narrowing does
      // not see, so neither is a narrowed local.
      const aborted = (): boolean => signal.aborted;
      const timer = { fired: false };
      if (aborted()) {
        resolve();
        return;
      }
      // Armed BEFORE any listener exists, then the signal re-read, so an abort raised while `setTimer` runs still
      // finds the handle to clear.
      let listening = false;
      const handle = setTimer({
        fire: () => {
          timer.fired = true;
          if (listening) {
            signal.removeEventListener("abort", onAbort);
          }
          resolve();
        },
        ms,
      });
      function onAbort(): void {
        clearTimer({ handle });
        resolve();
      }
      if (timer.fired) {
        return;
      }
      if (aborted()) {
        onAbort();
        return;
      }
      listening = true;
      signal.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Drop the settled entries past their hold and collect the running reads' answers. Mutates `reads`.
 *
 * @param at the instant a settled entry's age is read against
 * @returns the answers of the reads still running
 */
function runningAnswers<T>({
  reads,
  at,
  holdMs,
}: {
  reads: Map<string, CoalescedEntry<T>>;
  at: number;
  holdMs: number;
}): readonly Promise<T>[] {
  const running: Promise<T>[] = [];
  for (const [held, entry] of reads) {
    if (entry.settledAtMs === undefined) {
      running.push(entry.answer);
    } else if (at - entry.settledAtMs >= holdMs) {
      reads.delete(held);
    }
  }
  return running;
}

/** Start `run` under `key`, the entry in the map before `run` runs. */
async function startRead<T>({
  key,
  reads,
  now,
  run,
}: {
  key: string;
  reads: Map<string, CoalescedEntry<T>>;
  now: () => number;
  run: () => Promise<T>;
}): Promise<T> {
  // The entry is in the map BEFORE `run` is called, so a read that asks again synchronously from inside its own `run`
  // joins itself and counts against the limit rather than starting a second child.
  // And `run` is called synchronously, in the same turn as the caller's live-signal check, so no abort can land
  // between admission and the child's start.
  const started = Promise.withResolvers<T>();
  const entry: CoalescedEntry<T> = {
    answer: started.promise.finally(() => {
      entry.settledAtMs = now();
    }),
    settledAtMs: undefined,
  };
  reads.set(key, entry);
  try {
    started.resolve(run());
  } catch (cause: unknown) {
    started.reject(cause);
  }
  return entry.answer;
}

/** Swallow a running read's outcome: a waiter only needs to know it ended. */
function ended(): void {
  return undefined;
}

/**
 * Answer `run`'s read for `key`: the one already running for it, else the one that settled for it within `holdMs`,
 * else a new read once fewer than `limit` keys are running — waiting up to `waitMs` for that — else `busy`. A settled
 * entry past its hold is dropped as it is next looked at, so the map holds at most the running reads and the recent
 * answers.
 *
 * @param key what makes two reads the same read
 * @param reads the reads running and recently settled, keyed; the caller owns it, so one route shares one map
 * @param limit how many distinct keys may be running at once
 * @param holdMs how long a settled answer is reused for the same key
 * @param waitMs how long a new key may wait for a running slot; `0` answers `busy` at once
 * @param now the clock a settled answer's age and the wait's deadline are read off
 * @param pause the one wait this call arms for `waitMs`, released when the call returns
 * @param signal the caller's own abort; once it fires, nothing is joined or started for this caller
 * @param run start the read
 * @param busy the answer when no slot came free for this caller
 * @returns the read's answer
 */
export async function coalescedRead<T>({
  key,
  reads,
  limit,
  holdMs,
  waitMs,
  now,
  pause,
  signal,
  run,
  busy,
}: {
  key: string;
  reads: Map<string, CoalescedEntry<T>>;
  limit: number;
  holdMs: number;
  waitMs: number;
  now: () => number;
  pause: Pause;
  signal: AbortSignal;
  run: () => Promise<T>;
  busy: () => T;
}): Promise<T> {
  // Two lifetimes: the wait's timer is released the moment admission decides, the caller's abort listener only once
  // this call's answer has settled, because a caller that aborts after joining a read is answered `busy` at once
  // rather than handed a read it no longer wants.
  const waiting = new AbortController();
  const listening = new AbortController();
  const deadline = now() + waitMs;
  // Latched off the timer as well as read off the clock, so a clock stepped backwards cannot turn a pause that has
  // already resolved into a loop that never waits again.
  let timerFired = false;
  const bound = (async (): Promise<void> => {
    await pause({ ms: waitMs, signal: waiting.signal });
    timerFired = true;
  })();
  const abandoned = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true, signal: listening.signal },
    );
  });
  const admit = async (): Promise<{ readonly answer: Promise<T> } | undefined> => {
    try {
      let waited = false;
      for (;;) {
        const running = runningAnswers({ at: now(), holdMs, reads });
        const pastBound = timerFired || now() >= deadline;
        if (signal.aborted || (waited && pastBound)) {
          return undefined;
        }
        const found = reads.get(key);
        if (found !== undefined) {
          return { answer: found.answer };
        }
        if (running.length < limit) {
          return { answer: startRead({ key, now, reads, run }) };
        }
        if (pastBound) {
          return undefined;
        }
        await Promise.race([bound, abandoned, ...running.map((answer) => answer.then(ended, ended))]);
        waited = true;
      }
    } finally {
      waiting.abort();
    }
  };
  try {
    const admitted = await admit();
    if (admitted === undefined) {
      return busy();
    }
    return await Promise.race([admitted.answer, abandoned.then(busy)]);
  } finally {
    listening.abort();
  }
}
