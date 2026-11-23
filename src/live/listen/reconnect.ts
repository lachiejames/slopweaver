/**
 * What to do when a Socket Mode connection ends. PURE — one decision function, no timers, no sockets.
 *
 * ## A disconnect is normal, and that is the whole design constraint
 *
 * Slack rotates a Socket Mode connection routinely and it WARNS FIRST: a `disconnect` frame with reason
 * `warning` (the socket is about to be replaced) or `refresh_requested` (Slack is redeploying) arrives
 * before the close. Those are not failures, so they must not consume a failure budget and must not be waited
 * out — a listener that backs off 8 seconds every time Slack rotates a socket spends its life asleep.
 *
 * The inverse mistake is worse and is the one the doc calls out: a listener that treats the routine
 * rotation as the end and exits leaves the owner with a bot that answered for ten minutes and then quietly
 * stopped. "Worse than no listener" is exactly right — no listener at least fails visibly.
 *
 * So the two cases are separated: an EXPECTED rotation reconnects immediately with no failure recorded, and
 * an UNEXPECTED end (a socket error, an abrupt close, a ticket that could not be opened) backs off
 * exponentially and gives up loudly after {@link RECONNECT_MAX_FAILURES}.
 *
 * `link_disabled` is the third case and it terminates: Slack has turned Socket Mode off for the app, so
 * every reconnect would be refused. Spinning on it would burn the app's rate budget forever, and the fix is
 * a human enabling Socket Mode again.
 *
 * The schedule is deterministic — no jitter. One listener is one connection, so there is no thundering herd
 * to spread, and a fixed schedule is one a test can assert to the millisecond.
 */

/** The first backoff, doubled per consecutive failure. */
export const RECONNECT_BASE_MS = 1_000;

/** The backoff ceiling — a listener must keep trying at a visible cadence, not drift into hours. */
export const RECONNECT_MAX_MS = 30_000;

/** How many CONSECUTIVE failed connections end the listener rather than being retried again. */
export const RECONNECT_MAX_FAILURES = 8;

/** Slack's own reason for closing a socket, when it sent a `disconnect` frame. */
export const SLACK_LINK_DISABLED = "link_disabled";

/** The two `disconnect` reasons that mean "routine rotation", not "something is wrong". */
const EXPECTED_ROTATIONS: ReadonlySet<string> = new Set(["warning", "refresh_requested"]);

/** Reconnect after a delay, or stop and say why. */
export type ReconnectPlan =
  | { readonly kind: "reconnect"; readonly delayMs: number; readonly expected: boolean }
  | { readonly kind: "stop"; readonly why: string };

/**
 * Decide what to do after a connection ended.
 *
 * @param reason why the connection ended — a Slack `disconnect` reason, or a socket-level label
 * @param consecutiveFailures how many UNEXPECTED endings have happened in a row before this decision
 * @returns the plan: reconnect after a delay, or stop with a reason
 */
export function reconnectPlan({
  reason,
  consecutiveFailures,
}: {
  reason: string;
  consecutiveFailures: number;
}): ReconnectPlan {
  if (reason === SLACK_LINK_DISABLED) {
    return {
      kind: "stop",
      why:
        "Slack reported the Socket Mode link is disabled, so every reconnect would be refused — re-enable " +
        "Socket Mode on the app, then start `slopweaver listen` again",
    };
  }
  if (EXPECTED_ROTATIONS.has(reason)) {
    // A rotation is Slack working normally: reconnect at once, and do not spend the failure budget on it.
    return { delayMs: 0, expected: true, kind: "reconnect" };
  }
  if (consecutiveFailures >= RECONNECT_MAX_FAILURES) {
    return {
      kind: "stop",
      why:
        `${String(consecutiveFailures)} consecutive connections failed (last: ${reason}) — stopping rather ` +
        "than looping silently. Check the app-level token and that Socket Mode is enabled",
    };
  }
  return { delayMs: reconnectDelayMs({ consecutiveFailures }), expected: false, kind: "reconnect" };
}

/**
 * The backoff before the next attempt, on the one schedule every unexpected ending shares — exported so a
 * refused `hello` inside its grace window (`./connections.ts`) backs off on the same curve, counted by its own
 * streak, without spending the {@link RECONNECT_MAX_FAILURES} budget, which would otherwise end the listener
 * before the window does.
 *
 * @param consecutiveFailures how many unexpected endings (or refused `hello`s) have happened in a row before this wait
 * @returns the delay in milliseconds, doubling from {@link RECONNECT_BASE_MS} up to {@link RECONNECT_MAX_MS}
 */
export function reconnectDelayMs({ consecutiveFailures }: { consecutiveFailures: number }): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** consecutiveFailures, RECONNECT_MAX_MS);
}
