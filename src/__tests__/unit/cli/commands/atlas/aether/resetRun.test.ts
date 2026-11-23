/**
 * `atlas aether reset`'s branches that end BEFORE the reset is attempted: help succeeds, and a missing or
 * wrong `--confirm archive` or an unknown flag is a usage refusal. None of these reaches the home, the clock or
 * the filesystem — the reset core itself is covered by `unit/atlas/aether/reset.test.ts` over a temp home.
 * Exit codes are asserted as literals, because a harness reads the number, not the constant's name.
 */
import { describe, expect, it } from "vitest";

import {
  AETHER_RESET_USAGE,
  aetherResetCommand,
  runAetherReset,
} from "../../../../../../cli/commands/atlas/aether/resetRun.js";

/** The full process argv the router hands the verb, ending in the given tail. */
const argvWith = ({ tail }: { tail: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "atlas",
  "aether",
  "reset",
  ...tail,
];

describe("runAetherReset", () => {
  it("states its usage literally", () => {
    expect(AETHER_RESET_USAGE).toBe("usage: slopweaver atlas aether reset --confirm archive [--json] [--home <dir>]");
  });

  it("is the run function the command declaration carries", () => {
    expect(aetherResetCommand).toBe(runAetherReset);
  });

  it("answers --help with exit 0", () => {
    expect(runAetherReset(argvWith({ tail: ["--help"] }))).toBe(0);
  });

  it("answers -h with exit 0, even beside an otherwise-complete confirmation", () => {
    expect(runAetherReset(argvWith({ tail: ["--confirm", "archive", "-h"] }))).toBe(0);
  });

  it("refuses a run with no --confirm as a usage error, exit 2", () => {
    expect(runAetherReset(argvWith({ tail: [] }))).toBe(2);
  });

  it("refuses a --confirm value other than archive as a usage error, exit 2", () => {
    expect(runAetherReset(argvWith({ tail: ["--confirm", "yes"] }))).toBe(2);
  });

  it("refuses an unknown flag as a usage error even beside a valid confirmation, exit 2", () => {
    expect(runAetherReset(argvWith({ tail: ["--confirm", "archive", "--force"] }))).toBe(2);
  });
});
