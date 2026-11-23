/**
 * The install's dealings with the running app: which copies are running, quitting them, checking a build is the
 * one app, and opening the new install and watching it until it is trusted. Every effect goes through
 * {@link InstallSeams}; the judgements are pure in `../../../desktop/installPlan.ts`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { type DesktopInstallError, DesktopInstallErrors } from "../../../desktop/errors.js";
import {
  BUNDLE_ID,
  INSTALLED_BUNDLE,
  type OpenPoll,
  type OpenVerdict,
  openVerdict,
  rememberedCheckout,
  runningPids,
  SYSTEM_AUDIO_HELPER_BUNDLE_PATH,
} from "../../../desktop/installPlan.js";
import type { InstallSeams } from "./installSeams.js";
import { refuseDuringCall } from "./installStamp.js";

/**
 * How long a running copy is given to quit, the app to save its checkout once opened, and the new build to keep
 * running before the previous app's backup is deleted.
 */
const QUIT_SECONDS = 20;
const REMEMBER_SECONDS = 45;
const HOLD_SECONDS = 10;

/** The per-app folder Electron names after `productName`: one per Mac user, whatever `SLOPWEAVER_HOME` says. */
export const APP_SUPPORT = join(homedir(), "Library", "Application Support", "Slopweaver");

/**
 * The keychain holding the app's signing identity (`../../../desktop/signing.ts`). Per Mac user, beside the install
 * lock rather than in the state home: installs from two homes sign with ONE identity, or each would clear the
 * other's macOS grants.
 */
export const SIGNING_KEYCHAIN = join(APP_SUPPORT, "signing.keychain-db");

/**
 * The requirement the app's macOS grants were last cleared for, written only once a clear succeeded, so a clear that
 * failed, or a run killed before it, is owed again by the next install rather than forgotten.
 */
export const GRANTED_REQUIREMENT = join(APP_SUPPORT, "granted-requirement.txt");

/** The app's own saved state. */
export const STATE_FILE = join(APP_SUPPORT, "state.json");

/** The LaunchServices tool, which has no place on `PATH`. */
export const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/**
 * Run one filesystem step, turning a throw into the install's typed error, never an escaped exception.
 *
 * @param act the step
 * @param what what failed, in words, when it throws
 * @returns what the step returned, or the failure as REPLACE_FAILED
 */
export function attempt<T>({ act, what }: { act: () => T; what: string }): Result<T, DesktopInstallError> {
  try {
    return ok(act());
  } catch (cause) {
    return err(
      DesktopInstallErrors.replaceFailed({
        detail: `${what}: ${cause instanceof Error ? cause.message : "refused"}`,
        path: INSTALLED_BUNDLE,
      }),
    );
  }
}

/** The pids of the app's running main processes, from one `ps` read. */
function appPids({
  seams,
  bundle,
}: {
  seams: InstallSeams;
  bundle?: string;
}): Result<readonly number[], DesktopInstallError> {
  return seams
    .run({ args: ["-axo", "pid=,command="], command: "/bin/ps" })
    .map((ps) => (bundle === undefined ? runningPids({ ps }) : runningPids({ bundle, ps })));
}

/**
 * Ask every running copy to quit (SIGTERM, the same as Quit from its menu), and wait until none is left — unless a
 * voice call holds a console lease, which quitting would end. The leases are read here, at every quit, rather than
 * once when the install starts: the build takes minutes and the steps after the swap seconds more, and the owner can open
 * the app and start a call in any of them. The residue, stated rather than closed: a call
 * whose lease lands in the instant between this read and the quit signal is still ended.
 *
 * @param home the state home whose console call leases are read
 * @returns the line to print, CALL_LIVE when a call would end, or STILL_RUNNING naming the copies that would not quit
 */
export async function quitRunning({
  seams,
  home,
}: {
  seams: InstallSeams;
  home: string;
}): Promise<Result<string, DesktopInstallError>> {
  const before = appPids({ seams });
  if (before.isErr()) {
    return err(before.error);
  }
  if (before.value.length === 0) {
    return ok("quit: no copy was running");
  }
  const calm = refuseDuringCall({ home, seams });
  if (calm.isErr()) {
    return err(calm.error);
  }
  for (const pid of before.value) {
    seams.quit({ pid });
  }
  for (let waited = 0; waited < QUIT_SECONDS * 2; waited += 1) {
    const left = appPids({ seams });
    if (left.isErr()) {
      return err(left.error);
    }
    if (left.value.length === 0) {
      return ok(`quit: ${String(before.value.length)} running copy/copies quit`);
    }
    await seams.pause({ ms: 500 });
  }
  const left = appPids({ seams });
  return err(
    DesktopInstallErrors.stillRunning({ pids: left.isOk() ? left.value : before.value, seconds: QUIT_SECONDS }),
  );
}

