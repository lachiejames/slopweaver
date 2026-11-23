/**
 * `browser present`'s desktop route: a console page — a published local page (a briefing, a card's page) or a console
 * address such as the Queue or a Settings section (`./presentConsole.ts`) — opens in the installed desktop app, never
 * the owner's Chrome: the Queue in the one pinned Queue tab, every other page as a NEW TAB (a
 * second Queue tab leaves the owner reading a duplicate; `../desktop/deepLink.ts`).
 *
 * Owner ruling: a briefing or a Queue card opens as a deep link inside the desktop app, in a new tab, never in the
 * browser. The voice's `open_card` once sent a card's page to Chrome through
 * this verb, and the open was refused.
 *
 * The deep link goes to the canonical installed bundle by PATH (`open -a /Applications/Slopweaver.app`), so neither
 * another app claiming `slopweaver:` nor a second copy carrying our identifier ever receives a console path,
 * and only once that bundle's own identifier reads `ai.slopweaver.desktop`. Chrome stays the route only where the app is CONCLUSIVELY absent — no bundle of ours at `/Applications`,
 * or not macOS — and an installation that cannot be read, or an open that fails, is an error rather than a quiet fall back
 * to the browser the owner ruled out.
 */
import { lstatSync, type Stats } from "node:fs";
import { join } from "node:path";

import { desktopDeepLinkTab } from "../desktop/deepLink.js";
import { BUNDLE_ID, INSTALLED_BUNDLE } from "../desktop/installPlan.js";
import { err, ok, type Result } from "../lib/result.js";
import type { ForegroundCommand, ForegroundRun } from "./foreground.js";

/** Whether the desktop app is installed where `slopweaver desktop install` puts it. */
export type DesktopInstallation = "absent" | "installed";

/** The installed bundle exists but whether it is an app could not be read. */
export interface DesktopInstallUnreadableError {
  readonly code: "DESKTOP_INSTALL_UNREADABLE";
  readonly message: string;
  readonly bundle: string;
}

/** The bundle at the install path is not the Slopweaver desktop app. */
export interface DesktopInstallForeignError {
  readonly code: "DESKTOP_INSTALL_FOREIGN";
  readonly message: string;
  readonly bundle: string;
  readonly identifier: string;
}

/** The installed app was asked to open the deep link and the open failed. */
export interface DesktopOpenFailedError {
  readonly code: "DESKTOP_OPEN_FAILED";
  readonly message: string;
  readonly deepLink: string;
}

/** Why the desktop route could not open a page — never a reason to fall back to the owner's browser. */
export type PresentDesktopError = DesktopInstallForeignError | DesktopInstallUnreadableError | DesktopOpenFailedError;

/** The desktop route's error factory. */
export const PresentDesktopErrors = {
  installForeign: ({ bundle, identifier }: { bundle: string; identifier: string }): DesktopInstallForeignError => ({
    bundle,
    code: "DESKTOP_INSTALL_FOREIGN",
    identifier,
    message: `the app at ${bundle} identifies as ${JSON.stringify(identifier)}, not ${BUNDLE_ID}; reinstall with slopweaver desktop install`,
  }),
  installUnreadable: ({ bundle, why }: { bundle: string; why: string }): DesktopInstallUnreadableError => ({
    bundle,
    code: "DESKTOP_INSTALL_UNREADABLE",
    message: `could not read whether the desktop app is installed at ${bundle}: ${why}`,
  }),
  openFailed: ({ deepLink, why }: { deepLink: string; why: string }): DesktopOpenFailedError => ({
    code: "DESKTOP_OPEN_FAILED",
    deepLink,
    message: `the desktop app at ${INSTALLED_BUNDLE} did not take ${deepLink}: ${why}`,
  }),
} as const;

/** What the desktop route reaches: whether the app is there, and the one command that opens a deep link in it. */
export interface DesktopPageSeam {
  readonly installation: () => Result<DesktopInstallation, PresentDesktopError>;
  readonly run: ForegroundRun;
}

/** What the voice is handed when the page opened as a desktop-app tab. */
export interface DesktopPageAnswer {
  readonly opened: true;
  readonly openedIn: "slopweaver-desktop-app";
  /** The console address the page is served at, the same `requestedUrl` a Chrome present names. */
  readonly requestedUrl: string;
  /** The console path the app opens: the Queue in its pinned tab, any other page in a new tab. */
  readonly path: string;
  readonly deepLink: string;
  readonly note: string;
}

/**
 * The command that hands a deep link to the canonical installed bundle, the one `readDesktopInstallation` checked, and
 * to no other app.
 *
 * @param deepLink the `slopweaver://open?path=…` address
 * @returns `/usr/bin/open -a /Applications/Slopweaver.app <deepLink>`
 */
export function desktopOpenCommand({ deepLink }: { deepLink: string }): ForegroundCommand {
  // By absolute path, so no `open` earlier on PATH stands in for it.
  return { args: ["-a", INSTALLED_BUNDLE, deepLink], file: "/usr/bin/open" };
}

/**
 * Open one console page — a published page or a console address — in the desktop app when it is installed: the
 * Queue in its pinned tab, any other page as a new tab. The path and link are the resolver's, already judged
 * (`./present.ts`), and are not rebuilt here.
 *
 * @param path the console path the app opens, carried into the answer
 * @param deepLink that path's `slopweaver://open?path=…` address
 * @param requestedUrl the page's console address, carried into the answer
 * @param seam the installation read and the command runner
 * @returns the answer once opened, `undefined` when the app is conclusively absent (the caller takes Chrome), or why
 *   the app could not be asked — never a fall back to the browser
 */
