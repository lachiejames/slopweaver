/**
 * Why `slopweaver desktop install` stopped. Every `message` names the step and what to do next, because the
 * verb is run by a session on the owner's behalf and the line it prints is what reaches the owner.
 */

/** The longest error a STEP_FAILED message carries, counted from its end. */
export const STEP_DETAIL_MAX = 1200;

/** The longest command a STEP_FAILED message names, counted from its start. */
export const STEP_COMMAND_MAX = 600;

/** `text`'s last `max` characters, opened by an ellipsis when anything was cut. */
function keepEnd({ text, max }: { text: string; max: number }): string {
  return text.length <= max ? text : `…${text.slice(text.length - max + 1)}`;
}

/** `text`'s first `max` characters, closed by an ellipsis when anything was cut. */
function keepStart({ text, max }: { text: string; max: number }): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** One failure of the install. */
export type DesktopInstallError =
  | { readonly code: "UNSUPPORTED_HOST"; readonly message: string }
  | { readonly code: "CHECKOUT_UNRESOLVED"; readonly message: string }
  | { readonly code: "INSTALL_IN_PROGRESS"; readonly message: string }
  | { readonly code: "STEP_FAILED"; readonly message: string; readonly command: string }
  | { readonly code: "BUNDLE_INVALID"; readonly message: string; readonly path: string }
  | { readonly code: "SIGNING_FAILED"; readonly message: string; readonly keychain: string }
  | { readonly code: "STILL_RUNNING"; readonly message: string; readonly pids: readonly number[] }
  | { readonly code: "REPLACE_FAILED"; readonly message: string; readonly path: string }
  | { readonly code: "STALE_COPIES_KEPT"; readonly message: string; readonly paths: readonly string[] }
  | { readonly code: "NEVER_RAN"; readonly message: string; readonly path: string }
  | { readonly code: "STOPPED_RUNNING"; readonly message: string; readonly path: string }
  | { readonly code: "ROLLED_BACK"; readonly message: string }
  | { readonly code: "CHECKOUT_NOT_REMEMBERED"; readonly message: string; readonly checkout: string }
  | { readonly code: "CALL_LIVE"; readonly message: string; readonly calls: number }
  | { readonly code: "STAMP_MISSING"; readonly message: string; readonly path: string };