/**
 * The built bundle's identifier, read off its Info.plist, and its System Audio Recording helper, checked before
 * anything installed is touched: a build without the helper installs an app whose permissions guide cannot read
 * the permission that stalls a call's audio.
 *
 * @param path the built Slopweaver.app
 * @returns nothing when it is the one app, whole, else BUNDLE_INVALID
 */
export function checkBundle({ seams, path }: { seams: InstallSeams; path: string }): Result<void, DesktopInstallError> {
  if (!seams.exists({ path })) {
    return err(DesktopInstallErrors.bundleInvalid({ detail: "the build produced no Slopweaver.app", path }));
  }
  const read = seams.run({
    args: ["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(path, "Contents", "Info.plist")],
    command: "/usr/bin/plutil",
  });
  if (read.isErr()) {
    return err(read.error);
  }
  const identifier = read.value.trim();
  if (identifier !== BUNDLE_ID) {
    return err(
      DesktopInstallErrors.bundleInvalid({ detail: `its identifier is ${identifier}, not ${BUNDLE_ID}`, path }),
    );
  }
  const helper = join(path, SYSTEM_AUDIO_HELPER_BUNDLE_PATH);
  // `-f` as well as `-x`: a directory is "executable" to `test -x`, since x is its search permission. `! -L`: both
  // follow a symlink, which would pass the app's own binary off as the helper.
  if (seams.run({ args: ["-f", helper, "-a", "-x", helper, "-a", "!", "-L", helper], command: "/bin/test" }).isErr()) {
    return err(
      DesktopInstallErrors.bundleInvalid({
        detail: `it has no executable System Audio Recording helper at ${SYSTEM_AUDIO_HELPER_BUNDLE_PATH}`,
        path,
      }),
    );
  }
  return ok(undefined);
}

/** One poll of the opened app: whether it runs from the install, and whether its state names the checkout. */
function pollOnce({
  seams,
  installed,
  checkout,
}: {
  seams: InstallSeams;
  installed: string;
  checkout: string;
}): Result<OpenPoll, DesktopInstallError> {
  const pids = appPids({ bundle: installed, seams });
  if (pids.isErr()) {
    return err(pids.error);
  }
  const saved = attempt({
    act: () =>
      seams.exists({ path: STATE_FILE })
        ? rememberedCheckout({ text: seams.readText({ path: STATE_FILE }) })
        : undefined,
    what: `could not read the app's saved state at ${STATE_FILE}`,
  });
  if (saved.isErr()) {
    return err(saved.error);
  }
  return ok({ running: pids.value.length > 0, saved: saved.value === checkout });
}

/** What a verdict means for the install: the line to print, or the error it ends on. */
function verdictResult({
  verdict,
  installed,
  checkout,
}: {
  verdict: OpenVerdict;
  installed: string;
  checkout: string;
}): Result<string, DesktopInstallError> {
  switch (verdict) {
    case "ready":
      return ok(`opened: running from ${installed} for ${String(HOLD_SECONDS)}s, serving ${checkout}`);
    case "never-ran":
      return err(DesktopInstallErrors.neverRan({ path: installed, seconds: REMEMBER_SECONDS }));
    case "stopped":
      return err(DesktopInstallErrors.stoppedRunning({ path: installed, seconds: REMEMBER_SECONDS }));
    case "not-saved":
      return err(DesktopInstallErrors.checkoutNotRemembered({ checkout, seconds: REMEMBER_SECONDS }));
    default: {
      const unhandled: never = verdict;
      return unhandled;
    }
  }
}

/**
 * Open the install on the main checkout and wait until it has run from there for {@link HOLD_SECONDS} without
 * stopping, with that checkout saved — the evidence the previous app's backup is deleted on.
 *
 * @returns the line to print, or why the new build is not trusted
 */
export async function openOn({
  seams,
  installed,
  checkout,
}: {
  seams: InstallSeams;
  installed: string;
  checkout: string;
}): Promise<Result<string, DesktopInstallError>> {
  const opened = seams.run({ args: [installed, "--args", "--checkout", checkout], command: "/usr/bin/open" });
  if (opened.isErr()) {
    return err(opened.error);
  }
  const polls: OpenPoll[] = [];
  let verdict: OpenVerdict | undefined;
  while (verdict === undefined) {
    if (polls.length > 0) {
      await seams.pause({ ms: 500 });
    }
    const poll = pollOnce({ checkout, installed, seams });
    if (poll.isErr()) {
      return err(poll.error);
    }
    polls.push(poll.value);
    // n polls 500ms apart span (n - 1) * 500ms, so one more poll than half-seconds covers the whole span.
    verdict = openVerdict({ deadline: REMEMBER_SECONDS * 2 + 1, hold: HOLD_SECONDS * 2 + 1, polls });
  }
  return verdictResult({ checkout, installed, verdict });
}
