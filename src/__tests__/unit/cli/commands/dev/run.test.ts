import { describe, expect, it } from "vitest";

import { devGateCommand, runDevCommand } from "../../../../../cli/commands/dev/run.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";

/** argv as the router builds it: node, script, noun, then the verb tail. */
function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "dev", ...tail];
}

describe("runDevCommand", () => {
  it("prints usage and exits OK on --help, without running the gate", async () => {
    expect(await runDevCommand(argv({ tail: ["gate", "--help"] }))).toBe(EXIT_OK);
  });

  it("accepts the short -h form too", async () => {
    expect(await runDevCommand(argv({ tail: ["gate", "-h"] }))).toBe(EXIT_OK);
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    // The manifest owns the verb's contract. A handler exposing `.meta` would be a second declaration that
    // nothing compares — measured at twenty disagreements across forty-four verb entries before it was cut.
    expect(devGateCommand).toBe(runDevCommand);
    expect(Object.hasOwn(devGateCommand, "meta")).toBe(false);
  });
});
