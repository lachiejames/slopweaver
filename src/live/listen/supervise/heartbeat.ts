/**
 * The listener's own heartbeat: the pure record shape, its parse, and the staleness verdict a supervisor
 * reads it with. No clock, no filesystem — `store.ts` owns both.
 *
 * ## Why a pidfile is not enough
 *
 * A pidfile plus `kill -0` answers exactly one question: is the process still in the process table. It
 * cannot see a listener whose Socket Mode connection died while the event loop stayed up — the shape that
 * looks healthiest and answers nothing. So the listener writes this record on a fixed interval carrying BOTH
 * facts, and a supervisor treats a stale file and a `disconnected` socket as the same class of dead.
 *
 * ## Why the file is rewritten rather than appended
 *
 * Measured: a re-armed listener appended to the SAME `stream.err` as the arm it replaced, so
 * `tail` showed "connected to Slack over Socket Mode" from a process that no longer existed and the bot
 * looked live while it was deaf. A heartbeat that appends has the identical failure. This one is a single
 * whole-file rewrite carrying the writing arm's own id, so a reading supervisor can tell WHICH arm last
 * wrote it and a beat from a dead arm cannot be mistaken for a live one.
 */

import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type ListenerStateError, ListenerStateErrors } from "./errors.js";

/** How often a `--follow` listener rewrites its heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * How long a heartbeat may go unwritten before a supervisor calls the listener dead — four missed beats.
 * Deliberately a multiple of {@link HEARTBEAT_INTERVAL_MS} rather than a round number: one missed beat is a
 * busy event loop, four in a row is not.
 */
export const HEARTBEAT_STALE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 4;

/**
 * How long after arming a listener may still have written no heartbeat at all. A Socket Mode handshake plus
 * a preflight credential read takes real seconds; treating that window as death would re-arm forever.
 */
export const HEARTBEAT_GRACE_MS = 90_000;

/**
 * How long a socket may be un-connected before a supervisor calls it dead rather than reconnecting.
 *
 * A reconnect is NORMAL, not a fault: `reconnect.ts` backs off to {@link ../reconnect.RECONNECT_MAX_MS} —
 * 30 seconds — between attempts, so an instantaneous "socketState is not connected" reading catches a
 * perfectly healthy listener mid-backoff. A supervisor acting on that would kill and re-arm a listener that
 * was about to reconnect on its own, which is both wasteful and, three times over, an escalation to the
 * owner about nothing. Ninety seconds clears the longest legitimate gap with room to spare while still
 * bounding a genuinely dead socket to well under two minutes.
 */
export const SOCKET_DOWN_AFTER_MS = 90_000;

/** What the listener reports about its own Socket Mode connection at the moment it wrote the beat. */
export type ListenerSocketState = "connecting" | "connected" | "disconnected";

/** One whole-file heartbeat, as the listener writes it and a supervisor reads it. */
export interface ListenerHeartbeat {
  /** The arm that wrote this beat. A beat carrying another arm's id is a beat from a dead process. */
  readonly armId: string;
  /** The writing process's own pid, so a reader can cross-check the pidfile against the beat. */
  readonly pid: number;
  /** When this beat was written, ISO-8601. */
  readonly writtenAtIso: string;
  /** The socket's state at that instant. */
  readonly socketState: ListenerSocketState;
  /**
   * When the socket ENTERED that state, ISO-8601 — not when this beat was written.
   *
   * Without it, "not connected" is an instant reading and cannot be told apart from a normal reconnect
   * backoff; with it, a supervisor can ask how LONG the socket has been down, which is the question that
   * actually distinguishes the two.
   */
  readonly socketStateSinceIso: string;
  /** When Slack last delivered anything on the socket, ISO-8601, or `undefined` before the first. */
  readonly lastSocketEventAtIso: string | undefined;
}

/** Whether a decoded value names one of the three socket states. */
function isSocketState(value: unknown): value is ListenerSocketState {
  return value === "connecting" || value === "connected" || value === "disconnected";
}

