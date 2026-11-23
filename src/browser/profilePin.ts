/**
 * The profile pin: every Chrome the Playwright relay starts opens in the RECORDED work profile, whatever
 * the owner happened to be looking at.
 *
 * ## Why a pin is needed at all
 *
 * Neither relay on this machine chooses a profile. MEASURED by handing the relay a fake Chrome
 * that logged its argv and launched nothing (`playwright-core` 1.61.1, `attach --extension=chrome`): the
 * whole argument list is the connect URL and nothing else — no `--profile-directory`, no `--user-data-dir`.
 * Chrome then places the page in the profile it was last used in. A newer `@playwright/mcp` DOES pass
 * `--profile-directory`, but it derives the value from Chrome's `Local State` `profile.last_used` and tries
 * that profile first, so it follows the owner in exactly the same way one layer down. Reproduce either with:
 *
 * ```sh
 * grep -n "_openConnectPageInBrowser" node_modules/playwright-core/lib/coreBundle.js
 * ```
 *
 * The consequence falls on the owner: while a YouTube video plays in the personal profile, Playwright keeps
 * going to the personal profile because it is the tab in front. Measured, `profile.last_used` read the
 * personal profile while a walk was starting, and read the work profile ten
 * minutes later once the owner had closed everything else — one field, steering every browser leg here.
 *
 * ## Turning the extension OFF is not a pin, and this is the trap
 *
 * The newer relay skips a profile with no Playwright extension, so disabling the extension everywhere but
 * work reads like a fix. It is not: the test is `Extensions/<id>/` existing on disk, or a non-empty
 * `extensions.settings[<id>]` record in `Preferences`/`Secure Preferences`, and both survive a disable.
 * Only removing the extension changes the answer, and that is the owner's own hand — no session drives a
 * profile that is not the work one.
 *
 * ## The mechanism: a shim in front of Chrome, not a patched dependency
 *
 * `PLAYWRIGHT_MCP_EXECUTABLE_PATH` is honoured by BOTH relays, and both spawn it with the connect URL as the
 * argument. So the pin is a two-line shell script that execs the real Chrome with `--profile-directory`
 * already in front — which pins the profile without patching a dependency that `@latest` re-downloads, and
 * works identically on the version vendored here and on whatever ships next. MEASURED:
 * `attach --extension=chrome` through this shim returned a live session whose first snapshot line was
 * `✅ "Claude Code" connected`.
 *
 * ## The connect page gets its OWN window, so agent tabs never join the owner's
 *
 * Handed a URL with no window flag, Chrome puts the page in whichever window of the pinned profile was
 * last focused — which, while the owner is reading something, is theirs. `--new-window` moves every connect page
 * into a window the walk owns, which keeps agent tabs localised to a window: the owner can keep that window
 * minimised most of the time and do their own browser work in a separate window (in
 * the same chrome profile) without their own tabs being flooded.
 *
 * **This is deliberately a monotonic change, and that is why it can land without a live browser.** The flag
 * is forwarded by the same direct `exec` as `--profile-directory`, so the pin cannot stop pinning: if
 * Chrome honours it the tab lands in its own window, and if it does not, behaviour is exactly what it was
 * before. The alternative shape — `open -g -a <app> --args …`, which would also suppress activation — was
 * REJECTED for the opposite property: macOS `open` drops `--args` for an app that is already running, so a
 * pin built that way would silently stop passing `--profile-directory` and put a walk in whatever profile
 * the owner last used. Losing the profile to gain the focus is the wrong trade in every case.
 *
 * It composes with `./tabGuard.ts`: the guard closes the connect tab on every ending the process is told
 * about, and a Chrome window whose last tab closes goes with it, so an agent window does not accumulate.
 *
 * **What this does NOT fix, and where it is fixed instead:** Chrome still ACTIVATES itself when handed a
 * URL, and the extension focuses the window it connects, so the new window takes the foreground once per
 * walk. No Chrome flag suppresses either, so the foreground is GIVEN BACK rather than never taken:
 * `./foreground.ts` reads what was in front before the attach and raises it again the moment the attach
 * returns — measured at under a second, against ~5 seconds before — then raises the owner's window back
 * over the agent's in Chrome's own order, unless the run chose to be shown (`SLOPWEAVER_BROWSER_FOREGROUND=1`). Its
 * header carries the measurements, the rule, and the off-screen and minimised placements measured and rejected.
 *
 * ## Nothing here names a browser path, and that is the gate rather than a style
 *
 * Chrome's executable is resolved through `playwright-core`'s own registry — the same source the relay uses
 * to find it — so no absolute browser path is written down in this repository at all. That is what lets
 * `no-private-browser-profile` ban such a literal outright, with no allowlist and no exemption marker: a
 * lane that spells out a browser binary is a lane about to launch one without a pin.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { err, ok, type Result } from "../lib/result.js";

import { type RealChromeError, RealChromeErrors } from "./errors.js";
import { type RecordedProfilePort, readRecordedProfile } from "./recordedProfile.js";

/**
 * Characters that would end the double-quoted shell word the pin script puts a value in.
 *
 * A profile directory reaches here only through `browser profile --set`, which refuses a name Chrome's own
 * index does not list, and an executable path comes from Playwright's registry — so neither is attacker
 * input today. The guard is here because the SCRIPT is the thing being generated: a value that escaped its
 * quotes would run as a command in the owner's own shell the next time any browser leg attached, and a
 * refusal at generation time is the only place that failure is legible.
 *
 * @internal
 */
