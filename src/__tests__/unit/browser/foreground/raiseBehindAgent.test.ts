/*
 * Putting the owner's Chrome window back over the agent's: which window to raise off Chrome's own order, and the
 * best-effort raise that reads that order and never throws.
 */
import { describe, expect, it } from "vitest";

import { raiseBehindAgentAction, raiseWindowBehindAgent } from "../../../../browser/backgroundPlacement.js";
import { raiseLine, recorder, WINDOW_IDS } from "./harness.js";

describe("raiseBehindAgentAction — put the owner's window back over the agent's", () => {
  it("raises the first window behind the agent's when the agent's tops Chrome's stack", () => {
    expect(raiseBehindAgentAction({ agentWindowId: 7, ids: [7, 3, 5] })).toEqual({ kind: "raise-window", windowId: 3 });
  });

  it("leaves the order alone when the agent window is not on top", () => {
    expect(raiseBehindAgentAction({ agentWindowId: 7, ids: [3, 7, 5] })).toEqual({
      kind: "leave",
      why: "the agent window is not the top of Chrome's own stack",
    });
    expect(raiseBehindAgentAction({ agentWindowId: 7, ids: [] })).toEqual({
      kind: "leave",
      why: "the agent window is not the top of Chrome's own stack",
    });
  });

  it("leaves the order alone when the agent window is Chrome's only one", () => {
    expect(raiseBehindAgentAction({ agentWindowId: 7, ids: [7] })).toEqual({
      kind: "leave",
      why: "Chrome has no other window to put on top",
    });
  });
});

describe("raiseWindowBehindAgent is best effort", () => {
  it("reads the order and raises the window just behind the agent's", () => {
    const rec = recorder({ replies: { [WINDOW_IDS]: "7, 3, 5\n", [raiseLine({ windowId: 3 })]: "" } });
    expect(raiseWindowBehindAgent({ agentWindowId: 7, run: rec.run })).toEqual({ kind: "raise-window", windowId: 3 });
    expect(rec.ran()).toEqual([WINDOW_IDS, raiseLine({ windowId: 3 })]);
  });

  it("runs nothing for a window that was never identified", () => {
    const rec = recorder({ replies: {} });
    expect(raiseWindowBehindAgent({ agentWindowId: null, run: rec.run })).toEqual({
      kind: "leave",
      why: "the agent window was never identified",
    });
    expect(rec.ran()).toEqual([]);
  });

  it("leaves the order alone when Chrome will not list its windows, or lists garbage", () => {
    expect(raiseWindowBehindAgent({ agentWindowId: 7, run: recorder({ replies: {} }).run })).toEqual({
      kind: "leave",
      why: "Chrome would not list its windows",
    });
    expect(raiseWindowBehindAgent({ agentWindowId: 7, run: recorder({ replies: { [WINDOW_IDS]: "x" } }).run })).toEqual(
      {
        kind: "leave",
        why: "Chrome would not list its windows",
      },
    );
  });

  it("answers a refused raise as a failed restore, and throws nothing", () => {
    const rec = recorder({ replies: { [WINDOW_IDS]: "7, 3\n" } });
    expect(raiseWindowBehindAgent({ agentWindowId: 7, run: rec.run })).toEqual({
      kind: "leave",
      why: `the restore command failed: no such command: ${raiseLine({ windowId: 3 })}`,
    });
  });
});
