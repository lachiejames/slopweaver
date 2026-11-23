/**
 * The console's recovery, effectful: the fifteen-second check that waits out one slow read (`consoleHealth.ts`), the
 * one `--serve` attempt, a normal update's restart waited out with reads only (`consoleRestartHold.ts`), and the
 * failure the floating note is drawn for. `main.ts` owns the shell's state and lends it through
 * {@link ConsoleRecoveryHost}; the decisions are pure in `consoleHealth.ts`, `consoleRestartHold.ts` and
 * `shellState.ts`.
 */
import type { Result } from "neverthrow";

import { type ConsoleReadObservation, decideConsoleCheck } from "./consoleHealth";
import type { StandingFailure } from "./consoleNoteShell";
import { consoleOutageEntry, outageStart, RESTART_POLL_MS, restartHoldVerdict } from "./consoleRestartHold";
import { ensureConsoleIn, readConsole } from "./consoleServer";
import type { CheckoutError, ConsoleError } from "./errors";
import { logDesktopEvent } from "./eventLogShell";
import type { ServiceStatus, ShellEvent } from "./shellState";
import { loadTabsAfterRecovery } from "./tabRouting";

/** What the recovery reaches in `main.ts`. */
export interface ConsoleRecoveryHost {
  /** The checkout the console is served from, or why there is none. */
  readonly checkout: () => Result<string, CheckoutError>;
  /** Whether a console that is not serving is started; a test instance (`e2eMode.ts`) only reads one. */
  readonly start: boolean;
  /** Where the console stands now. */
  readonly service: () => ServiceStatus;
  /** Apply a shell event and redraw. */
  readonly dispatch: (options: { readonly event: ShellEvent }) => void;
  /** Load the overlay's page onto the console as it serves now. */
  readonly loadOverlay: () => void;
}

let host: ConsoleRecoveryHost | undefined;
let recovery: Promise<void> | undefined;
/** Why the last recovery failed, while the console stays down. */
let consoleFailure: ConsoleError | CheckoutError | undefined;
/** Counts raised failures, so a note link drawn for an older failure is never acted on. */
let failureSerial = 0;
/** When the console was first found not answering since it last served; `undefined` while it serves. */
let outageSinceMs: number | undefined;
/** The next read a held restart has scheduled. */
let restartReadTimer: NodeJS.Timeout | undefined;
/** Bumped on every change of who owns the console's standing, so a read that settles after a newer one is dropped. */
let consoleStanding = 0;
/**
 * Whether a timed check's read is still out. `--status` alone may take 20s against a 15s interval, so without this an
 * older check could settle after a newer one confirmed the console and start a recovery it no longer needs.
 */
let checkInFlight = false;
/** Failed timer reads in a row of a console held as serving (`consoleHealth.ts`): one slow read is waited out. */
let consoleReadFailures = 0;

/**
 * The host, once {@link startConsoleRecovery} has run.
 *
 * @returns the host
 */
function hostOf(): ConsoleRecoveryHost {
  if (host === undefined) {
    throw new Error("the console recovery was used before startConsoleRecovery");
  }
  return host;
}

/**
 * Lend the recovery what it reaches in `main.ts`, before anything asks it to recover.
 *
 * @param recoveryHost the shell's state and the effects it asks for
 */
export function startConsoleRecovery({ recoveryHost }: { recoveryHost: ConsoleRecoveryHost }): void {
  host = recoveryHost;
}

/**
 * The recovery in flight, for a caller that must wait for it.
 *
 * @returns its promise, or `undefined` when none runs
 */
export function recoveryInFlight(): Promise<void> | undefined {
  return recovery;
}

/**
 * Whether the console is being brought back or waited out, so nothing types into an app still coming up.
 *
 * @returns true while a recovery runs or a restart is held
 */
export function consoleRecovering(): boolean {
  return recovery !== undefined || hostOf().service().kind === "restarting";
}

/**
 * The failed recovery standing now, which the console's floating note is drawn for.
 *
 * @returns the failure and its serial, or `undefined` while the console serves, comes up or is held for a restart
 */
