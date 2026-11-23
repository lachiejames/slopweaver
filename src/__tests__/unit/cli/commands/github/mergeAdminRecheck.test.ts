/**
 * The last steps of `github merge --admin` before its mutation, each called directly over the plain-fake harness:
 * the refusal printer and the dry run's answer, which asks the REAL door without recording in it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminMergeDoorRequest } from "../../../../../cli/commands/github/mergeAdminCore.js";
import { answerDryRun, refuseAdminMerge } from "../../../../../cli/commands/github/mergeAdminRecheck.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { adminMergeHarness, adminMergePr } from "../../../../mergeAdminRunFixture.js";
import { expectedHoldRefusal, withProfileHold } from "../../../../profileHoldFixture.js";

let home: string;
let door: MemoryDoorLedger;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-admin-recheck-"));
  door = memoryDoorLedger();
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("refuseAdminMerge", () => {
  it("prints every line after `refused: ` and exits with the error code", () => {
    const h = adminMergeHarness({ door });
    expect(refuseAdminMerge({ deps: h.deps, lines: ["first", "second"] })).toBe(EXIT_ERROR);
    expect(h.lines).toEqual(["refused: first", "refused: second"]);
  });
});

describe("answerDryRun", () => {
  it("says what it would merge when the door would admit it, and records nothing", () => {
    const h = adminMergeHarness({ door });
    const doorRequest = adminMergeDoorRequest({ acknowledgement: undefined, home, number: 21, repo: "o/n" });
    const code = answerDryRun({ deps: h.deps, doorRequest, home, pr: adminMergePr() });
    expect(code).toBe(EXIT_OK);
    expect(h.lines).toEqual([
      "would merge #21 into main as a squash through the administrator bypass; dry-run wrote nothing.",
    ]);
    expect(door.records()).toEqual([]);
    expect(h.merges).toEqual([]);
  });

  it("refuses with the door's own hold lines when the door would hold the write", async () => {
    const h = adminMergeHarness({ door });
    const doorRequest = adminMergeDoorRequest({ acknowledgement: undefined, home, number: 21, repo: "o/n" });
    const { result: code, decision } = await withProfileHold({
      home,
      run: () => Promise.resolve(answerDryRun({ deps: h.deps, doorRequest, home, pr: adminMergePr() })),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(decision.findings.map((finding) => finding.code)).toEqual(["PROFILE_NOT_LOADED"]);
    expect(h.lines).toEqual(
      expectedHoldRefusal({ command: "slopweaver github merge --admin", decision }).map((line) => `refused: ${line}`),
    );
    expect(door.records()).toEqual([]);
  });
});
