/**
 * The checks-read gate, run as the SHIPPED verb over a throwaway home.
 *
 * The unit lane already proves `checksReadGateRefuses` and the register in isolation. What only a real
 * `bin/slopweaver handover finish` can prove is that the gate is actually WIRED — that a run with an
 * outstanding raise cannot be closed, and that appending a read row is what lets it close. A pull request
 * once sat red because nobody looked, and a gate nothing calls would reproduce that exactly while every unit
 * test stayed green.
 *
 * Two things about the fixture are deliberate. The register is written by hand rather than by `github
 * checks`, because a real read needs GitHub and this lane reaches no network — the ROW is the contract, and
 * `../../../../../unit/outbound/github/checksReadLedger.test.ts` is what proves the writers produce it. And
 * `SLOPWEAVER_ALLOW_NO_LESSONS=1` is set on every invocation: the lessons gate is asked first and reaches
 * the memories store, so without it this test would fail on a missing database instead of on what it tests.
 *
 * `SLOPWEAVER_CLI_DIR` is set for the reason `./auditRulings.test.ts` gives: `bin/slopweaver` otherwise
 * resolves its checkout from an ambient `PLUGIN_ROOT`, so a proof run from a worktree would silently
 * exercise the main checkout instead.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const SLUG = "checks-read-probe";
const BRANCH = "checks-read-probe-branch";
const REPO = "acme/acme-admin";
const NUMBER = 16415;
const HEAD = "46cf2efe65";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home carrying one ready doc, with an open run on {@link BRANCH}. */
function startedRun(): { home: string; handoverDir: string } {
  const home = mkdtempSync(join(tmpdir(), "checks-read-"));
  homes.push(home);
  const handoverDir = join(home, "handovers");
  mkdirSync(handoverDir, { recursive: true });
  mkdirSync(join(home, "ledgers"), { recursive: true });
  writeFileSync(
    join(handoverDir, `${SLUG}.md`),
    [
      "---",
      `slug: ${SLUG}`,
      'summary: "a run that raised a pull request"',
      "status: ready",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      'probeWaiver: "fixture for the checks-read gate"',
      "---",
      "",
      "# a run that raised a pull request",
      "",
    ].join("\n"),
  );
  run({ args: ["handover", "start", SLUG, "--branch", BRANCH], handoverDir, home });
  return { handoverDir, home };
}

/** One register row, appended exactly as the shipped writers would append it. */
function record({ home, row }: { home: string; row: Record<string, unknown> }): void {
  appendFileSync(join(home, "ledgers", "pr-checks-read.jsonl"), `${JSON.stringify(row)}\n`);
}

/** Run the real binary against the fixture home and return everything it said. */
function run({ args, home, handoverDir }: { args: readonly string[]; home: string; handoverDir: string }): {
  status: number | null;
  output: string;
} {
  const result = spawnSync(BIN, [...args, "--home", home, "--dir", handoverDir], {
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_ALLOW_NO_LESSONS: "1",
      SLOPWEAVER_CLI_DIR: repoRoot,
      TMPDIR: process.env["TMPDIR"]!,
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  // `status` is null only when the child was killed by a signal, which nothing here does — the assertions
  // read it directly rather than substituting a sentinel that would read as a real exit code.
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

describe("handover finish, against an outstanding checks-read obligation", () => {
  it("refuses to close a run whose branch raised a pull request nothing has read, and names the command", () => {
    const { home, handoverDir } = startedRun();
    record({
      home,
      row: {
        atIso: "2026-08-31T05:00:00.000Z",
        branch: BRANCH,
        headSha: HEAD,
        kind: "raised",
        number: NUMBER,
        repo: REPO,
      },
    });

    const refused = run({ args: ["handover", "finish", SLUG], handoverDir, home });

    expect(refused.status).toBe(1);
    expect(refused.output).toContain("1 pull request(s) raised on this branch have never had their checks read");
    expect(refused.output).toContain(`slopweaver github checks --repo ${REPO} --number ${String(NUMBER)} --wait`);
    expect(refused.output).toContain("SLOPWEAVER_ALLOW_UNREAD_CHECKS=1");
  });

  it("closes the same run once a read row discharges the raise", () => {
    const { home, handoverDir } = startedRun();
    record({
      home,
      row: {
        atIso: "2026-08-31T05:00:00.000Z",
        branch: BRANCH,
        headSha: HEAD,
        kind: "raised",
        number: NUMBER,
        repo: REPO,
      },
    });
    record({
      home,
      row: {
        atIso: "2026-08-31T06:00:00.000Z",
        headSha: HEAD,
        kind: "read",
        number: NUMBER,
        repo: REPO,
        rollup: "SUCCESS",
      },
    });

    const closed = run({ args: ["handover", "finish", SLUG], handoverDir, home });

    expect(closed.output).not.toContain("never had their checks read");
    expect(closed.output).toContain(SLUG);
  });

  it("never asks a branch that raised nothing", () => {
    const { home, handoverDir } = startedRun();
    record({
      home,
      row: {
        atIso: "2026-08-31T05:00:00.000Z",
        branch: "somebody-elses-branch",
        headSha: HEAD,
        kind: "raised",
        number: NUMBER,
        repo: REPO,
      },
    });

    const closed = run({ args: ["handover", "finish", SLUG], handoverDir, home });

    expect(closed.output).not.toContain("never had their checks read");
  });
});
