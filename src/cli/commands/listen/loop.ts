/**
 * The connect → drain → reconnect loop, and — when a deadline is supplied — the race between it and a Slack
 * address. Pulled out of `./run.ts`, which is the CLI verb, the credential/ownership checks and the live
 * wiring: this file is the pure connection machinery underneath, injected with {@link ListenDeps} so none of
 * it needs a socket to test. One connection's own open → drain → teardown lifecycle sits in
 * `./oneConnection.ts`, which imports `ListenDeps` back from here as a type only.
 */

import type { Result } from "../../../lib/result.js";
import { createDeadlineArbiter, type DeadlineArbiter, deadlineDelayMs } from "../../../live/listen/deadline.js";
import { createDedupeState } from "../../../live/listen/dedupe.js";
import type { SocketTicketError } from "../../../live/listen/errors.js";
import type { MentionHandler } from "../../../live/listen/mention.js";
import type { ListenScope } from "../../../live/listen/scope.js";
import type {
  AddressStart,
  ListenLog,
  ResponderRefusalHandler,
  SocketConnection,
} from "../../../live/listen/socket.js";
import type { ListenerSocketState } from "../../../live/listen/supervise/heartbeat.js";
import { NO_THREAD_REPLIES } from "../../../live/listen/threadReply.js";
import type { ResponderWhitelist } from "../../../live/listen/whitelist.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { afterConnectionEnded, FRESH_RECONNECT_COUNTERS, type ReconnectCounters } from "./connectionStep.js";
import { oneConnection } from "./oneConnection.js";

/** The seams the loop drives. Injected so the reconnect behaviour is testable without a socket. */
export interface ListenDeps {
  /** The current instant — the deadline race's start, and how old a streak of refused `hello`s has grown. */
  readonly nowMs: () => number;
  /**
   * Open a single-use Socket Mode ticket.
   *
   * `signal`, when given, aborts the underlying request — see `connectOnce` in `./oneConnection.ts` for what
   * that does and does not cover.
   */
  readonly openTicket: (args: { appToken: string; signal?: AbortSignal }) => Promise<Result<string, SocketTicketError>>;
  /**
   * Open the websocket for a ticket; undefined when it never opened.
   *
   * `signal` aborts the OPEN WAIT only — it covers the handshake, not the connection's later idle lifetime.
   * A caller holding the returned connection past this call attaches its own listener to
   * {@link SocketConnection.cancel} for as long as it keeps it; see `oneConnection`.
   */
  readonly openConnection: (args: { signal: AbortSignal; url: string }) => Promise<SocketConnection | undefined>;
  /** What to do with an admitted mention. */
  readonly handler: MentionHandler;
  /** Where the narration goes. */
  readonly log: ListenLog;
  /**
   * Wait, cancellable — between reconnect attempts always; in deadline mode, also the deadline's own wait.
   *
   * @returns `"elapsed"` once the full delay passed, or `"cancelled"` if `signal` fired first
   */
  readonly wait: (args: { ms: number; signal: AbortSignal }) => Promise<"elapsed" | "cancelled">;
  /**
   * WHO may command the bot, read once per addressed mention so a `responders add` admits on the next tag.
   * Required, so a wiring that forgot it cannot compile into an open listener.
   */
  readonly responderWhitelist: () => ResponderWhitelist;
  /** Asks, per address, whether the journalled `responder-allow-open` grant is open for this session. */
  readonly responderHatchOpen: () => boolean;
  /** Where a whitelist refusal's durable effects go — the door ledger, the fixed reply. */
  readonly refuseResponder: ResponderRefusalHandler;
  /** The resolved `SLOPWEAVER_ALLOW_MULTIPLE_SOCKET_CONNECTIONS` break-glass. */
  readonly allowMultipleConnections: boolean;
  /**
   * The conversations this listener acts on (`--channels`, `--dm-only`). Required, so a wiring that forgot
   * the flags cannot compile into a listener that quietly answers everywhere.
   */
  readonly scope: ListenScope;
  /**
   * The conversations a reply under one of this bot's own posts counts as an address in (`--thread-replies`).
   * Required, so a wiring that forgot the flag cannot compile into a listener that quietly answers replies
   * nobody asked it to; an empty list is the default and switches the whole path off.
   */
  readonly threadReplyChannels: readonly string[];
  /**
   * This install's own `bot_id`, from `auth.test` — the one identity a bot-authored event is ever refused
   * for. Omitted or `undefined` fails closed (any bot-authored event refused, matching this listener's
   * behaviour without it) rather than admitting one it cannot tell isn't us.
   */
  readonly selfBotId?: string;
  /**
   * This install's own Slack USER id, from `auth.test` — the tag a direct message must carry to count as
   * address (the owner's ruling; see `../../../live/listen/mention.ts`'s own header). Omitted or
   * `undefined` refuses every DM rather than admitting one whose address it cannot check.
   */
  readonly selfUserId?: string;
  /**
   * Report this listener's own socket state, for the supervision heartbeat (`live/listen/supervise/`).
   * Called with `"connecting"` before each attempt, `"connected"` the instant a socket is live, and
   * `"disconnected"` when it ends — so "process alive, socket dead", the failure a pidfile check can never
   * see, is observable from outside the process.
   */
  readonly onSocketState?: (args: { state: ListenerSocketState }) => void;
  /** Report that Slack delivered SOMETHING on the socket — any frame, `ping` included. See `consumeMentions`. */
  readonly onSocketFrame?: () => void;
  /**
   * Report the connection count Slack put on the `hello` frame — the ONE moment that number is observable,
   * and until it was recorded, a number used once in-process and thrown away. Persisted so `listen arm`
   * can show it before opening another connection; see `live/listen/supervise/socketBudget.ts`.
   */
  readonly onHello?: (args: { connections: number }) => void;
}

