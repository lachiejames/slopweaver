/**
 * The flags of a `fleet` verb that takes no positional argument: parsed, or the exit code the invocation already ended
 * on — help answered, a positional or an unknown flag refused as usage.
 */
import { describe, expect, it } from "vitest";

import { fleetFlagsOnly } from "../../../../../cli/commands/fleet/flagsOnly.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** The argv a verb receives. */
function argvOf({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "fleet", "recover", ...rest];
}

describe("fleetFlagsOnly", () => {
  it("parses a declared flag", () => {
    const parsed = fleetFlagsOnly({ argv: argvOf({ rest: ["--home", "/h"] }), verb: "recover" });
    expect(parsed).toEqual({ positionals: [], values: { home: "/h" } });
  });

  it("answers help with 0, before parsing anything else", () => {
    expect(fleetFlagsOnly({ argv: argvOf({ rest: ["--nope", "-h"] }), verb: "recover" })).toBe(EXIT_OK);
  });

  it("refuses a positional argument as usage", () => {
    expect(fleetFlagsOnly({ argv: argvOf({ rest: ["now"] }), verb: "recover" })).toBe(EXIT_USAGE);
  });

  it("refuses a flag the verb does not declare as usage", () => {
    expect(fleetFlagsOnly({ argv: argvOf({ rest: ["--json"] }), verb: "recover" })).toBe(EXIT_USAGE);
  });
});
