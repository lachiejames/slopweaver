/**
 * Lazy manifest for the `desktop` noun — the macOS desktop app (`desktop/`).
 *
 * `e2e` launches a bundle as a test instance with its own throwaway saved state and writes photographs under the home.
 * `install` is `effect: "local-state"`:it builds locally, writes `/Applications/Slopweaver.app`, updates
 * LaunchServices and opens the app. `prebuild` builds into the app's own support folder and touches nothing else.
 * Nothing reaches Slack, GitHub or Linear, so none is the admit door's concern.
 */
import {
  DESKTOP_E2E_USAGE,
  DESKTOP_INSTALL_USAGE,
  DESKTOP_PREBUILD_USAGE,
  DESKTOP_UPDATE_USAGE,
} from "../commands/desktop/desktopUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The `desktop` noun's verbs as lazy manifest entries. */
export const desktopManifest: Readonly<Record<string, VerbManifestEntry>> = {
  e2e: lazy({
    load: () => import("../commands/desktop/e2eRun.js").then((m) => m.desktopE2eCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver desktop e2e --app <candidate>/Slopweaver.app",
      parseRejectIsIoFree: true,
      summary:
        "Walk a real Slopweaver.app as a test instance beside the owner's, photograph every page and the voice window, fail on any error",
      usage: DESKTOP_E2E_USAGE,
    },
  }),
  install: lazy({
    load: () => import("../commands/desktop/installRun.js").then((m) => m.desktopInstallCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver desktop install",
      parseRejectIsIoFree: true,
      summary:
        "Build the desktop app and install it as /Applications/Slopweaver.app, open on the main checkout's console",
      usage: DESKTOP_INSTALL_USAGE,
    },
  }),
  prebuild: lazy({
    load: () => import("../commands/desktop/prebuildRun.js").then((m) => m.desktopPrebuildCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver desktop prebuild --decide",
      parseRejectIsIoFree: true,
      summary:
        "Build and sign the app at the main checkout's HEAD into a staged folder, so Update now installs it without building",
      usage: DESKTOP_PREBUILD_USAGE,
    },
  }),
  update: lazy({
    load: () => import("../commands/desktop/updateRun.js").then((m) => m.desktopUpdateCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver desktop update",
      parseRejectIsIoFree: true,
      summary:
        "The app's one-click update: fast-forward the main checkout, reinstall the app, reopen it, record the outcome",
      usage: DESKTOP_UPDATE_USAGE,
    },
  }),
};
