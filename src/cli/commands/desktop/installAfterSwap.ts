/**
 * Every step after the swap — register with LaunchServices, ask Spotlight, quit any copy that slipped in, clear
 * the macOS grants a changed signature left stale, open —
 * gathered so that any one failing can put the previous app back, and the settling that keeps or undoes the swap.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type DesktopInstallError, DesktopInstallErrors } from "../../../desktop/errors.js";
import {
  BUNDLE_ID,
  registeredBundles,
  spotlightLine,
  spotlightState,
  staleRegistrations,
} from "../../../desktop/installPlan.js";
import { GRANTED_REQUIREMENT, LSREGISTER, openOn, quitRunning } from "./installProcess.js";
import type { InstallSeams } from "./installSeams.js";
import { resetGrants as clearGrants, recordGrantClear } from "./installSigning.js";
import { discardBackup, rollBack } from "./installSwap.js";

/** The other copies LaunchServices registers under the app's identifier, read from a fresh dump. */
function staleCopies({
  seams,
  installed,
}: {
  seams: InstallSeams;
  installed: string;
}): Result<readonly string[], DesktopInstallError> {
  return seams
    .run({ args: ["-dump"], command: LSREGISTER })
    .map((dump) => staleRegistrations({ bundles: registeredBundles({ dump }), identifier: BUNDLE_ID, installed }));
}

/**
 * Register the install with LaunchServices and drop every other copy's registration. Every stale copy is tried,
 * so one that will not drop never keeps the rest registered, and the result is READ BACK from a second dump
 * rather than trusted from exit codes; whatever is still registered is handed back for the install to name once
 * the app is open.
 *
 * @param installed the installed bundle, which stays registered
 * @returns the line to print, and the copies still registered
 */
export function register({
  seams,
  installed,
}: {
  seams: InstallSeams;
  installed: string;
}): Result<{ line: string; kept: readonly string[] }, DesktopInstallError> {
  const registered = seams.run({ args: ["-f", installed], command: LSREGISTER });
  if (registered.isErr()) {
    return err(registered.error);
  }
  const stale = staleCopies({ installed, seams });
  if (stale.isErr()) {
    return err(stale.error);
  }
  if (stale.value.length === 0) {
    return ok({ kept: [], line: "registered: no other Slopweaver build to unregister" });
  }
  for (const path of stale.value) {
    // A failure here is judged by the read-back below, which is the evidence; the exit code is not.
    seams.run({ args: ["-u", path], command: LSREGISTER });
  }
  const after = staleCopies({ installed, seams });
  if (after.isErr()) {
    // Unread is not dropped: every copy it tried stays named, so a failed read-back never hides one.
    return ok({
      kept: stale.value,
      line: `registered: could not re-read LaunchServices (${after.error.message}), so these may still be registered: ${stale.value.join(", ")}`,
    });
  }
  const kept = after.value;
  const dropped = stale.value.filter((path) => !kept.includes(path));
  // Named here as well as in the closing error, so a later step's failure taking the exit never hides them.
  const stillRegistered = kept.length === 0 ? "" : `; still registered: ${kept.join(", ")}`;
  if (dropped.length === 0) {
    return ok({ kept, line: `registered: no other Slopweaver build unregistered${stillRegistered}` });
  }
  return ok({
    kept,
    line: `registered: and unregistered ${String(dropped.length)} other build(s), left on disk: ${dropped.join(", ")}${stillRegistered}`,
  });
}

/** Ask Spotlight to index the install. A refused import is printed, never fatal: it costs a search, not the app. */
function askSpotlight({ seams, installed }: { seams: InstallSeams; installed: string }): void {
  const status = seams.run({ args: ["-s", "/"], command: "/usr/bin/mdutil" });
  const mdutil = status.isOk() ? status.value : status.error.message;
  const spotlight = spotlightState({ mdutil });
  seams.out({ line: spotlightLine({ mdutil, state: spotlight }) });
  if (spotlight === "disabled") {
    return;
  }
  const indexed = seams.run({ args: [installed], command: "/usr/bin/mdimport" });
  if (indexed.isErr()) {
    seams.out({
      line: `spotlight: the import was refused (${indexed.error.message}) — Launchpad, Raycast and the Finder list the app`,
    });
  }
}

/**
 * Every step after the swap, in order, printing each line as it lands.
 *
 * @param installed the installed bundle
 * @param checkout the main checkout the app is opened on
 * @param pending lines from the swap itself, printed here so a failed write rolls back like any other step
 * @param resetFor the new build's requirement when the grants macOS pinned to an old one are owed a clear — run after
 *   every copy has quit and before the new build opens, so its first launch asks afresh rather than being wiped after
 *   asking
 * @param onGrantsCleared told once the clear succeeded, so the clear is recorded only if the new build is kept, and a
 *   rollback after it can say the app put back asks again
 * @param home the state home whose console call leases the second quit reads
 * @returns the opened line and the copies still registered, or the step that failed
 */
