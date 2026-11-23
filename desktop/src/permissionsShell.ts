/**
 * The shell's permission handlers, applied to Electron's default session: the console — and only the console — may
 * have the microphone, the screen and the clipboard, and macOS is asked for the microphone at the moment the owner presses
 * Start, never at launch. Split out of `main.ts`, which applies it at boot. System Audio Recording is not asked here:
 * the permissions guide asks it up front (`permissionGuideShell.ts`), since macOS would otherwise ask mid-call.
 */
import { desktopCapturer, screen, session, systemPreferences } from "electron";

import { asksForAudio } from "./mediaCounts";
import { SCREEN_RECORDING_OFF } from "./nativeCapture";
import { MICROPHONE_OFF } from "./permissionGuide";

/**
 * Install every permission handler.
 *
 * @param consoleOrigin the origin the console serves on now, or `undefined` while it does not
 * @param reportProblem a macOS permission the voice needs and lacks, or `undefined` once it is granted
 */
export function installPermissions({
  consoleOrigin,
  reportProblem,
}: {
  consoleOrigin: () => string | undefined;
  reportProblem: (options: { readonly problem: string | undefined }) => void;
}): void {
  const isConsole = ({ origin }: { origin: string }): boolean => {
    const served = consoleOrigin();
    return served !== undefined && origin.replace(/\/$/u, "") === served;
  };
  session.defaultSession.setPermissionCheckHandler((_contents, _permission, origin) => isConsole({ origin }));
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (!isConsole({ origin: new URL(details.requestingUrl).origin })) {
      callback(false);
      return;
    }
    const wantsMicrophone =
      permission === "media" && "mediaTypes" in details && asksForAudio({ mediaTypes: details.mediaTypes });
    if (!wantsMicrophone || process.platform !== "darwin") {
      callback(true);
      return;
    }
    void (async () => {
      const granted = await systemPreferences.askForMediaAccess("microphone");
      reportProblem({ problem: granted ? undefined : MICROPHONE_OFF });
      callback(granted);
    })();
  });
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isConsole({ origin: request.securityOrigin }) || !request.videoRequested) {
        callback({});
        return;
      }
      void (async () => {
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        const primary = String(screen.getPrimaryDisplay().id);
        const source = sources.find((candidate) => candidate.display_id === primary);
        if (source === undefined) {
          reportProblem({ problem: "Screen sharing found no primary display to share" });
          callback({});
          return;
        }
        callback({ video: source });
      })();
    },
    { useSystemPicker: true },
  );
  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status === "denied" || status === "restricted") {
      // The same line the look reports, so the look that succeeds once the owner grants it clears this one too.
      reportProblem({ problem: SCREEN_RECORDING_OFF });
    }
  }
}
