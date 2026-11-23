import { describe, expect, it, vi } from "vitest";

import { doorCoverageCommand, runDoorCoverage } from "../../../../../cli/commands/dev/doorCoverage.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";

/**
 * A generous per-test timeout: two cases below run the REAL `coverageReport()` whole-repo scan (git
 * `ls-files` plus a read of every seam file), not a synthetic fixture — measured at ~10s under load against
 * the default 5s, which turned an honest gate into a load-sensitive flake. The scan now reads its files
 * concurrently and skips the per-line pass over a file naming no seam, but its cost still scales with what it
 * inventories, so the budget keeps its margin over the default.
 */
vi.setConfig({ testTimeout: 20_000 });

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "dev", ...tail];
}

describe("runDoorCoverage", () => {
  it("exits OK on --help", async () => {
    expect(await runDoorCoverage(argv({ tail: ["door-coverage", "--help"] }))).toBe(EXIT_OK);
  });

  it("reports a clean repository as OK", async () => {
    expect(await runDoorCoverage(argv({ tail: ["door-coverage"] }))).toBe(EXIT_OK);
  });

  it("reports the same verdict in JSON mode", async () => {
    expect(await runDoorCoverage(argv({ tail: ["door-coverage", "--json"] }))).toBe(EXIT_OK);
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    expect(doorCoverageCommand).toBe(runDoorCoverage);
    expect(Object.hasOwn(doorCoverageCommand, "meta")).toBe(false);
  });
});
