/**
 * The cmux control-socket transport — one persistent connection, many concurrent calls, no process boundary.
 *
 * This is the "Octokit, not the `gh` CLI" half of the cmux client. cmux ships no
 * npm SDK, so the SDK here IS the socket: `src/cmux/socketFrames.ts` documents the wire format this speaks,
 * measured live rather than read off a spec, because cmux's published CLI contract deliberately documents
 * only user-visible CLI behaviour.
 *
 * Two properties the old `execFileSync("cmux", …)` client could not have, and both are the point:
 *
 * - **Calls multiplex.** Replies are correlated by the `id` this module assigns, so a caller may have several
 *   in flight on one connection. Measured: three requests written back-to-back returned three replies, each
 *   carrying its own id.
 * - **`events.stream` is a real subscription**, not a subprocess whose stdout has to be babysat. It takes its
 *   OWN connection ({@link openCmuxEventStream}) because the reply to it is not a reply at all — cmux switches
 *   that connection into a one-way frame feed, so any other call written down the same socket is swallowed.
 *   That was measured, not assumed: five requests sent after `events.stream` on one connection produced zero
 *   replies.
 */
import { createConnection, type Socket } from "node:net";

import { absentAsNumber } from "#lib/absent.js";
import { deferred } from "../lib/deferred.js";
import { logger } from "../lib/logger.js";
import { isRecord } from "../lib/parsers.js";
import { err, type Result } from "../lib/result.js";
import { type CmuxError, CmuxErrors } from "./errors.js";
import {
  encodeRequest,
  parseReplyFrame,
  redactCapability,
  refusalError,
  socketRefusalOf,
  splitFrames,
} from "./socketFrames.js";
import { productionSocketPathSources, resolveCmuxSocketEndpoint } from "./socketPath.js";

/** How long any one call may wait for its reply. A hung app must not hang a supervisor sweep. */
const CMUX_CALL_TIMEOUT_MS = 15_000;

/** The seam every typed wrapper in `client.ts` calls through, so those wrappers are testable without cmux. */
export interface CmuxSocket {
  /**
   * Call one v2 socket method.
   *
   * @param options the method name and its params
   * @returns the method's `result` value, or the typed failure
   */
  readonly call: (options: {
    method: string;
    params?: Readonly<Record<string, unknown>>;
  }) => Promise<Result<unknown, CmuxError>>;
  /** Release the underlying connection. Safe to call more than once. */
  readonly close: () => void;
}

/** One in-flight call, waiting for the reply frame carrying its id. */
interface Pending {
  readonly method: string;
  readonly settle: (result: Result<unknown, CmuxError>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Connect to the socket, mapping a connect-time failure into this domain's typed error. */
function connect({ socketPath }: { socketPath: string }): { socket: Socket } {
  const socket = createConnection({ path: socketPath });
  socket.setEncoding("utf8");
  return { socket };
}

/**
 * Open a live connection to the cmux control socket.
 *
 * The connection is established eagerly, but a connect failure is not thrown — it is remembered and returned
 * from every subsequent {@link CmuxSocket.call}, so a caller handles "cmux is not running" exactly the way it
 * handles any other cmux failure, through one `Result` branch rather than a try/catch bolted beside it.
 *
 * A `cmuxOnly` refusal — cmux's bare `ERROR:` line before it closes — fails every call with cmux's own
 * words, and a later close never overwrites them with "the connection closed".
 *
 * @param socketPath the socket to connect to; the live one ({@link resolveCmuxSocketEndpoint}) when omitted
 * @param capability the token presented on every frame; the environment's for the live socket, and none for
 *   a named one unless given, so a process that outlived its cmux launcher is still served
 * @param timeoutMs the per-call bound
 * @returns the connected {@link CmuxSocket}
 */
// max-lines-exempt: one connection's lifecycle — the pending map plus the four socket handlers that share it; the pure parts are already out (`socketFrames.ts` owns the wire format, `deferred.ts` owns settle-once).
export function openCmuxSocket({
  socketPath: named,
  capability: namedCapability,
  timeoutMs = CMUX_CALL_TIMEOUT_MS,
}: { socketPath?: string; capability?: string; timeoutMs?: number } = {}): CmuxSocket {
  const { socketPath, capability } = resolveCmuxSocketEndpoint({
    capability: namedCapability,
    socketPath: named,
    sources: productionSocketPathSources(),
  });
  const pending = new Map<string, Pending>();
  let nextId = 0;
  let buffer = "";
  let fatal: CmuxError | undefined;
  let closed = false;
  const { socket } = connect({ socketPath });

  const failAll = ({ error }: { error: CmuxError }): void => {
    fatal = error;
    const entries = Array.from(pending.entries());
    pending.clear();
    for (const [, entry] of entries) {
      clearTimeout(entry.timer);
      entry.settle(err(error));
    }
  };

  // cmux's refusal, in its own words, fails everything at once; the close that follows must not replace it.
  const refuse = ({ refusal }: { refusal: string }): void => {
    failAll({ error: refusalError({ refusal, socketPath }) });
    socket.destroy();
  };
  socket.on("error", (error: Error) => {
    // A refusal written without its final newline and then reset is still in the buffer, and outranks the reset.
    const refusal = socketRefusalOf({ capability, line: buffer });
    if (refusal !== undefined) {
      refuse({ refusal });
      return;
    }
    failAll({ error: CmuxErrors.socketUnavailable({ cause: error, detail: error.message, socketPath }) });
  });
  socket.on("close", () => {
    if (closed || fatal !== undefined) {
      return;
    }
    // A refusal written without its final newline is still in the buffer.
    const refusal = socketRefusalOf({ capability, line: buffer });
    if (refusal !== undefined) {
      refuse({ refusal });
      return;
    }
    failAll({ error: CmuxErrors.socketUnavailable({ detail: "the connection closed", socketPath }) });
  });
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    const split = splitFrames({ buffer });
    buffer = split.remainder;
    for (const sent of split.frames) {
      // Redacted once, here, so no branch below — a log line, a refusal, a reply — ever reads the presented token.
      const frame = redactCapability({ capability, text: sent });
      const refusal = socketRefusalOf({ capability, line: frame });
      if (refusal !== undefined) {
        refuse({ refusal });
        return;
      }
      const id = replyId({ line: frame });
      const entry = id === undefined ? undefined : pending.get(id);
      if (entry === undefined || id === undefined) {
        logger.error({ msg: `cmux socket: dropping an unmatched reply frame (${frame.slice(0, 120)})` });
        continue;
      }
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.settle(parseReplyFrame({ line: frame, method: entry.method }));
    }
  });

