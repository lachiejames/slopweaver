/**
 * One Socket Mode connection's whole lifecycle: open a ticket and then a socket, drain it, cancel it when the
 * signal fires, and say how it ended. Pulled out of `./loop.ts`, which keeps the reconnect loop and the deadline
 * race on top of this, and still owns {@link ListenDeps}.
 *
 * `ListenDeps` is imported back from `./loop.ts` as a TYPE only — the same shape `./connectionStep.ts` already
 * uses. It stays there because `./runLoop.ts` reads it, `runListenLoop` and `WORK_ARM_GRACE_MS` off one import
 * line and sits at its frozen file-size floor, so moving the type would add a line to that file.
 */

import type { DedupeState } from "../../../live/listen/dedupe.js";
import {
  type AddressStart,
  type ConnectionOutcome,
  consumeMentions,
  type SocketConnection,
} from "../../../live/listen/socket.js";
import type { ThreadReplyCounts } from "../../../live/listen/threadReply.js";
import { type ConnectionStep, stepAfterDrain } from "./connectionStep.js";
import type { ListenDeps } from "./loop.js";

/** One line summarising what a connection did, so a long session can be read without the whole log. */
function summaryLine({ outcome }: { outcome: ConnectionOutcome }): string {
  return (
    `connection ended — ${String(outcome.handled)} handled, ${String(outcome.dropped)} redelivered-and-dropped, ` +
    `${String(outcome.ignored)} ignored, ${String(outcome.refused)} refused by the responder whitelist, ` +
    `${String(outcome.failed)} failed, ` +
    // Last, and never omitted when zero. A counter that appears only when it fires is a counter nobody knows
    // to look for; a steady `0 abandoned` is what makes a `1` legible at a glance.
    `${String(outcome.abandoned)} abandoned-at-close`
  );
}

/**
 * Open a ticket and then a socket, or name which of the two failed.
 *
 * `signal` is passed straight into `openTicket`, which closes it over the in-flight request — a ticket-open
 * that is merely slow or stalled settles (rejecting) as soon as the clock wins, rather than running to its
 * own completion. What remains un-abortable is narrower and bounded rather than eliminated: a wait the
 * shared retry door takes AROUND an attempt — the rate-limit block, or the backoff sleep between retries —
 * neither of which this signal reaches, and both of which only apply after a real transient failure (a
 * genuine 429/5xx), never during the common stalled-request case this closes. `openConnection` DOES take the
 * signal for its own, separate handshake wait, and aborts promptly while the socket is still opening.
 */
async function connectOnce({
  appToken,
  deps,
  signal,
}: {
  appToken: string;
  deps: ListenDeps;
  signal: AbortSignal;
}): Promise<SocketConnection | string> {
  const ticket = await deps.openTicket({ appToken, signal });
  if (signal.aborted) {
    return "aborted-by-signal";
  }
  if (ticket.isErr()) {
    deps.log({ line: `could not open a Socket Mode ticket: ${ticket.error.message}` });
    return "ticket-open-failed";
  }
  const connection = await deps.openConnection({ signal, url: ticket.value });
  if (connection === undefined) {
    // The type checker cannot see the runtime relationship between `openConnection`'s promise resolving
    // `undefined` and this same `signal` — it can genuinely be true here, from an abort that fired while the
    // socket was still opening (see `wire.ts#waitForOpen`) — so this is reachable in production despite
    // whatever the checker infers from the earlier, unrelated check above.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (signal.aborted) {
      return "aborted-by-signal";
    }
    deps.log({ line: "the websocket did not open" });
    return "socket-open-failed";
  }
  return connection;
}

/**
 * Why a connection is being torn down, taken from the signal that asked for it.
 *
 * Both aborters state their own reason — the deadline arm and the operator's trapped signal
 * (`./stopSignal.ts`) — because this string is what the socket's `endedBecause` reports and what an
 * operator reads afterwards. It used to be the constant "the deadline expired", which became a confidently
 * wrong line the moment a human pressing Ctrl-C could reach this same path.
 *
 * @param signal the aborted signal
 * @returns the stated reason, or a neutral one when the aborter named none
 */
function abortWhy({ signal }: { signal: AbortSignal }): string {
  const reason: unknown = signal.reason;
  if (typeof reason === "string" && reason.length > 0) {
    return reason;
  }
  return "the connection was aborted";
}

/**
 * Arm an abort listener that cancels `attempt` once, without floating the teardown it starts.
 *
 * Captured rather than awaited INSIDE the listener — an abort handler cannot be async and still guarantee
 * ordering — so the caller awaits the returned getter's promise AFTER `consumeMentions` settles, never left
 * to float unawaited. Without this, `cancel`'s returned promise (wired to the socket's real `close` event)
 * would resolve on its own time, and the caller could return before the socket actually finished closing —
 * the exact gap a P3 pre-mortem found in this same spot.
 *
 * The `.catch` is attached HERE, the instant the promise is created, rather than only where it is later
 * awaited — a review pass found that a `cancel()` implementation which rejects (the interface's type
 * permits it, even though `wire.ts`'s one real implementation never does) left this promise genuinely
 * unhandled for however long it took `consumeMentions` to notice the abort and return; if it never did (a
 * connection whose frame source does not end on cancel), the rejection was unhandled forever. Caught and
 * narrated here, the returned promise itself never rejects, so awaiting it is always safe.
 *
 * @param attempt the live connection to cancel on abort
 * @param deps the injected seams — only `log` is used
 * @param signal the signal being answered, read for the reason it carries
 * @returns the listener a caller attaches to its own signal, and a getter for the teardown promise it may
 *   have started
 */
