/**
 * `slopweaver velocity` end to end, against the real SHIPPED `bin/slopweaver` binary — the same pattern
 * `cli/commands/connect/fixture.test.ts` uses, so real stdout is captured the normal way rather than
 * fighting `logger.out`'s synchronous `writeSync(1, …)` from inside this process. The fixture is a real
 * repository (via `gitInTemp`, the only sanctioned door — `src/__tests__/tempGitRepo.ts`) plus a real
 * `$SLOPWEAVER_HOME`, built with the SAME writers production code uses (`appendRunEvent`,
 * `appendAskLifecycleEvent`) rather than hand-typed JSON, so the fixture can never drift from what a real
 * run/ask actually writes.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { appendRunEvent } from "../../../handover/runStore.js";
import { appendAskLifecycleEvent } from "../../../live/ask/store.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
}

function freshRepo(): string {
  const dir = freshDir({ prefix: "slopweaver-velocity-run-repo-" });
  gitInTemp({ args: ["init", "-b", "main"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  writeFileSync(join(dir, "a.txt"), "x");
  gitInTemp({ args: ["add", "."], cwd: dir });
  gitInTemp({ args: ["commit", "-m", "feat(x): thing (#1)"], cwd: dir });
  writeFileSync(join(dir, "b.txt"), "x");
  gitInTemp({ args: ["add", "."], cwd: dir });
  gitInTemp({ args: ["commit", "-m", "docs: not a merge"], cwd: dir });
  return dir;
}

/**
 * Run the shipped binary with a minimal, isolated environment — never the real machine's config/tokens —
 * capturing BOTH streams regardless of exit code (`execFileSync` discards stderr on a clean exit).
 */
function runVelocityBin({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: { ...accountSandboxChildEnv(), HOME: tmpdir(), PATH: process.env["PATH"]! },
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("bin/slopweaver velocity", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("wires git merges, a clean doc landing and an ask's turns into one --json report", () => {
    const repo = freshRepo();
    const home = freshDir({ prefix: "slopweaver-velocity-run-home-" });

    const nowMs = Date.now();
    const startedIso = new Date(nowMs - 3 * 60 * 60 * 1000).toISOString();
    const finishedIso = new Date(nowMs - 1 * 60 * 60 * 1000).toISOString();
    appendRunEvent({
      event: { atIso: startedIso, branch: "feat/x", docHash: "abc123", kind: "started" },
      runsDir: `${home}/runs`,
      slug: "velocity-fixture-doc",
    });
    appendRunEvent({
      event: { atIso: finishedIso, kind: "finished", residue: [] },
      runsDir: `${home}/runs`,
      slug: "velocity-fixture-doc",
    });

    const identity = { channel: "C1", messageTs: "1.1", threadTs: "1.1" };
    appendAskLifecycleEvent({
      event: { ...identity, kind: "captured", surface: "channel", tsIso: startedIso, userId: "U1" },
      home,
    });
    appendAskLifecycleEvent({
      event: {
        ...identity,
        decision: {
          confidence: "high",
          needs: [],
          rationale: "context alone",
          response: "respond",
          schemaVersion: 1,
          tier: "inline",
          truthMode: "none",
        },
        kind: "dispatched",
        leaseExpiresAt: finishedIso,
        tier: "inline",
        tsIso: startedIso,
      },
      home,
    });
    appendAskLifecycleEvent({
      event: { ...identity, answerTs: "9999.1", kind: "answered", tsIso: finishedIso },
      home,
    });

    // --days 2, not 1: `startedIso`/`finishedIso` are hours before "now", which can fall on the PREVIOUS
    // UTC calendar day when the test runs soon after UTC midnight — a 1-day window would then miss them.
    const result = runVelocityBin({
      args: ["velocity", "--repo", repo, "--home", home, "--days", "2", "--json"],
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(report["mergesTotal"]).toBe(1);
    expect(report["docsLandedTotal"]).toBe(1);
    expect(report["medianDocLatencyHours"]).toBe(2);
    expect(report["meanTurnsPerAsk"]).toBe(1);
    expect(report["askSampleSize"]).toBe(1);
  });

  it("reports zeros over a home with no journals or asks yet, without writing anything into it", () => {
    const repo = freshRepo();
    const home = freshDir({ prefix: "slopweaver-velocity-run-empty-home-" });

    const result = runVelocityBin({ args: ["velocity", "--repo", repo, "--home", home, "--days", "1", "--json"] });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(report["docsLandedTotal"]).toBe(0);
    expect(report["askSampleSize"]).toBe(0);
    expect(readdirSync(home)).toEqual([]);
  });

  it("prints the human report, carrying the caution, on the bare (non-JSON) form", () => {
    const repo = freshRepo();
    const home = freshDir({ prefix: "slopweaver-velocity-run-human-home-" });

    const result = runVelocityBin({ args: ["velocity", "--repo", repo, "--home", home, "--days", "1"] });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('"faster does not necessarily equal better"');
    expect(result.stderr).toContain("PRs merged: 1 total");
  });
});
