/**
 * The websocket itself — the only file here that touches a socket, and deliberately the only one with no
 * decisions in it.
 *
 * Everything with a rule in it lives elsewhere: the frame grammar in `./frames.ts`, the loop in
 * `./socket.ts`, the buffering in `./frameQueue.ts`, the reconnect schedule in `./reconnect.ts`. What is left
 * is an adapter: construct, wait for `open`, forward text frames into the queue, send an acknowledgement as
 * JSON, and translate a close or an error into "the stream ended, here is why".
 *
 * Node's built-in `WebSocket` is used rather than a websocket library. Socket Mode's ping/pong keepalive is
 * handled at the protocol layer by the runtime, and the reconnect policy — the part a library would
 * otherwise own — is a decision this feature needs to make explicitly and test, not inherit.
 */
import { createFrameQueue, type FrameQueue } from "./frameQueue.js";
import type { SocketConnection } from "./socket.js";

/** How long to wait for the socket to open before giving up on this ticket. */
const OPEN_TIMEOUT_MS = 15_000;

/**
 * How long to wait for the socket's own `close`/`error` confirmation before proceeding anyway.
 *
 * The WHATWG `WebSocket.close()` only ever STARTS a closing handshake — a review pass found that a peer
 * which never returns a close frame and never resets the TCP connection (network-blackholed) leaves
 * `settled` pending forever, so a caller awaiting it (deadline mode's `cancel`, most load-bearingly — the
 * whole point of a deadline is a BOUNDED wake) hangs indefinitely too. There is no forced-abort primitive in
 * the standard API to reach for instead, so the fix is the same shape as {@link OPEN_TIMEOUT_MS}: proceed
 * after a ceiling. The socket may still be lingering half-closed afterward — an accepted, bounded cost, not
 * a claim that the transport is provably gone.
 *
 * MEASURED against a real Socket Mode connection: a proactive `.close()` did not fire its own `close`/
 * `error` event within the review-cited bound of 10s at all, meaning every clock-win against a real socket
 * was silently paying the FULL ceiling — a routine, not a rare, cost, for a feature whose whole point is
 * waking promptly. `main.ts` calls `process.exit` immediately after this settles, so there is nothing to
 * gain from waiting generously for a confirmation the socket may never send; a couple of seconds is still
 * ample margin over a healthy TCP/WS teardown and cuts the typical latency this actually adds by 5x.
 */
const CLOSE_TIMEOUT_MS = 2_000;

/**
 * One listener registration, named by the event it listens for. Each member's payload is the slice of the
 * native event its listener reads, so the native `MessageEvent`/`CloseEvent` is passed straight through.
 *
 * @internal
 */
export type SocketWireEvent =
  | { readonly type: "open"; readonly listener: () => void }
  | { readonly type: "message"; readonly listener: (event: { readonly data: unknown }) => void }
  | { readonly type: "close"; readonly listener: (event: { readonly code: number }) => void }
  | { readonly type: "error"; readonly listener: () => void };

/**
 * The three things this file does to a socket. `on` is exactly one native `addEventListener` per call, with
 * no options, so registration order is the order of the calls below.
 *
 * @internal
 */
export interface WireSocket {
  readonly on: (args: SocketWireEvent) => void;
  readonly send: (args: { text: string }) => void;
  readonly close: () => void;
}

/**
 * The effects this file reaches outside itself for: constructing the socket, and arming a timer. `setTimer`
 * returns the function that disarms it.
 *
 * @internal
 */
export interface WireSeams {
  readonly openSocket: (args: { url: string }) => WireSocket;
  readonly setTimer: (args: { ms: number; onElapsed: () => void }) => () => void;
}

/**
 * Register one listener on the native socket — one `addEventListener`, the listener itself, no options.
 *
 * @param event which event, and the listener to register for it
 * @param socket the native socket the listener is registered on
 */
