/**
 * Whether the fifteen-second console check acts on what it read: one slow answer is not a dead console. Pure;
 * `consoleRecoveryShell.ts` reads the console and applies the action.
 *
 * On a live call a window that went to "Starting Slopweaver" and a note naming localhost:3000 read as an update
 * forcing itself on the call, though no update ran. A probe that rendered the whole Queue page against a five-second
 * bound — 3.1 to 4.0s at rest, measured (`desktop/src/consoleServer.ts`, `PROBE_PATH`) — let a call's load tip one read
 * over, and the shell recovered a console that was serving the owner. So the probe asks a static file, and the check recovers only after
 * {@link CONSOLE_FAILURES_BEFORE_RECOVERY} failed reads in a row. A page that fails to load still recovers at once.
 */

/** How many failed reads in a row the check takes as a console that stopped answering. */
export const CONSOLE_FAILURES_BEFORE_RECOVERY = 2;

/** What one check read of the console came to. */
export type ConsoleReadObservation =
  { readonly kind: "answered"; readonly endpoint: string } | { readonly kind: "failed" };

/** What the check does about it. */
export type ConsoleCheckAction =
  | { readonly kind: "none" }
  | { readonly kind: "recover" }
  /** A console answered at another address: it is live, so it is taken as it is rather than recovered. */
  | { readonly kind: "adopt"; readonly endpoint: string };

/** The action, and the run of failed reads it leaves for the next check. */
export interface ConsoleCheckDecision {
  readonly action: ConsoleCheckAction;
  readonly consecutiveFailures: number;
}

/**
 * Decide one check of a console the shell holds as serving.
 *
 * @param consecutiveFailures failed reads in a row before this one
 * @param expectedEndpoint the address the shell holds the console at
 * @param observation what this read came to
 * @returns the action and the failed-read run after it — a recovery starts a fresh run
 */
export function decideConsoleCheck({
  consecutiveFailures,
  expectedEndpoint,
  observation,
}: {
  consecutiveFailures: number;
  expectedEndpoint: string;
  observation: ConsoleReadObservation;
}): ConsoleCheckDecision {
  if (observation.kind === "answered") {
    if (observation.endpoint === expectedEndpoint) {
      return { action: { kind: "none" }, consecutiveFailures: 0 };
    }
    return { action: { endpoint: observation.endpoint, kind: "adopt" }, consecutiveFailures: 0 };
  }
  const failures = consecutiveFailures + 1;
  if (failures >= CONSOLE_FAILURES_BEFORE_RECOVERY) {
    return { action: { kind: "recover" }, consecutiveFailures: 0 };
  }
  return { action: { kind: "none" }, consecutiveFailures: failures };
}
