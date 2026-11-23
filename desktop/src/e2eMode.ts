/**
 * The app run as a TEST instance beside the owner's own: `slopweaver desktop e2e` launches the bundle with
 * `--slopweaver-desktop-e2e=<dir>`, and this module is what that switch means.
 *
 * The fleet end-to-end tests the desktop app itself, every change proven before it reaches the owner.
 * A test instance must run while the owner's own app runs and touch nothing it does: its own saved state and single-instance
 * lock under the directory it is given, and none of the shell's automatic acts — no menu bar icon, no fleet launch
 * into cmux, no `cmux revive`, no update, no console started or restarted, no permissions guide, no triage. Those
 * belong to the owner's app, and a second copy doing them races it. The one opt-in is the menu bar icon: launched
 * with {@link E2E_MENU_BAR_SWITCH} as well, a test instance draws its own, named `Slopweaver Test` beside the owner's
 * (`trayPresentation.ts`), so the real menu can be proven locally (layer 3 of desktop proof). Everything the suite exists to test — the windows, the tabs, the
 * console pages, the voice overlay, crash handling — runs exactly as in the owner's. One thing it adds: every window
 * carries the test-instance marker, so a call it places through the owner's console is recorded as the walk's, never
 * the owner's words.
 *
 * A switch, not an environment variable: it is visible in the launched argv, never inherited by a child the shell
 * spawns, and the bundle advertises that it understands it (`SlopweaverDesktopE2EProtocol` in `Info.plist`), so the
 * verb refuses a build from before rather than starting a full second instance that ignores it.
 *
 * Pure: no Electron, no filesystem.
 */
import { isAbsolute, join } from "node:path";

import { err, ok, type Result } from "neverthrow";

/** The switch the verb passes, `=` and the directory after it. */
export const E2E_SWITCH = "--slopweaver-desktop-e2e";

/**
 * The bare switch that gives a test instance its own menu bar icon, under its own name (`trayPresentation.ts`). Legal
 * only beside {@link E2E_SWITCH}; the verb passes it for `slopweaver desktop e2e --menu-bar`.
 */
export const E2E_MENU_BAR_SWITCH = "--slopweaver-desktop-e2e-menu-bar";

/** The exit code of a launch whose switch is malformed: a caller's mistake, the CLI's `EXIT_USAGE`. */
export const E2E_SWITCH_REFUSED = 2;

/** A test instance: where its own saved state and lock live, and whether it draws its own menu bar icon. */
export interface DesktopE2eMode {
  readonly userData: string;
  readonly menuBar: boolean;
}

/**
 * What the shell does at boot of its own accord. Each is `true` for the owner's app and `false` for a test instance, so a
 * new automatic act added later has to be named here to run at all.
 */
export interface DesktopBootPolicy {
  /** The menu bar icon: the owner's app's, or a test instance's own under its own name when it was launched to draw one. */
  readonly tray: boolean;
  /**
   * The triage countdown and its menu items (`triageShell.ts`), which write the shared hand-step projection and command
   * inbox. The owner's app only.
   */
  readonly triage: boolean;
  /** Reading the fleet, launching its recovery into cmux, and knocking on cmux to revive it. */
  readonly fleet: boolean;
  /**
   * The update's coordination over this process's OWN windows and saved state: ending a call for an update, reloading
   * or relaunching onto a build, waiting out a swap, restarting the call after. A test instance runs it, so the
   * restart is proven on the real bundle; it touches nothing of the owner's app.
   */
  readonly updateResume: boolean;
  /**
   * Launching `slopweaver desktop update`, which quits and replaces the installed app. The owner's app only: a test instance
   * refuses it at the message itself, whatever its page offers.
   */
  readonly updateInstall: boolean;
  /** Starting or restarting the console when it is not serving; a test instance only reads it. */
  readonly consoleStart: boolean;
  /** The permissions guide and its native prompts. */
  readonly permissionGuide: boolean;
}

/**
 * Read the test switch off the process's arguments.
 *
 * @param argv the process's arguments
 * @returns the mode, `undefined` for the owner's own app, or why the switch is malformed
 */