/** What {@link runListenLoop} produced: an ordinary process exit, or the clock winning the deadline race. */
export type ListenLoopResult =
  { readonly kind: "exit"; readonly code: number } | { readonly kind: "clock-wake"; readonly deadlineMs: number };

/**
 * Connect, drain, reconnect — until `--once` is satisfied, the reconnect plan says to stop, or `signal`
 * fires. The dedupe window is threaded across connections on purpose: a socket dropping mid-turn is exactly
 * when Slack redelivers, and a window that reset on reconnect would let the duplicate through.
 *
 * Returns a bare exit code always, even when `signal` cut it short — that case only ever happens from
 * {@link runListenLoop}'s own deadline race, which already knows the clock won by the time this settles and
 * discards this code in favour of reporting `clock-wake`. It exists so this function has one honest return
 * type rather than a second "aborted" outcome the no-deadline caller would never produce and never check.
 *
 * @param addressStart the race latch `consumeMentions` calls before running an admitted address's handler
 * @param appToken the `xapp-` app-level token
 * @param deps the injected seams
 * @param discardBufferedAfterFirst whether a winning address cancels the connection instead of closing it
 * @param once whether to exit after one resolved address
 * @param signal aborts this whole loop — mid ticket-open, mid socket-open, mid an idle open connection, or
 *   mid reconnect backoff — and unwinds it before resolving
 * @returns the process exit code
 */
async function runReconnectLoop({
  addressStart,
  appToken,
  deps,
  discardBufferedAfterFirst,
  once,
  signal,
}: {
  addressStart: AddressStart;
  appToken: string;
  deps: ListenDeps;
  discardBufferedAfterFirst: boolean;
  once: boolean;
  signal: AbortSignal;
}): Promise<number> {
  let seen = createDedupeState();
  // Carried across reconnects for the same reason the dedupe window is: a socket dropping does not start a
  // new listener, so a thread's daily reply budget must not refill because Slack hung up.
  let threadReplies = NO_THREAD_REPLIES;
  let counters: ReconnectCounters = FRESH_RECONNECT_COUNTERS;
  for (;;) {
    const step = await oneConnection({
      addressStart,
      appToken,
      deps,
      discardBufferedAfterFirst,
      once,
      seen,
      signal,
      threadReplies,
    });
    seen = step.seen;
    threadReplies = step.threadReplies;
    if (step.kind === "aborted") {
      return EXIT_OK;
    }
    if (step.kind === "exit") {
      return step.code;
    }
    const after = await afterConnectionEnded({ counters, deps, signal, step });
    if (after.decision.kind === "stop") {
      return after.decision.code;
    }
    counters = after.counters;
  }
}

