/**
 * `machine unused`'s shell — `--help`/`-h` and bad-flag refusals, the deterministic surface of
 * `runMachineUnusedWithDeps`. The happy path (a real home's histories measured and rendered) is exercised
 * through the pure `capacity/unused.ts` and `capacity/unusedRender.ts` tests instead, per the house style of
 * not reaching into ambient state a unit test cannot pin down.
 */
import { describe, expect, it } from "vitest";
import { MACHINE_UNUSED_USAGE, runMachineUnusedWithDeps } from "../../../../../cli/commands/machine/unused.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { Logger } from "../../../../../lib/logger.js";
import { memoryPlanRegisterPort } from "../../../../planRegisterFixture.js";

/** A logger that records what the verb printed, by stream. */
function captureLogger(): { log: Pick<Logger, "error" | "out">; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    errs,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    out,
  };
}

/** `slopweaver machine unused <tail>` — the tail starts at argv index 4. */
async function run({ tail, log }: { tail: readonly string[]; log: Pick<Logger, "error" | "out"> }): Promise<number> {
  return runMachineUnusedWithDeps({
    argv: ["node", "slopweaver", "machine", "unused", ...tail],
    log,
    nowIso: "2026-09-28T00:00:00.000Z",
    port: memoryPlanRegisterPort(),
  });
}

describe("runMachineUnusedWithDeps", () => {
  it("prints the exact usage on --help", async () => {
    const { log, out } = captureLogger();
    expect(await run({ log, tail: ["--help"] })).toBe(EXIT_OK);
    expect(out).toEqual([MACHINE_UNUSED_USAGE]);
  });

  it("prints usage on -h too", async () => {
    const { log, out } = captureLogger();
    expect(await run({ log, tail: ["-h"] })).toBe(EXIT_OK);
    expect(out).toEqual([MACHINE_UNUSED_USAGE]);
  });

  it("refuses an unknown flag as a usage error, naming it then the usage", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--nope"] })).toBe(EXIT_USAGE);
    expect(errs).toEqual(["unknown flag: --nope", MACHINE_UNUSED_USAGE]);
  });

  it("refuses --days 0 as below the minimum", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--days", "0"] })).toBe(EXIT_USAGE);
    expect(errs).toEqual(["--days must be a whole number of days, at least 1 (got 0)"]);
  });

  it("refuses a non-numeric --days", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--days", "x"] })).toBe(EXIT_USAGE);
    expect(errs).toEqual(["--days must be a whole number of days, at least 1 (got x)"]);
  });

  it("refuses a fractional --days", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--days", "1.5"] })).toBe(EXIT_USAGE);
    expect(errs).toEqual(["--days must be a whole number of days, at least 1 (got 1.5)"]);
  });
});
