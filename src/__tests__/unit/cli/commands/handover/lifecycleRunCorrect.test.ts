/**
 * `handover correct` over a real temp board: its two usage refusals, each paired with the near miss that gets
 * past it to the phase refusal, so the exit code is shown to come from the flag under test. Every case stops
 * before the append, so no clock is read, and the whole home is compared byte for byte.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { runHandoverCorrect } from "../../../../../cli/commands/handover/lifecycleRunCorrect.js";
import {
  clearSessionEnv,
  lifecycleHome,
  restoreSessionEnv,
  STARTED,
  snapshotTree,
  verbArgv,
} from "./lifecycleRunFixture.js";

const SLUG = "correct-run";
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
  restoreSessionEnv();
});

describe("runHandoverCorrect", () => {
  it("answers 2 when --question or --why is missing, and 1 with both on a run holding no question", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const before = snapshotTree({ root: home });
    const run = async ({ flags }: { flags: readonly string[] }): Promise<number> =>
      runHandoverCorrect(verbArgv({ rest: [SLUG, "--home", home, ...flags], verb: "correct" }));

    const codes = [
      await run({ flags: [] }),
      await run({ flags: ["--question", "Which base?"] }),
      await run({ flags: ["--why", "the figure moved"] }),
      await run({ flags: ["--question", "Which base?", "--why", "the figure moved"] }),
    ];

    expect(codes).toEqual([2, 2, 2, 1]);
    expect(snapshotTree({ root: home })).toEqual(before);
  });

  it("answers 2 for a blank or multi-line --still-real, and 1 for a one-line one, writing nothing", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const before = snapshotTree({ root: home });
    const run = async ({ stillReal }: { stillReal: string }): Promise<number> =>
      runHandoverCorrect(
        verbArgv({
          rest: [SLUG, "--home", home, "--question", "Which base?", "--why", "moved", "--still-real", stillReal],
          verb: "correct",
        }),
      );

    const codes = [
      await run({ stillReal: "   " }),
      await run({ stillReal: "line one\nline two" }),
      await run({ stillReal: "re-read the doc: still cites both" }),
    ];

    expect(codes).toEqual([2, 2, 1]);
    expect(snapshotTree({ root: home })).toEqual(before);
  });
});
