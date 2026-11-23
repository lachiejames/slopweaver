/*
 * Giving back the foreground after a walk: the pure decision to give back only what was taken, and the restore
 * that reads the screen, runs that one command and throws nothing.
 */
import { describe, expect, it } from "vitest";

import {
  CHROME_BUNDLE_ID,
  type ForegroundSnapshot,
  foregroundRestoreAction,
  restoreForeground,
} from "../../../../browser/foreground.js";
import { BUNDLE_OF, CHROME_IN_FRONT, CHROME_WINDOW, FRONT_ASN, raiseLine, recorder } from "./harness.js";

describe("foregroundRestoreAction — give back only what was taken", () => {
  const AGENT = 2109125765;
  const agentInFront: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: AGENT };
  const ownerWindow: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125256 };
  const slack: ForegroundSnapshot = { bundleId: "com.tinyspeck.slackmacgap", chromeWindowId: null };

  it("raises the owner's Chrome window when the walk's own window took its place", () => {
    expect(foregroundRestoreAction({ agentWindowId: AGENT, before: ownerWindow, now: agentInFront })).toEqual({
      kind: "raise-window",
      windowId: 2109125256,
    });
  });

  it("activates the other app when the walk's window took the foreground from it", () => {
    expect(foregroundRestoreAction({ agentWindowId: AGENT, before: slack, now: agentInFront })).toEqual({
      bundleId: "com.tinyspeck.slackmacgap",
      kind: "activate-app",
    });
  });

  it("leaves the foreground alone when the walk's window is not in front — the owner switched away themselves", () => {
    expect(foregroundRestoreAction({ agentWindowId: AGENT, before: slack, now: ownerWindow })).toEqual({
      kind: "leave",
      why: "the walk's own window is not in front",
    });
    expect(foregroundRestoreAction({ agentWindowId: AGENT, before: ownerWindow, now: slack })).toEqual({
      kind: "leave",
      why: "the walk's own window is not in front",
    });
    expect(foregroundRestoreAction({ agentWindowId: AGENT, before: ownerWindow, now: null })).toEqual({
      kind: "leave",
      why: "the walk's own window is not in front",
    });
  });

  it("leaves the foreground alone when the walk's window was never identified", () => {
    expect(foregroundRestoreAction({ agentWindowId: null, before: slack, now: agentInFront })).toEqual({
      kind: "leave",
      why: "the walk's own window was never identified",
    });
  });

  it("leaves the foreground alone when nothing is known about before, or before was the walk's own window", () => {
    expect(foregroundRestoreAction({ agentWindowId: AGENT, before: null, now: agentInFront })).toEqual({
      kind: "leave",
      why: "nothing is known about what was in front before",
    });
    expect(foregroundRestoreAction({ agentWindowId: AGENT, before: agentInFront, now: agentInFront })).toEqual({
      kind: "leave",
      why: "what was in front before was the walk's own window, or no window",
    });
    const chromeNoWindow: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: null };
    expect(foregroundRestoreAction({ agentWindowId: AGENT, before: chromeNoWindow, now: agentInFront })).toEqual({
      kind: "leave",
      why: "what was in front before was the walk's own window, or no window",
    });
  });
});

describe("restoreForeground", () => {
  const AGENT_IN_FRONT: Readonly<Record<string, string>> = { ...CHROME_IN_FRONT, [CHROME_WINDOW]: "2109125765\n" };
  const RAISE = raiseLine({ windowId: 2109125256 });
  const ACTIVATE_SLACK = "open -b com.tinyspeck.slackmacgap";

  it("raises the owner's window over the walk's, through Chrome's own dictionary and nothing else", () => {
    const rec = recorder({ replies: { ...AGENT_IN_FRONT, [RAISE]: "" } });
    const before: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125256 };
    expect(restoreForeground({ agentWindowId: 2109125765, before, run: rec.run })).toEqual({
      kind: "raise-window",
      windowId: 2109125256,
    });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW, RAISE]);
  });

  it("brings the other app back with open -b, never by launching Chrome", () => {
    const rec = recorder({ replies: { ...AGENT_IN_FRONT, [ACTIVATE_SLACK]: "" } });
    const before: ForegroundSnapshot = { bundleId: "com.tinyspeck.slackmacgap", chromeWindowId: null };
    expect(restoreForeground({ agentWindowId: 2109125765, before, run: rec.run })).toEqual({
      bundleId: "com.tinyspeck.slackmacgap",
      kind: "activate-app",
    });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW, ACTIVATE_SLACK]);
  });

  it("runs no restore command at all when the walk's window is not in front", () => {
    const rec = recorder({ replies: CHROME_IN_FRONT });
    const before: ForegroundSnapshot = { bundleId: "com.tinyspeck.slackmacgap", chromeWindowId: null };
    expect(restoreForeground({ agentWindowId: 2109125765, before, run: rec.run })).toEqual({
      kind: "leave",
      why: "the walk's own window is not in front",
    });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW]);
  });

  it("reports a refused restore as left, carrying the refusal, and throws nothing", () => {
    const rec = recorder({ replies: AGENT_IN_FRONT });
    const before: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125256 };
    expect(restoreForeground({ agentWindowId: 2109125765, before, run: rec.run })).toEqual({
      kind: "leave",
      why: `the restore command failed: no such command: ${RAISE}`,
    });
  });
});
