/**
 * The macOS application menu, decided: the app-name menu carries the menu bar icon's own update item where other Mac
 * apps put "Check for Updates…", a failed update's line above it, and the standard menus after it.
 */
import { describe, expect, it } from "vitest";

import { APP_MENU_UPDATE_ID, appMenuTemplate } from "../../src/appMenu";
import { trayOutcomeLine, trayUpdateItem } from "../../src/updatePlan";

const TAIL = [
  { type: "separator" },
  { role: "services" },
  { type: "separator" },
  { role: "hide" },
  { role: "hideOthers" },
  { role: "unhide" },
  { type: "separator" },
  { role: "quit" },
];

describe("appMenuTemplate", () => {
  it("puts Check for Updates… under About in the app-name menu, then File, Edit, View and Window", () => {
    const template = appMenuTemplate({
      appName: "Slopweaver",
      outcomeLine: undefined,
      update: { enabled: true, label: "Check for Updates…" },
    });
    expect(template).toEqual([
      {
        label: "Slopweaver",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { enabled: true, id: "app-update", label: "Check for Updates…" },
          ...TAIL,
        ],
      },
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]);
  });

  it("carries the console's own offer, enabled, when the page has one", () => {
    const [appName] = appMenuTemplate({
      appName: "Slopweaver",
      outcomeLine: undefined,
      update: { enabled: true, label: "End call, update & restart call" },
    });
    expect(appName.submenu[2]).toEqual({
      enabled: true,
      id: APP_MENU_UPDATE_ID,
      label: "End call, update & restart call",
    });
  });

  it("carries a disabled offer disabled", () => {
    const [appName] = appMenuTemplate({
      appName: "Slopweaver",
      outcomeLine: undefined,
      update: { enabled: false, label: "Update waits for the build" },
    });
    expect(appName.submenu[2]).toEqual({ enabled: false, id: APP_MENU_UPDATE_ID, label: "Update waits for the build" });
  });

  it("reads Updating…, disabled, while an update runs", () => {
    const [appName] = appMenuTemplate({
      appName: "Slopweaver",
      outcomeLine: undefined,
      update: trayUpdateItem({ offer: null, running: true }),
    });
    expect(appName.submenu[2]).toEqual({ enabled: false, id: APP_MENU_UPDATE_ID, label: "Updating…" });
  });

  it("shows a failed update's line, disabled, directly above the update item", () => {
    const outcomeLine = trayOutcomeLine({
      outcome: {
        code: "SYNC_REFUSED",
        finishedIso: "2026-10-16T11:00:00.000Z",
        kind: "failed",
        logPath: undefined,
        message: "the checkout could not fast-forward",
        rolledBack: true,
      },
    });
    const [appName] = appMenuTemplate({
      appName: "Slopweaver",
      outcomeLine,
      update: trayUpdateItem({ offer: null, running: false }),
    });
    expect(appName.submenu).toEqual([
      { role: "about" },
      { type: "separator" },
      { enabled: false, label: "Update failed. The previous app was put back" },
      { enabled: true, id: APP_MENU_UPDATE_ID, label: "Check for Updates…" },
      ...TAIL,
    ]);
  });

  it("uses the menu bar icon's words: with no offer and nothing running it is Check for Updates…", () => {
    const [appName] = appMenuTemplate({
      appName: "Slopweaver",
      outcomeLine: undefined,
      update: trayUpdateItem({ offer: null, running: false }),
    });
    expect(appName.submenu[2]).toEqual({ enabled: true, id: APP_MENU_UPDATE_ID, label: "Check for Updates…" });
  });
});