function armCancelOnAbort({
  attempt,
  deps,
  signal,
}: {
  attempt: SocketConnection;
  deps: ListenDeps;
  signal: AbortSignal;
}): {
  readonly cancelling: () => Promise<void> | undefined;
  readonly onAbort: () => void;
} {
  let cancelling: Promise<void> | undefined;
  const onAbort = (): void => {
    cancelling = attempt.cancel({ why: abortWhy({ signal }) }).catch((error: unknown): void => {
      // Guarded for the same reason settleWorkArmAfterClockWins's own narration is: deps.log carries no
      // "never throws" contract, and a throw here must not leave THIS handler's own derived promise
      // unhandled.
      try {
        deps.log({ line: `cancel failed while the deadline was winning: ${String(error)}` });
      } catch {
        // Nothing further to do — the narration itself failed.
      }
      return;
    });
  };
  return { cancelling: () => cancelling, onAbort };
}

/**
 * Every argument one drain of the loop takes, assembled — split out of {@link oneConnection} so that
 * function stays about the connection's LIFECYCLE rather than about its arguments.
 *
 * An argument BUILDER rather than a wrapper that awaits the call, deliberately. A second async frame around
 * `consumeMentions` costs one extra microtask tick per connection, and the deadline arbiter's own test (the
 * refusal-then-natural-end case in `runListenLoop — deadline mode`) measures the loop's scheduling closely
 * enough to hang on it. Building the object costs nothing.
 *
 * @param deps the injected seams, whose three optional fields are spread conditionally so an absent one is
 *   absent rather than explicitly `undefined`
 * @returns the argument object to hand straight to `consumeMentions`
 */
function drainArgs({
  addressStart,
  connection,
  deps,
  discardBufferedAfterFirst,
  once,
  seen,
  threadReplies,
}: {
  addressStart: AddressStart;
  connection: SocketConnection;
  deps: ListenDeps;
  discardBufferedAfterFirst: boolean;
  once: boolean;
  seen: DedupeState;
  threadReplies: ThreadReplyCounts;
}): Parameters<typeof consumeMentions>[0] {
  return {
    addressStart,
    allowMultipleConnections: deps.allowMultipleConnections,
    connection,
    discardBufferedAfterFirst,
    handler: deps.handler,
    log: deps.log,
    refuseResponder: deps.refuseResponder,
    responderHatchOpen: deps.responderHatchOpen,
    responderWhitelist: deps.responderWhitelist,
    scope: deps.scope,
    ...(deps.onSocketFrame === undefined ? {} : { onFrame: deps.onSocketFrame }),
    ...(deps.onHello === undefined ? {} : { onHello: deps.onHello }),
    ...(deps.selfBotId === undefined ? {} : { selfBotId: deps.selfBotId }),
    ...(deps.selfUserId === undefined ? {} : { selfUserId: deps.selfUserId }),
    seen,
    stopAfterFirst: once,
    threadReplies,
    threadReplyChannels: deps.threadReplyChannels,
  };
}

/**
 * One whole connection: open it, drain it, and say how it ended.
 *
 * `signal` covers this connection's WHOLE lifetime, not just opening it — the fix for the gap named in the
 * deadline-listener plan's own P3 pass: `openConnection`'s own abort listener is removed the moment a socket
 * opens, so nothing was left to cancel an already-open, idle connection when the clock later expired. This
 * function attaches its OWN listener the instant it holds a live connection, calling {@link
 * SocketConnection.cancel}, and removes it once the connection has ended either way — so a signal that fires
 * while idle-connected tears the socket down instead of waiting forever on a frame that never arrives.
 *
 * @returns the step the reconnect loop applies next — ended with its reason, exit, or aborted
 */
export async function oneConnection({
  addressStart,
  appToken,
  deps,
  discardBufferedAfterFirst,
  once,
  seen,
  signal,
  threadReplies,
}: {
  addressStart: AddressStart;
  appToken: string;
  deps: ListenDeps;
  discardBufferedAfterFirst: boolean;
  once: boolean;
  seen: DedupeState;
  signal: AbortSignal;
  threadReplies: ThreadReplyCounts;
}): Promise<ConnectionStep> {
  deps.onSocketState?.({ state: "connecting" });
  const attempt = await connectOnce({ appToken, deps, signal });
  if (typeof attempt === "string") {
    deps.onSocketState?.({ state: "disconnected" });
    if (signal.aborted && attempt === "aborted-by-signal") {
      return { kind: "aborted", seen, threadReplies };
    }
    return { connectionRefusal: undefined, helloPermitted: false, kind: "ended", reason: attempt, seen, threadReplies };
  }
  deps.onSocketState?.({ state: "connected" });
  const { cancelling, onAbort } = armCancelOnAbort({ attempt, deps, signal });
  signal.addEventListener("abort", onAbort);
  let drained: Awaited<ReturnType<typeof consumeMentions>>;
  try {
    drained = await consumeMentions(
      drainArgs({ addressStart, connection: attempt, deps, discardBufferedAfterFirst, once, seen, threadReplies }),
    );
  } finally {
    signal.removeEventListener("abort", onAbort);
    deps.onSocketState?.({ state: "disconnected" });
  }
  const stillCancelling = cancelling();
  if (stillCancelling !== undefined) {
    await stillCancelling;
  }
  deps.log({ line: summaryLine({ outcome: drained.outcome }) });
  return stepAfterDrain({ attempt, discardBufferedAfterFirst, drained, once, signal });
}