  return {
    call: ({ method, params = {} }) => {
      // A one-shot `deferred` rather than three `resolve` calls in an executor: the reply, the timeout and a
      // dead connection can all decide this call is over, and only the first of them should be believed.
      const answered = deferred<Result<unknown, CmuxError>>();
      if (fatal !== undefined) {
        answered.settle({ value: err(fatal) });
        return answered.promise;
      }
      nextId += 1;
      const id = `sw-${String(nextId)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        answered.settle({ value: err(CmuxErrors.timedOut({ method, timeoutMs })) });
      }, timeoutMs);
      timer.unref();
      pending.set(id, {
        method,
        settle: (value) => {
          answered.settle({ value });
        },
        timer,
      });
      socket.write(encodeRequest({ capability, id, method, params }));
      return answered.promise;
    },
    close: () => {
      closed = true;
      socket.destroy();
    },
  };
}

/** Whether a failure is the transport's, which a fresh connection may cure — never an access refusal. */
function transportUnavailable({ error }: { error: CmuxError }): boolean {
  return error.code === "SOCKET_UNAVAILABLE" && error.reason === "transport-unavailable";
}

/**
 * The methods a replay would apply twice. A transport failure after the write cannot say whether cmux applied the
 * call before the reply was lost — `openCmuxSocket` writes the frame while the connection may still be opening, so
 * no failure shows the frame never left — and these are not idempotent: a keystroke types the text a second time,
 * and a create makes a second workspace. So these are never retried; `./workspaceCreateRecovery.ts` reconciles a
 * create's unknown outcome against the inventory instead.
 */
const NON_REPLAYABLE_METHODS: ReadonlySet<string> = new Set([
  "surface.send_text",
  "surface.send_key",
  "workspace.create",
]);

/** The `id` a reply frame carries, or `undefined` when it carries none this client can match. */
function replyId({ line }: { line: string }): string | undefined {
  try {
    const decoded: unknown = JSON.parse(line);
    if (!isRecord(decoded)) {
      return undefined;
    }
    const id = decoded["id"];
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How many times a call may reconnect and retry after a `SOCKET_UNAVAILABLE` failure, and how long to wait
 * before each attempt — measured against the live incidents this closes: `cmux control socket unavailable at
 * ~/.local/state/cmux/cmux-501.sock: write EPIPE`, four times in one night, always transient —
 * cmux itself answered `list` immediately every time, and a fresh CLI invocation (a brand-new connection)
 * succeeded on the very next attempt. That is the fix this bounds: not a longer wait on the SAME dead
 * connection (retrying `openCmuxSocket`'s own `fatal` state is a no-op — see {@link withSocketRetry}), but a
 * fresh one, tried a bounded number of times before the caller ever sees a failure.
 */
const CMUX_SOCKET_RETRY_ATTEMPTS = 3;

/** The backoff before each reconnect attempt after the first, in ms — short, because the failure is a write, not a slow server. */
const CMUX_SOCKET_RETRY_BACKOFF_MS = [250, 750, 1_500] as const;

/**
 * Wrap a {@link CmuxSocket} factory so a `SOCKET_UNAVAILABLE` failure — cmux's own `openCmuxSocket` sets this
 * PERMANENTLY on the connection once the underlying transport errors or closes, so calling `.call()` again on
 * the SAME instance just replays the cached failure — is answered by closing the dead connection, waiting a
 * short backoff, and opening a fresh one from `openFresh`, up to {@link CMUX_SOCKET_RETRY_ATTEMPTS} attempts
 * total before the caller sees the failure.
 *
 * Only a transport `SOCKET_UNAVAILABLE` is retried. Every other {@link CmuxError} — a `CALL_FAILED` reply, a
 * genuine `TIMEOUT`, a malformed reply — is a real per-attempt answer from a LIVE connection, not evidence the
 * transport is down, and retrying one would just resend a call cmux already rejected. Nor is an `access-denied`
 * one: a fresh connection from the same process presents the same missing token and is refused the same way. Nor is a
 * call a replay would apply twice ({@link NON_REPLAYABLE_METHODS}): cmux may have applied it before the reply was lost.
 *
 * Retiring the dead connection and replaying the call are separate decisions. EVERY transport failure retires the
 * connection it failed on — a non-replayable call and a call out of attempts included — so the NEXT call opens a fresh
 * one rather than spending its first attempt on the dead one's cached failure (the residue
 * `./workspaceCreateRecovery.ts` recorded for its snapshot read). The fresh connection
 * opens lazily, after the backoff, and a connection is retired only while it is still the current one, so two calls
 * failing on the same dead connection open ONE replacement and never close the other's.
 *
 * Pure with respect to I/O: `openFresh` and `wait` are the only effects, so this is testable with a fake
 * {@link CmuxSocket} factory and no real connection — see `src/__tests__/unit/cmux/socket.test.ts`.
 *
 * @param openFresh opens a brand-new connection, replacing a dead one
 * @param wait the pacing delay between attempts
 * @param attempts the total attempt bound (first try plus retries), defaulting to {@link CMUX_SOCKET_RETRY_ATTEMPTS}
 * @param backoffMs the delay before each attempt after the first, defaulting to {@link CMUX_SOCKET_RETRY_BACKOFF_MS}
 * @returns a {@link CmuxSocket} that reconnects transparently on a transient control-socket failure
 */
export function withSocketRetry({
  openFresh,
  wait,
  attempts = CMUX_SOCKET_RETRY_ATTEMPTS,
  backoffMs = CMUX_SOCKET_RETRY_BACKOFF_MS,
}: {
  openFresh: () => CmuxSocket;
  wait: (options: { delayMs: number }) => Promise<void>;
  attempts?: number;
  backoffMs?: readonly number[];
}): CmuxSocket {
  let current: CmuxSocket | undefined = openFresh();

  // The live connection, opening a fresh one when the last was retired.
  const connection = (): CmuxSocket => {
    if (current !== undefined) {
      return current;
    }
    const fresh = openFresh();
    current = fresh;
    return fresh;
  };

  // Retire a connection a call failed on, only while it is still the current one: a peer call may already have
  // retired it and opened the replacement, which must not be closed in its turn.
  const retire = ({ dead }: { dead: CmuxSocket }): void => {
    if (current !== dead) {
      return;
    }
    dead.close();
    current = undefined;
  };

  return {
    call: async ({ method, params = {} }) => {
      for (let attempt = 0; ; attempt++) {
        const used = connection();
        const result = await used.call({ method, params });
        if (result.isOk() || !transportUnavailable({ error: result.error })) {
          return result;
        }
        retire({ dead: used });
        if (NON_REPLAYABLE_METHODS.has(method) || attempt >= attempts - 1) {
          return result;
        }
        await wait({
          delayMs: absentAsNumber({ value: backoffMs[Math.min(attempt, backoffMs.length - 1)], whenAbsent: 0 }),
        });
      }
    },
    close: () => {
      current?.close();
    },
  };
}
