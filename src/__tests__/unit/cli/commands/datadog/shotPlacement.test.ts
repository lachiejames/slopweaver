/**
 * `datadog shot --out` refuses a directory a checkout could carry before any sub-verb runs. `file` without
 * `--image` is a usage refusal otherwise, so the exit code alone tells the two answers apart.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runDatadogShot } from "../../../../../cli/commands/datadog/shotRun.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh canonical scratch directory. */
function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "datadog-shot-placement-")));
  fixtureDirs.push(dir);
  return dir;
}

describe("datadog shot --out placement", () => {
  it("refuses an --out inside a checkout before the sub-verb runs", async () => {
    const dir = scratch();
    gitInTemp({ args: ["init", "-q"], cwd: dir });
    expect(
      await runDatadogShot(["node", "slopweaver", "datadog", "shot", "file", "--out", join(dir, "screenshots")]),
    ).toBe(EXIT_ERROR);
  });

  it("lets an --out outside every checkout reach the sub-verb", async () => {
    const dir = scratch();
    expect(await runDatadogShot(["node", "slopweaver", "datadog", "shot", "file", "--out", join(dir, "shots")])).toBe(
      EXIT_USAGE,
    );
  });
});