export function standingFailure(): StandingFailure | undefined {
  if (hostOf().service().kind !== "needs-attention" || consoleFailure === undefined) {
    return undefined;
  }
  return { failure: consoleFailure, serial: failureSerial };
}

/**
 * Bring the console back once — serialised, so a poll, a retry and a failed load never start three. While a normal
 * update's restart is being waited out the hold's own reads own the outcome, so a page that failed to load meanwhile
 * starts nothing; and once the note stands, a page that failed late starts nothing either: a second
 * `--serve` is only ever the owner's Retry.
 */
export function recover(): void {
  const kind = hostOf().service().kind;
  if (recovery !== undefined || kind === "restarting" || kind === "needs-attention") {
    return;
  }
  runRecovery();
}

/** The owner's Retry, from the menu bar or the note: one more attempt, raised at once if it fails — the window is spent. */
export function retryConsole(): void {
  if (recovery !== undefined) {
    return;
  }
  runRecovery();
}

/** The one recovery attempt both entries run. */
function runRecovery(): void {
  const recoveryHost = hostOf();
  clearTimeout(restartReadTimer);
  restartReadTimer = undefined;
  consoleReadFailures = 0;
  consoleStanding += 1;
  recoveryHost.dispatch({ event: { kind: "recovery-started" } });
  // Stamped as the attempt's first read begins, after the redraw, so the window dates from that read.
  outageSinceMs = outageStart({ nowMs: performance.now(), outageSinceMs });
  // One stored promise, never a wrapper per caller, so a failing recovery is one rejection however many asked
  // a caller that must wait awaits `recoveryInFlight()` itself.
  recovery = ensureConsoleIn({ checkout: recoveryHost.checkout(), start: recoveryHost.start })
    .match(
      (endpoint) => {
        consoleServes({ endpoint });
      },
      (failure) => {
        consoleFails({ failure });
      },
    )
    .finally(() => {
      recovery = undefined;
      loadTabsAfterRecovery();
      if (recoveryHost.service().kind !== "restarting") {
        recoveryHost.loadOverlay();
      }
    });
}

/**
 * The console answers: the outage, the hold and the failure are over.
 *
 * @param endpoint the origin it answers on
 */
function consoleServes({ endpoint }: { endpoint: string }): void {
  clearTimeout(restartReadTimer);
  restartReadTimer = undefined;
  if (outageSinceMs !== undefined && consoleFailure !== undefined) {
    const entry = consoleOutageEntry({ atMs: Date.now(), nowMs: performance.now(), outageSinceMs, outcome: "back" });
    logDesktopEvent({ entry });
  }
  outageSinceMs = undefined;
  consoleFailure = undefined;
  consoleReadFailures = 0;
  consoleStanding += 1;
  hostOf().dispatch({ event: { endpoint, kind: "recovery-succeeded" } });
}

/**
 * A recovery or a held read failed: wait it out quietly while a normal update's restart could still explain it, and
 * raise the note only once past that window.
 *
 * @param failure why the console is not serving
 */
function consoleFails({ failure }: { failure: ConsoleError | CheckoutError }): void {
  // Set before the dispatch, whose redraw raises the note for this failure.
  consoleFailure = failure;
  const nowMs = performance.now();
  const atMs = Date.now();
  const since = outageStart({ nowMs, outageSinceMs });
  if (restartHoldVerdict({ failure, nowMs, outageSinceMs: since }) === "hold") {
    if (hostOf().service().kind !== "restarting") {
      const problem = failure.message;
      const entry = consoleOutageEntry({ atMs, nowMs, outageSinceMs: since, outcome: "held", problem });
      logDesktopEvent({ entry });
    }
    hostOf().dispatch({ event: { kind: "restart-held", problem: failure.message } });
    restartReadTimer = setTimeout(() => {
      restartReadTimer = undefined;
      void readHeldRestart();
    }, RESTART_POLL_MS);
    return;
  }
  failureSerial += 1;
  logDesktopEvent({
    entry: consoleOutageEntry({ atMs, nowMs, outageSinceMs: since, outcome: "raised", problem: failure.message }),
  });
  hostOf().dispatch({ event: { kind: "recovery-failed", problem: failure.message } });
}

