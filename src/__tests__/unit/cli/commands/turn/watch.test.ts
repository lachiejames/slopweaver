import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { endsWatch, runTurnWatch } from "../../../../../cli/commands/turn/watch.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** The argv the router hands the verb: `[node, cli, turn, watch, …]`. */
const argv = (...rest: string[]): readonly string[] => ["node", "slopweaver", "turn", "watch", ...rest];

describe("endsWatch", () => {
  it("keeps ticking over a posted plan, whose worker is still building, and stops on the final answer", () => {
    expect(endsWatch({ state: "first-answered" })).toBe(false);
    expect(endsWatch({ state: "answered" })).toBe(true);
  });
});

describe("runTurnWatch", () => {
  let home: string | undefined;
  afterEach(() => {
    if (home !== undefined) {
      rmSync(home, { force: true, recursive: true });
      home = undefined;
    }
  });

  it("prints its usage and exits 0 on --help", async () => {
    expect(await runTurnWatch(argv("--help"))).toBe(EXIT_OK);
  });

  it("refuses a flag it does not know before any effect", async () => {
    expect(await runTurnWatch(argv("--interval", "5"))).toBe(EXIT_USAGE);
  });

  it("refuses a run with no --brief as a usage error", async () => {
    home = mkdtempSync(join(tmpdir(), "turn-watch-"));
    expect(await runTurnWatch(argv("--home", home))).toBe(EXIT_USAGE);
  });

  it("fails on a brief that is not there, before it claims the card", async () => {
    home = mkdtempSync(join(tmpdir(), "turn-watch-"));
    expect(await runTurnWatch(argv("--home", home, "--brief", join(home, "absent.json")))).toBe(EXIT_ERROR);
  });
});
