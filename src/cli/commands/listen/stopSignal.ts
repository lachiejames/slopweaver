/**
 * What a listener does when the operator stops it — Ctrl-C, or the `kill` that `skills/loop/reference/
 * listener-stream.md` tells a session to send after `listen disarm`.
 *
 * ## Why this exists
 *
 * Nothing under `listen/` trapped a signal, so `kill <pid>` terminated Node without unwinding: the
 * websocket was torn down at the TCP layer with no close handshake, and `exitCodeOfLoop`'s `finally` — the
 * one that writes the final `disconnected` beat — never ran, despite its own comment claiming it covered a
 * signal. A socket closed that way keeps counting against Slack's ten-connection per-app cap for tens of
 * minutes, so a session that restacks and re-arms several times in one hour runs the app out of
 * connections with every process long dead (observed; see
 * `../../../live/listen/supervise/socketBudget.ts`).
 *
 * ## Why it is an ABORT and not a shutdown routine
 *
 * `runReconnectLoop` already takes an `AbortSignal` covering a live connection's whole lifetime, and
 * already answers it by calling `SocketConnection.cancel`, which sends the close and awaits the teardown
 * bounded by `wire.ts`'s `CLOSE_TIMEOUT_MS`. The no-deadline path simply passed a signal nothing held a
 * controller for. So the whole of this change is handing that path a signal a human can actually fire —
 * a bespoke shutdown path would have reimplemented a close that already works, on a second code path
 * nothing else exercises.
 *
 * The process seam is injected rather than reached for, so every ending below is unit-testable with a plain
 * fake. It is deliberately NOT `src/browser/tabGuard.ts`'s `GuardedProcess`, whose close is synchronous by
 * construction (it runs on `exit`, where nothing can be awaited); a socket close is asynchronous and must
 * be allowed to finish, which is the opposite requirement.
 */

import type { ListenLog } from "../../../live/listen/socket.js";

/**
 * The endings this listener answers, and the exit code each owes its shell — 128 + the signal number, the
 * shell's own convention, matching `src/browser/tabGuard.ts`'s `GUARDED_ENDINGS` and its stated reason: a
 * run that swallowed Ctrl-C and reported success would be a worse defect than the abrupt kill it replaces.
 */
export const LISTEN_STOP_SIGNALS: readonly { readonly signal: string; readonly code: number }[] = [
  { code: 130, signal: "SIGINT" },
  { code: 143, signal: "SIGTERM" },
];

/**
 * The exit code one signal owes its shell.
 *
 * @param signal the signal name as Node reports it
 * @returns the code, or `undefined` for a signal this listener does not answer
 */
export function listenStopExitCode({ signal }: { signal: string }): number | undefined {
  return LISTEN_STOP_SIGNALS.find((ending) => ending.signal === signal)?.code;
}

/** The slice of Node's process this module touches, injected so the wiring is testable without one. */
export interface StopSignalProcess {
  readonly on: (args: { event: string; handler: () => void }) => void;
  readonly off: (args: { event: string; handler: () => void }) => void;
  readonly exit: (args: { code: number }) => void;
}

/** What a caller holds for the listener's lifetime: the signal to pass down, and what actually happened. */
export interface StopSignalGuard {
  /** Handed to `runListenLoop`, which passes it to the loop that owns the live connection. */
  readonly signal: AbortSignal;
  /** The exit code the first signal earned, or `undefined` when none ever fired. */
  readonly firedCode: () => number | undefined;
  /** Unregister every handler — called once the loop has returned, however it ended. */
  readonly release: () => void;
}

/**
 * Register the stop signals, and hand back the abort signal the loop closes its socket on.
 *
 * Three behaviours that are the contract rather than notes:
 *
 * - **The FIRST signal aborts and returns**, letting the existing close run. The exit code is remembered
 *   here rather than taken from the loop, which has no way to know a signal is why it was told to stop.
 * - **A SECOND signal exits immediately.** A listener wedged in a per-frame side effect would otherwise
 *   turn Ctrl-C into "nothing happened", which is worse than the abrupt kill this replaces.
 * - **A ceiling backs the first one**, on an `unref`'d timer so it can never itself hold the process open.
 *   The caller supplies it; `../../../cli/commands/listen/loop.ts`'s `WORK_ARM_GRACE_MS` is the measured
 *   grace this repo already uses for abandoning a work arm that will not unwind.
 *
 * @param forceExitAfterMs how long the graceful close gets before the process exits anyway
 * @param log where the one line narrating the signal goes
 * @param schedule the force-exit timer seam; returns its canceller
 * @param target the process to register against
 * @returns the guard the caller holds until the loop returns
 */
export function guardStopSignals({
  forceExitAfterMs,
  log,
  schedule,
  target,
}: {
  forceExitAfterMs: number;
  log: ListenLog;
  schedule: (args: { ms: number; tick: () => void }) => () => void;
  target: StopSignalProcess;
}): StopSignalGuard {
  const controller = new AbortController();
  let firedCode: number | undefined;
  let cancelForceExit: () => void = () => undefined;

  const registered = LISTEN_STOP_SIGNALS.map((ending) => ({
    event: ending.signal,
    handler: (): void => {
      if (firedCode !== undefined) {
        log({ line: `${ending.signal} again — exiting now, without waiting for the socket to close` });
        target.exit({ code: ending.code });
        return;
      }
      firedCode = ending.code;
      log({
        line:
          `${ending.signal} — closing the Socket Mode connection, then exiting. A socket closed by the ` +
          "handshake stops counting against Slack's per-app cap far sooner than one torn down by a kill",
      });
      controller.abort(`the operator stopped this listener (${ending.signal})`);
      cancelForceExit = schedule({
        ms: forceExitAfterMs,
        tick: () => {
          log({ line: `the socket did not close within ${String(forceExitAfterMs)}ms — exiting anyway` });
          target.exit({ code: ending.code });
        },
      });
    },
  }));

  registered.forEach((entry) => {
    target.on({ event: entry.event, handler: entry.handler });
  });

  return {
    firedCode: () => firedCode,
    release: () => {
      cancelForceExit();
      registered.forEach((entry) => {
        target.off({ event: entry.event, handler: entry.handler });
      });
    },
    signal: controller.signal,
  };
}

/**
 * The running process, behind {@link StopSignalProcess}.
 *
 * @returns the adapter the guard registers against in production
 */
export function nodeStopSignalProcess(): StopSignalProcess {
  return {
    exit: ({ code }: { code: number }): void => {
      process.exit(code);
    },
    off: ({ event, handler }: { event: string; handler: () => void }): void => {
      process.off(event, handler);
    },
    on: ({ event, handler }: { event: string; handler: () => void }): void => {
      process.on(event, handler);
    },
  };
}
