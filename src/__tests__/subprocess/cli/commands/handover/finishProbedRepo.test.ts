/**
 * `handover finish --probed-repo` and `--probed-tree`, run as the SHIPPED verb over a throwaway home.
 *
 * `handover wake` proves a merge in one tree and then asks finish, which re-reads the doc and re-classifies its own
 * working directory. The unit lane proves `probedRepoMoved` and `parseProbedTree` in isolation; what only the real
 * binary proves is that both flags are parsed and WIRED ahead of the `finished` append — a doc rewritten, or a
 * worktree path retargeted, between the wake's proof and finish's read must not close the run over a tree nobody
 * proved. Each case also closes the same run once the binding matches, so the
 * refusal is the flag's doing and not some other gate's.
 *
 * `SLOPWEAVER_ALLOW_NO_LESSONS=1` and `SLOPWEAVER_CLI_DIR` are set for the reasons `./checksReadGate.test.ts` gives.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const SLUG = "probed-repo-probe";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * Run the real binary against the fixture home, standing in the home itself — no checkout, so finish classifies its
 * probes onto the doc's `repo:`.
 *
 * @returns the exit status and everything the binary printed
 */
function run({ args, home, handoverDir }: { args: readonly string[]; home: string; handoverDir: string }): {
  status: number | null;
  output: string;
} {
  const result = spawnSync(BIN, [...args, "--home", home, "--dir", handoverDir], {
    cwd: home,
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
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

/**
 * A home carrying one ready doc with an open run: with `repo` set, the doc names that checkout and probes for
 * `done.txt`, which the caller writes once the run is open (start refuses a doc whose probes already pass); without,
 * it names no `repo:` and carries no probe.
 *
 * @returns the home and its handover directory
 */
function startedRun({ repo }: { repo: string | undefined }): { home: string; handoverDir: string } {
  const home = mkdtempSync(join(tmpdir(), "probed-repo-"));
  homes.push(home);
  const handoverDir = join(home, "handovers");
  mkdirSync(handoverDir, { recursive: true });
  const probed = repo === undefined ? ["doneWhen: []"] : [`repo: ${repo}`, "doneWhen:", "  - path: done.txt"];
  writeFileSync(
    join(handoverDir, `${SLUG}.md`),
    [
      "---",
      `slug: ${SLUG}`,
      'summary: "a run the wake proved somewhere"',
      "status: ready",
      "blockedBy: []",
      "artifact: null",
      ...probed,
      'probeWaiver: "fixture for the probed-repo binding"',
      "---",
      "",
      "# a run the wake proved somewhere",
      "",
    ].join("\n"),
  );
  const started = run({ args: ["handover", "start", SLUG], handoverDir, home });
  expect(started.status).toBe(0);
  return { handoverDir, home };
}

/**
 * A committed checkout the doc names, not yet holding the `done.txt` its probe reads.
 *
 * @returns the checkout's directory
 */
function docRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "probed-repo-doc-"));
  homes.push(dir);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: dir });
  writeFileSync(join(dir, "a.txt"), "a\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "base"], cwd: dir });
  return dir;
}

describe("handover finish bound to the tree a caller proved", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("refuses a run whose doc no longer names the repo the caller proved, then closes it without the flag", () => {
    const { home, handoverDir } = startedRun({ repo: undefined });
    const refused = run({ args: ["handover", "finish", SLUG, "--probed-repo", "/repo/acme"], handoverDir, home });
    const closed = run({ args: ["handover", "finish", SLUG], handoverDir, home });
    expect([refused.status, closed.status]).toEqual([1, 0]);
    expect(refused.output).toContain(
      "--probed-repo /repo/acme was proved, but the doc now names no repo:, so finish will not probe a tree nobody " +
        "proved",
    );
  });

  it("refuses when its probes would read a tree other than the one proved, then closes once they match", () => {
    const repo = docRepo();
    const { home, handoverDir } = startedRun({ repo });
    writeFileSync(join(repo, "done.txt"), "done\n");
    const refused = run({
      args: ["handover", "finish", SLUG, "--probed-repo", repo, "--probed-tree", "session-worktree"],
      handoverDir,
      home,
    });
    const closed = run({
      args: ["handover", "finish", SLUG, "--probed-repo", repo, "--probed-tree", "doc-repo"],
      handoverDir,
      home,
    });
    expect([refused.status, closed.status]).toEqual([1, 0]);
    expect(refused.output).toContain(
      `the caller proved the session-worktree tree, but these probes would read ${repo} (doc-repo)`,
    );
  });

  it("refuses a --probed-tree that names no tree", () => {
    const { home, handoverDir } = startedRun({ repo: undefined });
    const refused = run({ args: ["handover", "finish", SLUG, "--probed-tree", "elsewhere"], handoverDir, home });
    expect(refused.status).toBe(2);
    expect(refused.output).toContain('--probed-tree must be session-worktree or doc-repo, not "elsewhere"');
  });
});