/**
 * Race a Slack address against a supplied deadline, or — with no deadline — run the ordinary reconnect loop
 * unraced and unchanged.
 *
 * The race is a shared {@link DeadlineArbiter} (`../../../live/listen/deadline.js`), not a bare
 * `Promise.race`: first-writer-wins decides which side gets to act, and BOTH sides are always awaited to
 * full settlement before this returns, so neither a live socket nor a pending timer outlives the process
 * reporting done. A past or current `deadlineMs` wins immediately, without ever opening a ticket.
 *
 * @param appToken the `xapp-` app-level token
 * @param deadlineMs the absolute epoch-ms instant to race against a Slack address, or omitted entirely for
 *   the ordinary unraced wait every existing caller already gets — genuinely OPTIONAL, not a required key
 *   typed to allow `undefined`, so an existing call site that never knew about deadlines still compiles
 *   unchanged
 * @param deps the injected seams
 * @param once whether to exit after one resolved address
 * @param stopSignal the operator's own stop — a trapped SIGINT/SIGTERM — which closes the live socket
 *   through the same `cancel` path a deadline uses. Defaults to a signal nothing holds a controller for,
 *   which is every existing caller's exact current behaviour, and was what the no-deadline branch passed
 *   unconditionally before a human had any way to reach it (`./stopSignal.ts`)
 * @returns which side actually produced the outcome, and what it was
 */
export async function runListenLoop({
  appToken,
  deadlineMs,
  deps,
  once,
  stopSignal = new AbortController().signal,
}: {
  appToken: string;
  deadlineMs?: number;
  deps: ListenDeps;
  once: boolean;
  stopSignal?: AbortSignal;
}): Promise<ListenLoopResult> {
  if (deadlineMs === undefined) {
    const code = await runReconnectLoop({
      addressStart: () => true,
      appToken,
      deps,
      discardBufferedAfterFirst: false,
      once,
      signal: stopSignal,
    });
    return { code, kind: "exit" };
  }
  const nowMs = deps.nowMs();
  if (deadlineMs <= nowMs) {
    return { deadlineMs, kind: "clock-wake" };
  }
  return raceAgainstDeadline({ appToken, deadlineMs, deps, nowMs, once, stopSignal });
}

/**
 * How long the losing work arm gets to unwind once the clock has won, before this proceeds without it.
 *
 * Deliberately longer than `wire.ts`'s own `CLOSE_TIMEOUT_MS` (2s), so that ALREADY-bounded inner waits
 * (the socket teardown behind `cancel`) get to finish on their own terms in the common case, while this
 * outer ceiling only bites for the genuinely unbounded case a review pass found: a per-frame side effect —
 * `refuseResponder`'s Slack post, say — with no abort seam of its own, blocking `consumeMentions`'s
 * sequential frame loop from ever returning to notice `workAbort` fired at all. The process exits via
 * `process.exit` right after this resolves (see `src/cli/main.ts`), which is what makes abandoning a
 * still-running work arm safe rather than a leak: nothing waits on it past that exit.
 */
export const WORK_ARM_GRACE_MS = 30_000;

/**
 * Wait for the work arm, but never past {@link WORK_ARM_GRACE_MS} once the clock has already won — logging
 * if it had to give up rather than silently dropping the wait.
 *
 * Routed through {@link ListenDeps.wait} rather than a raw timer, like every other wait in this file — so
 * this is exercised with the same injected `controllableWait` fixture the rest of the suite uses, with no
 * real timer in the loop.
 *
 * @param deps the injected seams — only `wait` and `log` are used
 * @param workPromise the work arm's own promise, already told to abort
 * @returns once the work arm settles, or the grace period elapses, whichever is first
 */
