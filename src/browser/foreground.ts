/**
 * The foreground restore: a browser leg that took the macOS foreground gives it back within a second, to
 * whatever the owner was reading before — their Chrome window, Slack, the terminal, anything.
 *
 * ## Why a restore rather than a suppression
 *
 * Three things bring the walk's own window in front of the owner, and none of them can be switched off:
 *
 * - Chrome ACTIVATES itself when handed a URL, which is how the relay's connect page is opened
 *   (`./profilePin.ts` carries why the launch cannot go through `open -g` instead).
 * - The Playwright extension focuses the window it connects: `chrome.windows.update(tab.windowId,
 *   { focused: true })` in `_connectTab` — reproduce with
 *   `grep -n "focused: true" ~/Library/Application\ Support/Google/Chrome/Default/Extensions/mmlmfjhmonkocbjadbfplnigmagldckm/*\/lib/background.mjs`.
 * - `page.bringToFront()` before a second screenshot attempt (`./pageVisitSnippet.ts`). Through
 *   `chrome.debugger`, CDP `Page.bringToFront` activates the tab AND raises its window.
 *
 * So the property this module holds is that the window comes into the foreground for about half a second
 * and is then put straight back in the background. The window is still real,
 * visible and the owner's to interrupt — rule 2 is about VISIBILITY, and nothing here hides anything — it is just
 * not in front of what the owner is reading.
 *
 * ## MEASURED on the owner's live work Chrome, before any of this existed
 *
 * Sampling the front app every ~0.5s (`lsappinfo front`, then Chrome's own `id of window 1`) around one
 * `slopweaver browser shot --url https://example.com`: the agent window was front for ~5 seconds, and the owner's
 * Fleet Briefing window came back only when the tab closed. With a loop that raised the owner's window the moment
 * another Chrome window became front, it was back in 0.85s — and the shot STILL photographed the
 * page, byte-identical to the baseline PNG, with the agent window behind the owner's. Chrome renders a covered
 * window; what it will not render is an inactive TAB (`./pageVisitSnippet.ts`), which is a different thing.
 *
 * ## Two primitives, chosen for needing no new permission
 *
 * - `open -b <bundle id>` activates a running app in ~0.1s through LaunchServices and asks TCC nothing.
 * - `osascript` hiding and re-showing one of the owner's Chrome windows raises it over the walk's
 *   ({@link raiseChromeWindowCommand} carries why it is no longer `set index … to 1`, and the
 *   measurement). Apple Events to Chrome need an Automation grant for the
 *   RESPONSIBLE app, and the terminal every fleet session runs under already holds one — reproduce with
 *   `sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db "select client, indirect_object_identifier from access where service = 'kTCCServiceAppleEvents'"`.
 *   A session run from somewhere without that grant gets macOS's one-time consent prompt, once, and a
 *   refusal there costs nothing but the restore.
 *
 * `open -b com.google.Chrome` is never issued: for an app that is not running, `open` LAUNCHES it, with
 * no profile named — the exact shape `./profilePin.ts` exists to prevent. When the owner's previous window was a
 * Chrome window, Chrome is by construction already the front app, so raising the window is all it takes.
 *
 * ## The rule is "give back only what was taken", and that is what keeps it safe
 *
 * A LOCKED SCREEN is the same rule rather than a special case, and it was measured rather than reasoned
 * about: while the console is locked `lsappinfo front` names `com.apple.loginwindow`, so the walk's window
 * is not in front and nothing moves — including the attach's own snapshot, which identifies no agent window
 * and leaves every later restore inert. Neither probe hangs there either: measured with the
 * screen locked, `lsappinfo front` answered in 19ms and both `osascript` calls in about 150ms. Reproduce the
 * state with `ioreg -n Root -d1 -a | grep -A1 IOConsoleLocked`.
 *
 * A restore runs ONLY when the walk's own window is front right now. If the owner switched to something else
 * while a visit ran, the walk's window is not front and nothing moves. The snapshot restored to is the
 * one taken immediately before the operation that might have stolen the foreground, so the target is at
 * most one page visit old. Every failure — no `lsappinfo` on this platform, Chrome with no windows, an
 * Apple Event refused — leaves behaviour exactly what it was before this module: best effort, by
 * construction. A refused restore COMMAND is still said on stderr (`./backgroundPlacement.ts`), because the one
 * thing worse than an agent window left in front of the owner is a run that believes it was not.
 *
 * ## Background by default, and the one way to show a run
 *
 * Owner ruling: browser automation runs in the background, except when the owner is being shown something, as on
 * a call. So every launch path is
 * {@link WindowPlacement} `background` unless the run sets {@link BROWSER_FOREGROUND_ENV}`=1`, and a background run
 * does two things after anything that may have brought its window forward: the restore above, THEN it raises the owner's
 * window over the agent's (`./backgroundPlacement.ts`), so the agent's is not the top of Chrome's own stack the next
 * time the owner comes back to Chrome. A foreground run does neither. `browser present` is always foreground — taking the owner to a page is
 * showing it — and the sign-in page a hand step opens (`./openInWorkChrome.ts`) is the owner's to use, so it never runs
 * through either lane.
 *
 * Both halves of the restore can die silently, which is how runs land in front of the owner: `lsappinfo` can change its
 * output ({@link parseBundleId}), and Chrome can stop obeying `set index`
 * ({@link raiseChromeWindowCommand}). Each fails silently — the second because Chrome reports no error for a
 * reorder it ignores.
 *
 * MEASURED and REJECTED, so nobody re-tries them blind:
 *
 * - **`set index of window id N to (count windows)`** to send the agent window to the back: Chrome's indices
 *   count a hidden window (the screen-share bar), so `count` stops one short of the back slot and the slot past it
 *   is `Wrong index`.
 * - **Off-screen.** macOS will not place a window fully off the display: `set bounds` to x=-4000 read back
 *   `{-1472,33,40,865}` and to y=3000 read back `{0,824,1512,1656}` — a ~41px strip stays on screen. Worse, Chrome
 *   wrote the parked bounds into the profile's `browser.window_placement` in `Default/Preferences`, the bounds its
 *   next new window opens at, so a walk killed while parked would strand the owner's next window off-screen. Behind the owner's
 *   windows the agent window is already out of sight; the strip bought nothing worth that.
 * - **Minimised.** A minimised window does not render: a `browser read` timed out its screenshot, and the
 *   tab-activation retry (`./keepForeground.ts`) un-minimised it.
 */