/** Build a {@link DesktopInstallError}. */
export const DesktopInstallErrors = {
  callLive: ({ calls }: { calls: number }): DesktopInstallError => ({
    calls,
    code: "CALL_LIVE",
    message:
      `${calls === 1 ? "a voice call is" : `${String(calls)} voice calls are`} live, and installing quits the app, ` +
      "which ends it — the app the call runs in was left running; run the install once the call has ended, and it " +
      "puts right anything this run left part way",
  }),
  stampMissing: ({ path, detail }: { path: string; detail: string }): DesktopInstallError => ({
    code: "STAMP_MISSING",
    message:
      `the build at ${path} does not carry the commit it was made from (${detail}), so the sidebar could not say ` +
      "which app is running — nothing installed was touched; read the build's output",
    path,
  }),
  bundleInvalid: ({ path, detail }: { path: string; detail: string }): DesktopInstallError => ({
    code: "BUNDLE_INVALID",
    message: `the build at ${path} is not the app to install: ${detail}`,
    path,
  }),
  checkoutNotRemembered: ({ checkout, seconds }: { checkout: string; seconds: number }): DesktopInstallError => ({
    checkout,
    code: "CHECKOUT_NOT_REMEMBERED",
    message:
      `the installed app opened but had not saved ${checkout} as its checkout within ${String(seconds)}s, so a ` +
      "launch from Applications may show no console — read its menu bar icon",
  }),
  checkoutUnresolved: ({ detail }: { detail: string }): DesktopInstallError => ({
    code: "CHECKOUT_UNRESOLVED",
    message: `no main checkout for the app to serve its console from: ${detail}`,
  }),
  installInProgress: ({ detail }: { detail: string }): DesktopInstallError => ({
    code: "INSTALL_IN_PROGRESS",
    message: `could not take the desktop install lock, so this run touched nothing: ${detail} — usually another install is still running, so let it finish`,
  }),
  neverRan: ({ path, seconds }: { path: string; seconds: number }): DesktopInstallError => ({
    code: "NEVER_RAN",
    message: `${path} was opened and no copy of it was running within ${String(seconds)}s`,
    path,
  }),
  stoppedRunning: ({ path, seconds }: { path: string; seconds: number }): DesktopInstallError => ({
    code: "STOPPED_RUNNING",
    message: `${path} started and then stopped within ${String(seconds)}s, before saving the checkout`,
    path,
  }),
  replaceFailed: ({ path, detail }: { path: string; detail: string }): DesktopInstallError => ({
    code: "REPLACE_FAILED",
    message: `could not put the new app at ${path}: ${detail}`,
    path,
  }),
  rolledBack: ({ cause, grantsCleared }: { cause: string; grantsCleared: boolean }): DesktopInstallError => ({
    code: "ROLLED_BACK",
    message:
      `the new build did not register, start and keep running (${cause}), so the previous app was put back and ` +
      `opened — read the build's output${grantsCleared ? "; its macOS grants were cleared before the failure, so it asks for the microphone, System Audio Recording and Screen Recording once more" : ""}`,
  }),
  staleCopiesKept: ({ paths }: { paths: readonly string[] }): DesktopInstallError => ({
    code: "STALE_COPIES_KEPT",
    message:
      `the app is installed and open, but LaunchServices kept ${String(paths.length)} other build(s) registered, so ` +
      `Launchpad may list two: ${paths.join(", ")} — delete each, or run the install again`,
    paths,
  }),
  signingFailed: ({ keychain, detail }: { keychain: string; detail: string }): DesktopInstallError => ({
    code: "SIGNING_FAILED",
    keychain,
    message:
      `could not sign the build with the app's own identity (${detail}), so nothing installed was touched — ` +
      `if it persists, delete ${keychain} and run the install again: a new identity is minted, and macOS asks once ` +
      "more for each permission",
  }),
  // The error leads and the command follows: a build command runs to hundreds of characters, and the owner's update
  // card shows only its opening, so a failed press with the command first reads as a command with no error at all.
  // Each half is bounded so the whole line survives the update record's clip (`OUTCOME_MESSAGE_MAX`, asserted in
  // `stepFailedMessage.test.ts`) with its exit code and command intact: the error keeps its END, where a
  // build prints the failure and the exit code sits, and the command keeps its START, where the program is named.
  stepFailed: ({ command, detail }: { command: string; detail: string }): DesktopInstallError => ({
    command,
    code: "STEP_FAILED",
    message: `${keepEnd({ text: detail, max: STEP_DETAIL_MAX })} — from \`${keepStart({ text: command, max: STEP_COMMAND_MAX })}\``,
  }),
  stillRunning: ({ pids, seconds }: { pids: readonly number[]; seconds: number }): DesktopInstallError => ({
    code: "STILL_RUNNING",
    message:
      `Slopweaver (pid ${pids.join(", ")}) was asked to quit and was still running after ${String(seconds)}s — ` +
      "choose Quit Slopweaver from its menu bar icon, then run the install again",
    pids,
  }),
  unsupportedHost: ({ platform, arch }: { platform: string; arch: string }): DesktopInstallError => ({
    code: "UNSUPPORTED_HOST",
    message: `the desktop app is built for macOS on Apple silicon, and this is ${platform}/${arch}`,
  }),
} as const;

/**
 * Why `slopweaver desktop update` stopped before or around the install it runs. The install's own failures travel
 * whole inside `INSTALL_FAILED`, so the outcome record names the install's code rather than this wrapper's.
 */
export type DesktopUpdateError =
  | { readonly code: "CALL_STILL_LIVE"; readonly message: string; readonly calls: number }
  | { readonly code: "NOT_MAIN_CHECKOUT"; readonly message: string; readonly running: string; readonly main: string }
  | { readonly code: "SYNC_REFUSED"; readonly message: string; readonly lines: readonly string[] }
  | { readonly code: "INSTALL_FAILED"; readonly message: string; readonly install: DesktopInstallError };