async function settleWorkArmAfterClockWins({
  deps,
  workPromise,
}: {
  deps: ListenDeps;
  workPromise: Promise<number>;
}): Promise<void> {
  const graceAbort = new AbortController();
  // BOTH handlers, never just the fulfilment one: a review pass found that a rejecting work arm (an
  // unforced `runReconnectLoop` throw, say) left this `.then()`'s own derived promise unhandled, which
  // Node's default unhandled-rejection policy can terminate the process over — replacing a hung race with a
  // crashed one. Attaching a rejection handler here means the derived promise resolves either way; the
  // failure itself is still surfaced, just narrated rather than left to propagate into an already-decided
  // clock-wake.
  void workPromise.then(
    (): void => {
      graceAbort.abort();
      return;
    },
    (error: unknown): void => {
      // `deps.log` is a plain synchronous callback with no "never throws" contract (a closed stderr pipe,
      // say) — a review pass found that a throw here would reject THIS handler's own derived promise,
      // discarded with `void` and therefore genuinely unhandled. Narrating the failure must never be able to
      // stop `graceAbort.abort()` from firing, which is why it is guarded and this is not.
      try {
        deps.log({ line: `the work arm failed while unwinding after the clock won: ${String(error)}` });
      } catch {
        // Nothing further to do — the narration itself failed; the grace wait still unblocks below.
      }
      graceAbort.abort();
      return;
    },
  );
  const outcome = await deps.wait({ ms: WORK_ARM_GRACE_MS, signal: graceAbort.signal });
  if (outcome === "elapsed") {
    deps.log({
      line:
        `the work arm did not unwind within ${String(WORK_ARM_GRACE_MS)}ms of the clock winning — ` +
        "proceeding without it",
    });
  }
}

/**
 * Decide the outcome once both arms are in flight: whichever of `workPromise`/`clockPromise` settles first
 * is raced ONLY to catch the case neither the arbiter nor `clockAbort` has any visibility into —
 * `workPromise` settling entirely on its own, a fatal or graceful reconnect-loop exit (`link_disabled`, the
 * reconnect-failure budget) that never went through an admitted Slack address (which aborts the clock) or
 * the clock itself (which aborts the work arm). A review pass found that left unhandled, that exit code was
 * masked until the deadline elapsed, then silently REPLACED by a clock-wake outcome — reporting success over
 * an already-dead listener. `arbiter.winner()` afterward, not which side of the race actually settled
 * first, is what decides the outcome.
 *
 * @param arbiter the shared decision the two arms above have already been wired to
 * @param clockAbort stops the clock's own wait — used when the work arm turns out to have decided this alone
 * @param clockPromise the clock arm, already wired to abort the work arm if it wins
 * @param deadlineMs the absolute epoch-ms instant this deadline is racing toward
 * @param deps the injected seams, passed through to {@link settleWorkArmAfterClockWins}
 * @param workPromise the work arm, already given an immediate no-op rejection handler by the caller
 * @returns the race's final outcome
 */
async function decideRaceOutcome({
  arbiter,
  clockAbort,
  clockPromise,
  deadlineMs,
  deps,
  workPromise,
}: {
  arbiter: DeadlineArbiter;
  clockAbort: AbortController;
  clockPromise: Promise<void>;
  deadlineMs: number;
  deps: ListenDeps;
  workPromise: Promise<number>;
}): Promise<ListenLoopResult> {
  const settledFirst = await Promise.race([
    workPromise.then(
      (code): { readonly code: number; readonly side: "work" } => ({ code, side: "work" }),
      // A rejection here must not make THIS race throw — that would stop the clock from ever getting to
      // decide, even when it is still genuinely pending. Reported as EXIT_ERROR only when the arbiter turns
      // out to still be "pending" below; otherwise the clock or Slack branch's own handling takes over.
      (): { readonly code: number; readonly side: "work" } => ({ code: EXIT_ERROR, side: "work" }),
    ),
    clockPromise.then((): { readonly side: "clock" } => ({ side: "clock" })),
  ]);

  if (settledFirst.side === "work" && arbiter.winner() === "pending") {
    // Neither Slack nor the clock ever won this race — the work arm ended on its own. Stop the clock's own
    // wait, which has nothing left to decide, then report the work arm's exit code exactly as the
    // no-deadline path would.
    clockAbort.abort();
    await clockPromise;
    return { code: settledFirst.code, kind: "exit" };
  }
  if (arbiter.winner() === "clock-wake") {
    await settleWorkArmAfterClockWins({ deps, workPromise });
    return { deadlineMs, kind: "clock-wake" };
  }
  // Slack won: nothing is racing against this arm anymore, so it is awaited fully and unbounded, exactly as
  // the no-deadline path always has been.
  const code = await workPromise;
  return { code, kind: "exit" };
}

