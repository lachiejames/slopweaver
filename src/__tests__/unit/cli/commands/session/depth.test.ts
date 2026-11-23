/**
 * `session depth` — the CLI edge's flag handling against a real, empty state home.
 *
 * The join and the fold are covered exhaustively as pure functions (`sessions/depthReport.test.ts`,
 * `sessions/tokenDepth.test.ts`); what is left here is the parse/usage surface, which is all this edge owns
 * that does not need a live cmux socket.
 */
import { describe, expect, it } from "vitest";

import { runSessionDepth } from "../../../../../cli/commands/session/depth.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** Build an argv the router would hand a verb: `[node, cli, session, depth, …rest]`. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "session", "depth", ...rest];
}

describe("runSessionDepth", () => {
  it("prints usage on --help without touching disk", async () => {
    expect(await runSessionDepth(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("prints usage on -h", async () => {
    expect(await runSessionDepth(argv({ rest: ["-h"] }))).toBe(EXIT_OK);
  });

  it("rejects a flag it does not know", async () => {
    expect(await runSessionDepth(argv({ rest: ["--nope"] }))).toBe(EXIT_USAGE);
  });

  it("rejects a threshold that is not a whole number", async () => {
    expect(await runSessionDepth(argv({ rest: ["--threshold", "lots"] }))).toBe(EXIT_USAGE);
  });

  it("rejects a negative threshold", async () => {
    expect(await runSessionDepth(argv({ rest: ["--threshold", "-1"] }))).toBe(EXIT_USAGE);
  });
});
