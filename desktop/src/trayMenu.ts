/**
 * The menu bar icon's menu, in order: what it says, the fleet, each plan's usage, the update, Open Sessions, Recovery, the permissions items, the
 * voice, triage, the Queue, a reopen, a retry and Quit. A test instance's own icon draws the same menu less what it
 * never started — the fleet, the permissions guide, triage — so each of those is passed in only when it runs.
 * `main.ts` supplies the acts and sets the menu; nothing here touches Electron, nor imports its types — the unit lane
 * typechecks this file where Electron is not installed — so an item is the structural subset of Electron's
 * `MenuItemConstructorOptions` this menu draws, and the update and triage items pass through as the shells made them.
 */
import { INPUT_CONTROL_NAME } from "./inputControlConsent";
import type { MenuView, TrayVoiceCommand } from "./shellState";

/** One item this module draws: a line, a press or a separator — assignable to Electron's own item options. */
export interface TrayMenuItem {
  readonly accelerator?: string;
  readonly click?: () => void;
  readonly enabled?: boolean;
  readonly label?: string;
  readonly type?: "separator";
}

/** What the menu's items do when pressed. */
export interface TrayMenuActs {
  readonly commandVoice: (options: { readonly command: TrayVoiceCommand }) => void;
  readonly openQueue: () => void;
  readonly openSessions: () => void;
  readonly quit: () => void;
  readonly raiseGuide: () => void;
  readonly raiseInputControl: () => void;
  readonly reopen: (options: { readonly path: string }) => void;
  readonly retry: () => void;
}

/** The fleet's part of the menu: its line, and the Recovery item, which exists only beside a fleet. */
export interface TrayFleet {
  readonly line: string;
  /** A Recovery check is running, so its item is disabled until it finishes. */
  readonly recoveryRunning: boolean;
  /** The owner's Recovery press: the same press as the Sessions page's button. */
  readonly recover: () => void;
}

/** What the menu shows, each part the owner's app's alone left `undefined` (or empty) in a test instance. */
export interface TrayMenuParts<Item> {
  /** The lines above the first separator, the build's own first when it has one. */
  readonly lines: readonly string[];
  /** The fleet's part; `undefined` with no fleet, which also drops Open Sessions and Recovery. */
  readonly fleet: TrayFleet | undefined;
  readonly updateItems: readonly Item[];
  /** The permissions guide's item label, `undefined` while every voice permission is on; the whole entry `undefined` with no guide. */
  readonly permissions: { readonly label: string | undefined } | undefined;
  /** Each plan's recorded usage, drawn after the fleet line: a headline carrying one line per plan (`planUsageShell.ts`). */
  readonly planUsageItems: readonly Item[];
  readonly triageItems: readonly Item[];
  readonly quitLabel: string;
  readonly view: MenuView;
}

/**
 * The menu bar's permissions items: the guide's, naming a voice permission still off, and the optional mouse and
 * keyboard control step's, which is always there to reconsider and never names itself as off.
 *
 * @param permissions the guide's item label, the whole entry `undefined` when the guide never started
 * @param acts what the items do
 * @returns the items, in menu order
 */
function permissionItems({
  permissions,
  acts,
}: {
  permissions: TrayMenuParts<unknown>["permissions"];
  acts: TrayMenuActs;
}): TrayMenuItem[] {
  if (permissions === undefined) {
    return [];
  }
  const guide = permissions.label === undefined ? [] : [{ click: acts.raiseGuide, label: permissions.label }];
  return [...guide, { click: acts.raiseInputControl, label: `${INPUT_CONTROL_NAME}…` }];
}

/**
 * The menu's items, in order.
 *
 * @param parts what the menu shows
 * @param acts what its items do
 * @returns the template `Menu.buildFromTemplate` takes
 */
export function trayMenuItems<Item>({
  parts,
  acts,
}: {
  parts: TrayMenuParts<Item>;
  acts: TrayMenuActs;
}): (Item | TrayMenuItem)[] {
  const { fleet, view } = parts;
  const items: (Item | TrayMenuItem)[] = parts.lines.map((label) => ({ enabled: false, label }));
  if (fleet !== undefined) {
    items.push({ enabled: false, label: fleet.line });
  }
  items.push(...parts.planUsageItems, { type: "separator" }, ...parts.updateItems);
  if (fleet !== undefined) {
    items.push(
      { click: acts.openSessions, label: "Open Sessions" },
      { click: fleet.recover, enabled: !fleet.recoveryRunning, label: "Recovery" },
    );
  }
  items.push(...permissionItems({ acts, permissions: parts.permissions }));
  if (view.voice !== undefined) {
    const { command, label } = view.voice;
    items.push({
      click: () => {
        acts.commandVoice({ command });
      },
      label,
    });
  }
  items.push(...parts.triageItems, { click: acts.openQueue, label: "Open Queue" });
  if (view.reopenPath !== undefined) {
    const path = view.reopenPath;
    items.push({
      click: () => {
        acts.reopen({ path });
      },
      label: `Reopen ${path}`,
    });
  }
  if (view.retry) {
    items.push({ click: acts.retry, label: "Retry Console" });
  }
  items.push({ type: "separator" }, { accelerator: "Command+Q", click: acts.quit, label: parts.quitLabel });
  return items;
}