/**
 * The clock arm of the deadline race: wait out the remaining time, and — only if the arbiter still lets the
 * clock win — abort the work arm with the reason a human reads on the way out.
 *
 * Returns the promise rather than awaiting it, because the whole point is that this arm runs BESIDE the
 * socket rather than before it.
 *
 * @param arbiter the one place a winner is declared, so two arms cannot both think they won
 * @param clockAbort what cancels this wait when Slack wins first
 * @param deadlineMs when this listener is due to wake, epoch milliseconds
 * @param deps the injected wait
 * @param nowMs the clock at the moment the race started
 * @param workAbort what this arm aborts when the deadline is the winner
 * @returns the arm, already running
 */
async function startDeadlineClock({
  arbiter,
  clockAbort,
  deadlineMs,
  deps,
  nowMs,
  workAbort,
}: {
  arbiter: DeadlineArbiter;
  clockAbort: AbortController;
  deadlineMs: number;
  deps: ListenDeps;
  nowMs: number;
  workAbort: AbortController;
}): Promise<void> {
  return deps.wait({ ms: deadlineDelayMs({ deadlineMs, nowMs }), signal: clockAbort.signal }).then((outcome): void => {
    if (outcome === "cancelled" || !arbiter.tryClockWake()) {
      // Either the wait was cancelled because Slack already won, or — a last-instant race — Slack won in
      // the moment between this callback firing and the check above. Either way the clock lost; nothing
      // more to do on this arm.
      return;
    }
    workAbort.abort("the deadline expired");
    return;
  });
}

async function raceAgainstDeadline({
  appToken,
  deadlineMs,
  deps,
  nowMs,
  once,
  stopSignal,
}: {
  appToken: string;
  deadlineMs: number;
  deps: ListenDeps;
  nowMs: number;
  once: boolean;
  stopSignal: AbortSignal;
}): Promise<ListenLoopResult> {
  const arbiter = createDeadlineArbiter();
  const workAbort = new AbortController();
  const clockAbort = new AbortController();
  // The operator stopping this process outranks the race: BOTH arms are told, so the socket closes through
  // the work arm's own `cancel` and the clock stops waiting on a deadline nobody is left to answer. The
  // arbiter stays `pending`, which is exactly the case `decideRaceOutcome` already reports as the work
  // arm ending on its own.
  stopSignal.addEventListener("abort", () => {
    workAbort.abort(stopSignal.reason);
    clockAbort.abort();
  });
  const addressStart: AddressStart = () => {
    const won = arbiter.trySlackAddress();
    if (won) {
      // Slack won — stop waiting on the clock. The work side unwinds itself; nothing to abort there.
      clockAbort.abort();
    }
    return won;
  };

  const workPromise = runReconnectLoop({
    addressStart,
    appToken,
    deps,
    discardBufferedAfterFirst: true,
    once,
    signal: workAbort.signal,
  });
  // Closes the unhandled-rejection window described above — harmless to attach twice; the real handling
  // still happens in whichever branch of decideRaceOutcome actually reaches this promise.
  void workPromise.catch((): void => undefined);
  const clockPromise = startDeadlineClock({ arbiter, clockAbort, deadlineMs, deps, nowMs, workAbort });

  return decideRaceOutcome({ arbiter, clockAbort, clockPromise, deadlineMs, deps, workPromise });
}
