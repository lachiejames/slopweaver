import { describe, expect, it } from "vitest";

import { runAtlasProbeCommand } from "../../../../../cli/commands/atlas/probeRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/**
 * The argv this runner is handed, with the four leading tokens it slices past.
 *
 * `runAtlasProbeCommand` takes the WHOLE process argv, so a test that passed only the flags would be
 * testing a different offset from the one the router uses.
 */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "atlas", "probe", ...rest];
}

describe("runAtlasProbeCommand — the paths that return before a connection is opened", () => {
  it("prints the usage on --help and succeeds, reaching no database", async () => {
    expect(await runAtlasProbeCommand(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("takes the short -h too", async () => {
    expect(await runAtlasProbeCommand(argv({ rest: ["-h"] }))).toBe(EXIT_OK);
  });

  // No keyword is the SCOPE mode, not a refusal, so the no-keyword case is not a pre-connection path at
  // all and cannot be asserted here — `unit/cli/atlasProbeCore.test.ts` carries it on the parser instead.
  it("refuses an unknown flag as a CALLER mistake, before opening anything", async () => {
    expect(await runAtlasProbeCommand(argv({ rest: ["--nope"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a --cells that is not a whole number of at least 1", async () => {
    expect(await runAtlasProbeCommand(argv({ rest: ["airtable", "--cells", "0"] }))).toBe(EXIT_USAGE);
  });

  it("slices past exactly the four leading tokens, so a keyword is never eaten as the verb", async () => {
    // `--help` in the keyword position proves the offset: at any other offset it would be a positional
    // keyword and this would try to connect instead of returning EXIT_OK.
    expect(await runAtlasProbeCommand(argv({ rest: ["--help", "airtable"] }))).toBe(EXIT_OK);
  });
});
