/**
 * `runGateEntry` closes TypeScript after the gate and before the exit, whether the gate answered or threw. The
 * real-process witness, where the exit is `process.exit` itself, is `../../subprocess/devLint/gateEntry.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { runGateEntry } from "../../../devLint/gateEntry.js";

/** Recorders for the close and the exit, writing into one ordered event list. */
function recorders({ events }: { events: string[] }): { close: () => void; exit: (code: number) => void } {
  return {
    close: () => {
      events.push("close");
    },
    exit: (code) => {
      events.push(`exit:${String(code)}`);
    },
  };
}

describe("runGateEntry", () => {
  it("runs the gate, closes, then exits with the gate's own code", async () => {
    const events: string[] = [];
    await runGateEntry({
      ...recorders({ events }),
      run: () => {
        events.push("run");
        return 23;
      },
    });

    expect(events).toEqual(["run", "close", "exit:23"]);
  });

  it("awaits an async gate before it closes", async () => {
    const events: string[] = [];
    await runGateEntry({
      ...recorders({ events }),
      run: async () => {
        await Promise.resolve();
        events.push("run");
        return 0;
      },
    });

    expect(events).toEqual(["run", "close", "exit:0"]);
  });

  it("still closes when the gate throws, and rejects rather than exiting", async () => {
    const events: string[] = [];
    await expect(
      runGateEntry({
        ...recorders({ events }),
        run: () => {
          events.push("run");
          throw new Error("gate broke");
        },
      }),
    ).rejects.toThrow("gate broke");

    expect(events).toEqual(["run", "close"]);
  });
});
