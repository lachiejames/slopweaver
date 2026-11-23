/**
 * The call leg's hold on SIGINT and SIGTERM while a scenario drives a test instance. A signal to this pid alone would
 * otherwise exit past `closeCallSession`, leaving the test instance and its call up (Codex call-r1-cleanup).
 *
 * Playwright's launcher handler closes the instance and exits on the FIRST SIGINT, before the console can prove the
 * call ended (playwright-core coreBundle.js, `exitWithCode130`), so the guard owns both signals while it runs and hands
 * them back after (Codex call-r3-cleanup). An interrupted run writes no report, so a call it could not prove ended is
 * named here. A SECOND signal is the hard stop: `process.exit` still runs Playwright's exit hook, which kills the
 * instance, and the next leg's preflight holds (exit 4) on any lease left until it expires.
 */
import { rmSync } from "node:fs";

import { logger } from "#lib/logger.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { type CallSession, closeCallSession } from "./e2eCallSession.js";

/** The two signals the guard holds. */
type HeldSignal = "SIGINT" | "SIGTERM";

/** One signal and the listeners the process holds for it. */
export interface SignalListeners {
  readonly signal: HeldSignal;
  readonly listeners: ReturnType<typeof process.listeners>;
}

/**
 * The process's SIGINT and SIGTERM listeners as they stand, raw: a `once` listener is read as its wrapper, so handing
 * it back keeps it one-shot (Codex call-r12-signals).
 *
 * @returns each signal with its listeners
 */
export function signalListeners(): readonly SignalListeners[] {
  return (["SIGINT", "SIGTERM"] as const).map((signal) => ({ listeners: process.rawListeners(signal), signal }));
}

/**
 * A `newListener` hook dropping every SIGINT or SIGTERM listener added while the guard holds, bar the guard's own. A
 * launch INSIDE the drive (the relaunch scenario's) adds Playwright's listener again; `newListener` fires before the
 * add, so the drop waits one microtask (Codex call-r3-cleanup-single-signal). A drop still queued when the guard lets
 * go does nothing: run after the hand-back, it would erase the listeners just handed back (Codex call-r4-signals).
 *
 * @param keep the guard's own listener, never dropped
 * @returns the hook, and the release the guard calls before it hands the listeners back
 */
export function lateListenerDropper({ keep }: { keep: () => void }): {
  readonly hook: (...args: unknown[]) => void;
  readonly release: () => void;
} {
  let holding = true;
  const hook = (...args: unknown[]): void => {
    const [added] = args;
    if (added !== "SIGINT" && added !== "SIGTERM") {
      return;
    }
    queueMicrotask(() => {
      if (!holding) {
        return;
      }
      process
        .listeners(added)
        .filter((listener) => listener !== keep)
        .forEach((listener) => process.off(added, listener));
      // A second copy of the guard's own listener would read one signal as two (Codex call-r9-signals).
      while (process.listeners(added).length > 1) {
        process.off(added, keep);
      }
    });
  };
  return {
    hook,
    release: (): void => {
      holding = false;
    },
  };
}

/**
 * The guard's listener: the first signal ends what the session placed and exits, the second exits at once.
 *
 * @param session the session whose calls the first signal ends
 * @param scratch the scenario's scratch folder, removed before the run exits
 * @returns the listener, and the cleanup a first signal started, which ends in the exit
 */
function interruptHandler({ session, scratch }: { session: CallSession; scratch: string }): {
  readonly onSignal: () => void;
  readonly exiting: () => Promise<void> | undefined;
} {
  let closing: Promise<void> | undefined;
  const closeAndExit = async (): Promise<void> => {
    try {
      const closed = await closeCallSession({ session });
      if (closed !== undefined) {
        logger.error({ msg: `STOPPED  interrupted, and a test call could not be proven ended: ${closed}` });
      }
    } finally {
      rmSync(scratch, { force: true, recursive: true });
      process.exit(EXIT_ERROR);
    }
  };
  const onSignal = (): void => {
    if (closing !== undefined) {
      logger.error({ msg: "STOPPED  interrupted twice: the test call was not proven ended" });
      process.exit(EXIT_ERROR);
    }
    // The drive runs on beside cleanup, so it is told first: a Talk it has not pressed yet stays unpressed.
    session.interrupted = true;
    closing = closeAndExit();
  };
  return { exiting: () => closing, onSignal };
}

/**
 * Drive an opened session with SIGINT and SIGTERM ending what it placed first.
 *
 * @param beforeLaunch the listeners read before the instance launched, the ones handed back after
 * @param drive the scenario's drive over the session
 * @param scratch the scenario's scratch folder, removed before an interrupted run exits
 * @returns what the drive returned
 */
export async function signalGuarded<T>({
  beforeLaunch,
  drive,
  scratch,
  session,
}: {
  beforeLaunch: readonly SignalListeners[];
  drive: () => Promise<T>;
  scratch: string;
  session: CallSession;
}): Promise<T> {
  const { exiting, onSignal } = interruptHandler({ scratch, session });
  const dropper = holdSignals({ keep: onSignal });
  try {
    return await drive();
  } finally {
    // A drive settling under a first signal's cleanup keeps the guard until that cleanup exits, so a second signal
    // is still the guard's hard stop rather than the default kill (Codex call-r11-signals).
    await exiting();
    handBack({ beforeLaunch, dropper });
  }
}

/**
 * Take both signals: every listener they hold now is removed and `keep` installed on each. The dropper is attached
 * first, so a listener another `newListener` hook adds while `keep` goes on is seen too (Codex call-r6-signals).
 * Playwright's own listener is not handed back: it drops it itself once the instance closes, which the drive does.
 *
 * @param keep the guard's listener, the one each signal holds while the guard does
 * @returns the dropper, for `handBack`
 */
export function holdSignals({ keep }: { keep: () => void }): ReturnType<typeof lateListenerDropper> {
  const dropper = lateListenerDropper({ keep });
  process.on("newListener", dropper.hook);
  for (const { listeners, signal } of signalListeners()) {
    listeners.forEach((listener) => process.off(signal, listener));
    process.on(signal, keep);
  }
  return dropper;
}

/**
 * Let go of both signals, leaving each holding exactly the listeners read before launch. Every listener is cleared
 * rather than only the guard's: one added in the drive's last microtask has its drop queued behind this, and a
 * released dropper does nothing, so it would otherwise outlive the guard (Codex call-r5-signals).
 *
 * @param beforeLaunch the listeners read before the instance launched
 * @param dropper the guard's late-listener dropper, released first so a drop still queued spares the hand-back
 */
export function handBack({
  beforeLaunch,
  dropper,
}: {
  beforeLaunch: readonly SignalListeners[];
  dropper: ReturnType<typeof lateListenerDropper>;
}): void {
  dropper.release();
  process.off("newListener", dropper.hook);
  for (const { listeners, signal } of beforeLaunch) {
    process.removeAllListeners(signal);
    listeners.forEach((listener) => process.on(signal, listener));
  }
}
