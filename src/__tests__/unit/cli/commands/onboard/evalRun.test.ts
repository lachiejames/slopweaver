import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runOnboardEval } from "../../../../../cli/commands/onboard/evalRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "onboard-eval-run-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const VALID_RUN = {
  finishedAt: "2026-08-29T00:20:00Z",
  notes: "",
  onboardSkillCommit: "deadbeef",
  runId: "run-1",
  startedAt: "2026-08-29T00:00:00Z",
  steps: [
    {
      durationSeconds: 5,
      guessNote: null,
      guessed: false,
      id: "1-scaffold",
      instructionClear: true,
      outcome: "ok",
      outcomeDetail: "worked as documented",
      skillRef: "skills/onboard/SKILL.md § 1",
      verb: "slopweaver init",
      verbPresent: true,
    },
  ],
};

describe("runOnboardEval", () => {
  it("prints usage and exits clean on --help", () => {
    expect(runOnboardEval(["node", "slopweaver", "onboard", "eval", "--help"])).toBe(EXIT_OK);
  });

  it("prints the schema and exits clean on --schema", () => {
    expect(runOnboardEval(["node", "slopweaver", "onboard", "eval", "--schema"])).toBe(EXIT_OK);
  });

  it("refuses when --run is missing", () => {
    expect(runOnboardEval(["node", "slopweaver", "onboard", "eval"])).toBe(EXIT_USAGE);
  });

  it("fails when the run file does not exist", () => {
    expect(runOnboardEval(["node", "slopweaver", "onboard", "eval", "--run", "/no/such/file.json"])).toBe(EXIT_ERROR);
  });

  it("scores a real run file, records history, and files the top finding as a board doc", () => {
    const runDir = tempDir();
    const evalHome = tempDir();
    const runPath = join(runDir, "run.json");
    writeFileSync(runPath, JSON.stringify(VALID_RUN), "utf8");
    const exitCode = runOnboardEval([
      "node",
      "slopweaver",
      "onboard",
      "eval",
      "--run",
      runPath,
      "--eval-home",
      evalHome,
      "--json",
    ]);
    expect(exitCode).toBe(EXIT_OK);
    expect(readFileSync(join(evalHome, "onboard-eval", "reports.jsonl"), "utf8")).toContain('"runId":"run-1"');
  });
});
