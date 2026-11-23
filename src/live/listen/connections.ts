/**
 * Refusing a second Socket Mode connection: the pure decisions behind it, and the one `hello` handler that acts
 * on them for `./socket.ts`.
 *
 * Slack's `hello` frame carries `num_connections`, and this repo's listener has always logged when it goes
 * above one — proof a tag can be silently load-balanced away to a listener that will never answer it, since
 * only one Slack connection at a time is this bot's own operating model. Detection alone leaves the owner to
 * notice a printed line; this turns it into a refusal.
 *
 * The escape hatch is an ambient environment break-glass (`src/hatch/listenConnectionHatches.ts`) rather
 * than a CLI flag: the violation is only discovered after the
 * websocket has already opened and Slack has sent `hello`, so there is no argv moment to attach a flag to.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { ListenLog, SocketConnection } from "./socket.js";

/** The environment break-glass for this refusal — resolved once by the caller and handed in as a boolean. */
export const ALLOW_MULTIPLE_SOCKET_CONNECTIONS_ENV = "SLOPWEAVER_ALLOW_MULTIPLE_SOCKET_CONNECTIONS";

/** What to do about one `hello` frame's reported connection count. */
export interface SocketConnectionPermit {
  readonly line: string;
}

/** Why a second Socket Mode connection was refused. */
export interface MultipleConnectionsRefusal {
  readonly kind: "multiple-connections";
  readonly connections: number;
  readonly message: string;
}

/**
 * Decide whether to proceed on this `hello`'s reported connection count.
 *
 * Missing, zero or one connection always proceeds — this refuses only the known collision signal, not a
 * count Slack did not send. With the override, an over-one count still proceeds, but loudly: the caller must
 * never treat this as silent.
 *
 * @param connections the `hello` frame's `num_connections`, or `undefined` when Slack did not send one
 * @param allowMultipleConnections the resolved break-glass — `true` bypasses the refusal, loudly
 * @returns the permit line to log, or the typed refusal
 */
export function socketConnectionPermit({
  connections,
  allowMultipleConnections,
}: {
  connections: number | undefined;
  allowMultipleConnections: boolean;
}): Result<SocketConnectionPermit, MultipleConnectionsRefusal> {
  if (connections === undefined || connections <= 1) {
    return ok({ line: "connected to Slack over Socket Mode" });
  }
  const message =
    `Slack reports ${String(connections)} connections for this app — a tag can be delivered to either one, ` +
    "and only one of them will answer. Stop the other listener and retry.";
  if (allowMultipleConnections) {
    return ok({
      line: `connected to Slack over Socket Mode — ${message} OVERRIDDEN by ${ALLOW_MULTIPLE_SOCKET_CONNECTIONS_ENV}=1`,
    });
  }
  return err({ connections, kind: "multiple-connections", message });
}

/**
 * Handle Slack's `hello` frame: refuse and cancel on a second connection with no override, otherwise record
 * the permit, log and proceed.
 *
 * @param connections the frame's `num_connections`, or `undefined` when Slack sent none
 * @param allowMultipleConnections the resolved break-glass, handed to {@link socketConnectionPermit}
 * @param onHello where a reported count goes, before the permit decides
 * @param state the connection's own record of how its `hello` went, written here
 */
export async function handleHello({
  allowMultipleConnections,
  connection,
  connections,
  log,
  onHello,
  state,
}: {
  allowMultipleConnections: boolean;
  connection: Pick<SocketConnection, "cancel">;
  connections: number | undefined;
  log: ListenLog;
  onHello: (args: { connections: number }) => void;
  state: { connectionRefusal: MultipleConnectionsRefusal | undefined; helloPermitted: boolean };
}): Promise<void> {
  // Reported BEFORE the permit decides, so the reading that matters most — the one attached to a refusal —
  // is the one that survives. A `hello` carrying no count reports nothing rather than a fabricated zero.
  if (connections !== undefined) {
    onHello({ connections });
  }
  const permit = socketConnectionPermit({ allowMultipleConnections, connections });
  if (permit.isErr()) {
    state.connectionRefusal = permit.error;
    log({ line: `REFUSED: ${permit.error.message}` });
    // Cancellation, not a graceful close — a buffered mention must not be handled after the authoritative
    // `hello` has already failed policy. See `./socket.ts`'s module doc.
    await connection.cancel({ why: "multiple Socket Mode connections" });
    return;
  }
  state.helloPermitted = true;
  log({ line: permit.value.line });
}

/**
 * How long a run of refused `hello`s is retried before the listener exits on one.
 *
 * `num_connections` is what Slack still HOLDS for the app, and a socket this process just lost keeps counting
 * until Slack notices it is gone. MEASURED (repro: `grep <arm-id>
 * ~/.slopweaver/ledgers/loop-breakage.jsonl`, then the arm's own log under `~/.slopweaver/live/listener/logs/`):
 * an arm's socket errored, its reconnect 4s later was told `2` with no other listener on the host, and
 * the supervisor's re-arm about 25s later was told `1`. Two minutes is several times that drain, and on the
 * reconnect schedule it buys a ninth authoritative `hello` that ninety seconds would not. A count still above
 * one after it is a real second listener, or a retention this window does not cover; either way the process
 * exits loudly rather than looping.
 */
export const MULTIPLE_CONNECTIONS_GRACE_MS = 120_000;

/** Retry a refused `hello` inside the grace window, or give up on it — both carrying the streak's timing. */
export type MultipleConnectionsGraceDecision = {
  readonly kind: "retry" | "refuse";
  /** When the current streak of refused `hello`s began. */
  readonly firstRefusalAtMs: number;
  /** How long the streak has run, at this decision. */
  readonly waitedMs: number;
};

/**
 * Judge one refused `hello` against the streak it belongs to. PURE — the caller owns the clock and the streak.
 *
 * A refusal with no streak open starts one at `nowMs` and is always retried; a later one is retried while the
 * streak is younger than `windowMs`, and refused once it is not. Only a PERMITTED `hello` ends a streak, which
 * the caller does by forgetting `firstRefusalAtMs`.
 *
 * The streak's age is the LONGER of the wall-clock distance and the backoff it has already waited out. The
 * production clock is `Date.now()`, which a system clock adjustment can move backward — a review pass showed a
 * rollback mid-streak retrying past the window — while the backoff runs on timers, so it is a lower bound on
 * real elapsed time that no adjustment can shrink.
 *
 * @param backedOffMs the backoff the open streak has already waited, summed — `0` when this refusal opens one
 * @param firstRefusalAtMs when the open streak began, or `undefined` when this refusal is the first of one
 * @param nowMs the instant of this refusal
 * @param windowMs how long a streak may run before a refusal ends the listener
 * @returns retry or refuse, with the streak's start and its age
 */
export function multipleConnectionsGraceDecision({
  backedOffMs,
  firstRefusalAtMs,
  nowMs,
  windowMs,
}: {
  backedOffMs: number;
  firstRefusalAtMs: number | undefined;
  nowMs: number;
  windowMs: number;
}): MultipleConnectionsGraceDecision {
  if (firstRefusalAtMs === undefined) {
    return { firstRefusalAtMs: nowMs, kind: "retry", waitedMs: 0 };
  }
  const waitedMs = Math.max(nowMs - firstRefusalAtMs, backedOffMs);
  return { firstRefusalAtMs, kind: waitedMs < windowMs ? "retry" : "refuse", waitedMs };
}
