/**
 * The one-click update, applied to Electron: launch `slopweaver desktop update` from the checkout so it outlives the
 * app it quits, wait for the outcome it writes, and relaunch or reload in place when that is all an update needs.
 * Ending a call for it and restarting that call once it settles is `updateCallShell.ts`; the decisions are
 * `updatePlan.ts`.
 *
 * The update quits this app on success and on a rollback alike, so nothing here may rely on surviving it: the launch
 * is saved before the update starts, and whichever app opens next — the new build, or the previous one put back —
 * reads the saved launch at boot, waits for its record and restarts the call.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { app, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, type MenuItemConstructorOptions } from "electron";
import { err, ok, type Result } from "neverthrow";

import { childEnv } from "./consoleEndpoint";
import type { DesktopBootPolicy } from "./e2eMode";
import { showWindow } from "./tabRouting";
import { activeTabId, everyTabContents, tabContents } from "./tabsShell";
import { endCallForUpdate, rememberUpdate, resumeIfOwed, startUpdateCall } from "./updateCallShell";
import {
  lostOutcome,
  type PendingUpdate,
  parseUpdateOffer,
  pendingVerdict,
  SWAP_WAIT_MS,
  type TrayUpdateItem,
  trayOutcomeLine,
  trayUpdateItem,
  UPDATE_POLL_MS,
  type UpdateOffer,
  type UpdateOutcome,
  updateLaunch,
} from "./updatePlan";
import { readOutcome, type UpdateShellHost, type UpdateWire } from "./updateShellHost";

let host: UpdateShellHost | undefined;
/** The console page's last offer, as published to the menu bar. */
let offer: UpdateOffer | null = null;
/** The update this app is waiting on, while it is. */
let waiting: PendingUpdate | undefined;
/** Whether this app launched the update itself and has seen its process exit. */
let exited = false;
let pollTimer: NodeJS.Timeout | undefined;
/** The last outcome this app read, shown in the sidebar and the menu bar. */
let lastOutcome: UpdateOutcome | undefined;
/** Whether this process may launch `slopweaver desktop update` at all — the owner's app only, never a test instance. */
let installAllowed = false;
/** The shell's own deadline for a swap, which a reload of the console page cannot take with it. */
let swapTimer: NodeJS.Timeout | undefined;

/**
 * Pick the update half up at boot: answer the console's messages, then wait on a launch saved by the app before this
 * one, or restart a call ended for an update that has already settled. A process whose policy refuses the update's
 * coordination (a malformed test switch) starts none of it.
 *
 * @param updateHost the rest of the shell
 * @param policy whether this process coordinates its own update steps at all, and whether a press may launch the
 *   update itself; a test instance coordinates only its own steps (`e2eMode.ts`)
 */
export function startUpdateShell({
  updateHost,
  policy,
}: {
  updateHost: UpdateShellHost;
  policy: Pick<DesktopBootPolicy, "updateInstall" | "updateResume">;
}): void {
  if (!policy.updateResume) {
    return;
  }
  host = updateHost;
  installAllowed = policy.updateInstall;
  startUpdateCall({ callContext: { host: updateHost, installAllowed, updateRunning: () => waiting !== undefined } });
  installUpdateMessages({ updateHost });
  const saved = updateHost.saved();
  if (saved.update !== undefined) {
    waitFor({ pending: saved.update });
    return;
  }
  resumeIfOwed();
}

/**
 * The console's messages: the sidebar publishes what its button offers, for the menu bar to offer too, and asks for
 * each step. Only a console tab may, never the overlay.
 */
