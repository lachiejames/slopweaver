/**
 * `cmux takeover` — every case here is a parse, a usage line, or `--help`, reached BEFORE the verb touches a
 * live `cmux` socket. The gate logic itself is pure, tested against `src/__tests__/unit/cmux/takeover.test.ts`
 * with no socket at all; gate (a)'s transcript leg is tested against a real temporary projects directory in
 * `./takeoverTranscript.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { runCmuxTakeover } from "../../../../../cli/commands/cmux/takeover.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** Build an argv the router would hand a verb: `[node, cli, noun, verb, …rest]`. */
function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "cmux", verb, ...rest];
}

describe("cmux takeover", () => {
  it("prints usage on --help without touching cmux", async () => {
    expect(await runCmuxTakeover(argv({ rest: ["--help"], verb: "takeover" }))).toBe(EXIT_OK);
  });

  it("rejects a flag takeover does not accept", async () => {
    expect(await runCmuxTakeover(argv({ rest: ["--nope"], verb: "takeover" }))).toBe(EXIT_USAGE);
  });
});
