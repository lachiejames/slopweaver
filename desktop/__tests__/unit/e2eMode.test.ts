/**
 * The test-instance switch `slopweaver desktop e2e` launches the bundle with, and what a boot with it does of its own
 * accord: nothing the owner's own app does automatically, and its saved state and lock under the directory it names — bar
 * its own menu bar icon, when the verb asked for one.
 */
import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import {
  desktopBootPolicy,
  desktopE2eMode,
  E2E_MENU_BAR_SWITCH,
  E2E_SWITCH,
  isDesktopTestInstance,
  ownUserData,
} from "../../src/e2eMode";

const APP = "/Applications/Slopweaver.app/Contents/MacOS/Slopweaver";

describe("desktopE2eMode", () => {
  it("reads no mode off the owner's own app's launch", () => {
    expect(unwrap(desktopE2eMode({ argv: [APP, "--checkout=/Users/x/slopweaver"] }))).toBe(undefined);
  });

  it("reads the test instance's own directory off the switch, with no menu bar icon by default", () => {
    const mode = desktopE2eMode({ argv: [APP, `${E2E_SWITCH}=/tmp/sw-e2e/user-data`, "--checkout=/c"] });
    expect(unwrap(mode)).toEqual({ menuBar: false, userData: "/tmp/sw-e2e/user-data" });
  });

  it("reads the menu bar opt-in beside the switch", () => {
    const mode = desktopE2eMode({ argv: [APP, `${E2E_SWITCH}=/tmp/sw-e2e/user-data`, E2E_MENU_BAR_SWITCH] });
    expect(unwrap(mode)).toEqual({ menuBar: true, userData: "/tmp/sw-e2e/user-data" });
  });

  it("refuses the menu bar opt-in on the owner's own app's launch", () => {
    expect(unwrapErr(desktopE2eMode({ argv: [APP, E2E_MENU_BAR_SWITCH] }))).toEqual([
      "--slopweaver-desktop-e2e-menu-bar is only for a test instance, beside --slopweaver-desktop-e2e=<dir>",
    ]);
  });

  it("refuses the menu bar opt-in given twice, or given a value", () => {
    const base = `${E2E_SWITCH}=/tmp/sw-e2e`;
    expect(unwrapErr(desktopE2eMode({ argv: [APP, base, E2E_MENU_BAR_SWITCH, E2E_MENU_BAR_SWITCH] }))).toEqual([
      "--slopweaver-desktop-e2e-menu-bar was given 2 times",
    ]);
    expect(unwrapErr(desktopE2eMode({ argv: [APP, base, `${E2E_MENU_BAR_SWITCH}=yes`] }))).toEqual([
      "--slopweaver-desktop-e2e-menu-bar takes no value",
    ]);
  });

  it("refuses the switch with no directory, or a relative one", () => {
    expect(unwrapErr(desktopE2eMode({ argv: [APP, E2E_SWITCH] }))).toEqual([
      "--slopweaver-desktop-e2e needs =<an absolute directory> for the test instance's own state",
    ]);
    expect(unwrapErr(desktopE2eMode({ argv: [APP, `${E2E_SWITCH}=user-data`] }))).toEqual([
      "--slopweaver-desktop-e2e needs =<an absolute directory> for the test instance's own state",
    ]);
  });

  it("refuses the switch given twice rather than picking one", () => {
    expect(unwrapErr(desktopE2eMode({ argv: [APP, `${E2E_SWITCH}=/a`, `${E2E_SWITCH}=/b`] }))).toEqual([
      "--slopweaver-desktop-e2e was given 2 times",
    ]);
  });

  it("ignores an argument that only starts like the switch", () => {
    expect(unwrap(desktopE2eMode({ argv: [APP, `${E2E_SWITCH}-later=/a`] }))).toBe(undefined);
  });
});

describe("desktopBootPolicy", () => {
  it("runs every automatic act for the owner's own app", () => {
    expect(desktopBootPolicy({ mode: ok(undefined) })).toEqual({
      consoleStart: true,
      fleet: true,
      permissionGuide: true,
      tray: true,
      triage: true,
      updateInstall: true,
      updateResume: true,
    });
  });

  it("runs none of them for a test instance but its own update steps, and never launches an update", () => {
    expect(desktopBootPolicy({ mode: ok({ menuBar: false, userData: "/tmp/sw-e2e" }) })).toEqual({
      consoleStart: false,
      fleet: false,
      permissionGuide: false,
      tray: false,
      triage: false,
      updateInstall: false,
      updateResume: true,
    });
  });

  it("draws a test instance's own menu bar icon when asked, and still nothing else of the owner's", () => {
    expect(desktopBootPolicy({ mode: ok({ menuBar: true, userData: "/tmp/sw-e2e" }) })).toEqual({
      consoleStart: false,
      fleet: false,
      permissionGuide: false,
      tray: true,
      triage: false,
      updateInstall: false,
      updateResume: true,
    });
  });

  it("runs none of them on a malformed switch either", () => {
    expect(desktopBootPolicy({ mode: err(["bad switch"]) })).toEqual({
      consoleStart: false,
      fleet: false,
      permissionGuide: false,
      tray: false,
      triage: false,
      updateInstall: false,
      updateResume: false,
    });
  });
});

describe("isDesktopTestInstance", () => {
  it("leaves the owner's own app unmarked", () => {
    expect(isDesktopTestInstance({ mode: ok(undefined) })).toBe(false);
  });

  it("marks a test instance, with or without its own menu bar icon", () => {
    expect(isDesktopTestInstance({ mode: ok({ menuBar: false, userData: "/tmp/sw-e2e" }) })).toBe(true);
    expect(isDesktopTestInstance({ mode: ok({ menuBar: true, userData: "/tmp/sw-e2e" }) })).toBe(true);
  });

  it("marks a malformed switch too: only the owner's own app, read cleanly, speaks as the owner", () => {
    expect(isDesktopTestInstance({ mode: err(["bad switch"]) })).toBe(true);
  });
});

describe("ownUserData", () => {
  const appData = "/Users/x/Library/Application Support";

  it("keeps Electron's directory for the owner's installed app", () => {
    expect(ownUserData({ appData, devDir: "Slopweaver Dev", mode: undefined, packaged: true })).toBe(undefined);
  });

  it("puts a run from source in the dev directory", () => {
    expect(ownUserData({ appData, devDir: "Slopweaver Dev", mode: undefined, packaged: false })).toBe(
      "/Users/x/Library/Application Support/Slopweaver Dev",
    );
  });

  it("puts a test instance in its switch's directory, installed or not", () => {
    const mode = { menuBar: false, userData: "/tmp/sw-e2e/user-data" };
    expect(ownUserData({ appData, devDir: "Slopweaver Dev", mode, packaged: true })).toBe("/tmp/sw-e2e/user-data");
    expect(ownUserData({ appData, devDir: "Slopweaver Dev", mode, packaged: false })).toBe("/tmp/sw-e2e/user-data");
  });
});
