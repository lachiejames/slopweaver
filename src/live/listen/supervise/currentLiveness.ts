/**
 * The listener's liveness as it stands right now: both signals read off the home and judged by
 * `./liveness.ts`. Every reader that grades the listener — `listen status`, `supervise`, a scheduled
 * recovery's end-of-sweep check, a standing session's freshness — asks here, so they share one verdict and
 * never a re-derivation.
 */
import { type ListenerLiveness, listenerLiveness } from "./liveness.js";
import { readListenerArm, readListenerHeartbeat } from "./store.js";

/**
 * Whether a pid is in the process table — `kill(pid, 0)`, the one check with no command-line pattern to
 * self-match. The monitor this replaced ran `pgrep -f "…listen --follow"`, whose target string was part of
 * the monitor's OWN command line, so it reported "alive" whether or not a listener existed.
 *
 * @returns whether the pid is alive (in the table, ours or not)
 */
export function pidAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means the process EXISTS and belongs to someone else — alive, just not ours to signal.
    return error !== null && typeof error === "object" && "code" in error && error["code"] === "EPERM";
  }
}

/**
 * Read both liveness signals and judge them. A signal that will not READ is treated as absent, and said so.
 *
 * @param home the Slopweaver home
 * @param nowMs the current instant, epoch milliseconds
 * @returns the verdict, and every signal that could not be read
 */
export function currentLiveness({ home, nowMs }: { home: string; nowMs: number }): {
  readonly liveness: ListenerLiveness;
  readonly problems: readonly string[];
} {
  const problems: string[] = [];
  const arm = readListenerArm({ home });
  if (arm.isErr()) {
    problems.push(arm.error.message);
    return { liveness: { state: "unarmed" }, problems };
  }
  const heartbeat = readListenerHeartbeat({ home });
  if (heartbeat.isErr()) {
    problems.push(heartbeat.error.message);
  }
  return {
    liveness: listenerLiveness({
      arm: arm.value,
      heartbeat: heartbeat.isOk() ? heartbeat.value : undefined,
      nowMs,
      pidAlive: arm.value === undefined ? false : pidAlive({ pid: arm.value.pid }),
    }),
    problems,
  };
}
