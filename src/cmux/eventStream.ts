/**
 * A live subscription to cmux's event stream, on its own connection.
 *
 * `events.stream` is not a request/response method: cmux answers it with one ack frame and then keeps the
 * connection open, pushing a frame per hook firing until the caller hangs up. Measured — five ordinary calls
 * written down the same connection after subscribing produced no replies at all, which is why this takes its
 * own socket rather than sharing `socket.ts`'s multiplexed one.
 *
 * Reconnection is the caller's `--follow` loop, not a hidden retry in here: a resumed subscription needs the
 * cursor the caller committed (`./eventState/`), and a supervisor that silently re-subscribes from
 * `latest` would look healthy while having skipped exactly the events it exists to catch.
 */
import { createConnection } from "node:net";

import { type Deferred, deferred } from "../lib/deferred.js";
import { err, ok, type Result } from "../lib/result.js";
import { type CmuxError, CmuxErrors } from "./errors.js";
import { dispatchFrames, endingOf, refusedError } from "./eventStreamEnding.js";
import { type CmuxEvent, type CmuxEventAck } from "./events.js";
import { encodeRequest, splitFrames } from "./socketFrames.js";
import { productionSocketPathSources, resolveCmuxSocketEndpoint } from "./socketPath.js";

/** What a subscriber is told, as it happens. */
export interface CmuxEventHandlers {
  /** The subscription opened. `ack.gap` true means the requested cursor had already aged out. */
  readonly onAck: (options: { ack: CmuxEventAck }) => void;
  /** One event arrived. */
  readonly onEvent: (options: { event: CmuxEvent }) => void;
  /** The subscription ended — cleanly (`error` undefined) or because the socket failed. */
  readonly onEnd: (options: { error: CmuxError | undefined }) => void;
}

/** A subscription's filters and resume point. */
export interface CmuxEventSubscription {
  /** Resume strictly after this sequence number; omit to start from the live edge. */
  readonly afterSeq?: number;
  /** Only these event names; empty means every name. */
  readonly names?: readonly string[];
  /** Only these categories (`agent`, `feed`, `sidebar`, `notification`); empty means every category. */
  readonly categories?: readonly string[];
}

/** A running subscription. */
export interface CmuxEventStream {
  /** Hang up. Safe to call more than once; `onEnd` fires exactly once. */
  readonly close: () => void;
}

/**
 * The `events.stream` params for one subscription, omitting every filter the caller left unset.
 *
 * `heartbeat: false` always: cmux's 15-second keepalive frame is not an event, and every consumer here either
 * drains to a quiet edge or follows indefinitely, so a heartbeat only ever resets a quiet timer that is
 * measuring exactly the thing it would hide.
 *
 * @param subscription the resume point and filters
 * @returns the params to send with `events.stream`
 */
function subscriptionParams({
  subscription,
}: {
  subscription: CmuxEventSubscription;
}): Readonly<Record<string, unknown>> {
  return {
    ...(subscription.afterSeq === undefined ? {} : { after_seq: subscription.afterSeq }),
    ...(subscription.names === undefined || subscription.names.length === 0 ? {} : { names: subscription.names }),
    ...(subscription.categories === undefined || subscription.categories.length === 0
      ? {}
      : { categories: subscription.categories }),
    heartbeat: false,
  };
}

/**
 * Open a live event subscription.
 *
 * The capability rides only the subscribe frame: once cmux answers it, the connection is a one-way feed and
 * nothing else is ever written. A `cmuxOnly` refusal ends the stream with SOCKET_UNAVAILABLE in cmux's own
 * words — never the clean end a bare close would otherwise read as.
 *
 * @param subscription the resume point and filters
 * @param handlers what to call as frames arrive
 * @param socketPath the socket to connect to; the live one ({@link resolveCmuxSocketEndpoint}) when omitted
 * @param capability the token presented on the subscribe frame; the environment's for the live socket only
 * @returns the running subscription
 */
export function openCmuxEventStream({
  subscription,
  handlers,
  socketPath: named,
  capability: namedCapability,
}: {
  subscription: CmuxEventSubscription;
  handlers: CmuxEventHandlers;
  socketPath?: string;
  capability?: string;
}): CmuxEventStream {
  const { socketPath, capability } = resolveCmuxSocketEndpoint({
    capability: namedCapability,
    socketPath: named,
    sources: productionSocketPathSources(),
  });
  let buffer = "";
  let ended = false;
  const socket = createConnection({ path: socketPath });
  socket.setEncoding("utf8");
  const end = ({ error }: { error: CmuxError | undefined }): void => {
    if (ended) {
      return;
    }
    ended = true;
    handlers.onEnd({ error });
  };
  const subscribe = encodeRequest({
    capability,
    id: "sw-events",
    method: "events.stream",
    params: subscriptionParams({ subscription }),
  });
  socket.on("connect", () => socket.write(subscribe));
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    const split = splitFrames({ buffer });
    buffer = split.remainder;
    const refusal = dispatchFrames({ capability, frames: split.frames, handlers });
    if (refusal !== undefined) {
      end({ error: refusedError({ refusal, socketPath }) });
      socket.destroy();
    }
  });
  socket.on("error", (error: Error) => {
    end({ error: endingOf({ buffer, capability, cause: error, socketPath }) });
    socket.destroy();
  });
  socket.on("close", () => {
    end({ error: endingOf({ buffer, capability, cause: undefined, socketPath }) });
  });
  return {
    close: () => {
      end({ error: undefined });
      socket.destroy();
    },
  };
}