export async function afterSwap({
  seams,
  installed,
  home,
  checkout,
  pending,
  resetFor,
  onGrantsCleared,
}: {
  seams: InstallSeams;
  installed: string;
  home: string;
  checkout: string;
  pending: readonly string[];
  resetFor: string | undefined;
  onGrantsCleared: () => void;
}): Promise<Result<{ opened: string; kept: readonly string[] }, DesktopInstallError>> {
  for (const line of pending) {
    seams.out({ line });
  }
  const registered = register({ installed, seams });
  if (registered.isErr()) {
    return err(registered.error);
  }
  seams.out({ line: registered.value.line });
  askSpotlight({ installed, seams });
  // A copy started between the first quit and the swap is the previous build at the installed path, and would
  // pass for the new one while it is polled, so it is quit too. The residue, stated rather than closed: a launch
  // spawned before the swap whose process first shows in `ps` after this check would still be counted, since `ps`
  // names a path, never which build is behind it.
  const requit = await quitRunning({ home, seams });
  if (requit.isErr()) {
    return err(requit.error);
  }
  seams.out({ line: `${requit.value} after the swap` });
  if (resetFor !== undefined) {
    const reset = clearGrants({ seams });
    if (reset.cleared) {
      onGrantsCleared();
    }
    seams.out({ line: reset.line });
  }
  const opened = await openOn({ checkout, installed, seams });
  return opened.map((line) => ({ kept: registered.value.kept, opened: line }));
}

/**
 * Put the previous app back after the new build failed. A rollback that stops — refused by a call started since, or
 * a copy that will not quit — prints why the new build failed first, since the rollback's own error is the one the run
 * can return and would otherwise hide it.
 */
async function putBack({
  seams,
  backup,
  cause,
  clearedFor,
  home,
}: {
  seams: InstallSeams;
  backup: string;
  cause: DesktopInstallError;
  clearedFor: string | undefined;
  home: string;
}): Promise<Result<void, DesktopInstallError>> {
  const restored = await rollBack({ backup, home, seams });
  if (restored.isErr()) {
    seams.out({ line: `rollback: not done, and the new build had failed: ${cause.message}` });
    return err(restored.error);
  }
  return err(DesktopInstallErrors.rolledBack({ cause: cause.message, grantsCleared: clearedFor !== undefined }));
}

/**
 * Keep or undo the swap on how the new build did. Only a new app seen running but not yet saving the checkout
 * keeps the install; any other failure after the swap puts the previous app back, so a build that cannot register
 * or start never replaces one that could. A first install has no previous app to put back, so its new build stays
 * and the error is reported; rerunning the verb replaces it. A clear of the grants is recorded only on a path that
 * keeps the new build: a rollback after one says the app put back asks for each once more, and leaves the clear owed,
 * since that app may be granted afresh under the old requirement before the next install.
 *
 * A call started after the swap stops the run where it stands: the rollback quits too, so it refuses as well, and the
 * backup stays for the next install's recovery to put right once the call has ended.
 *
 * @param opened what {@link afterSwap} came to
 * @param backup the previous app, moved aside by the swap; `undefined` on a first install
 * @param clearedFor the new build's requirement when its grants were cleared this run
 * @param home the state home whose console call leases a rollback's quit reads
 * @returns nothing when the new build is kept and every other copy dropped, else why not
 */
export async function settle({
  seams,
  opened,
  backup,
  clearedFor,
  home,
}: {
  seams: InstallSeams;
  opened: Result<{ opened: string; kept: readonly string[] }, DesktopInstallError>;
  backup: string | undefined;
  clearedFor: string | undefined;
  home: string;
}): Promise<Result<void, DesktopInstallError>> {
  if (opened.isErr() && opened.error.code === "CALL_LIVE") {
    return err(opened.error);
  }
  if (opened.isErr() && opened.error.code !== "CHECKOUT_NOT_REMEMBERED" && backup !== undefined) {
    return putBack({ backup, cause: opened.error, clearedFor, home, seams });
  }
  if (backup !== undefined) {
    const cleared = discardBackup({ backup, seams });
    if (cleared.isErr()) {
      return err(cleared.error);
    }
  }
  // After the discard, so no backup a later recovery could put back survives a recorded clear.
  if (clearedFor !== undefined) {
    const unrecorded = recordGrantClear({ record: GRANTED_REQUIREMENT, requirement: clearedFor, seams });
    if (unrecorded !== undefined) {
      seams.out({ line: unrecorded });
    }
  }
  if (opened.isErr()) {
    return err(opened.error);
  }
  seams.out({ line: opened.value.opened });
  if (opened.value.kept.length > 0) {
    return err(DesktopInstallErrors.staleCopiesKept({ paths: opened.value.kept }));
  }
  return ok(undefined);
}
