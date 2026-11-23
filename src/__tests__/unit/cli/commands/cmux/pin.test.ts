/**
 * `cmux pin` / `cmux unpin` — every case here is a parse, a usage line, or `--help`, reached BEFORE the verb
 * touches a live `cmux` socket. The collision refusal itself is pure logic, tested against
 * `src/__tests__/unit/cmux/pin.test.ts` with no socket at all.
 */
import { describe, expect, it } from "vitest";

import { runCmuxPin, runCmuxUnpin } from "../../../../../cli/commands/cmux/pin.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** Build an argv the router would hand a verb: `[node, cli, noun, verb, …rest]`. */
function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "cmux", verb, ...rest];
}

describe("cmux pin", () => {
  it("prints usage on --help without touching cmux", async () => {
    expect(await runCmuxPin(argv({ rest: ["--help"], verb: "pin" }))).toBe(EXIT_OK);
  });

  it("rejects a flag pin does not accept", async () => {
    expect(await runCmuxPin(argv({ rest: ["--nope"], verb: "pin" }))).toBe(EXIT_USAGE);
  });
});

describe("cmux unpin", () => {
  it("prints usage on --help without touching cmux", async () => {
    expect(await runCmuxUnpin(argv({ rest: ["--help"], verb: "unpin" }))).toBe(EXIT_OK);
  });

  it("rejects a flag unpin does not accept", async () => {
    expect(await runCmuxUnpin(argv({ rest: ["--nope"], verb: "unpin" }))).toBe(EXIT_USAGE);
  });
});