/**
 * What one bounded {@link drainUntil} call found.
 *
 * @internal — no caller outside this module needs the shape by name; `drainUntil`'s callers destructure the
 * `Result`'s `.value.match`/`.value.gap` fields directly.
 */
export interface DrainUntilResult {
  /** The first event that satisfied `stopWhen`, or `undefined` when none arrived before quiet or the deadline. */
  readonly match: CmuxEvent | undefined;
  /**
   * True when the requested cursor had already aged out of cmux's retained buffer. A `gap` drain's
   * `match: undefined` is NOT proof the event never happened — only that this drain could not see far enough
   * back to find it, which a caller checking a one-off fact (never a recurring poll) must treat as inconclusive
   * rather than as a clean negative.
   */
  readonly gap: boolean;
  /** The oldest frame cmux still held when it acked, so a `gap` caller can say how far back the replay reached. */
  readonly oldestSeq: number | undefined;
}

/** What `onAck` records for the drain to report, whichever way it settles. */
interface DrainAckState {
  gap: boolean;
  oldestSeq: number | undefined;
}

/**
 * One settled drain's value, read off the ack state at the moment it settles.
 *
 * @param ackState what the ack recorded, if it has arrived yet
 * @param match the matching frame, when there was one
 * @returns the drain's result value
 */
function drainResult({ ackState, match }: { ackState: DrainAckState; match: CmuxEvent | undefined }): DrainUntilResult {
  return { gap: ackState.gap, match, oldestSeq: ackState.oldestSeq };
}

/**
 * The event handlers one {@link drainUntil} call wires into its own subscription.
 *
 * Split out purely so `drainUntil` itself stays under the repo's max-function-lines ratchet — this is the
 * subscription's reaction to each frame, not a second decision.
 *
 * @param stopWhen the event this drain is looking for
 * @param finish settle the drain, closing the stream first
 * @param armQuiet (re)start the quiet timer
 * @param settlement the drain's own settlement, to skip a stale event after it already ended
 * @param ackState the mutable box `onAck` writes the ack's gap and oldest seq into, so `finish` always reads the latest value
 * @returns the handlers to pass to `openCmuxEventStream`
 */
function drainHandlers({
  stopWhen,
  finish,
  armQuiet,
  settlement,
  ackState,
}: {
  stopWhen: (options: { event: CmuxEvent }) => boolean;
  finish: (options: { result: Result<DrainUntilResult, CmuxError> }) => void;
  armQuiet: () => void;
  settlement: Deferred<Result<DrainUntilResult, CmuxError>>;
  ackState: DrainAckState;
}): CmuxEventHandlers {
  return {
    onAck: ({ ack }) => {
      ackState.gap = ack.gap;
      ackState.oldestSeq = ack.oldestSeq;
      armQuiet();
    },
    onEnd: ({ error }) => {
      finish({ result: error === undefined ? ok(drainResult({ ackState, match: undefined })) : err(error) });
    },
    onEvent: ({ event }) => {
      if (settlement.settled()) {
        return;
      }
      if (stopWhen({ event })) {
        finish({ result: ok(drainResult({ ackState, match: event })) });
        return;
      }
      armQuiet();
    },
  };
}

/**
 * Subscribe, and end the moment one event satisfies `stopWhen`, the stream falls quiet, or `deadlineMs`
 * elapses — whichever comes first. Built for a one-shot mechanical check that must not block forever waiting
 * for an event that may simply not exist (`cmux takeover`'s sweep-armed gate, `../cmux/takeover.ts`, is the
 * first caller) — `openCmuxEventStream` alone has no such stopping condition.
 *
 * @param subscription the resume point and filters
 * @param stopWhen the event this drain is looking for
 * @param quietMs how long with no new frame before deciding nothing else is coming
 * @param deadlineMs the hard ceiling on the whole drain, however busy the fleet is
 * @param socketPath the socket to connect to; the live one, token and all, when omitted
 * @param openStream the subscription opener; a unit test passes a fake whose `close()` ends synchronously
 * @returns the drain's result, or the typed failure if the socket itself failed
 */
