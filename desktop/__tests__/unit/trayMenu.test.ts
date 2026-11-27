/**
 * The menu bar icon's menu, in order: the owner's app's whole menu, and a test instance's, which drops the fleet, the
 * permissions guide and triage it never started and keeps everything else, each plan's usage included.
 */
import { describe, expect, it } from "vitest";

import type { MenuView } from "../../src/shellState";
import {
  type TrayFleet,
  type TrayMenuActs,
  type TrayMenuItem,
  type TrayMenuParts,
  trayMenuItems,
} from "../../src/trayMenu";

/** Every press records its own name, so a test reads which act an item is wired to. */
const pressed: string[] = [];
const ACTS: TrayMenuActs = {
  commandVoice: ({ command }) => pressed.push(`voice:${command}`),
  openQueue: () => pressed.push("queue"),
  openSessions: () => pressed.push("sessions"),
  quit: () => pressed.push("quit"),
  raiseGuide: () => pressed.push("guide"),
  raiseInputControl: () => pressed.push("input-control"),
  reopen: ({ path }) => pressed.push(`reopen:${path}`),
  retry: () => pressed.push("retry"),
};

/** The owner's fleet with no Recovery check running. */
const FLEET: TrayFleet = {
  chair: [],
  line: "Fleet: 3 sessions",
  recover: () => pressed.push("recover"),
  recoveryRunning: false,
};

const VIEW: MenuView = {
  icon: "ready",
  lines: ["Console serving"],
  reopenPath: "/fleet",
  retry: true,
  tooltip: "Console serving",
  voice: { command: "activate", label: "Start voice" },
};

/** A menu item's label, or `---` for a separator. */
const labelOf = (item: TrayMenuItem): string => (item.type === "separator" ? "---" : item.label!);

describe("trayMenuItems", () => {
  it("draws the chair watch's lines, disabled, directly under the fleet line", () => {
    const parts: TrayMenuParts<TrayMenuItem> = {
      fleet: { ...FLEET, chair: ["Chair: stays · week 20%", "Hand-off refused · no successor plan"] },
      lines: [],
      permissions: undefined,
      planUsageItems: [{ label: "Plans: 2 of 3 open" }],
      quitLabel: "Quit Slopweaver",
      triageItems: [],
      updateItems: [],
      view: { ...VIEW, voice: undefined },
    };
    const items = trayMenuItems({ acts: ACTS, parts });
    expect(items.slice(0, 4).map(labelOf)).toEqual([
      "Fleet: 3 sessions",
      "Chair: stays · week 20%",
      "Hand-off refused · no successor plan",
      "Plans: 2 of 3 open",
    ]);
    expect(items.slice(1, 3).map((item) => item.enabled)).toEqual([false, false]);
  });

  it("draws the owner's app's whole menu, in order", () => {
    const parts: TrayMenuParts<TrayMenuItem> = {
      fleet: FLEET,
      lines: ["Console serving"],
      permissions: { label: "Turn on Screen Recording…" },
      planUsageItems: [{ label: "Plans: 2 of 3 open" }],
      quitLabel: "Quit Slopweaver",
      triageItems: [{ label: "Start triage" }],
      updateItems: [{ label: "Update now" }],
      view: VIEW,
    };
    expect(trayMenuItems({ acts: ACTS, parts }).map(labelOf)).toEqual([
      "Console serving",
      "Fleet: 3 sessions",
      "Plans: 2 of 3 open",
      "---",
      "Update now",
      "Open Sessions",
      "Recovery",
      "Turn on Screen Recording…",
      "Mouse & keyboard control…",
      "Start voice",
      "Start triage",
      "Open Queue",
      "Reopen /fleet",
      "Retry Console",
      "---",
      "Quit Slopweaver",
    ]);
  });

  it("drops the fleet, the permissions items and triage from a test instance's own icon, and keeps the rest", () => {
    const parts: TrayMenuParts<TrayMenuItem> = {
      fleet: undefined,
      lines: ["Test instance · Slopweaver Dev", "Console serving"],
      permissions: undefined,
      planUsageItems: [{ label: "Plans: reading…" }],
      quitLabel: "Quit Slopweaver Test",
      triageItems: [],
      updateItems: [{ label: "Update now" }],
      view: { ...VIEW, reopenPath: undefined, retry: false, voice: undefined },
    };
    expect(trayMenuItems({ acts: ACTS, parts }).map(labelOf)).toEqual([
      "Test instance · Slopweaver Dev",
      "Console serving",
      "Plans: reading…",
      "---",
      "Update now",
      "Open Queue",
      "---",
      "Quit Slopweaver Test",
    ]);
  });

  it("keeps mouse and keyboard control in the owner's menu while every voice permission is on", () => {
    const parts: TrayMenuParts<TrayMenuItem> = {
      fleet: undefined,
      lines: [],
      permissions: { label: undefined },
      planUsageItems: [],
      quitLabel: "Quit Slopweaver",
      triageItems: [],
      updateItems: [],
      view: { ...VIEW, reopenPath: undefined, retry: false, voice: undefined },
    };
    expect(trayMenuItems({ acts: ACTS, parts }).map(labelOf)).toEqual([
      "---",
      "Mouse & keyboard control…",
      "Open Queue",
      "---",
      "Quit Slopweaver",
    ]);
  });

  it("wires each item to its own act, Quit on Command+Q", () => {
    const parts: TrayMenuParts<TrayMenuItem> = {
      fleet: FLEET,
      lines: [],
      permissions: { label: "Turn on Microphone…" },
      planUsageItems: [],
      quitLabel: "Quit Slopweaver",
      triageItems: [],
      updateItems: [],
      view: VIEW,
    };
    const items = trayMenuItems({ acts: ACTS, parts });
    pressed.length = 0;
    for (const item of items.filter((one) => one.click !== undefined)) {
      item.click!();
    }
    expect(pressed).toEqual([
      "sessions",
      "recover",
      "guide",
      "input-control",
      "voice:activate",
      "queue",
      "reopen:/fleet",
      "retry",
      "quit",
    ]);
    expect(items.at(-1)!.accelerator).toBe("Command+Q");
  });

  it("disables Recovery while a check runs, and enables it otherwise", () => {
    const partsFor = ({ recoveryRunning }: { recoveryRunning: boolean }): TrayMenuParts<TrayMenuItem> => ({
      fleet: { ...FLEET, recoveryRunning },
      lines: [],
      permissions: undefined,
      planUsageItems: [],
      quitLabel: "Quit Slopweaver",
      triageItems: [],
      updateItems: [],
      view: VIEW,
    });
    const recoveryItem = ({ recoveryRunning }: { recoveryRunning: boolean }): TrayMenuItem =>
      trayMenuItems({ acts: ACTS, parts: partsFor({ recoveryRunning }) }).find((item) => item.label === "Recovery")!;
    expect(recoveryItem({ recoveryRunning: true }).enabled).toBe(false);
    expect(recoveryItem({ recoveryRunning: false }).enabled).toBe(true);
  });
});