function installUpdateMessages({ updateHost }: { updateHost: UpdateShellHost }): void {
  const fromConsole = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => updateHost.roleOf(event) === "main";
  ipcMain.on("slopweaver:update-offer", (event, value: unknown) => {
    const next = parseUpdateOffer({ value });
    // Every tab reads the same two standings, so the last word from any of them is the menu bar's.
    if (fromConsole(event) && next !== undefined) {
      offer = next;
      changed();
    }
  });
  ipcMain.handle("slopweaver:update-state", (event): UpdateWire | null => (fromConsole(event) ? updateWire() : null));
  ipcMain.handle("slopweaver:update-end-call", async (event): Promise<string | null> => {
    if (!fromConsole(event)) {
      return "NOT_ALLOWED";
    }
    const ended = await endCallForUpdate();
    return ended.isOk() ? null : ended.error;
  });
  ipcMain.handle("slopweaver:update-start", (event): string | null => {
    if (!fromConsole(event)) {
      return "NOT_ALLOWED";
    }
    const started = startAppUpdate();
    return started.isOk() ? null : started.error;
  });
  // A relaunch reopens the bundle that is running, so from source there is nothing to reopen onto.
  ipcMain.on("slopweaver:update-relaunch", (event) => {
    if (fromConsole(event) && app.isPackaged) {
      app.relaunch();
      app.quit();
    }
  });
  ipcMain.on("slopweaver:update-reload", (event) => {
    if (fromConsole(event)) {
      reloadForUpdate();
    }
  });
  // A swap's call ended: the page watches for the held build and reloads as soon as it is served, and the shell holds
  // the deadline, so a page reloaded under the wait (a console outage's) still ends in a reload and the restart.
  ipcMain.on("slopweaver:update-swap", (event) => {
    if (fromConsole(event)) {
      clearTimeout(swapTimer);
      swapTimer = setTimeout(() => {
        swapTimer = undefined;
        reloadForUpdate();
      }, SWAP_WAIT_MS);
    }
  });
}

/**
 * The update's standing, as the console's pages are told it.
 *
 * @returns whether one runs, and the last outcome
 */
function updateWire(): UpdateWire {
  let outcome: UpdateOutcome | null = null;
  if (lastOutcome !== undefined) {
    outcome = lastOutcome;
  }
  return { outcome, running: waiting !== undefined };
}

/** The update's standing changed: redraw the menu bar and tell every console page. */
function changed(): void {
  host?.drawTray();
  const wire = updateWire();
  for (const contents of everyTabContents()) {
    contents.send("slopweaver:update-state", wire);
  }
}

/**
 * The update item as both menus show it now — the menu bar icon's and the app-name menu's — and the last failure's
 * line, so the two never word it differently.
 *
 * @returns the item, and the failure line or `undefined` when the last update did not fail
 */
export function updateMenuView(): { readonly item: TrayUpdateItem; readonly outcomeLine: string | undefined } {
  return {
    item: trayUpdateItem({ offer, running: waiting !== undefined }),
    outcomeLine: trayOutcomeLine({ outcome: lastOutcome }),
  };
}

/**
 * The menu bar's update lines, first after its status: the last failure's line when there is one, and the item where
 * other apps put it — the page's one "Update now", whichever step it takes underneath.
 *
 * @returns the menu items
 */
export function trayUpdateItems(): MenuItemConstructorOptions[] {
  const { item, outcomeLine } = updateMenuView();
  const items: MenuItemConstructorOptions[] = [];
  if (outcomeLine !== undefined) {
    items.push({ enabled: false, label: outcomeLine });
  }
  items.push({ click: clickUpdate, enabled: item.enabled, label: item.label });
  return items;
}

/**
 * The update item was clicked, in the menu bar icon's menu or the app-name menu: run what the console's button
 * would, else open its build fold.
 */
export function clickUpdate(): void {
  const item = trayUpdateItem({ offer, running: waiting !== undefined });
  const contents = tabContents({ id: activeTabId() });
  showWindow({});
  if (item.click === "run" && contents !== undefined) {
    contents.send("slopweaver:update-run");
    return;
  }
  contents?.send("slopweaver:update-check");
}

/** Why an update could not be launched. */
type StartUpdateRefusal = "INSTALL_DISABLED" | "RUNNING" | "NO_CHECKOUT" | "CALL_LIVE" | "LAUNCH_FAILED";

/**
 * Launch `slopweaver desktop update` from the checkout, detached, its output to a log beside its record. The launch
 * is saved first, because the update quits this app.
 *
 * @returns nothing once it is running, else why not
 */
