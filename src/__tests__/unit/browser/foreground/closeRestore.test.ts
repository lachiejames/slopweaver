/*
 * Restoring after a close, when the walk's own window is already gone: the decision read as a change, the
 * restore that acts on it, and dropping a raise whose window the close took.
 */
import { describe, expect, it } from "vitest";

import { restoreAfterClose, unlessClosedAction } from "../../../../browser/backgroundPlacement.js";
import { CHROME_BUNDLE_ID, closeRestoreAction, type ForegroundSnapshot } from "../../../../browser/foreground.js";
import { BUNDLE_OF, CHROME_IN_FRONT, CHROME_WINDOW, FRONT_ASN, raiseLine, recorder, WINDOW_IDS } from "./harness.js";

describe("closeRestoreAction — the walk's own window is gone by now, so the test is a CHANGE", () => {
  const ownerWindow: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125256 };
  const otherWindow: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125801 };
  const slack: ForegroundSnapshot = { bundleId: "com.tinyspeck.slackmacgap", chromeWindowId: null };

  it("re-activates the app the close took the foreground from", () => {
    expect(closeRestoreAction({ before: slack, now: ownerWindow })).toEqual({
      bundleId: "com.tinyspeck.slackmacgap",
      kind: "activate-app",
    });
  });

  it("raises the owner's window again when the close left a different Chrome window in front", () => {
    expect(closeRestoreAction({ before: ownerWindow, now: otherWindow })).toEqual({
      kind: "raise-window",
      windowId: 2109125256,
    });
  });

  it("does nothing when the close changed nothing", () => {
    expect(closeRestoreAction({ before: ownerWindow, now: ownerWindow })).toEqual({
      kind: "leave",
      why: "the close changed nothing about what is in front",
    });
    expect(closeRestoreAction({ before: slack, now: slack })).toEqual({
      kind: "leave",
      why: "the close changed nothing about what is in front",
    });
  });

  it("does nothing when either side could not be read, or Chrome named no window", () => {
    expect(closeRestoreAction({ before: null, now: ownerWindow })).toEqual({
      kind: "leave",
      why: "the foreground could not be read on both sides of the close",
    });
    expect(closeRestoreAction({ before: ownerWindow, now: null })).toEqual({
      kind: "leave",
      why: "the foreground could not be read on both sides of the close",
    });
    const chromeNoWindow: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: null };
    expect(closeRestoreAction({ before: chromeNoWindow, now: ownerWindow })).toEqual({
      kind: "leave",
      why: "Chrome was in front before with no window to name",
    });
  });
});

describe("restoreAfterClose", () => {
  const ACTIVATE_SLACK = "open -b com.tinyspeck.slackmacgap";

  it("puts back the app the close activated Chrome over", () => {
    const rec = recorder({ replies: { ...CHROME_IN_FRONT, [ACTIVATE_SLACK]: "" } });
    const before: ForegroundSnapshot = { bundleId: "com.tinyspeck.slackmacgap", chromeWindowId: null };
    expect(restoreAfterClose({ before, run: rec.run })).toEqual({
      bundleId: "com.tinyspeck.slackmacgap",
      kind: "activate-app",
    });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW, ACTIVATE_SLACK]);
  });

  it("runs no restore command when the close left the foreground where it was", () => {
    const rec = recorder({ replies: CHROME_IN_FRONT });
    const before: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125256 };
    expect(restoreAfterClose({ before, run: rec.run })).toEqual({
      kind: "leave",
      why: "the close changed nothing about what is in front",
    });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW]);
  });

  it("raises the owner's window back when the close put another of Chrome's windows over it", () => {
    const RAISE_OWNERS = raiseLine({ windowId: 2109125256 });
    const rec = recorder({
      replies: {
        ...CHROME_IN_FRONT,
        [CHROME_WINDOW]: "2109124910\n",
        [RAISE_OWNERS]: "",
        [WINDOW_IDS]: "2109124910, 2109125256\n",
      },
    });
    const before: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125256 };
    expect(restoreAfterClose({ before, run: rec.run })).toEqual({ kind: "raise-window", windowId: 2109125256 });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW, WINDOW_IDS, RAISE_OWNERS]);
  });

  it("raises nothing when the window in front before was the one the close took — the owner was watching it", () => {
    const rec = recorder({
      replies: { ...CHROME_IN_FRONT, [CHROME_WINDOW]: "2109125256\n", [WINDOW_IDS]: "2109125256\n" },
    });
    const before: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125765 };
    expect(restoreAfterClose({ before, run: rec.run })).toEqual({
      kind: "leave",
      why: "the window in front before the close was the one it closed",
    });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW, WINDOW_IDS]);
  });
});

describe("unlessClosedAction", () => {
  const raise = { kind: "raise-window", windowId: 3 } as const;

  it("keeps a raise whose window Chrome still has, and one it could not check", () => {
    expect(unlessClosedAction({ action: raise, ids: [5, 3] })).toEqual(raise);
    expect(unlessClosedAction({ action: raise, ids: null })).toEqual(raise);
  });

  it("drops a raise whose window is gone", () => {
    expect(unlessClosedAction({ action: raise, ids: [5] })).toEqual({
      kind: "leave",
      why: "the window in front before the close was the one it closed",
    });
  });

  it("passes every other action through untouched", () => {
    const activate = { bundleId: "com.tinyspeck.slackmacgap", kind: "activate-app" } as const;
    expect(unlessClosedAction({ action: activate, ids: [] })).toEqual(activate);
  });
});