export async function drainUntil({
  subscription,
  stopWhen,
  quietMs,
  deadlineMs,
  socketPath,
  openStream = openCmuxEventStream,
}: {
  subscription: CmuxEventSubscription;
  stopWhen: (options: { event: CmuxEvent }) => boolean;
  quietMs: number;
  deadlineMs: number;
  socketPath?: string;
  openStream?: typeof openCmuxEventStream;
}): Promise<Result<DrainUntilResult, CmuxError>> {
  const settlement = deferred<Result<DrainUntilResult, CmuxError>>();
  const ackState: DrainAckState = { gap: false, oldestSeq: undefined };
  let quiet: ReturnType<typeof setTimeout> | undefined;

  // Settle BEFORE closing: `close()` fires `onEnd` synchronously, and `onEnd` calls back into `finish` with
  // `match: undefined`. Closing first let that re-entry settle the drain and drop the real result — a match or
  // a socket failure alike. Measured: `cmux takeover` saw its own armed sweep and still refused on
  // the GAP-inconclusive line. Repro: `src/__tests__/unit/cmux/drainUntil.test.ts` reddens with the order swapped.
  const finish = ({ result }: { result: Result<DrainUntilResult, CmuxError> }): void => {
    if (settlement.settled()) {
      return;
    }
    settlement.settle({ value: result });
    if (quiet !== undefined) {
      clearTimeout(quiet);
    }
    clearTimeout(deadline);
    closer.close();
  };
  const closer = deferredCloser();

  const armQuiet = (): void => {
    if (quiet !== undefined) {
      clearTimeout(quiet);
    }
    quiet = setTimeout(() => {
      finish({ result: ok(drainResult({ ackState, match: undefined })) });
    }, quietMs);
  };

  const deadline = setTimeout(() => {
    finish({ result: ok(drainResult({ ackState, match: undefined })) });
  }, deadlineMs);

  closer.bind({
    stream: openStream({
      handlers: drainHandlers({ ackState, armQuiet, finish, settlement, stopWhen }),
      subscription,
      ...(socketPath === undefined ? {} : { socketPath }),
    }),
  });

  return settlement.promise;
}

/**
 * A `close()` that may be asked for before the stream it closes exists.
 *
 * An opener is allowed to deliver frames synchronously, before `openStream` returns — a settle then wants to
 * close a stream that is not assigned yet. This remembers the ask and closes the stream the moment it is bound,
 * so a synchronous ack or match settles with its real result instead of a `ReferenceError`.
 *
 * @returns the close to call from a settle, and the bind to call with the opened stream
 */
function deferredCloser(): {
  readonly close: () => void;
  readonly bind: (options: { stream: CmuxEventStream }) => void;
} {
  let bound: CmuxEventStream | undefined;
  let wanted = false;
  return {
    bind: ({ stream }) => {
      bound = stream;
      if (wanted) {
        stream.close();
      }
    },
    close: () => {
      wanted = true;
      if (bound !== undefined) {
        bound.close();
      }
    },
  };
}

/**
 * Subscribe, read the ack, and hang up — what cmux holds right now, without draining a single event.
 *
 * The way to learn `oldest_seq` before choosing a cursor: cmux exposes no other call for it. Settles before
 * closing, for the same reason {@link drainUntil} does — `close()` fires `onEnd` synchronously.
 *
 * @param subscription the filters to ack under; leave `afterSeq` unset to subscribe at the live edge
 * @param deadlineMs how long to wait for the ack before giving up
 * @param socketPath the socket to connect to; the live one, token and all, when omitted
 * @param openStream the subscription opener; a unit test passes a fake whose `close()` ends synchronously
 * @returns the ack, or the typed failure — a clean end before any ack is a malformed reply
 */
export async function readCmuxEventAck({
  subscription,
  deadlineMs,
  socketPath,
  openStream = openCmuxEventStream,
}: {
  subscription: CmuxEventSubscription;
  deadlineMs: number;
  socketPath?: string;
  openStream?: typeof openCmuxEventStream;
}): Promise<Result<CmuxEventAck, CmuxError>> {
  const settlement = deferred<Result<CmuxEventAck, CmuxError>>();
  const finish = ({ result }: { result: Result<CmuxEventAck, CmuxError> }): void => {
    if (settlement.settled()) {
      return;
    }
    settlement.settle({ value: result });
    clearTimeout(deadline);
    closer.close();
  };
  const closer = deferredCloser();
  const deadline = setTimeout(() => {
    finish({ result: err(CmuxErrors.timedOut({ method: "events.stream", timeoutMs: deadlineMs })) });
  }, deadlineMs);
  closer.bind({
    stream: openStream({
      handlers: {
        onAck: ({ ack }) => {
          finish({ result: ok(ack) });
        },
        onEnd: ({ error }) => {
          if (error !== undefined) {
            finish({ result: err(error) });
            return;
          }
          finish({
            result: err(
              CmuxErrors.malformedReply({ detail: "the stream ended before cmux acked", method: "events.stream" }),
            ),
          });
        },
        onEvent: () => undefined,
      },
      subscription,
      ...(socketPath === undefined ? {} : { socketPath }),
    }),
  });
  return settlement.promise;
}
