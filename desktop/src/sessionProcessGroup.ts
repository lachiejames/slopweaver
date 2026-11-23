/**
 * End a session's whole process group: the worker leads it (`sessionWorkerLaunch.ts`), and the ACP adapter and the
 * Codex app-server under it inherit it, so one negative-pid signal reaches every descendant that did not leave the
 * group on its own. SIGTERM first, so the worker can close its vendor session; SIGKILL to whatever is left after the
 * grace.
 */

/** How long the group gets to exit on SIGTERM before SIGKILL. */
export const GROUP_GRACE_MS = 5_000;

/** How often the group is looked at while it winds down. */
const POLL_MS = 100;

/**
 * Whether any process in the group is still alive.
 *
 * @param pgid the group's id — its leader's pid
 * @returns true while signal 0 reaches the group
 */
export function groupAlive({ pgid }: { pgid: number }): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means a process is there that we cannot signal — alive, and not ours to end.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * Send one signal to the whole group, saying nothing when it is already gone.
 *
 * @param pgid the group's id — its leader's pid
 * @param signal what every member is sent
 */
export function signalGroup({ pgid, signal }: { pgid: number; signal: NodeJS.Signals }): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // The group is already gone.
  }
}

/** The monotonic clock: a deadline on the wall clock moves when the owner (or NTP) sets it back. */
const monotonicMs = (): number => performance.now();

/**
 * Wait up to `ms` for every process in the group to exit.
 *
 * @param pgid the group's id — its leader's pid
 * @param ms the longest it waits, on the monotonic clock
 * @returns whether the group is gone by then
 */
export async function waitGone({ pgid, ms }: { pgid: number; ms: number }): Promise<boolean> {
  const deadline = monotonicMs() + ms;
  while (monotonicMs() < deadline) {
    if (!groupAlive({ pgid })) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return !groupAlive({ pgid });
}

/**
 * End the group: SIGTERM, wait out the grace, SIGKILL whatever remains.
 *
 * @param pgid the group's id — its leader's pid
 * @param graceMs how long SIGTERM gets
 * @returns whether SIGKILL was needed, and whether the group is gone afterwards
 */
export async function endProcessGroup({
  pgid,
  graceMs,
}: {
  pgid: number;
  graceMs: number;
}): Promise<{ readonly killed: boolean; readonly gone: boolean }> {
  signalGroup({ pgid, signal: "SIGTERM" });
  if (await waitGone({ ms: graceMs, pgid })) {
    return { gone: true, killed: false };
  }
  signalGroup({ pgid, signal: "SIGKILL" });
  return { gone: await waitGone({ ms: graceMs, pgid }), killed: true };
}

/** The effects {@link endGroupsBeforeExit} needs, so its order can be checked without real processes. */
export interface GroupSignals {
  readonly alive: (options: { readonly pgid: number }) => boolean;
  readonly signal: (options: { readonly pgid: number; readonly signal: NodeJS.Signals }) => void;
  /** Block the calling thread for about `ms`. */
  readonly pause: (options: { readonly ms: number }) => void;
  readonly now: () => number;
}

/** The real signals: `kill(2)` on the negative pid, a blocking wait, and the monotonic clock. */
export const REAL_GROUP_SIGNALS: GroupSignals = {
  alive: groupAlive,
  now: monotonicMs,
  pause: ({ ms }) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
  signal: signalGroup,
};

/**
 * End every group before the app exits, SYNCHRONOUSLY: `will-quit` does not wait for a promise, so an async sweep
 * there would be cut off at the first await and leave a stopped or slow group alive. SIGTERM to all of them, wait out
 * the grace for all of them at once, SIGKILL whatever is left — a stopped process cannot catch SIGTERM, and SIGKILL
 * ends it anyway — and wait, bounded by the grace again, until the kernel no longer lists them.
 *
 * @param pgids each group's id — its leader's pid
 * @param graceMs how long SIGTERM gets, across every group together
 * @param signals the process effects
 * @returns the groups that needed SIGKILL
 */
export function endGroupsBeforeExit({
  pgids,
  graceMs,
  signals,
}: {
  pgids: readonly number[];
  graceMs: number;
  signals: GroupSignals;
}): readonly number[] {
  for (const pgid of pgids) {
    signals.signal({ pgid, signal: "SIGTERM" });
  }
  waitAllGone({ graceMs, pgids, signals });
  const left = pgids.filter((pgid) => signals.alive({ pgid }));
  for (const pgid of left) {
    signals.signal({ pgid, signal: "SIGKILL" });
  }
  // SIGKILL is delivered, not done: the app must not exit while the kernel still lists a process it started.
  waitAllGone({ graceMs, pgids: left, signals });
  return left;
}

function waitAllGone({
  pgids,
  graceMs,
  signals,
}: {
  pgids: readonly number[];
  graceMs: number;
  signals: GroupSignals;
}): void {
  const deadline = signals.now() + graceMs;
  while (signals.now() < deadline && pgids.some((pgid) => signals.alive({ pgid }))) {
    signals.pause({ ms: POLL_MS });
  }
}
