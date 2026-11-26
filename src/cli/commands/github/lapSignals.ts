/**
 * A `github lap` ended by SIGHUP, SIGINT or SIGTERM tears down what it brought up before it exits.
 *
 * Every lap resource is disposed in a `finally`, and a signal's default disposition skips every `finally` in the
 * process: a lap a caller's deadline killed left its detached tree registered with git, its report directory
 * inside it, for as long as nobody removed it by hand. So the lap installs one handler per catchable stop signal
 * before it takes the machine lock or mints a tree; the first signal drains the invocation's cleanup registry
 * (`./lapCleanup.ts`), newest first, and exits `128 + n`, as a shell reports the same death. A second signal while
 * that drain runs never starts another: it exits at once, because the caller is insisting.
 *
 * The handlers never come down, for the reason `../automation/runDueSignal.ts` gives: Node dispatches a signal on a
 * later poll phase, and a listener removed before that phase drops it. After the lap's own work returns, a signal
 * drains an empty registry and exits with its code, which is the order the caller gave.
 *
 * What this cannot cover, stated rather than discovered: SIGKILL, a power cut, and the wait a synchronous call
 * imposes — a handler runs only once the call holding the loop returns, and a lane is one (`./lapStepProcess.ts`,
 * rule 2), so a signal mid-lane is acted on when that lane ends and no lane starts after it. Each tree the lap
 * mints carries a marker naming this process (`../../../worktree/lapTreeProvenance.ts`), so `worktree prune`'s `lap`
 * class removes one this handler never reached.
 */
import type { LapCleanupRegistry } from "./lapCleanup.js";

/** The catchable termination signals a caller's deadline or interruption arrives as. */
export type LapStopSignal = "SIGHUP" | "SIGINT" | "SIGTERM";

/** Every trapped signal, in the order handlers are installed. */
const LAP_STOP_SIGNALS: readonly LapStopSignal[] = ["SIGHUP", "SIGINT", "SIGTERM"];

/** The POSIX number of each trapped signal. */
const SIGNAL_NUMBER: Readonly<Record<LapStopSignal, number>> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

/** The shell convention for a process a signal ended: 128 plus the signal's number. */
const SIGNAL_EXIT_BASE = 128;

/** The process edge the trap reaches, injected so a test drives it with a plain fake. */
export interface LapSignalProcess {
  readonly on: (input: { readonly signal: LapStopSignal; readonly handler: () => void }) => void;
  readonly exit: (input: { readonly code: number }) => void;
  readonly warn: (input: { readonly line: string }) => void;
}

/**
 * The exit code a lap killed by this signal answers. PURE.
 *
 * @returns 129 for SIGHUP, 130 for SIGINT, 143 for SIGTERM
 */
export function lapSignalExitCode({ signal }: { readonly signal: LapStopSignal }): number {
  return SIGNAL_EXIT_BASE + SIGNAL_NUMBER[signal];
}

/**
 * Install the lap's stop-signal handlers over `cleanup`.
 *
 * @param cleanup the invocation's registry, drained by the first signal
 * @param signalProcess where handlers are installed, warnings written and the exit requested
 * @returns `drained`, answering the first signal's teardown — settled once its exit was requested — or `null` while
 * no signal has arrived; a test awaits it
 */
export function installLapSignalCleanup({
  cleanup,
  signalProcess,
}: {
  readonly cleanup: LapCleanupRegistry;
  readonly signalProcess: LapSignalProcess;
}): { readonly drained: () => Promise<void> | null } {
  let first: Promise<void> | null = null;
  let exited = false;
  const exitOnce = ({ code }: { code: number }): void => {
    if (!exited) {
      exited = true;
      signalProcess.exit({ code });
    }
  };
  const drainThenExit = async ({ code }: { code: number }): Promise<void> => {
    try {
      for (const failure of await cleanup.drain()) {
        signalProcess.warn({ line: `github lap: teardown failed — ${failure}` });
      }
    } finally {
      exitOnce({ code });
    }
  };
  const onSignal = ({ signal }: { signal: LapStopSignal }): void => {
    const code = lapSignalExitCode({ signal });
    if (first !== null) {
      signalProcess.warn({
        line: `github lap: ${signal} arrived while the lap was still tearing down after an earlier signal — exiting ${String(code)} now`,
      });
      exitOnce({ code });
      return;
    }
    signalProcess.warn({
      line: `github lap: ${signal} received — starting no further lane and removing what this lap brought up`,
    });
    first = drainThenExit({ code });
  };
  for (const signal of LAP_STOP_SIGNALS) {
    signalProcess.on({
      handler: () => {
        onSignal({ signal });
      },
      signal,
    });
  }
  return { drained: () => first };
}

/**
 * The real process edge.
 *
 * @returns Node's own signal listeners, stderr and exit
 */
export function nodeLapSignalProcess(): LapSignalProcess {
  return {
    exit: ({ code }) => {
      process.exit(code);
    },
    on: ({ signal, handler }) => {
      process.on(signal, handler);
    },
    warn: ({ line }) => {
      process.stderr.write(`${line}\n`);
    },
  };
}
