import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lapRunsDirectory, readLapReceipts } from "../../../../../cli/commands/github/lapReceipts.js";

const ARGS = {
  acknowledge: undefined,
  dryRun: false,
  home: undefined,
  land: true,
  landOnly: true,
  number: 7,
  owner: "o",
  repo: "r",
};

let homes: string[] = [];
afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** Write one run directory's `lap.json` under a fresh home. */
function runWith({ home, run, body }: { home: string; run: string; body: string }): void {
  const dir = join(lapRunsDirectory({ args: ARGS, home }), run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lap.json"), body);
}

describe("readLapReceipts", () => {
  it("reads back each run's receipt, and leaves out a run with a malformed or missing one", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-lap-receipts-"));
    homes.push(home);
    const receipt = {
      baseTip: "b",
      environmentKeys: ["CI"],
      headSha: "h",
      outcomes: [{ context: "build", exitCode: 0, id: "lint", wallMs: 5 }],
      phase: "finished",
      plan: [{ argv: ["yarn", "lint"], directory: undefined, id: "lint" }],
      startedIso: "2026-11-10T00:00:00.000Z",
      subject: "o/r#7",
    };
    runWith({ body: JSON.stringify(receipt), home, run: "a" });
    runWith({ body: "{not json", home, run: "b" });
    mkdirSync(join(lapRunsDirectory({ args: ARGS, home }), "c"));
    expect(readLapReceipts({ args: ARGS, home })).toEqual([
      {
        baseTip: "b",
        headSha: "h",
        outcomes: [{ exitCode: 0, id: "lint" }],
        phase: "finished",
        plan: ['["lint",["yarn","lint"],null]'],
      },
    ]);
  });

  it("reads nothing for a pull request no lap ever ran", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-lap-receipts-"));
    homes.push(home);
    expect(readLapReceipts({ args: ARGS, home })).toEqual([]);
  });
});