/** Build a {@link DesktopUpdateError}. */
export const DesktopUpdateErrors = {
  callStillLive: ({ calls, seconds }: { calls: number; seconds: number }): DesktopUpdateError => ({
    calls,
    code: "CALL_STILL_LIVE",
    message:
      `a voice call still held the console ${String(seconds)}s after the update asked it to end, so nothing was ` +
      "touched and the app kept running — end the call, then press update again",
  }),
  installFailed: ({ install }: { install: DesktopInstallError }): DesktopUpdateError => ({
    code: "INSTALL_FAILED",
    install,
    message: install.message,
  }),
  notMainCheckout: ({ running, main }: { running: string; main: string }): DesktopUpdateError => ({
    code: "NOT_MAIN_CHECKOUT",
    main,
    message:
      `the update builds the main checkout, ${main}, and this run stands in ${running} — nothing was touched; ` +
      `run it from ${main}`,
    running,
  }),
  syncRefused: ({ lines }: { lines: readonly string[] }): DesktopUpdateError => ({
    code: "SYNC_REFUSED",
    lines,
    message:
      `the main checkout could not be brought up to date (${lines.join("; ")}), so nothing was built and the app ` +
      "kept running — read `slopweaver checkout status`",
  }),
} as const;

/**
 * Why the committed `desktop/package.json` could not say which repository paths its scripts reach outside
 * `desktop/` (`desktopScriptArchivePaths`). Each one stops the export before anything is copied, since an export
 * missing a path the build reaches is the failure that read exists to stop.
 */
export type DesktopScriptArchiveError =
  | { readonly code: "MANIFEST_NOT_JSON"; readonly message: string }
  | { readonly code: "NO_SCRIPTS"; readonly message: string }
  | { readonly code: "SCRIPT_NOT_STRING"; readonly message: string; readonly script: string }
  | { readonly code: "SHELL_SYNTAX"; readonly message: string; readonly script: string; readonly word: string }
  | { readonly code: "NOT_ONE_PATH"; readonly message: string; readonly script: string; readonly word: string }
  | { readonly code: "OUTSIDE_REPO"; readonly message: string; readonly script: string; readonly word: string }
  | { readonly code: "CLIMBS_BACK"; readonly message: string; readonly script: string; readonly word: string };

/** Build a {@link DesktopScriptArchiveError}. */
export const DesktopScriptArchiveErrors = {
  climbsBack: ({ script, word }: { script: string; word: string }): DesktopScriptArchiveError => ({
    code: "CLIMBS_BACK",
    message: `desktop/package.json script "${script}" names "${word}", which climbs back up partway along its path`,
    script,
    word,
  }),
  manifestNotJson: (): DesktopScriptArchiveError => ({
    code: "MANIFEST_NOT_JSON",
    message: "desktop/package.json is not valid JSON",
  }),
  noScripts: (): DesktopScriptArchiveError => ({
    code: "NO_SCRIPTS",
    message: "desktop/package.json has no scripts object",
  }),
  notOnePath: ({ script, word }: { script: string; word: string }): DesktopScriptArchiveError => ({
    code: "NOT_ONE_PATH",
    message: `desktop/package.json script "${script}" names "${word}", which is not exactly one path in the repo`,
    script,
    word,
  }),
  outsideRepo: ({ script, word }: { script: string; word: string }): DesktopScriptArchiveError => ({
    code: "OUTSIDE_REPO",
    message: `desktop/package.json script "${script}" names "${word}", which is not one file or folder in the repo`,
    script,
    word,
  }),
  scriptNotString: ({ script }: { script: string }): DesktopScriptArchiveError => ({
    code: "SCRIPT_NOT_STRING",
    message: `desktop/package.json script "${script}" is not a string`,
    script,
  }),
  shellSyntax: ({ script, word }: { script: string; word: string }): DesktopScriptArchiveError => ({
    code: "SHELL_SYNTAX",
    message: `desktop/package.json script "${script}" carries shell syntax in "${word}", so what it reaches is unread`,
    script,
    word,
  }),
} as const;