function startAppUpdate(): Result<void, StartUpdateRefusal> {
  // A test instance never launches the update, whatever its page asked: it would quit and replace the owner's app.
  if (!installAllowed) {
    resumeIfOwed();
    return err("INSTALL_DISABLED");
  }
  if (host === undefined || waiting !== undefined) {
    return err("RUNNING");
  }
  const launched = launchUpdate({ updateHost: host });
  // A call ended for an update that never started is restarted at once, as a failed one is.
  if (launched.isErr()) {
    resumeIfOwed();
  }
  return launched;
}

/**
 * The launch itself, once no other update runs.
 *
 * @param updateHost the rest of the shell
 * @returns nothing once it is running, else why not
 */
function launchUpdate({ updateHost }: { updateHost: UpdateShellHost }): Result<void, StartUpdateRefusal> {
  if (updateHost.callLive()) {
    return err("CALL_LIVE");
  }
  const checkout = updateHost.checkout();
  if (checkout.isErr()) {
    return err("NO_CHECKOUT");
  }
  const id = `${new Date().toISOString().replace(/[:.]/gu, "-").toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const folder = join(app.getPath("userData"), "updates");
  const launch = updateLaunch({ folder, id });
  const pending: PendingUpdate = {
    id,
    logPath: launch.logPath,
    outcomePath: launch.outcomePath,
    startedIso: new Date().toISOString(),
  };
  let log: number;
  try {
    mkdirSync(folder, { recursive: true });
    log = openSync(launch.logPath, "a");
  } catch {
    return err("LAUNCH_FAILED");
  }
  rememberUpdate({ change: { update: pending } });
  exited = false;
  try {
    const child = spawn(
      join(checkout.value, "bin", "slopweaver"),
      ["desktop", "update", "--outcome", launch.outcomePath, "--log", launch.logPath],
      {
        cwd: checkout.value,
        detached: true,
        env: childEnv({ home: homedir(), inherited: process.env }),
        stdio: ["ignore", log, log],
      },
    );
    child.on("exit", () => {
      exited = true;
      check();
    });
    child.on("error", () => {
      exited = true;
      check();
    });
    child.unref();
  } catch {
    rememberUpdate({ change: { update: null } });
    return err("LAUNCH_FAILED");
  } finally {
    closeSync(log);
  }
  waitFor({ pending });
  return ok(undefined);
}

/**
 * Reload every console page and the overlay onto the build the console serves now, restarting a call ended for it —
 * through the overlay, which holds the command until its fresh page listens.
 */
function reloadForUpdate(): void {
  // The page's own early finish and the shell's deadline both land here; whichever is first, the other is spent.
  clearTimeout(swapTimer);
  swapTimer = undefined;
  for (const contents of everyTabContents()) {
    contents.reloadIgnoringCache();
  }
  host?.reloadOverlay();
  resumeIfOwed();
}

/** Wait on one update's record, looking now and every {@link UPDATE_POLL_MS}. */
function waitFor({ pending }: { pending: PendingUpdate }): void {
  waiting = pending;
  changed();
  check();
}

/** Look for the record once: settle on it, give up on a lost update, or look again shortly. */
function check(): void {
  if (pollTimer !== undefined) {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  }
  const pending = waiting;
  if (pending === undefined || host === undefined) {
    return;
  }
  const outcome = readOutcome({ path: pending.outcomePath });
  if (outcome !== undefined) {
    settle({ outcome });
    return;
  }
  if (pendingVerdict({ exited, nowMs: Date.now(), pending }) === "lost") {
    settle({ outcome: lostOutcome({ nowIso: new Date().toISOString(), pending }) });
    return;
  }
  pollTimer = setTimeout(check, UPDATE_POLL_MS);
}

/** The update has settled: show its outcome, forget the launch, and restart a call ended for it. */
function settle({ outcome }: { outcome: UpdateOutcome }): void {
  waiting = undefined;
  lastOutcome = outcome;
  rememberUpdate({ change: { update: null } });
  changed();
  resumeIfOwed();
}
