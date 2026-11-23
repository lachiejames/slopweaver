/**
 * `cmux reseat`'s request reading: exactly one of a workspace or `--all`, and a `--plan` the register carries,
 * refused before anything opens a socket.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runCmuxReseatOver } from "../../../../../cli/commands/cmux/reseat.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

/** The process argv for one invocation. */
function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "cmux", "reseat", ...tail];
}

/** One invocation over a fresh in-memory register, so no case can reach a real store. */
function reseat({ tail }: { tail: readonly string[] }): Promise<number> {
  return runCmuxReseatOver({ argv: argv({ tail }), port: memoryPlanRegisterPort() });
}

describe("runCmuxReseat", () => {
  it("prints its usage on --help", async () => {
    expect(await reseat({ tail: ["--help"] })).toBe(EXIT_OK);
  });

  it("refuses an invocation that names neither a workspace nor --all", async () => {
    expect(await reseat({ tail: ["--dry-run"] })).toBe(EXIT_USAGE);
  });

  it("refuses a workspace AND --all, which would leave the target ambiguous", async () => {
    expect(await reseat({ tail: ["workspace:4", "--all"] })).toBe(EXIT_USAGE);
  });

  it("refuses two workspaces", async () => {
    expect(await reseat({ tail: ["workspace:4", "workspace:5"] })).toBe(EXIT_USAGE);
  });

  it("refuses a --timeout-seconds that is not a number", async () => {
    expect(await reseat({ tail: ["--all", "--timeout-seconds", "soon"] })).toBe(EXIT_USAGE);
  });

  it("refuses --plan beside --all, since one plan names one seat", async () => {
    expect(await reseat({ tail: ["--all", "--plan", "plan-three"] })).toBe(EXIT_USAGE);
  });

  it("refuses a --plan the home's register does not carry, before any socket opens", async () => {
    const home = mkdtempSync(join(tmpdir(), "reseat-plan-"));
    try {
      const code = await reseat({ tail: ["workspace:4", "--plan", "plan-nine", "--home", home] });
      expect(code).toBe(EXIT_USAGE);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  // The same invocation as above over an unreachable store: the register's contents are unknown, so the refusal
  // is a fact about the machine (EXIT_ERROR), not the caller's mistake, and still lands before any socket opens.
  it("refuses a --plan when the register's store is unreachable, before any socket opens", async () => {
    const home = mkdtempSync(join(tmpdir(), "reseat-outage-"));
    try {
      const code = await runCmuxReseatOver({
        argv: argv({ tail: ["workspace:4", "--plan", "plan-nine", "--home", home] }),
        port: unavailablePlanRegisterPort(),
      });
      expect(code).toBe(EXIT_ERROR);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