/**
 * Validate an already-JSON-parsed value as a {@link ListenerHeartbeat}.
 *
 * Every field is checked rather than trusted: a supervisor that accepts a half-written beat will report a
 * dead listener healthy, which is the one verdict this whole module exists to make impossible.
 *
 * @param raw the parsed JSON value read from disk
 * @returns the validated heartbeat, or the error naming the first field that did not match
 */
export function parseListenerHeartbeat({ raw }: { raw: unknown }): Result<ListenerHeartbeat, ListenerStateError> {
  if (!isRecord(raw)) {
    return err(ListenerStateErrors.invalid({ field: "heartbeat", found: raw }));
  }
  const armId = raw["armId"];
  if (typeof armId !== "string" || armId.length === 0) {
    return err(ListenerStateErrors.invalid({ field: "armId", found: armId }));
  }
  const pid = raw["pid"];
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return err(ListenerStateErrors.invalid({ field: "pid", found: pid }));
  }
  const writtenAtIso = raw["writtenAtIso"];
  if (typeof writtenAtIso !== "string" || !Number.isFinite(Date.parse(writtenAtIso))) {
    return err(ListenerStateErrors.invalid({ field: "writtenAtIso", found: writtenAtIso }));
  }
  const socketState = raw["socketState"];
  if (!isSocketState(socketState)) {
    return err(ListenerStateErrors.invalid({ field: "socketState", found: socketState }));
  }
  const socketStateSinceIso = raw["socketStateSinceIso"];
  if (typeof socketStateSinceIso !== "string" || !Number.isFinite(Date.parse(socketStateSinceIso))) {
    return err(ListenerStateErrors.invalid({ field: "socketStateSinceIso", found: socketStateSinceIso }));
  }
  const lastSocketEventAtIso = raw["lastSocketEventAtIso"];
  if (
    lastSocketEventAtIso !== undefined &&
    (typeof lastSocketEventAtIso !== "string" || !Number.isFinite(Date.parse(lastSocketEventAtIso)))
  ) {
    return err(ListenerStateErrors.invalid({ field: "lastSocketEventAtIso", found: lastSocketEventAtIso }));
  }
  return ok({
    armId,
    lastSocketEventAtIso: typeof lastSocketEventAtIso === "string" ? lastSocketEventAtIso : undefined,
    pid,
    socketState,
    socketStateSinceIso,
    writtenAtIso,
  });
}

/**
 * How old a heartbeat is, in milliseconds — negative when the beat is stamped in the future, which a caller
 * may treat as fresh but must not treat as an error (clock skew across a suspend/resume is real).
 *
 * @param heartbeat the beat to age
 * @param nowMs the current instant, epoch milliseconds
 * @returns the beat's age in milliseconds
 */
export function heartbeatAgeMs({ heartbeat, nowMs }: { heartbeat: ListenerHeartbeat; nowMs: number }): number {
  return nowMs - Date.parse(heartbeat.writtenAtIso);
}

/**
 * How long the socket has been in its current state, in milliseconds.
 *
 * @param heartbeat the beat to read
 * @param nowMs the current instant, epoch milliseconds
 * @returns the duration the socket has held its reported state
 */
export function socketStateAgeMs({ heartbeat, nowMs }: { heartbeat: ListenerHeartbeat; nowMs: number }): number {
  return nowMs - Date.parse(heartbeat.socketStateSinceIso);
}

/**
 * Whether a heartbeat is too old to be believed.
 *
 * @param heartbeat the beat to judge
 * @param nowMs the current instant, epoch milliseconds
 * @param staleAfterMs how long a beat stays believable (defaults to {@link HEARTBEAT_STALE_AFTER_MS})
 * @returns true when the beat is older than the tolerance
 */
export function isHeartbeatStale({
  heartbeat,
  nowMs,
  staleAfterMs = HEARTBEAT_STALE_AFTER_MS,
}: {
  heartbeat: ListenerHeartbeat;
  nowMs: number;
  staleAfterMs?: number;
}): boolean {
  return heartbeatAgeMs({ heartbeat, nowMs }) > staleAfterMs;
}
