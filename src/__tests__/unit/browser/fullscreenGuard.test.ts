import { describe, expect, it } from "vitest";

import { BROWSER_ACTION_KINDS } from "../../../browser/action.js";
import {
  fullscreenReceiptLines,
  parseFullscreenGuardInstallation,
  parseFullscreenGuardObservation,
  shouldGuardFullscreen,
} from "../../../browser/fullscreenGuard.js";

/** The client's `run-code` reply carrying one JSON value. */
function reply({ value }: { value: unknown }): string {
  return `### Ran Playwright code\n### Result\n${JSON.stringify(value, null, 2)}\n`;
}

describe("shouldGuardFullscreen", () => {
  it("guards exactly the thirteen write-capable kinds in a background session", () => {
    expect(BROWSER_ACTION_KINDS.length).toBeGreaterThan(0);
    const guarded = BROWSER_ACTION_KINDS.filter((kind) => shouldGuardFullscreen({ kind, placement: "background" }));
    expect(guarded.toSorted()).toEqual([
      "check",
      "click",
      "double-click",
      "download",
      "drag",
      "fill",
      "hover",
      "press",
      "scroll",
      "select",
      "type",
      "uncheck",
      "upload",
    ]);
  });

  it("guards nothing in a foreground session, which was opened to be shown", () => {
    const guarded = BROWSER_ACTION_KINDS.filter((kind) => shouldGuardFullscreen({ kind, placement: "foreground" }));
    expect(guarded).toEqual([]);
  });
});

describe("parseFullscreenGuardInstallation", () => {
  it("reads a three-frame installation with one frame that refused", () => {
    const stdout = reply({
      value: {
        attemptedFrames: 3,
        failedFrames: 1,
        installedFrames: 2,
        mainListenerInstalled: true,
        newDocumentsGuarded: true,
      },
    });
    expect(parseFullscreenGuardInstallation({ stdout })).toEqual({
      attemptedFrames: 3,
      failedFrames: 1,
      installedFrames: 2,
      mainListenerInstalled: true,
      newDocumentsGuarded: true,
    });
  });

  it("reads a page with no frames at all as an empty installation", () => {
    const stdout = reply({
      value: {
        attemptedFrames: 0,
        failedFrames: 0,
        installedFrames: 0,
        mainListenerInstalled: false,
        newDocumentsGuarded: false,
      },
    });
    expect(parseFullscreenGuardInstallation({ stdout })).toEqual({
      attemptedFrames: 0,
      failedFrames: 0,
      installedFrames: 0,
      mainListenerInstalled: false,
      newDocumentsGuarded: false,
    });
  });

  it("refuses totals that do not add up", () => {
    const stdout = reply({
      value: {
        attemptedFrames: 3,
        failedFrames: 0,
        installedFrames: 2,
        mainListenerInstalled: true,
        newDocumentsGuarded: true,
      },
    });
    expect(parseFullscreenGuardInstallation({ stdout })).toBe(null);
  });

  it("refuses a negative, fractional or missing count", () => {
    const negative = reply({
      value: {
        attemptedFrames: 1,
        failedFrames: -1,
        installedFrames: 2,
        mainListenerInstalled: true,
        newDocumentsGuarded: true,
      },
    });
    const fractional = reply({
      value: {
        attemptedFrames: 1.5,
        failedFrames: 0,
        installedFrames: 1.5,
        mainListenerInstalled: true,
        newDocumentsGuarded: true,
      },
    });
    const missing = reply({
      value: { attemptedFrames: 1, installedFrames: 1, mainListenerInstalled: true, newDocumentsGuarded: true },
    });
    expect(parseFullscreenGuardInstallation({ stdout: negative })).toBe(null);
    expect(parseFullscreenGuardInstallation({ stdout: fractional })).toBe(null);
    expect(parseFullscreenGuardInstallation({ stdout: missing })).toBe(null);
  });

  it("refuses a listener flag that is not a boolean", () => {
    const stdout = reply({
      value: {
        attemptedFrames: 1,
        failedFrames: 0,
        installedFrames: 1,
        mainListenerInstalled: 1,
        newDocumentsGuarded: true,
      },
    });
    expect(parseFullscreenGuardInstallation({ stdout })).toBe(null);
  });

  it("refuses a new-documents flag that is missing or not a boolean", () => {
    const missing = reply({
      value: { attemptedFrames: 1, failedFrames: 0, installedFrames: 1, mainListenerInstalled: true },
    });
    const numeric = reply({
      value: {
        attemptedFrames: 1,
        failedFrames: 0,
        installedFrames: 1,
        mainListenerInstalled: true,
        newDocumentsGuarded: 1,
      },
    });
    expect(parseFullscreenGuardInstallation({ stdout: missing })).toBe(null);
    expect(parseFullscreenGuardInstallation({ stdout: numeric })).toBe(null);
  });

  it("refuses a reply with no Result section, or one that is not JSON", () => {
    expect(parseFullscreenGuardInstallation({ stdout: "### Error\nTimeout 5000ms exceeded\n" })).toBe(null);
    expect(parseFullscreenGuardInstallation({ stdout: "### Result\nnot json\n" })).toBe(null);
    expect(parseFullscreenGuardInstallation({ stdout: reply({ value: [1, 2, 3] }) })).toBe(null);
  });
});

describe("parseFullscreenGuardObservation", () => {
  it("reads the counters the read source sums", () => {
    const stdout = reply({ value: { emergencyExits: 0, refusedRequests: 1, unreadableFrames: 0 } });
    expect(parseFullscreenGuardObservation({ stdout })).toEqual({
      emergencyExits: 0,
      refusedRequests: 1,
      unreadableFrames: 0,
    });
  });

  it("refuses a counter of the wrong type", () => {
    const stdout = reply({ value: { emergencyExits: "0", refusedRequests: 1, unreadableFrames: 0 } });
    expect(parseFullscreenGuardObservation({ stdout })).toBe(null);
  });

  it("refuses a reply with no Result section", () => {
    expect(parseFullscreenGuardObservation({ stdout: "### Error\nTarget closed\n" })).toBe(null);
  });
});

describe("fullscreenReceiptLines", () => {
  it("says nothing when there was no reading, or the page asked for nothing", () => {
    expect(fullscreenReceiptLines({ observation: null })).toEqual([]);
    expect(
      fullscreenReceiptLines({ observation: { emergencyExits: 0, refusedRequests: 0, unreadableFrames: 0 } }),
    ).toEqual([]);
  });

  it("names one refused request and how to allow it", () => {
    expect(
      fullscreenReceiptLines({ observation: { emergencyExits: 0, refusedRequests: 1, unreadableFrames: 0 } }),
    ).toEqual([
      "  full screen: the page asked for full screen; it was refused, so the browser stayed in the background (SLOPWEAVER_BROWSER_FOREGROUND=1 at browser open allows it)",
    ]);
  });

  it("counts several refused requests", () => {
    expect(
      fullscreenReceiptLines({ observation: { emergencyExits: 0, refusedRequests: 3, unreadableFrames: 0 } }),
    ).toEqual([
      "  full screen: the page asked for full screen (3 requests); it was refused, so the browser stayed in the background (SLOPWEAVER_BROWSER_FOREGROUND=1 at browser open allows it)",
    ]);
  });

  it("never reports an emergency exit as a clean background success", () => {
    expect(
      fullscreenReceiptLines({ observation: { emergencyExits: 1, refusedRequests: 0, unreadableFrames: 0 } }),
    ).toEqual([
      "  full screen: the page ENTERED full screen and was taken back out of it; whether macOS had already switched your screen to it first is unknown",
    ]);
  });
});