const SHELL_UNSAFE = /["'`$\\\r\n]/;

/**
 * The file mode the pin script is written with: the owner may read and run it, nobody else may touch it.
 *
 * @internal
 */
export const PIN_SCRIPT_MODE = 0o700;

/**
 * Build the pin script's source.
 *
 * `exec` rather than a plain call so the shim leaves no process of its own behind, and `"$@"` last so the
 * connect URL the relay appends stays a single argument however it is quoted.
 *
 * @param directory the Chrome profile directory to pin to, e.g. the one `browser profile --list` marks
 * @param executablePath Chrome's own binary, as Playwright's registry resolved it
 * @returns the shell source, or why one of the values cannot be written into a script safely
 */
export function chromePinScript({
  directory,
  executablePath,
}: {
  directory: string;
  executablePath: string;
}): Result<string, RealChromeError> {
  if (SHELL_UNSAFE.test(directory)) {
    return err(RealChromeErrors.pinUnwritable({ detail: `the profile directory ${directory} cannot be quoted` }));
  }
  if (SHELL_UNSAFE.test(executablePath)) {
    return err(RealChromeErrors.pinUnwritable({ detail: `Chrome's path ${executablePath} cannot be quoted` }));
  }
  return ok(
    [
      "#!/bin/sh",
      "# Written by `slopweaver browser pin`. Every Playwright connect page opens in the recorded work",
      "# profile, whatever Chrome was last used in, and in a window the walk owns rather than the owner's.",
      "# Do not edit — re-run the verb instead.",
      `exec "${executablePath}" --profile-directory="${directory}" --new-window "$@"`,
      "",
    ].join("\n"),
  );
}

/**
 * Ask Playwright's own registry where Chrome is.
 *
 * The relay finds the binary this way, so resolving it the same way means the shim cannot point at a
 * different Chrome than the one that would otherwise have been launched.
 *
 * @returns the absolute path to Chrome, or why it could not be found
 * @internal
 */
export function chromeExecutablePath(): Result<string, RealChromeError> {
  let resolved: unknown;
  try {
    const bundle: unknown = createRequire(import.meta.url)("playwright-core/lib/coreBundle");
    const registry: unknown = isRecordLike(bundle) ? bundle["registry"] : undefined;
    const inner: unknown = isRecordLike(registry) ? registry["registry"] : undefined;
    const find: unknown = isRecordLike(inner) ? inner["findExecutable"] : undefined;
    if (!isRecordLike(inner) || !takesAName(find)) {
      return err(RealChromeErrors.chromeNotFound({ detail: "playwright-core exposes no executable registry" }));
    }
    const executable: unknown = find.call(inner, "chrome");
    const pathOf: unknown = isRecordLike(executable) ? executable["executablePath"] : undefined;
    if (!takesNothing(pathOf)) {
      return err(RealChromeErrors.chromeNotFound({ detail: "playwright-core knows no chrome channel" }));
    }
    resolved = pathOf.call(executable);
  } catch (cause: unknown) {
    return err(RealChromeErrors.chromeNotFound({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
  if (typeof resolved !== "string" || resolved.length === 0) {
    return err(RealChromeErrors.chromeNotFound({ detail: "Chrome is not installed where Playwright looks for it" }));
  }
  return ok(resolved);
}

/** Narrow an unknown to something with readable properties, without reaching for `any`. */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Narrow a value off an untyped bundle to a one-string-argument function.
 *
 * A predicate rather than an assertion because `no-unsafe-type-assertion` is right here: nothing about
 * `playwright-core`'s runtime shape is checked by the compiler, so the check belongs at run time, once.
 */
function takesAName(value: unknown): value is (name: string) => unknown {
  return typeof value === "function";
}

/** Narrow a value off an untyped bundle to a no-argument function. See {@link takesAName}. */
function takesNothing(value: unknown): value is () => unknown {
  return typeof value === "function";
}

/**
 * Write the pin script, creating its directory.
 *
 * Rewritten on every call rather than written once: the recorded profile can change under
 * `browser profile --set`, and a stale pin would silently keep steering at the profile the owner moved off.
 *
 * @param path where the script belongs, `$SLOPWEAVER_HOME/chrome-pin.sh`
 * @param directory the profile directory to pin to
 * @param executablePath Chrome's own binary
 * @returns the path it was written to, or why it could not be written
 */
export function writeChromePin({
  path,
  directory,
  executablePath,
}: {
  path: string;
  directory: string;
  executablePath: string;
}): Result<string, RealChromeError> {
  const source = chromePinScript({ directory, executablePath });
  if (source.isErr()) {
    return err(source.error);
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source.value, { encoding: "utf8", mode: PIN_SCRIPT_MODE });
  } catch (cause: unknown) {
    return err(RealChromeErrors.pinUnwritable({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
  return ok(path);
}

/**
 * Resolve the pin every browser leg launches Chrome through, refreshing it from what is recorded now.
 *
 * @param home the state home whose store records the work profile
 * @param path where the script belongs
 * @param profiles the door the recorded work profile is read through
 * @returns the pin script's path, or why there is no pin to use
 */
export async function resolveChromePin({
  home,
  path,
  profiles,
}: {
  home: string;
  path: string;
  profiles: RecordedProfilePort;
}): Promise<Result<string, RealChromeError>> {
  const directory = await readRecordedProfile({ home, profiles });
  if (directory.isErr()) {
    return err(directory.error);
  }
  const executablePath = chromeExecutablePath();
  if (executablePath.isErr()) {
    return err(executablePath.error);
  }
  return writeChromePin({ directory: directory.value, executablePath: executablePath.value, path });
}
