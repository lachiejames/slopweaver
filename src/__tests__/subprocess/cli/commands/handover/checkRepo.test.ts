/**
 * `handover check`, proved through the real door, over a doc whose `repo:` names a repository slopweaver
 * itself does not check out. The resolver used to default to the caller's own checkout regardless of the
 * doc's `repo:`, so it reported every file in the doc's real repository as uncommitted.
 *
 * `gitInTemp` per `src/__tests__/tempGitRepo.ts` — a test may not shell git any other way.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp git repo on `main`, holding one committed file, with committer identity set. */
function targetRepoWithFile({ relativePath }: { relativePath: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "handover-check-target-repo-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, dirname(relativePath)), { recursive: true });
  writeFileSync(join(dir, relativePath), "export const x = 1;\n", "utf8");
  git("add", relativePath);
  git("commit", "-m", "seed");
  return dir;
}

/**
 * Run the shipped binary against an empty handovers dir, so no real board state is read.
 *
 * `handover check` prints its findings and the resolved-repo diagnostic on stderr (`logger.error`), and only
 * its final one-line "is sound" verdict on stdout (`logger.out`) — see `src/lib/logger.ts`. `spawnSync`, not
 * `execFileSync`, because `execFileSync` only returns stdout on a successful (exit 0) run and this suite
 * needs stderr in both outcomes.
 */
function runCheck({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const emptyHandoversDir = mkdtempSync(join(tmpdir(), "handover-check-empty-board-"));
  fixtureDirs.push(emptyHandoversDir);
  const result = spawnSync(BIN, ["handover", "check", "--dir", emptyHandoversDir, ...args], {
    encoding: "utf8",
    env: { ...accountSandboxChildEnv(), HOME: process.env["HOME"]!, PATH: process.env["PATH"]! },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe(
  "bin/slopweaver handover check — resolves against the doc's own repo",
  { timeout: REAL_GIT_TIMEOUT_MS },
  () => {
    it("passes a reference the doc's repo: commits, which slopweaver's own checkout does not have", () => {
      const targetRepo = targetRepoWithFile({ relativePath: "only-in-target-repo.ts" });
      const docDir = mkdtempSync(join(tmpdir(), "handover-check-doc-"));
      fixtureDirs.push(docDir);
      const docPath = join(docDir, "fixture.md");
      writeFileSync(
        docPath,
        `---\nslug: fixture\nstatus: draft\nrepo: ${targetRepo}\nartifact: null\ndoneWhen: []\n---\n\n` +
          "Read `only-in-target-repo.ts` first.\n",
        "utf8",
      );

      const result = runCheck({ args: ["--doc", docPath] });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(`resolving file references against ${targetRepo} (from doc)`);
      expect(result.stdout).toContain("fixture is sound");
    });

    it("still fails a reference genuinely missing from the doc's own repo, not slopweaver's", () => {
      const targetRepo = targetRepoWithFile({ relativePath: "present.ts" });
      const docDir = mkdtempSync(join(tmpdir(), "handover-check-doc-"));
      fixtureDirs.push(docDir);
      const docPath = join(docDir, "fixture.md");
      writeFileSync(
        docPath,
        `---\nslug: fixture\nstatus: draft\nrepo: ${targetRepo}\nartifact: null\ndoneWhen: []\n---\n\n` +
          "Read `nowhere-in-target.ts` first.\n",
        "utf8",
      );

      const result = runCheck({ args: ["--doc", docPath] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("nowhere-in-target.ts");
    });

    it("--repo overrides the doc's own repo", () => {
      const docRepo = targetRepoWithFile({ relativePath: "only-in-doc-repo.ts" });
      const overrideRepo = targetRepoWithFile({ relativePath: "only-in-override-repo.ts" });
      const docDir = mkdtempSync(join(tmpdir(), "handover-check-doc-"));
      fixtureDirs.push(docDir);
      const docPath = join(docDir, "fixture.md");
      writeFileSync(
        docPath,
        `---\nslug: fixture\nstatus: draft\nrepo: ${docRepo}\nartifact: null\ndoneWhen: []\n---\n\n` +
          "Read `only-in-override-repo.ts` first.\n",
        "utf8",
      );

      const result = runCheck({ args: ["--doc", docPath, "--repo", overrideRepo] });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(`resolving file references against ${overrideRepo} (from flag)`);
    });

    it("refuses a doc whose repo: names a path that does not exist on disk", () => {
      const docDir = mkdtempSync(join(tmpdir(), "handover-check-doc-"));
      fixtureDirs.push(docDir);
      const docPath = join(docDir, "fixture.md");
      const missingRepo = join(tmpdir(), "handover-check-missing-repo-3f9a1c");
      writeFileSync(
        docPath,
        `---\nslug: fixture\nstatus: draft\nrepo: ${missingRepo}\nartifact: null\ndoneWhen: []\n---\n\nbody\n`,
        "utf8",
      );

      const result = runCheck({ args: ["--doc", docPath] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(missingRepo);
      expect(result.stderr).toContain("does not exist on disk");
    });
  },
);
