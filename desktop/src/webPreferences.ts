/**
 * The web preferences both of the shell's windows share, built from the window's role alone, so `main.ts` lends each
 * window one call rather than carrying the shape.
 */
import { join } from "node:path";

import { instanceArguments, ROLE_ARGUMENT } from "./desktopBridge";
import { windowControlsArgument, windowControlsState } from "./windowChrome";

/**
 * The web preferences both windows share: isolated, sandboxed, no Node, the one preload, the role, and — on the test
 * instance alone — its marker.
 *
 * @param role which window
 * @param fullscreen whether it opens full-screen, so the page knows from its first paint whether the window's buttons
 *   stand over it
 * @param e2e whether this is the desktop test instance, whose pages carry its marker
 * @returns the preferences
 */
export function webPreferencesFor({
  role,
  fullscreen,
  e2e,
}: {
  role: "main" | "overlay";
  fullscreen: boolean;
  e2e: boolean;
}): Electron.WebPreferences {
  const controls = windowControlsState({ fullscreen, platform: process.platform, role });
  return {
    additionalArguments: [
      `${ROLE_ARGUMENT}${role}`,
      windowControlsArgument({ state: controls }),
      ...instanceArguments({ e2e }),
    ],
    backgroundThrottling: role !== "overlay",
    contextIsolation: true,
    nodeIntegration: false,
    preload: join(__dirname, "preload.js"),
    sandbox: true,
    spellcheck: role === "main",
  };
}
