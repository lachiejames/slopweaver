/**
 * Which names, bundle ids and executables ARE a web browser — the one table the browser-launch walk
 * (`./browserLaunchCommand.ts`) asks, so `open -a`, `open -b`, an AppleScript `tell application` and a directly run
 * binary are judged against the same list.
 *
 * Rule 3 says "a browser", not "Chrome": Safari, Firefox and the Chromium family are all here. A browser this
 * table does not name is a false negative the walk accepts, because it is a tripwire for the natural spellings a
 * seat reaches for, never a fence (AGENTS.md rule 3).
 */
import { posix } from "node:path";

/**
 * Application names as `open -a` and AppleScript spell them, lowercased, without `.app` — the display names macOS
 * gives each browser's bundle.
 */
const BROWSER_APPLICATION_NAMES: ReadonlySet<string> = new Set([
  "arc",
  "brave browser",
  "brave browser beta",
  "brave browser nightly",
  "chromium",
  "duckduckgo",
  "firefox",
  "firefox developer edition",
  "firefox nightly",
  "google chrome",
  "google chrome beta",
  "google chrome canary",
  "google chrome dev",
  "google chrome for testing",
  "microsoft edge",
  "microsoft edge beta",
  "microsoft edge canary",
  "microsoft edge dev",
  "opera",
  "orion",
  "safari",
  "safari technology preview",
  "vivaldi",
  "zen",
  "zen browser",
]);

/** Bundle identifiers as `open -b` and `application id "…"` spell them, lowercased. */
const BROWSER_BUNDLE_IDS: ReadonlySet<string> = new Set([
  "app.zen-browser.zen",
  "com.apple.safari",
  "com.apple.safaritechnologypreview",
  "com.brave.browser",
  "com.brave.browser.beta",
  "com.brave.browser.nightly",
  "com.duckduckgo.macos.browser",
  "com.google.chrome",
  "com.google.chrome.beta",
  "com.google.chrome.canary",
  "com.google.chrome.dev",
  "com.google.chrome.for.testing",
  "com.kagi.kagimacos",
  "com.microsoft.edgemac",
  "com.microsoft.edgemac.beta",
  "com.microsoft.edgemac.canary",
  "com.microsoft.edgemac.dev",
  "com.operasoftware.opera",
  "com.vivaldi.vivaldi",
  "company.thebrowser.browser",
  "org.chromium.chromium",
  "org.mozilla.firefox",
  "org.mozilla.firefoxdeveloperedition",
  "org.mozilla.nightly",
]);

/**
 * Command names that run a browser when typed bare, lowercased. Deliberately NOT every application name: `arc` is
 * also Phabricator's CLI and `orion` and `zen` are ordinary words, so a bare one is judged only inside a path
 * ({@link isBrowserExecutable}); a display name no command shares (`Google Chrome`, `Safari`) is judged bare too.
 */
const BROWSER_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "brave",
  "brave-browser",
  "chrome",
  "chrome-headless-shell",
  "chromium",
  "chromium-browser",
  "firefox",
  "google-chrome",
  "google-chrome-beta",
  "google-chrome-canary",
  "google-chrome-stable",
  "google-chrome-unstable",
  "microsoft-edge",
  "microsoft-edge-beta",
  "microsoft-edge-dev",
  "microsoft-edge-stable",
  "msedge",
  "opera",
  "vivaldi",
  "vivaldi-stable",
]);

/** One-word application names no ordinary command shares, so a bare one is the browser's own executable. */
const UNSHARED_BARE_NAMES: ReadonlySet<string> = new Set(["duckduckgo", "safari"]);

/** The path segment a macOS application's own executable sits under. */
const APP_EXECUTABLE_DIR = ".app/contents/macos/";

/**
 * An application as written — `Google Chrome`, `google chrome.app`, `/Applications/Safari.app/` — reduced to the
 * name {@link BROWSER_APPLICATION_NAMES} is keyed by.
 *
 * @param text the application word, quotes already removed
 * @returns its lowercased display name
 */
function applicationKey({ text }: { text: string }): string {
  // A path is the bundle it normalises to: `/Applications/Google Chrome.app/.` is Chrome.
  const written = text.trim();
  const trimmed = (written.includes("/") ? posix.normalize(written) : written).replace(/\/+$/, "");
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return base
    .replace(/\.app$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Whether an application name or path (`open -a`, `tell application`) names a web browser.
 *
 * @param text the application as written, quotes removed
 * @returns true for a browser
 */
export function isBrowserApplication({ text }: { text: string }): boolean {
  return BROWSER_APPLICATION_NAMES.has(applicationKey({ text }));
}

/**
 * Whether a bundle identifier (`open -b`, `application id "…"`) names a web browser.
 *
 * @param text the bundle id as written, quotes removed
 * @returns true for a browser
 */
export function isBrowserBundleId({ text }: { text: string }): boolean {
  return BROWSER_BUNDLE_IDS.has(text.trim().toLowerCase());
}

/**
 * Whether a program word runs a browser binary directly: a bare browser command (`google-chrome`, `chromium`), or
 * any path into a browser application's own `Contents/MacOS/` directory.
 *
 * @param program the program word as written, quotes removed
 * @returns true for a browser executable
 */
export function isBrowserExecutable({ program: written }: { program: string }): boolean {
  // The kernel resolves `Contents/../Contents`, `.` and doubled slashes, so the path is read as it resolves.
  const program = written.includes("/") ? posix.normalize(written) : written;
  const lowered = program.toLowerCase();
  const inApp = lowered.lastIndexOf(APP_EXECUTABLE_DIR);
  if (inApp !== -1) {
    return isBrowserApplication({ text: program.slice(0, inApp) });
  }
  // A path the walk cannot resolve — `./Google Chrome` run from inside `Contents/MacOS` — is judged by the application
  // executable's own name, which macOS gives the app's display name.
  if (written.includes("/") && isBrowserApplication({ text: program })) {
    return true;
  }
  // The same name typed bare, found on a PATH holding `Contents/MacOS`: a display name with a space
  // in it, or one no other tool shares, is never an ordinary command; `arc`, `orion` and `zen` stay unjudged bare.
  const key = applicationKey({ text: program });
  if (BROWSER_APPLICATION_NAMES.has(key) && (key.includes(" ") || UNSHARED_BARE_NAMES.has(key))) {
    return true;
  }
  return BROWSER_COMMAND_NAMES.has(lowered.slice(lowered.lastIndexOf("/") + 1));
}
