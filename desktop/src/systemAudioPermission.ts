/**
 * System Audio Recording ("System Audio Recording Only" in Settings, TCC service `kTCCServiceAudioCapture`): where its
 * helper lives and what its answers mean. Pure; `systemAudioPermissionShell.ts` runs the helper.
 *
 * Why the guide asks for it at all, measured: coreaudiod — not Chromium — authorises every audio client
 * each time its IO starts and each time the default device changes, and asks this permission of an app it has never
 * asked. The ask is synchronous, so while the prompt sat unanswered mid-call, audio in every app on the Mac stopped
 * (Meet froze for 18s), and a device switch is exactly when the owner is not looking at a prompt. Electron has no call to
 * read or ask it (`getMediaAccessStatus` covers microphone, camera and screen), so a small helper the app spawns
 * asks TCC itself, and TCC answers for the app that spawned it.
 */
import { dirname, join } from "node:path";

import { err, ok, type Result } from "neverthrow";

import { type PermissionGuideError, PermissionGuideErrors } from "./errors";
import type { MacAccessStatus } from "./permissionGuide";

/** The helper's file name, in `Contents/MacOS` of the installed app and `build/native` of a dev run. */
export const SYSTEM_AUDIO_HELPER_NAME = "slopweaver-system-audio";

/** What the helper prints on success, each the whole of stdout, and the status it means. */
const ANSWERS: Readonly<Record<string, MacAccessStatus>> = {
  "denied\n": "denied",
  "granted\n": "granted",
  "not-determined\n": "not-determined",
};

/**
 * Where the helper is: beside the app's own executable in the installed app — real code there, signed with the rest
 * — and in the build directory for a dev run, which `yarn start` compiles it into.
 *
 * @param packaged whether this is the installed app
 * @param appPath `app.getAppPath()`, the directory a dev run loads `package.json` from
 * @param resourcesPath `process.resourcesPath`, the installed app's `Contents/Resources`
 * @returns the helper's absolute path
 */
export function helperPathOf({
  packaged,
  appPath,
  resourcesPath,
}: {
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string {
  if (packaged) {
    return join(dirname(resourcesPath), "MacOS", SYSTEM_AUDIO_HELPER_NAME);
  }
  return join(appPath, "build", "native", SYSTEM_AUDIO_HELPER_NAME);
}

/**
 * What one helper run answered. Exactly one word and its newline on stdout, nothing on stderr and exit 0 is an
 * answer; anything else is said, never read as granted.
 *
 * @param code its exit code, `null` when a signal stopped it
 * @param stdout everything it printed
 * @param stderr everything it printed as a problem
 * @returns the status, or why there is none
 */
export function parseSystemAudioHelperResult({
  code,
  stdout,
  stderr,
}: {
  code: number | null;
  stdout: string;
  stderr: string;
}): Result<MacAccessStatus, PermissionGuideError> {
  if (code !== 0) {
    return err(PermissionGuideErrors.helperFailed({ exitCode: code, stderr }));
  }
  const status = Object.hasOwn(ANSWERS, stdout) ? ANSWERS[stdout] : undefined;
  if (status === undefined || stderr !== "") {
    return err(PermissionGuideErrors.helperMalformed({ stderr, stdout }));
  }
  return ok(status);
}
