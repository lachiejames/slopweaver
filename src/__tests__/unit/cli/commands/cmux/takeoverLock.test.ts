/**
 * `cmux takeover`'s critical section over plain fakes: the supervisor-pin lock is taken before gates (b) and (c) read
 * the seat, held through the act they allow, and released on every path. No cmux, no app, no file.
 */
import { describe, expect, it } from "vitest";

import { runLockedTakeover } from "../../../../../cli/commands/cmux/takeoverLock.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { fakePinLock } from "./pinLockFake.js";

/** A stand-in gated predecessor: the helper only carries it from the gates to the act. */
const PREDECESSOR = { kind: "cmux", ref: "workspace:7" } as const;

/** The gates and act, journalling into `events`. */
function steps({ events, gated = PREDECESSOR }: { events: string[]; gated?: typeof PREDECESSOR | number }): {
  gates: () => Promise<typeof PREDECESSOR | number>;
  act: (options: { predecessor: typeof PREDECESSOR }) => Promise<number>;
} {
  return {
    act: async ({ predecessor }) => {
      events.push(`act ${predecessor.ref}`);
      return EXIT_OK;
    },
    gates: async () => {
      events.push("gates");
      return gated;
    },
  };
}

describe("runLockedTakeover", () => {
  it("refuses on a held lock before the gates read the seat", async () => {
    const events: string[] = [];
    const exit = await runLockedTakeover({ holdPinLock: fakePinLock({ events, held: true }), ...steps({ events }) });
    expect(exit).toBe(EXIT_ERROR);
    expect(events).toEqual(["lock"]);
  });

  it("holds the lock across the gates and the act, then releases", async () => {
    const events: string[] = [];
    const exit = await runLockedTakeover({ holdPinLock: fakePinLock({ events }), ...steps({ events }) });
    expect(exit).toBe(EXIT_OK);
    expect(events).toEqual(["lock", "gates", "act workspace:7", "release"]);
  });

  it("releases after the gates refuse, acting on nothing", async () => {
    const events: string[] = [];
    const exit = await runLockedTakeover({
      holdPinLock: fakePinLock({ events }),
      ...steps({ events, gated: EXIT_ERROR }),
    });
    expect(exit).toBe(EXIT_ERROR);
    expect(events).toEqual(["lock", "gates", "release"]);
  });

  it("releases when the act throws", async () => {
    const events: string[] = [];
    await expect(
      runLockedTakeover({
        act: async () => {
          throw new Error("cmux went away mid-takeover");
        },
        gates: async () => PREDECESSOR,
        holdPinLock: fakePinLock({ events }),
      }),
    ).rejects.toThrow("cmux went away mid-takeover");
    expect(events).toEqual(["lock", "release"]);
  });
});