/** One read of a console held for a restart — read only, never `--serve` — and what it settles. */
async function readHeldRestart(): Promise<void> {
  const recoveryHost = hostOf();
  const checkout = recoveryHost.checkout();
  if (recoveryHost.service().kind !== "restarting" || recovery !== undefined || checkout.isErr()) {
    return;
  }
  const standing = consoleStanding;
  const read = await readConsole({ checkout: checkout.value });
  // Read through the accessor: a recovery may have started during the await, which a narrowed `recovery` hides.
  if (
    standing !== consoleStanding ||
    recoveryHost.service().kind !== "restarting" ||
    recoveryInFlight() !== undefined
  ) {
    return;
  }
  if (read.isOk()) {
    consoleServes({ endpoint: read.value });
  } else {
    consoleFails({ failure: read.error });
    if (recoveryHost.service().kind === "restarting") {
      return;
    }
  }
  loadTabsAfterRecovery();
  recoveryHost.loadOverlay();
}

/**
 * Check the console on a timer: a running one that stops answering is brought back once; a failed one is only
 * READ, never started, so it turns quiet by itself if the owner brings the console back another way. A held restart has
 * its own reads. One check at a time: a tick while the last one's read is out is skipped.
 */
export function checkConsole(): void {
  const checkout = hostOf().checkout();
  if (recovery !== undefined || checkInFlight || checkout.isErr()) {
    return;
  }
  const service = hostOf().service();
  const path = checkout.value;
  const standing = consoleStanding;
  if (service.kind === "ready") {
    checkInFlight = true;
    void checkServingConsole({ expectedEndpoint: service.endpoint, path, standing }).finally(() => {
      checkInFlight = false;
    });
    return;
  }
  if (service.kind === "needs-attention") {
    checkInFlight = true;
    void adoptConsoleBroughtBack({ path, standing }).finally(() => {
      checkInFlight = false;
    });
  }
}

/**
 * Read a console held as serving, and act only on what `decideConsoleCheck` says: one failed read is waited out
 * (`consoleHealth.ts`). The outage dates from when the run's FIRST failed read began, so a `--status` that timed out
 * at 20s has spent 20s of the restart window; an answer ends the run and its outage. A read that settles after its
 * standing was replaced is dropped.
 *
 * @param expectedEndpoint the address the console was held at when the read started
 * @param path the checkout whose console is read
 * @param standing the console's standing when the read began
 */
async function checkServingConsole({
  expectedEndpoint,
  path,
  standing,
}: {
  expectedEndpoint: string;
  path: string;
  standing: number;
}): Promise<void> {
  const readBeganMs = performance.now();
  const read = await readConsole({ checkout: path });
  if (recoveryInFlight() !== undefined || standing !== consoleStanding) {
    return;
  }
  let observation: ConsoleReadObservation = { kind: "failed" };
  if (read.isOk()) {
    observation = { endpoint: read.value, kind: "answered" };
    outageSinceMs = undefined;
  } else {
    outageSinceMs = outageStart({ nowMs: readBeganMs, outageSinceMs });
  }
  const decision = decideConsoleCheck({ consecutiveFailures: consoleReadFailures, expectedEndpoint, observation });
  consoleReadFailures = decision.consecutiveFailures;
  if (decision.action.kind === "recover") {
    recover();
    return;
  }
  if (decision.action.kind === "adopt") {
    consoleServes({ endpoint: decision.action.endpoint });
    loadTabsAfterRecovery();
    hostOf().loadOverlay();
  }
}

/**
 * Read a failed console once more and, if the owner brought it back another way, adopt it. A recovery that started — or
 * started and finished — while the read was in flight owns the outcome instead, so this read is dropped.
 *
 * @param path the checkout whose console is read
 * @param standing the console's standing when the read began
 */
async function adoptConsoleBroughtBack({ path, standing }: { path: string; standing: number }): Promise<void> {
  const read = await readConsole({ checkout: path });
  if (read.isOk() && recovery === undefined && standing === consoleStanding) {
    consoleServes({ endpoint: read.value });
    loadTabsAfterRecovery();
    hostOf().loadOverlay();
  }
}