import { execFileSync } from "node:child_process";

import { FOREGROUND_COMMAND_TIMEOUT_MS } from "./lookBudget.js";

/** Chrome's bundle identifier, the one app whose windows are told apart rather than merely activated. */
export const CHROME_BUNDLE_ID = "com.google.Chrome";

/** What was in front at one instant: the app, and — when it was Chrome — which of its windows. */
export interface ForegroundSnapshot {
  readonly bundleId: string;
  /** Chrome's own stable id for its front window; `null` for any other app, or a Chrome with no window. */
  readonly chromeWindowId: number | null;
}

/**
 * One command, as argv rather than a shell line — nothing here is ever joined into a string.
 *
 * @internal
 */
export interface ForegroundCommand {
  readonly file: string;
  readonly args: readonly string[];
}

/**
 * The seam every probe and restore runs through: run one command synchronously and hand back its stdout,
 * throwing on any failure. The production one is {@link realForegroundRun}; a test supplies a recorder
 * and touches no real app.
 */
export type ForegroundRun = (command: ForegroundCommand) => string;

/** What a restore decided, so a caller can say which of the three it was. */
export type ForegroundRestoreAction =
  | { readonly kind: "raise-window"; readonly windowId: number }
  | { readonly kind: "activate-app"; readonly bundleId: string }
  | { readonly kind: "leave"; readonly why: string };

/**
 * The command that names the front application's process serial number.
 *
 * @returns `lsappinfo front`
 * @internal
 */
export function frontAsnCommand(): ForegroundCommand {
  return { args: ["front"], file: "lsappinfo" };
}

/**
 * The command that resolves a process serial number to its bundle identifier.
 *
 * @param asn the serial `lsappinfo front` printed
 * @returns `lsappinfo info -only bundleid <asn>`
 * @internal
 */
export function bundleIdCommand({ asn }: { asn: string }): ForegroundCommand {
  return { args: ["info", "-only", "bundleid", asn], file: "lsappinfo" };
}

/**
 * The command that asks Chrome which of its windows is in front.
 *
 * @returns an `osascript` reading `id of window 1`
 * @internal
 */
export function chromeFrontWindowCommand(): ForegroundCommand {
  return { args: ["-e", 'tell application "Google Chrome" to get id of window 1'], file: "osascript" };
}

