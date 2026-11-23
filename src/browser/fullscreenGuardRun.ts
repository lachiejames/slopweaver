/**
 * The effectful half of the background full-screen guard: arm it before an act, read it back after.
 *
 * `./fullscreenGuard.ts` carries why it exists — a background click on Datadog's "Enter fullscreen" took the owner's whole
 * screen — and what it does not close. This file holds the failure policy, which is the part that
 * needs saying: the guard is BEST EFFORT and never refuses an act. A guard that could fail an act would turn a
 * safety measure into a new way for browser work to stop, so a failure is said on stderr, where `./keepForeground.ts`
 * says a refused foreground restore, and the act goes on. What is never allowed is a session believing the owner's screen
 * was protected when it was not, so a guard that could not be armed, or a reading that could not be taken, says so.
 */
import { logger } from "../lib/logger.js";
import type { Result } from "../lib/result.js";
import type { BrowserActionKind } from "./action.js";
import type { BrowserActionError } from "./actionErrors.js";
import {
  FULLSCREEN_GUARD_INSTALL_SOURCE,
  FULLSCREEN_GUARD_READ_SOURCE,
  type FullscreenGuardObservation,
  type FullscreenGuardPreparation,
  parseFullscreenGuardInstallation,
  parseFullscreenGuardObservation,
  shouldGuardFullscreen,
} from "./fullscreenGuard.js";
import { runClientCommand, type TerminalClientDeps, type TerminalReply } from "./terminalClient.js";

/** Where a guard failure is said. */
export type FullscreenGuardReport = (line: string) => void;

/** The client seam: `runClientCommand` in production, a plain fake function in a test. */
export type FullscreenGuardCommand = (args: {
  args: readonly string[];
  deps: TerminalClientDeps;
  mayAct?: boolean;
}) => Result<TerminalReply, BrowserActionError>;

/* The production report: stderr, so the verb's stdout stays its own answer. */
const reportOnStderr: FullscreenGuardReport = (line) => {
  logger.error({ msg: line });
};

/**
 * Arm the guard in every frame of the session's page, when this act is one that is guarded.
 *
 * A PREPARATION: `./actionExecutor.ts` calls it before its live-page admission, never between that admission and
 * the dispatch, so nothing slow widens the window the admission exists to close.
 *
 * @param kind the interaction about to run
 * @param deps the client and the session it runs under — its `placement` decides whether anything is armed
 * @param report where a guard that could not be armed is said
 * @param runCommand the client seam
 * @returns whether the guard was armed, and how far
 */
export function prepareFullscreenGuard({
  kind,
  deps,
  report = reportOnStderr,
  runCommand = runClientCommand,
}: {
  kind: BrowserActionKind;
  deps: TerminalClientDeps;
  report?: FullscreenGuardReport;
  runCommand?: FullscreenGuardCommand;
}): FullscreenGuardPreparation {
  if (!shouldGuardFullscreen({ kind, placement: deps.placement })) {
    return { kind: "not-required" };
  }
  return armGuard({ deps, report, runCommand, subject: kind });
}

/**
 * Arm the guard on a background session's blank tab, between `attach` and the `goto` that loads its first page.
 *
 * The init script it registers is what guards that first document before its own scripts run: armed only at the
 * first act, a page that kept `Element.prototype.requestFullscreen` at startup would still hold the original
 * Never fails the open, for the reason this file opens with.
 *
 * @param deps the client and the session it runs under — a foreground session arms nothing
 * @param report where a guard that could not be armed is said
 * @param runCommand the client seam
 * @returns whether the guard was armed, and how far
 */
export function armFullscreenGuardAtOpen({
  deps,
  report = reportOnStderr,
  runCommand = runClientCommand,
}: {
  deps: TerminalClientDeps;
  report?: FullscreenGuardReport;
  runCommand?: FullscreenGuardCommand;
}): FullscreenGuardPreparation {
  if (deps.placement !== "background") {
    return { kind: "not-required" };
  }
  return armGuard({ deps, report, runCommand, subject: "open" });
}

/* Send the install source and say every way it fell short; `subject` is what goes ahead regardless. */
function armGuard({
  deps,
  report,
  runCommand,
  subject,
}: {
  deps: TerminalClientDeps;
  report: FullscreenGuardReport;
  runCommand: FullscreenGuardCommand;
  subject: string;
}): FullscreenGuardPreparation {
  // `mayAct`: the source rewrites the page's prototypes, so a client that dies mid-command may have armed some
  // frames and not others.
  const reply = runCommand({ args: ["run-code", FULLSCREEN_GUARD_INSTALL_SOURCE], deps, mayAct: true });
  if (reply.isErr()) {
    report(
      `browser: the background full-screen guard could not be armed (${reply.error.message}); the ${subject} goes ahead, and whether the page can take full screen is unknown`,
    );
    return { kind: "unknown" };
  }
  const installation = parseFullscreenGuardInstallation({ stdout: reply.value.stdout });
  if (installation === null) {
    report(
      `browser: the background full-screen guard's reply could not be read; the ${subject} goes ahead, and whether the page can take full screen is unknown`,
    );
    return { kind: "unknown" };
  }
  if (installation.failedFrames > 0) {
    report(
      `browser: the background full-screen guard could not be armed in ${String(installation.failedFrames)} of ${String(installation.attemptedFrames)} frames; the ${subject} goes ahead, and whether those frames can take full screen is unknown`,
    );
  }
  if (!installation.newDocumentsGuarded) {
    report(
      `browser: the background full-screen guard could not be registered for new documents; the ${subject} goes ahead, and a page that reloads or navigates before it can take full screen`,
    );
  }
  return { installation, kind: "armed" };
}

/**
 * Read the guard's counters back once the act has been dispatched.
 *
 * Past the dispatch, so a failure here is advisory and never an evidence failure: the act happened either way.
 *
 * @param preparation what {@link prepareFullscreenGuard} returned for this act
 * @param deps the client and the session it runs under
 * @param report where a reading that could not be taken is said
 * @param runCommand the client seam
 * @returns the counters, or `null` when nothing was armed or no reliable reading was taken
 */
export function observeFullscreenGuard({
  preparation,
  deps,
  report = reportOnStderr,
  runCommand = runClientCommand,
}: {
  preparation: FullscreenGuardPreparation;
  deps: TerminalClientDeps;
  report?: FullscreenGuardReport;
  runCommand?: FullscreenGuardCommand;
}): FullscreenGuardObservation | null {
  if (preparation.kind !== "armed") {
    return null;
  }
  const reply = runCommand({ args: ["run-code", FULLSCREEN_GUARD_READ_SOURCE], deps });
  if (reply.isErr()) {
    report(`browser: the background full-screen guard could not be read back (${reply.error.message})`);
    return null;
  }
  const observation = parseFullscreenGuardObservation({ stdout: reply.value.stdout });
  if (observation === null) {
    report("browser: the background full-screen guard's read-back could not be parsed");
    return null;
  }
  if (observation.unreadableFrames > 0) {
    report(
      `browser: ${String(observation.unreadableFrames)} frame(s) could not be read back, so the full-screen counts are a lower bound`,
    );
  }
  return observation;
}
