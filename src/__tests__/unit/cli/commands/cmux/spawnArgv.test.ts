/**
 * `resolveSpawnArgv` — every `cmux spawn` refusal that needs the argv alone. None of these reads the plan register,
 * so the unit sandbox, which has no store, answers each one as a usage error rather than the store's error.
 */
import { describe, expect, it } from "vitest";

import { resolveSpawnArgv } from "../../../../../cli/commands/cmux/spawnArgv.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** Build an argv the router would hand the verb: `[node, cli, cmux, spawn, …rest]`. */
function spawnArgv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "cmux", "spawn", ...rest];
}

describe("resolveSpawnArgv", () => {
  it("refuses a missing slug, a missing --model, a bad --effort and a --timeout-seconds with no --wait", () => {
    const refusals = [
      [],
      ["a-doc"],
      ["a-doc", "--model", "sonnet", "--effort", "nonsense"],
      ["a-doc", "--model", "sonnet", "--timeout-seconds", "10"],
    ].map((rest) => resolveSpawnArgv({ argv: spawnArgv({ rest }) }));
    expect(refusals).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
  });

  it("settles the slug, the model and the passed effort when every flag is well formed", () => {
    const settled = resolveSpawnArgv({ argv: spawnArgv({ rest: ["a-doc", "--model", "sonnet", "--effort", "high"] }) });
    // A refusal is a number, whose destructured fields are undefined, so the equality below fails on one.
    const { argvPins, slug } = settled as Exclude<typeof settled, number>;
    expect({ argvPins, slug }).toEqual({ argvPins: { effort: "high", model: "sonnet" }, slug: "a-doc" });
  });
});