export function desktopE2eMode({
  argv,
}: {
  argv: readonly string[];
}): Result<DesktopE2eMode | undefined, readonly string[]> {
  const given = argv.filter((arg) => arg === E2E_SWITCH || arg.startsWith(`${E2E_SWITCH}=`));
  const menuBarGiven = argv.filter((arg) => arg === E2E_MENU_BAR_SWITCH || arg.startsWith(`${E2E_MENU_BAR_SWITCH}=`));
  if (given.length === 0) {
    if (menuBarGiven.length > 0) {
      return err([`${E2E_MENU_BAR_SWITCH} is only for a test instance, beside ${E2E_SWITCH}=<dir>`]);
    }
    return ok(undefined);
  }
  if (given.length > 1) {
    return err([`${E2E_SWITCH} was given ${String(given.length)} times`]);
  }
  const userData = given[0]!.slice(E2E_SWITCH.length + 1);
  if (userData === "" || !isAbsolute(userData)) {
    return err([`${E2E_SWITCH} needs =<an absolute directory> for the test instance's own state`]);
  }
  if (menuBarGiven.length > 1) {
    return err([`${E2E_MENU_BAR_SWITCH} was given ${String(menuBarGiven.length)} times`]);
  }
  if (menuBarGiven.some((arg) => arg !== E2E_MENU_BAR_SWITCH)) {
    return err([`${E2E_MENU_BAR_SWITCH} takes no value`]);
  }
  return ok({ menuBar: menuBarGiven.length === 1, userData });
}

/**
 * What a boot does of its own accord, for the owner's app or a test instance. A malformed switch gets a test instance's
 * policy too: the process is exiting, and nothing that read the switch wrong may act as the owner's app meanwhile.
 *
 * @param mode the switch as read, `ok(undefined)` for the owner's own app
 * @returns the policy
 */
export function desktopBootPolicy({
  mode,
}: {
  mode: Result<DesktopE2eMode | undefined, readonly string[]>;
}): DesktopBootPolicy {
  const own = mode.isOk() && mode.value === undefined;
  // A clean switch is a test instance, which coordinates its own update steps; a malformed one does nothing at all.
  const testInstance = mode.isOk() && mode.value !== undefined;
  const testMenuBar = mode.isOk() && mode.value?.menuBar === true;
  return {
    consoleStart: own,
    fleet: own,
    permissionGuide: own,
    tray: own || testMenuBar,
    triage: own,
    updateInstall: own,
    updateResume: own || testInstance,
  };
}

/**
 * Whether this launch's windows are marked as the test instance's (`desktopBridge.ts`'s `INSTANCE_ARGUMENT`), so every
 * call they place is recorded as the walk's, never the owner's. A malformed switch is marked too, for the reason
 * {@link desktopBootPolicy} gives: only the owner's own app, read cleanly, speaks as the owner.
 *
 * @param mode the switch as read, `ok(undefined)` for the owner's own app
 * @returns whether to mark the windows
 */
export function isDesktopTestInstance({
  mode,
}: {
  mode: Result<DesktopE2eMode | undefined, readonly string[]>;
}): boolean {
  return !(mode.isOk() && mode.value === undefined);
}

/**
 * Where this process keeps its saved state and its single-instance lock. A test instance uses its switch's directory;
 * a run from source uses the dev directory beside the installed app's, so neither overwrites what the owner's app reopens or
 * quits silently into it; the owner's installed app keeps Electron's own.
 *
 * @param appData Electron's per-user application data directory
 * @param devDir the dev run's directory name under it
 * @param mode the test mode, `undefined` for a run that is not one
 * @param packaged whether this is an installed bundle rather than a run from source
 * @returns the directory to set, or `undefined` to keep Electron's
 */
export function ownUserData({
  appData,
  devDir,
  mode,
  packaged,
}: {
  appData: string;
  devDir: string;
  mode: DesktopE2eMode | undefined;
  packaged: boolean;
}): string | undefined {
  if (mode !== undefined) {
    return mode.userData;
  }
  return packaged ? undefined : join(appData, devDir);
}
