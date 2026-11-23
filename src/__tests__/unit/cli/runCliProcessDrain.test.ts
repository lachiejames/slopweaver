/**
 * `runCliProcess` exits only once stdout and stderr have drained. `process.exit` discards what a piped
 * stream still has queued, so an exit that runs first lost `slopweaver dev gate`'s whole verdict on a pipe
 * (`src/lib/drainStdio.ts`). The ORDER is the property, and only a drain the test holds open can show it:
 * a drain that resolved at once would pass a shell that never awaited it.
 */
import { describe, expect, it } from "vitest";

import { EXIT_USAGE } from "../../../cli/exitCodes.js";
import { runCliProcess } from "../../../cli/main.js";

describe("runCliProcess", () => {
  it("does not exit until the drain it awaits has settled, then exits with the verb's own code", async () => {
    const events: string[] = [];
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const drainEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const drain = (): Promise<void> => {
      events.push("drain");
      entered();
      return held;
    };

    // No noun at all: `main` prints usage and answers EXIT_USAGE — a non-zero code that is not the `1` a
    // fault path would pick, so the exit below is provably the verb's own.
    const done = runCliProcess({
      argv: ["node", "cli"],
      drain,
      exit: (code) => {
        events.push(`exit:${String(code)}`);
      },
    });

    await drainEntered;
    expect(events).toEqual(["drain"]);

    release();
    await done;
    expect(events).toEqual(["drain", `exit:${String(EXIT_USAGE)}`]);
  });
});
