/**
 * `slopweaver desktop update` — what the desktop app's Update button runs: one
 * click that quits and reopens the app on the latest build, and, if it fails, the old app back so the restarted call
 * can tell the owner what happened.
 *
 * One straight line: wait for a call the app has just ended to let go of the console, fast-forward the main checkout
 * (the same `checkout sync`, which also rebuilds the console page), run `desktop install` from it, and — whatever
 * happened — leave the app running and write one outcome record. The app launches this detached, from the main
 * checkout, so it outlives the app it quits; the decisions are pure in `../../../desktop/updateOutcome.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";
import { cachePaths } from "../../../cacheHome.js";
import { productionInspectDeps } from "../../../checkouts/inspect.js";
import { liveCallLeases } from "../../../desktop/buildStamp.js";
import { readCallLeases } from "../../../desktop/callLeases.js";
import { type DesktopInstallError, type DesktopUpdateError, DesktopUpdateErrors } from "../../../desktop/errors.js";
import { INSTALLED_BUNDLE, runningPids } from "../../../desktop/installPlan.js";
import {
  CALL_END_POLL_MS,
  CALL_END_WAIT_MS,
  callEndVerdict,
  type DesktopUpdateOutcome,
  desktopUpdateArgs,
  failedOutcome,
} from "../../../desktop/updateOutcome.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { selectCheckouts } from "../checkout/core.js";
import { declaredCheckouts } from "../checkout/statusRun.js";
import { syncOneCheckout } from "../checkout/syncRun.js";
import { DESKTOP_UPDATE_USAGE } from "./desktopUsage.js";
import { install } from "./installRun.js";
import { type InstallSeams, machineSeams } from "./installSeams.js";

/** argv[0..3] are node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** What one fast-forward of the main checkout said, and whether it may be built on. */
interface Synced {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** The two slow steps, passed in, so the line between them runs in a test over fakes. */
interface UpdateSteps {
  /** Fast-forward the declared main checkout at `path`. */
  readonly sync: (target: { path: string }) => Synced;
  /** `desktop install`, lock and all. */
  readonly install: (from: { home: string }) => Promise<Result<void, DesktopInstallError>>;
}

/**
 * Wait for every call lease to clear, re-reading them each {@link CALL_END_POLL_MS}: the app ends the call just
 * before launching this, and its last beat may land a moment after.
 */
async function awaitCallEnd({
  seams,
  home,
}: {
  seams: InstallSeams;
  home: string;
}): Promise<Result<void, DesktopUpdateError>> {
  const started = seams.nowMs();
  for (;;) {
    const leases = readCallLeases({ home, seams });
    // An unreadable lease folder is the install's to refuse, with its own message; the wait has nothing to add.
    if (leases.isErr()) {
      return ok(undefined);
    }
    const live = liveCallLeases({ leases: leases.value, nowMs: seams.nowMs() });
    const verdict = callEndVerdict({ live, waitedMs: seams.nowMs() - started });
    if (verdict === "go") {
      return ok(undefined);
    }
    if (verdict === "refuse") {
      return err(DesktopUpdateErrors.callStillLive({ calls: live, seconds: CALL_END_WAIT_MS / 1000 }));
    }
    await seams.pause({ ms: CALL_END_POLL_MS });
  }
}

/**
 * Every step up to and including the install, printing each line as it lands.
 *
 * @param seams every effect on this Mac
 * @param home the state home the main checkout and the call leases are read from
 * @param steps the fast-forward and the install
 * @returns the commit the installed app was built from, else why the update stopped
 */
export async function updateHeld({
  seams,
  home,
  steps,
}: {
  seams: InstallSeams;
  home: string;
  steps: UpdateSteps;
}): Promise<Result<string, DesktopUpdateError>> {
  const calm = await awaitCallEnd({ home, seams });
  if (calm.isErr()) {
    return err(calm.error);
  }
  const main = seams.mainCheckout({ home });
  if (main.isErr()) {
    return err(DesktopUpdateErrors.installFailed({ install: main.error }));
  }
  const running = seams.runningRoot();
  if (running !== main.value) {
    return err(DesktopUpdateErrors.notMainCheckout({ main: main.value, running }));
  }
  const synced = steps.sync({ path: main.value });
  for (const line of synced.lines) {
    seams.out({ line });
  }
  if (!synced.ok) {
    return err(DesktopUpdateErrors.syncRefused({ lines: synced.lines }));
  }
  const installed = await steps.install({ home });
  if (installed.isErr()) {
    return err(DesktopUpdateErrors.installFailed({ install: installed.error }));
  }
  const head = seams.run({ args: ["rev-parse", "HEAD"], command: "git", cwd: main.value });
  if (head.isErr()) {
    return err(DesktopUpdateErrors.installFailed({ install: head.error }));
  }
  return ok(head.value.trim());
}

/**
 * Leave the app running however the update ended: when no copy is running and one is installed — an install that
 * quit the app and then could not reopen anything, or a new build that exited after its health check — open what is
 * installed on the main checkout. A copy already running
 * is left alone, never brought forward. "Running" is what `runningPids` reads off `ps`, the same match the install
 * quits by: a process that only carries the app's path as an argument reads as a copy, and the reopen is skipped.
 *
 * @returns the line to print, or `undefined` when there was nothing to do or nothing could be read
 */
export function reopenIfGone({ seams, home }: { seams: InstallSeams; home: string }): string | undefined {
  const ps = seams.run({ args: ["-axo", "pid=,command="], command: "/bin/ps" });
  if (ps.isErr() || runningPids({ ps: ps.value }).length > 0 || !seams.exists({ path: INSTALLED_BUNDLE })) {
    return undefined;
  }
  const main = seams.mainCheckout({ home });
  let args = [INSTALLED_BUNDLE];
  if (main.isOk()) {
    args = [INSTALLED_BUNDLE, "--args", "--checkout", main.value];
  }
  const opened = seams.run({ args, command: "/usr/bin/open" });
  if (opened.isErr()) {
    return `reopen: could not open ${INSTALLED_BUNDLE} — ${opened.error.message}`;
  }
  return `reopen: no copy was running, so ${INSTALLED_BUNDLE} was opened again`;
}

/** Write one outcome record (the atomic write makes its folder); a failure is printed, never thrown. */
function writeOutcome({ path, outcome }: { path: string; outcome: DesktopUpdateOutcome }): void {
  try {
    writeFileAtomic({ contents: `${JSON.stringify(outcome)}\n`, path });
  } catch (cause) {
    logger.error({ msg: `desktop update: could not write ${path}: ${String(cause)}` });
  }
}

/**
 * The real fast-forward: `checkout sync` of the one declared checkout at `path`.
 *
 * @param home the state home whose profile declares the checkouts
 * @param path the main checkout
 * @returns what the sync said, and whether it may be built on
 */
function syncDeclared({ home, path }: { home: string; path: string }): Synced {
  const config = selectCheckouts({ configs: declaredCheckouts({ home }), path })[0];
  if (config === undefined) {
    return { lines: [`${path}: REFUSED — not a declared main checkout, so it cannot be synced`], ok: false };
  }
  return syncOneCheckout({ config, deps: productionInspectDeps(), dryRun: false, nowMs: Date.now() });
}

/**
 * The record of how the update ended, printing its last line — and, either way, leaving the app running.
 *
 * @returns the outcome to write
 */
function settledOutcome({
  done,
  home,
  seams,
  startedIso,
  logPath,
}: {
  done: Result<string, DesktopUpdateError>;
  home: string;
  seams: InstallSeams;
  startedIso: string;
  logPath: string | undefined;
}): DesktopUpdateOutcome {
  const finishedIso = new Date().toISOString();
  // Either way: a new build that passed its health check can still exit before this line.
  const reopened = reopenIfGone({ home, seams });
  if (reopened !== undefined) {
    logger.out({ line: reopened });
  }
  if (done.isOk()) {
    logger.out({ line: `updated: the app now runs ${done.value.slice(0, 9)}` });
    return { finishedIso, kind: "updated", logPath, sha: done.value, startedIso };
  }
  logger.error({ msg: `desktop update: ${done.error.message}` });
  return failedOutcome({ error: done.error, finishedIso, logPath, startedIso });
}

/**
 * `desktop update` — fast-forward the main checkout, reinstall and reopen the app, and record how it went.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runDesktopUpdate(argv: readonly string[]): Promise<number> {
  const parsed = desktopUpdateArgs({ args: argv.slice(VERB_ARG_OFFSET) });
  if (parsed === undefined) {
    logger.error({ msg: DESKTOP_UPDATE_USAGE });
    return EXIT_USAGE;
  }
  if (parsed.help) {
    logger.out({ line: DESKTOP_UPDATE_USAGE });
    return EXIT_OK;
  }
  let home = slopweaverHome();
  if (parsed.home !== undefined) {
    home = parsed.home;
  }
  const startedIso = new Date().toISOString();
  const seams = machineSeams();
  const done = await updateHeld({
    home,
    seams,
    steps: { install, sync: ({ path }) => syncDeclared({ home, path }) },
  });
  const outcome = settledOutcome({ done, home, logPath: parsed.log, seams, startedIso });
  writeOutcome({ outcome, path: cachePaths().desktopLastUpdateJson });
  if (parsed.outcome !== undefined) {
    writeOutcome({ outcome, path: parsed.outcome });
  }
  if (done.isErr()) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

export const desktopUpdateCommand = defineCommand({ run: runDesktopUpdate });