export function openConsolePathInDesktop({
  path,
  deepLink,
  requestedUrl,
  seam,
}: {
  path: string;
  deepLink: string;
  requestedUrl: string;
  seam: DesktopPageSeam;
}): Result<DesktopPageAnswer | undefined, PresentDesktopError> {
  const installation = seam.installation();
  if (installation.isErr()) {
    return err(installation.error);
  }
  if (installation.value === "absent") {
    return ok(undefined);
  }
  try {
    seam.run(desktopOpenCommand({ deepLink }));
  } catch (cause) {
    const why = cause instanceof Error ? cause.message.slice(0, 300) : "open failed";
    return err(PresentDesktopErrors.openFailed({ deepLink, why }));
  }
  return ok({
    deepLink,
    note: desktopOpenNote({ path }),
    opened: true,
    openedIn: "slopweaver-desktop-app",
    path,
    requestedUrl,
  });
}

/**
 * What the voice is told about where the page opened: the Queue in the owner's one pinned Queue tab, never a second one,
 * any other page as a new tab in front.
 *
 * @param path the console path the deep link opened
 * @returns the answer's `note`
 */
function desktopOpenNote({ path }: { path: string }): string {
  let opened = "The page opened as a new tab in front in the owner's Slopweaver desktop app";
  if (desktopDeepLinkTab({ path }) === "pinned") {
    opened =
      "The page opened in the one pinned Queue tab of the owner's Slopweaver desktop app, shown in front, never a second Queue tab";
  }
  return `${opened}; the owner's Chrome was not touched and nothing on the page was clicked or typed.`;
}

/**
 * The command that prints a bundle's own identifier off its `Info.plist`, binary or XML.
 *
 * @param bundle the `.app` directory
 * @returns `PlistBuddy -c "Print :CFBundleIdentifier" <bundle>/Contents/Info.plist`
 */
export function bundleIdentifierCommand({ bundle }: { bundle: string }): ForegroundCommand {
  return {
    args: ["-c", "Print :CFBundleIdentifier", join(bundle, "Contents", "Info.plist")],
    file: "/usr/libexec/PlistBuddy",
  };
}

/* Why an fs read threw, in its own words. */
function causeText({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "unreadable";
}

/*
 * Whether a real directory stands at the bundle's path, read with `lstat` and never through a link. Only NOTHING at
 * the path is absent (a dangling link is not nothing). A symlink is refused
 * outright: `slopweaver desktop install` places a real directory by `ditto` and rename, and a link could be
 * retargeted by whoever owns where it points between the identifier read and the open. Anything
 * else that is not a directory is a broken install, never absence. "installed" here means only
 * that a directory is there; the identifier decides the rest.
 */
function bundleOnDisk({ bundle }: { bundle: string }): Result<DesktopInstallation, PresentDesktopError> {
  let entry: Stats;
  try {
    entry = lstatSync(bundle);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok("absent");
    }
    return err(PresentDesktopErrors.installUnreadable({ bundle, why: causeText({ cause }) }));
  }
  if (entry.isSymbolicLink()) {
    return err(PresentDesktopErrors.installUnreadable({ bundle, why: "a symlink, not the installed bundle itself" }));
  }
  if (!entry.isDirectory()) {
    return err(PresentDesktopErrors.installUnreadable({ bundle, why: "not an app bundle directory" }));
  }
  return ok("installed");
}

/**
 * Whether the app is installed, read off the bundle's own path AND its own identifier. Absent ONLY off macOS or when
 * nothing is at the path. Anything else there that is not a real directory identifying as `ai.slopweaver.desktop` —
 * a link, a file, a foreign or malformed identifier, one that cannot be read — is an error, so a decoy never
 * receives a console path and a broken install never falls back to the
 * browser. A bundle swapped between this read and the `open -a` is the residue, the same one a hand
 * note carries.
 *
 * @param platform the running platform
 * @param bundle the installed bundle's path
 * @param run the command runner the identifier is read through
 * @returns the installation, or why it could not be read
 */
export function readDesktopInstallation({
  platform,
  bundle,
  run,
}: {
  platform: NodeJS.Platform;
  bundle: string;
  run: ForegroundRun;
}): Result<DesktopInstallation, PresentDesktopError> {
  if (platform !== "darwin") {
    return ok("absent");
  }
  const onDisk = bundleOnDisk({ bundle });
  if (onDisk.isErr() || onDisk.value === "absent") {
    return onDisk;
  }
  let identifier: string;
  try {
    // Only the one newline PlistBuddy appends is dropped: a padded identifier is not ours.
    identifier = run(bundleIdentifierCommand({ bundle })).replace(/\n$/u, "");
  } catch (cause) {
    const why = cause instanceof Error ? cause.message.slice(0, 300) : "no bundle identifier";
    return err(PresentDesktopErrors.installUnreadable({ bundle, why }));
  }
  // Any other identifier — foreign, or malformed but printable — is a broken install, never absence:
  // only NOTHING at the path takes Chrome.
  if (identifier !== BUNDLE_ID) {
    return err(PresentDesktopErrors.installForeign({ bundle, identifier }));
  }
  return ok("installed");
}

/**
 * The live seam: the bundle at `/Applications/Slopweaver.app`, its identifier and `open` run synchronously.
 *
 * @param run the command runner (`realForegroundRun`)
 * @returns the seam `runPresent` takes
 */
export function realDesktopPageSeam({ run }: { run: ForegroundRun }): DesktopPageSeam {
  return {
    installation: () => readDesktopInstallation({ bundle: INSTALLED_BUNDLE, platform: process.platform, run }),
    run,
  };
}
