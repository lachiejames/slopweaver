/**
 * What `OFFLOADED_COMMANDS` hands the console's browser worker, written out by hand so a change to the declaration
 * cannot silently change what is expected of it. The other workers' commands, and the whole workflow's contract, are
 * `ciOffloadContract.test.ts`'s.
 */
import { describe, expect, it } from "vitest";
import { OFFLOADED_COMMANDS } from "../../../devLint/ciOffloadCommands.js";

describe("OFFLOADED_COMMANDS", () => {
  it("offloads the console's browser lane to its own worker, so a red page walk reddens `build`", () => {
    expect(OFFLOADED_COMMANDS.filter((entry) => entry.job === "desktop-e2e").map((entry) => entry.command)).toEqual([
      "yarn test:e2e",
    ]);
  });
});