/**
 * The command that raises one of Chrome's windows over the rest, and makes it Chrome's focused window: hide it,
 * then show it again.
 *
 * Not `set index of window id N to 1`, which is what this was until it was MEASURED against the
 * window server's own order (`CGWindowListCopyWindowInfo`, read through `osascript -l JavaScript`), on the owner's live
 * work Chrome with the console's screen share running: `set index … to 1` moved nothing at all. Chrome numbered
 * its n browser windows 2..n+1 — the "localhost:3000 is sharing your screen" bar held index 1 — and refused n+1
 * as `Wrong index`, so no index reached the back either. Hiding and re-showing the window raised it in every
 * case measured: with Chrome active and an agent window focused on top of the owner's, the owner's window came back on top AND
 * focused (System Events' `AXFocusedWindow`), and with Finder active it went to the top of Chrome's own stack
 * without activating Chrome. Reproduce with `tell application "Google Chrome" to get {id, index} of every window`.
 * NOT measured: a fullscreen window, or one on another Space — the hide may move the owner there or do nothing. A
 * background act keeps a page from MAKING its window full screen in the first place (`./fullscreenGuard.ts`).
 *
 * The id is interpolated as a NUMBER — it came out of {@link parseChromeWindowId} or {@link parseChromeWindowIds},
 * so nothing a page said can reach this script.
 *
 * @param windowId Chrome's own id for the window to raise
 * @returns an `osascript` hiding that window and showing it again
 * @internal
 */
export function raiseChromeWindowCommand({ windowId }: { windowId: number }): ForegroundCommand {
  const window = `window id ${String(windowId)}`;
  return {
    args: [
      "-e",
      'tell application "Google Chrome"',
      "-e",
      `set visible of ${window} to false`,
      "-e",
      `set visible of ${window} to true`,
      "-e",
      "end tell",
    ],
    file: "osascript",
  };
}

/**
 * The command that lists Chrome's windows front to back, by id — and asks nothing of a Chrome that is not running,
 * since a `tell` would LAUNCH one with no profile named (`./profilePin.ts`).
 *
 * @returns an `osascript` reading `id of every window`, guarded on Chrome running
 * @internal
 */
export function chromeWindowIdsCommand(): ForegroundCommand {
  return {
    args: [
      "-e",
      'if application "Google Chrome" is running then tell application "Google Chrome" to get id of every window',
    ],
    file: "osascript",
  };
}

/**
 * Where an agent Chrome window belongs while a run drives it: behind whatever the owner is doing, or in front of them.
 *
 * `background` is the default for every launch path. `foreground` is the per-run choice to SHOW the owner something —
 * on a call, say — and it leaves the window exactly where the extension put it, in front.
 */
export type WindowPlacement = "background" | "foreground";

/**
 * The one option that foregrounds a run, read from the environment so a single prefix reaches every launch the
 * command makes — a resync drives several walk verbs, each of which attaches on its own.
 *
 * Not an `ALLOW_` name on purpose: it waives no refusal, so it is not an escape hatch (`src/hatch/registry.ts`).
 */
export const BROWSER_FOREGROUND_ENV = "SLOPWEAVER_BROWSER_FOREGROUND";

/**
 * Read the run's placement off its environment.
 *
 * @param env the process environment
 * @returns `foreground` only when {@link BROWSER_FOREGROUND_ENV} is exactly `1`; anything else is the default
 */
export function placementFromEnv({ env }: { env: Readonly<Record<string, string | undefined>> }): WindowPlacement {
  return env[BROWSER_FOREGROUND_ENV] === "1" ? "foreground" : "background";
}

/**
 * The command that brings a running app back to the front.
 *
 * @param bundleId the app's bundle identifier
 * @returns `open -b <bundle id>`
 * @internal
 */
export function activateAppCommand({ bundleId }: { bundleId: string }): ForegroundCommand {
  return { args: ["-b", bundleId], file: "open" };
}

/**
 * Read a bundle identifier out of what `lsappinfo info -only bundleid` prints.
 *
 * Two shapes, both real. The older macOS line was
 * `"CFBundleIdentifier"="com.google.Chrome"`. On Darwin 27 the same command prints a header and then
 * `bundleID="com.google.Chrome"` — MEASURED, and a parser that reads only the old line answers `null` on every probe,
 * so every restore in both lanes is a silent `leave` and the agent window stays in front of the owner after every
 * attach. Reproduce with
 * `lsappinfo info -only bundleid "$(lsappinfo front)"`. An app with no bundle prints `[ NULL ]` unquoted in
 * either shape and is not something `open -b` could ever bring back.
 *
 * @param output what the command printed
 * @returns the identifier, or `null` when there is not one
 */
