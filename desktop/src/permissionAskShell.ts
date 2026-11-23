/**
 * What the permissions guide asks of macOS when the owner presses a button: its own prompt for one permission, or the System
 * Settings page that permission's switch is on. Reading a status asks nothing and stays in `permissionGuideShell.ts`,
 * which decides when a press may reach here.
 */
import { app, desktopCapturer, shell, systemPreferences } from "electron";
import { ResultAsync } from "neverthrow";

import { type PermissionGuideError, PermissionGuideErrors } from "./errors";
import { type PermissionId, settingsUrlOf } from "./permissionGuide";
import { helperPathOf } from "./systemAudioPermission";
import { requestSystemAudio } from "./systemAudioPermissionShell";

/**
 * Where the System Audio Recording helper is, for this build.
 *
 * @returns its absolute path
 */
export function systemAudioHelper(): string {
  return helperPathOf({ appPath: app.getAppPath(), packaged: app.isPackaged, resourcesPath: process.resourcesPath });
}

/**
 * Raise macOS's own prompt for one permission. The microphone has a call for it; System Audio Recording's helper asks
 * TCC itself; Screen Recording's prompt is raised by the first attempt to list the screen — which is also what puts
 * the app in Settings' list — so the list is asked for at no size, which Electron takes as no picture, and dropped
 * unread.
 *
 * @param permission the permission asked for
 * @returns nothing once macOS has answered, or why it did not ask
 */
export function askMacOs({ permission }: { permission: PermissionId }): ResultAsync<void, PermissionGuideError> {
  switch (permission) {
    case "microphone":
      return ResultAsync.fromPromise(systemPreferences.askForMediaAccess("microphone"), (cause) =>
        PermissionGuideErrors.promptFailed({ cause, permission }),
      ).map(() => undefined);
    case "systemAudio":
      return requestSystemAudio({ helperPath: systemAudioHelper() }).map(() => undefined);
    case "screen":
      return ResultAsync.fromPromise(
        desktopCapturer.getSources({ thumbnailSize: { height: 0, width: 0 }, types: ["screen"] }),
        (cause) => PermissionGuideErrors.promptFailed({ cause, permission }),
      ).map(() => undefined);
    default: {
      const unhandled: never = permission;
      return unhandled;
    }
  }
}

/**
 * Open the System Settings page one permission's switch is on, after asking once more for Screen Recording. On
 * purpose, even when it reads denied: Settings lists only an app that has asked, and a status off cannot say whether
 * this build ever did — a re-signed install starts over unlisted. macOS raises its prompt once per app, so an ask
 * already answered raises nothing; it only makes sure the row the owner is sent to find is there. System Audio Recording is
 * never asked from here: its row has a + to add the app by hand, and its Allow already asked.
 *
 * @param permission the permission whose page opens
 * @returns nothing once it opened, or why it did not
 */
export function openPermissionSettings({
  permission,
}: {
  permission: PermissionId;
}): ResultAsync<void, PermissionGuideError> {
  const url = settingsUrlOf({ permission });
  const listed = permission === "screen" ? askMacOs({ permission }) : ResultAsync.fromSafePromise(Promise.resolve());
  return listed.andThen(() =>
    ResultAsync.fromPromise(shell.openExternal(url), (cause) =>
      PermissionGuideErrors.settingsOpenFailed({ cause, url }),
    ),
  );
}
