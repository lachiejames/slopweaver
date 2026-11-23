/**
 * The lazy half of `claudePlanProbesPort`: the store module is loaded once per port, on first use, and a load that
 * fails answers `CLAUDE_PLAN_PROBES_STORE_UNAVAILABLE` rather than rejecting, however the loader failed.
 */
import { describe, expect, it } from "vitest";

import { type ClaudePlanProbesPort, claudePlanProbesPort } from "../../../claude/planProbes.js";
import { ok } from "../../../lib/result.js";

/** A store half that answers every operation empty. */
const WORKING_PORT: ClaudePlanProbesPort = {
  read: async () => ok([]),
  record: async () => ok({ kept: [], written: 0 }),
};

describe("claudePlanProbesPort's load", () => {
  it("loads nothing until the first operation, and once across every later one", async () => {
    let calls = 0;
    const port = claudePlanProbesPort({
      load: async () => {
        calls += 1;
        return WORKING_PORT;
      },
    });
    const before = calls;
    const first = await port.read({ home: "/nowhere" });
    const second = await port.record({ home: "/nowhere", observed: [] });
    expect([before, calls, first.isOk(), second.isOk()]).toEqual([0, 1, true, true]);
  });

  it("answers a rejecting load as store-unavailable, on one load across both operations", async () => {
    let calls = 0;
    const port = claudePlanProbesPort({
      load: async () => {
        calls += 1;
        throw new Error("module load failed");
      },
    });
    const read = await port.read({ home: "/nowhere" });
    const recorded = await port.record({ home: "/nowhere", observed: [] });
    expect(calls).toBe(1);
    expect(read._unsafeUnwrapErr().code).toBe("CLAUDE_PLAN_PROBES_STORE_UNAVAILABLE");
    expect(read._unsafeUnwrapErr().message).toContain("module load failed");
    expect(recorded._unsafeUnwrapErr().code).toBe("CLAUDE_PLAN_PROBES_STORE_UNAVAILABLE");
  });

  it("answers a loader that throws before any await the same way, still on one load", async () => {
    let calls = 0;
    const port = claudePlanProbesPort({
      load: () => {
        calls += 1;
        throw new Error("module load failed");
      },
    });
    const first = await port.read({ home: "/nowhere" });
    const second = await port.read({ home: "/nowhere" });
    expect(calls).toBe(1);
    expect(first._unsafeUnwrapErr().code).toBe("CLAUDE_PLAN_PROBES_STORE_UNAVAILABLE");
    expect(second._unsafeUnwrapErr().code).toBe("CLAUDE_PLAN_PROBES_STORE_UNAVAILABLE");
  });

  it("publishes its load before the loader runs, so a loader re-entering the port waits on it", async () => {
    let calls = 0;
    let reentered: Promise<unknown> | undefined;
    const port: ClaudePlanProbesPort = claudePlanProbesPort({
      load: async () => {
        calls += 1;
        // Not awaited: the re-entrant read waits on this very load, so awaiting it here would never settle.
        reentered = port.read({ home: "/nowhere" });
        return WORKING_PORT;
      },
    });
    const outer = await port.read({ home: "/nowhere" });
    await reentered;
    expect([calls, outer.isOk()]).toEqual([1, true]);
  });
});
