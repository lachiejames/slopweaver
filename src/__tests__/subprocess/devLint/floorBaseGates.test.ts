/**
 * The three diff gates whose whole verdict depends on `SLOPWEAVER_COVERAGE_BASE_SHA`, run as the real entries
 * `yarn lint` spawns: with no base they FAIL and print the command that supplies one, a brand-new ref's all-zeroes
 * base passes and says no comparison was made, and a short SHA fails with the command that expands it.
 *
 * A subprocess test because the property is the entry's exit code and which stream the line lands on — the two
 * things a lane reads — and both are decided by `runGateEntry` ending the process. `coverage-ratchet` and
 * `heap-ceiling-ratchet` take an injected root and env, so their halves are pinned in-process by
 * `coverageRatchetShell.test.ts` and `heapCeilingRatchetShell.test.ts` instead.
 *
 * Every case here is decided before the gate reads a single file at the base, so the entries run against this
 * checkout read-only.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FLOOR_BASE_ENV, resolveFloorBase } from "../../../devLint/gitAtCommit.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The TypeScript loader, handed to `node` directly — `../lib/stdoutDataChannel.test.ts` § TSX_LOADER. */
const TSX_LOADER = import.meta.resolve("tsx");

/** A deadline rather than a request: an entry that never exits fails loudly instead of hanging the lane. */
const ENTRY_DEADLINE_MS = 60_000;

const SHORT_SHA = "abc1234";

const ZERO_SHA = "0".repeat(40);

/** The reason text each case's base resolves to — `../../unit/devLint/gitAtCommit.test.ts` pins every word of it. */
function reasonFor({ value }: { value: string | undefined }): string {
  const env: NodeJS.ProcessEnv = {};
  if (value !== undefined) {
    env[FLOOR_BASE_ENV] = value;
  }
  const base = resolveFloorBase({ env });
  if (base.kind === "sha") {
    throw new Error(`fixture value ${String(value)} resolved to a usable SHA`);
  }
  return base.reason;
}

/**
 * Run one gate's entry with the base variable set to `value`, or removed when `value` is undefined.
 *
 * @returns the exit status and both streams
 */
function runEntry({ entry, value }: { entry: string; value: string | undefined }): {
  status: number | null;
  stderr: string;
  stdout: string;
} {
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  delete env[FLOOR_BASE_ENV];
  if (value !== undefined) {
    env[FLOOR_BASE_ENV] = value;
  }
  const child = spawnSync(process.execPath, ["--import", TSX_LOADER, join(repoRoot, "src", "devLint", entry)], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    killSignal: "SIGKILL",
    timeout: ENTRY_DEADLINE_MS,
  });
  return { status: child.status, stderr: child.stderr, stdout: child.stdout };
}

const RUNNER_GATES = [
  { entry: "hostWording.entry.ts", gate: "host-wording" },
  { entry: "testEnshittification.entry.ts", gate: "test-enshittification" },
] as const;

describe("a diff gate run with no usable base", { timeout: ENTRY_DEADLINE_MS * 2 }, () => {
  it.each(RUNNER_GATES)("$gate fails with no base and prints the command that supplies one", ({ entry, gate }) => {
    expect(runEntry({ entry, value: undefined })).toEqual({
      status: 1,
      stderr: `${gate}: ${reasonFor({ value: undefined })}\n`,
      stdout: "",
    });
  });

  it.each(RUNNER_GATES)(
    "$gate passes a brand-new ref's all-zeroes base and says nothing was compared",
    ({ entry, gate }) => {
      expect(runEntry({ entry, value: ZERO_SHA })).toEqual({
        status: 0,
        stderr: `${gate}: ${FLOOR_BASE_ENV} is all zeroes — this ref has no previous commit — no comparison made\n`,
        stdout: "",
      });
    },
  );

  it.each(RUNNER_GATES)("$gate fails a short SHA and prints the command that expands it", ({ entry, gate }) => {
    expect(runEntry({ entry, value: SHORT_SHA })).toEqual({
      status: 1,
      stderr: `${gate}: ${reasonFor({ value: SHORT_SHA })}\n`,
      stdout: "",
    });
  });

  it("baseline-against-main fails with no base and prints the command that supplies one", () => {
    expect(runEntry({ entry: "baselineAgainstMain.entry.ts", value: undefined })).toEqual({
      status: 1,
      stderr: `baseline-against-main: ${reasonFor({ value: undefined })}\n`,
      stdout: "",
    });
  });

  it("baseline-against-main skips a brand-new ref's all-zeroes base on stdout", () => {
    expect(runEntry({ entry: "baselineAgainstMain.entry.ts", value: ZERO_SHA })).toEqual({
      status: 0,
      stderr: "",
      stdout: `baseline-against-main: skipped — ${FLOOR_BASE_ENV} is all zeroes — this ref has no previous commit\n`,
    });
  });

  it("baseline-against-main fails a short SHA and prints the command that expands it", () => {
    expect(runEntry({ entry: "baselineAgainstMain.entry.ts", value: SHORT_SHA })).toEqual({
      status: 1,
      stderr: `baseline-against-main: ${reasonFor({ value: SHORT_SHA })}\n`,
      stdout: "",
    });
  });
});