export function parseBundleId({ output }: { output: string }): string | null {
  const match = /(?:"CFBundleIdentifier"|\bbundleID)="([^"]+)"/.exec(output);
  // No match is an app with no bundle (`[ NULL ]`, unquoted); a match always carries its one non-optional group.
  return match === null ? null : match[1]!;
}

/**
 * Read a window id out of what Chrome's `id of window 1` prints.
 *
 * @param output what `osascript` printed
 * @returns the id, or `null` when the reply is not one whole non-negative integer
 */
export function parseChromeWindowId({ output }: { output: string }): number | null {
  const trimmed = output.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Read Chrome's window ids out of what `id of every window` prints: `2109159231, 2109159219` for two, nothing at
 * all for none or for a Chrome that is not running.
 *
 * @param output what `osascript` printed
 * @returns the ids front to back, empty when there are none, or `null` when any entry is not a window id
 */
export function parseChromeWindowIds({ output }: { output: string }): readonly number[] | null {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const ids = trimmed.split(",").map((part) => parseChromeWindowId({ output: part }));
  if (ids.some((id) => id === null)) {
    return null;
  }
  return ids.filter((id): id is number => id !== null);
}

/**
 * Decide what, if anything, a restore should do. Pure — the rule, separated from the commands it drives.
 *
 * @param before what was in front before the operation that may have taken the foreground
 * @param now what is in front at this instant
 * @param agentWindowId Chrome's id for the walk's own window, or `null` when it was never identified
 * @returns the one action to take, or why none is
 */
export function foregroundRestoreAction({
  before,
  now,
  agentWindowId,
}: {
  before: ForegroundSnapshot | null;
  now: ForegroundSnapshot | null;
  agentWindowId: number | null;
}): ForegroundRestoreAction {
  if (agentWindowId === null) {
    return { kind: "leave", why: "the walk's own window was never identified" };
  }
  if (now === null || now.bundleId !== CHROME_BUNDLE_ID || now.chromeWindowId !== agentWindowId) {
    return { kind: "leave", why: "the walk's own window is not in front" };
  }
  if (before === null) {
    return { kind: "leave", why: "nothing is known about what was in front before" };
  }
  if (before.bundleId !== CHROME_BUNDLE_ID) {
    return { bundleId: before.bundleId, kind: "activate-app" };
  }
  if (before.chromeWindowId === null || before.chromeWindowId === agentWindowId) {
    return { kind: "leave", why: "what was in front before was the walk's own window, or no window" };
  }
  return { kind: "raise-window", windowId: before.chromeWindowId };
}

/**
 * Decide what a restore should do when the walk's own window is GONE. Pure — the release's rule.
 *
 * {@link foregroundRestoreAction} cannot serve here: the close takes the walk's window with its last tab,
 * so by the time anything can be measured there is no agent window left to recognise. The test is a
 * CHANGE instead — `before` is read microseconds before the close, so it is what was in front at that
 * instant, and anything different afterwards is the close's own doing rather than a choice the owner made.
 *
 * @param before what was in front immediately before the close
 * @param now what is in front once the close has finished
 * @returns the one action to take, or why none is
 */
export function closeRestoreAction({
  before,
  now,
}: {
  before: ForegroundSnapshot | null;
  now: ForegroundSnapshot | null;
}): ForegroundRestoreAction {
  if (before === null || now === null) {
    return { kind: "leave", why: "the foreground could not be read on both sides of the close" };
  }
  if (before.bundleId === now.bundleId && before.chromeWindowId === now.chromeWindowId) {
    return { kind: "leave", why: "the close changed nothing about what is in front" };
  }
  if (before.bundleId !== CHROME_BUNDLE_ID) {
    return { bundleId: before.bundleId, kind: "activate-app" };
  }
  if (before.chromeWindowId === null) {
    return { kind: "leave", why: "Chrome was in front before with no window to name" };
  }
  return { kind: "raise-window", windowId: before.chromeWindowId };
}

/**
 * The production seam: one synchronous command with a short bound and its stderr dropped.
 *
 * Synchronous on purpose — `no-headless` in `yarn lint` bans every asynchronous child-process capability,
 * and nothing here needs one: a probe is a few milliseconds and a restore under a second.
 *
 * Killed with SIGKILL, not the default SIGTERM, so the cap is a hard bound: `execFileSync` waits for the child to
 * exit, and one that caught SIGTERM would outlive it, while `BUDGETED_LOOK_WORST_CASE_MS` (`./lookBudget.ts`) counts
 * every probe at exactly this cap. A probe reads and a restore raises a window, so neither
 * has anything to clean up.
 *
 * @param command what to run
 * @returns its stdout
 */
export function realForegroundRun(command: ForegroundCommand): string {
  return execFileSync(command.file, [...command.args], {
    encoding: "utf8",
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: FOREGROUND_COMMAND_TIMEOUT_MS,
  });
}

/**
 * What is in front right now. `null` when the platform cannot say, which is every platform but macOS and
 * any macOS where a probe fails.
 *
 * @param run the command seam
 * @returns the snapshot, or `null`
 */
export function readForeground({ run }: { run: ForegroundRun }): ForegroundSnapshot | null {
  try {
    const asn = run(frontAsnCommand()).trim();
    if (asn.length === 0) {
      return null;
    }
    const bundleId = parseBundleId({ output: run(bundleIdCommand({ asn })) });
    if (bundleId === null) {
      return null;
    }
    if (bundleId !== CHROME_BUNDLE_ID) {
      return { bundleId, chromeWindowId: null };
    }
    return { bundleId, chromeWindowId: chromeFrontWindowId({ run }) };
  } catch {
    return null;
  }
}

/**
 * Chrome's id for its front window, or `null` when Chrome has none or will not say.
 *
 * @param run the command seam
 * @returns the id, or `null`
 */
function chromeFrontWindowId({ run }: { run: ForegroundRun }): number | null {
  try {
    return parseChromeWindowId({ output: run(chromeFrontWindowCommand()) });
  } catch {
    return null;
  }
}

/**
 * Give the foreground back, if the walk's own window has it.
 *
 * @param before the snapshot taken before the operation that may have taken the foreground
 * @param agentWindowId Chrome's id for the walk's own window
 * @param run the command seam
 * @returns what was done, or why nothing was
 */
export function restoreForeground({
  before,
  agentWindowId,
  run,
}: {
  before: ForegroundSnapshot | null;
  agentWindowId: number | null;
  run: ForegroundRun;
}): ForegroundRestoreAction {
  return actOn({ action: foregroundRestoreAction({ agentWindowId, before, now: readForeground({ run }) }), run });
}

/**
 * Whether the owner was already looking at the agent window before an operation brought it forward — they went to it
 * themselves, so nothing may send it away. Pure.
 *
 * @param before what was in front before the operation
 * @param agentWindowId Chrome's id for the agent window, or `null` when it was never identified
 * @returns `true` only when Chrome's front window before the operation WAS the agent's
 */
export function wasWatchingAgentWindow({
  before,
  agentWindowId,
}: {
  before: ForegroundSnapshot | null;
  agentWindowId: number | null;
}): boolean {
  return agentWindowId !== null && before?.bundleId === CHROME_BUNDLE_ID && before.chromeWindowId === agentWindowId;
}

/**
 * Carry out one decided action, reporting a refusal as having left the foreground alone.
 *
 * The shared tail of both restores, so neither can grow its own idea of what a failure means: a refused
 * Apple Event is a `leave` carrying the refusal, never a throw into the middle of a walk's cleanup.
 *
 * @param action what was decided
 * @param run the command seam
 * @returns the action, or the `leave` its command failed into
 */
export function actOn({
  action,
  run,
}: {
  action: ForegroundRestoreAction;
  run: ForegroundRun;
}): ForegroundRestoreAction {
  try {
    if (action.kind === "raise-window") {
      run(raiseChromeWindowCommand({ windowId: action.windowId }));
    } else if (action.kind === "activate-app") {
      run(activateAppCommand({ bundleId: action.bundleId }));
    }
  } catch (cause: unknown) {
    return { kind: "leave", why: `${RESTORE_FAILED}: ${causeText({ cause })}` };
  }
  return action;
}

/* A thrown value as text, never by `String()`: an object with no primitive conversion would throw from inside
   the handler and take the report with it. */
function causeText({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  return `a thrown ${typeof cause} that is not an Error`;
}

/* What a `leave` a restore command FAILED into opens with — told apart from a `leave` that was decided. */
const RESTORE_FAILED = "the restore command failed";

/**
 * Whether a restore meant to move the foreground back and its command was refused — the one outcome that
 * leaves an agent window in front of the owner, so the one a caller must say out loud rather than swallow.
 *
 * @param outcome what a restore returned
 * @returns true only for a failed restore command, never for a decided `leave`
 */
export function restoreCommandFailed({ outcome }: { outcome: ForegroundRestoreAction }): boolean {
  return outcome.kind === "leave" && outcome.why.startsWith(`${RESTORE_FAILED}:`);
}
