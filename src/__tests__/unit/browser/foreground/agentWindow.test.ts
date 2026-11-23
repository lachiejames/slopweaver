/*
 * Naming the agent's own Chrome window after an attach: the window that newly tops Chrome's stack, read from
 * the front app when it is Chrome and from Chrome's window order when it is not.
 */
import { describe, expect, it } from "vitest";

import { agentWindowAfterAttach, agentWindowFromOrder } from "../../../../browser/backgroundPlacement.js";
import { CHROME_BUNDLE_ID, type ForegroundSnapshot } from "../../../../browser/foreground.js";
import { recorder, WINDOW_IDS } from "./harness.js";

describe("agentWindowFromOrder — the window that newly tops Chrome's own stack", () => {
  it("names the new top", () => {
    expect(agentWindowFromOrder({ after: [42, 7], before: [7] })).toBe(42);
    expect(agentWindowFromOrder({ after: [42], before: [] })).toBe(42);
  });

  it("names nothing when the top did not change — an attach that opened nothing moves nothing of the owner's", () => {
    expect(agentWindowFromOrder({ after: [7, 42], before: [7] })).toBe(null);
    expect(agentWindowFromOrder({ after: [], before: [] })).toBe(null);
  });

  it("names nothing when either side could not be listed", () => {
    expect(agentWindowFromOrder({ after: [42, 7], before: null })).toBe(null);
    expect(agentWindowFromOrder({ after: null, before: [7] })).toBe(null);
  });
});

describe("agentWindowAfterAttach", () => {
  it("takes Chrome's front window when Chrome is the front app, asking nothing more", () => {
    const rec = recorder({ replies: {} });
    const now: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 42 };
    expect(agentWindowAfterAttach({ beforeIds: [7], now, run: rec.run })).toEqual({ unnamed: false, windowId: 42 });
    expect(rec.ran()).toEqual([]);
  });

  it("names nothing when Chrome's front window was already the top of its stack — a failed attach on the OWNER's window", () => {
    const rec = recorder({ replies: {} });
    const now: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 7 };
    expect(agentWindowAfterAttach({ beforeIds: [7, 55], now, run: rec.run })).toEqual({
      unnamed: false,
      windowId: null,
    });
  });

  it("reads Chrome's order when the owner is in another app", () => {
    const rec = recorder({ replies: { [WINDOW_IDS]: "42, 7\n" } });
    const now: ForegroundSnapshot = { bundleId: "com.cmuxterm.app", chromeWindowId: null };
    expect(agentWindowAfterAttach({ beforeIds: [7], now, run: rec.run })).toEqual({ unnamed: false, windowId: 42 });
    expect(rec.ran()).toEqual([WINDOW_IDS]);
  });

  it("is unnamed when Chrome is in front naming no window, or will not list its windows", () => {
    const chromeUnnamed: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: null };
    expect(agentWindowAfterAttach({ beforeIds: [7], now: chromeUnnamed, run: recorder({ replies: {} }).run })).toEqual({
      unnamed: true,
      windowId: null,
    });
    const cmux: ForegroundSnapshot = { bundleId: "com.cmuxterm.app", chromeWindowId: null };
    expect(agentWindowAfterAttach({ beforeIds: [7], now: cmux, run: recorder({ replies: {} }).run })).toEqual({
      unnamed: true,
      windowId: null,
    });
    expect(
      agentWindowAfterAttach({
        beforeIds: null,
        now: cmux,
        run: recorder({ replies: { [WINDOW_IDS]: "42, 7\n" } }).run,
      }),
    ).toEqual({ unnamed: true, windowId: null });
  });
});