function attachNative({ event, socket }: { event: SocketWireEvent; socket: WebSocket }): void {
  switch (event.type) {
    case "open":
      socket.addEventListener("open", event.listener);
      return;
    case "message":
      socket.addEventListener("message", event.listener);
      return;
    case "close":
      socket.addEventListener("close", event.listener);
      return;
    case "error":
      socket.addEventListener("error", event.listener);
      return;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** Node's own `WebSocket` and timers — what {@link openSocketConnection} uses unless a test passes its own. */
const LIVE_WIRE_SEAMS: WireSeams = {
  openSocket: ({ url }) => {
    const socket = new WebSocket(url);
    return {
      close: () => {
        socket.close();
      },
      on: (event) => {
        attachNative({ event, socket });
      },
      send: ({ text }) => {
        socket.send(text);
      },
    };
  },
  setTimer: ({ ms, onElapsed }) => {
    const timer = setTimeout(onElapsed, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

/**
 * `settled`, but resolving after {@link CLOSE_TIMEOUT_MS} even if the socket's own `close`/`error` event
 * never fires — see that constant for why. Only the first of the two to happen has any effect; a promise
 * settles once.
 *
 * @param settled resolves once the socket's `close`/`error` event has actually fired
 * @param setTimer arms the bound
 * @returns a promise that always resolves within the bound
 */
async function settleWithinBound({
  setTimer,
  settled,
}: {
  setTimer: WireSeams["setTimer"];
  settled: Promise<void>;
}): Promise<void> {
  let settle: () => void = () => undefined;
  const bounded = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const disarm = setTimer({ ms: CLOSE_TIMEOUT_MS, onElapsed: settle });
  void settled.then((): void => {
    disarm();
    settle();
    return;
  });
  return bounded;
}

/**
 * Wrap a socket and its queue as the {@link SocketConnection} contract the loop drives.
 *
 * `settled` is the ONE promise every close path is built on — passed in already wired to the socket's real
 * `close`/`error` events (see `openSocketConnection`) — but `cancel`/`close` return it through
 * {@link settleWithinBound} rather than raw, so a caller awaiting the actual transport teardown is never left
 * waiting past that bound either. Idempotent by construction: calling `socket.close()` more than once, or
 * after it is already closed, is a documented no-op on Node's `WebSocket`, and `settled` itself only ever
 * resolves once.
 */
function buildConnection({
  queue,
  setTimer,
  settled,
  socket,
}: {
  queue: FrameQueue;
  setTimer: WireSeams["setTimer"];
  settled: Promise<void>;
  socket: WireSocket;
}): SocketConnection {
  return {
    acknowledge: ({ envelopeId }) => {
      // Fire-and-forget by contract: Slack wants the ack inside ~3s, and there is nothing to await — a
      // failed send shows up as the redelivery the dedupe window is there to absorb.
      socket.send({ text: JSON.stringify({ envelope_id: envelopeId }) });
    },
    cancel: ({ why }) => {
      queue.cancel({ why });
      socket.close();
      return settleWithinBound({ setTimer, settled });
    },
    close: ({ why }) => {
      queue.end({ why });
      socket.close();
      return settleWithinBound({ setTimer, settled });
    },
    discarded: () => queue.discarded(),
    endedBecause: () => queue.endedBecause(),
    frames: () => queue.frames(),
  };
}

/**
 * Wait for the socket to open, or give up — on its own 15s timeout, on a socket error, or on `signal`
 * firing first. The timeout ends the queue and the abort cancels it, each with a stated reason, and both
 * close the socket. The error path only resolves `false`: the queue is ended by the error listener
 * `openSocketConnection` registered, and nothing here calls `socket.close()` on it. Either way the caller
 * only has to ask "did it open".
 *
 * The outcome is a DEFERRED rather than work done inside the executor. Four different events decide it —
 * the socket opened, it errored before opening, it never opened, or the signal aborted first — and a promise
 * settled from four places inside its own executor is the shape that hides a double-settle. The executor
 * only captures the resolver — it runs synchronously, so `markOpen` is in place before any listener below
 * can fire, and a second call after the first is a no-op by the promise's own contract.
 *
 * Deliberately does NOT await the socket's own teardown (unlike {@link buildConnection}'s `cancel`/`close`)
 * before resolving `false` on its own two close-initiating paths (the timeout, and an abort): nothing here is
 * deciding a race whose winner another caller could misreport by returning too early — the caller just moves
 * on to a reconnect decision either way — so there was never a correctness need for the bound, and a review
 * pass found that adding it anyway changed observable no-deadline reconnect timing by up to `CLOSE_TIMEOUT_MS`
 * whenever a peer never confirms its close. Reverted to reporting `false` the instant `socket.close()` is
 * called.
 *
 * @param queue the frame queue this socket feeds; ended or cancelled here on every non-open outcome
 * @param signal aborts the wait early, resolving `false` exactly as a timeout would
 * @param setTimer arms the open timeout
 * @param socket the socket being opened
 * @returns whether the socket actually opened
 */
async function waitForOpen({
  queue,
  setTimer,
  signal,
  socket,
}: {
  queue: FrameQueue;
  setTimer: WireSeams["setTimer"];
  signal: AbortSignal | undefined;
  socket: WireSocket;
}): Promise<boolean> {
  let markOpen: (live: boolean) => void = () => undefined;
  const outcome = new Promise<boolean>((resolve) => {
    markOpen = resolve;
  });
  const disarm = setTimer({
    ms: OPEN_TIMEOUT_MS,
    onElapsed: () => {
      queue.end({ why: `the socket did not open within ${String(OPEN_TIMEOUT_MS)}ms` });
      socket.close();
      markOpen(false);
    },
  });
  const onAbort = (): void => {
    queue.cancel({ why: "the deadline expired while the socket was still opening" });
    socket.close();
    markOpen(false);
  };
  signal?.addEventListener("abort", onAbort);
  socket.on({
    listener: () => {
      markOpen(true);
    },
    type: "open",
  });
  socket.on({
    listener: () => {
      markOpen(false);
    },
    type: "error",
  });
  const opened = await outcome;
  disarm();
  signal?.removeEventListener("abort", onAbort);
  return opened;
}

/**
 * Open one Socket Mode websocket and wrap it as a {@link SocketConnection}.
 *
 * Resolves once the socket is open, or with `undefined` when it could not be opened — the caller turns that
 * into a reconnect decision rather than a throw, because a failed connection is a normal event in the life
 * of a long-running listener.
 *
 * `signal`, when given, only covers THIS function's own wait — the open handshake and its timeout. It is not
 * retained once a live connection is returned: a caller that needs to cancel an already-open, already-idle
 * connection attaches its own listener to the returned {@link SocketConnection.cancel} for as long as it
 * holds one. Splitting it this way is deliberate — see the deadline-listener plan's own correction on this
 * exact point — rather than one listener trying to cover a connection's whole lifetime from inside this
 * adapter.
 *
 * @param signal aborts the open wait early; when it fires before the socket opens, this resolves
 *   `undefined` exactly as a timeout would, instead of continuing to wait
 * @param url the single-use `wss://` URL from `apps.connections.open`
 * @param seams the socket constructor and timer; Node's own `WebSocket` and `setTimeout` unless a test passes
 *   fakes
 * @returns the live connection, or undefined when the socket never opened
 */
export async function openSocketConnection({
  signal,
  url,
  seams = LIVE_WIRE_SEAMS,
}: {
  signal?: AbortSignal;
  url: string;
  seams?: WireSeams;
}): Promise<SocketConnection | undefined> {
  const queue = createFrameQueue();
  const socket = seams.openSocket({ url });
  // The ONE promise `cancel`/`close` return, so a caller can await the actual transport teardown rather than
  // merely the request to begin it — registered from construction, so it cannot miss a `close`/`error` that
  // fires before `buildConnection` is ever reached (e.g. one racing the open handshake itself).
  let markSettled: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
  socket.on({
    listener: ({ data }) => {
      if (typeof data === "string") {
        queue.push({ text: data });
      }
    },
    type: "message",
  });
  socket.on({
    listener: ({ code }) => {
      queue.end({ why: `the socket closed (code ${String(code)})` });
      markSettled();
    },
    type: "close",
  });
  socket.on({
    listener: () => {
      queue.end({ why: "the socket reported an error" });
      markSettled();
    },
    type: "error",
  });
  const opened = await waitForOpen({ queue, setTimer: seams.setTimer, signal, socket });
  return opened ? buildConnection({ queue, setTimer: seams.setTimer, settled, socket }) : undefined;
}
