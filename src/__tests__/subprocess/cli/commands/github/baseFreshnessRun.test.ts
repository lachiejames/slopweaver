/**
 * `baseFreshnessRun.ts`'s production `measureReverted` edge, proven against a real bare remote and a real
 * clone — the exact shape `slopweaver github push` reads. `gitInTemp` per `src/__tests__/tempGitRepo.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { behindBaseLines } from "../../../../../cli/commands/github/baseFreshnessCore.js";
import {
  measureRequiredBaseFreshness,
  productionBaseFreshnessRunDeps,
} from "../../../../../cli/commands/github/baseFreshnessRun.js";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const realGit: GithubPushDeps = {
  cwd: () => "",
  doorLedger: memoryDoorLedger().port,
  out: () => {},
  readGit: ({ cwd, args }) => gitInTemp({ args, cwd }),
  writeGit: ({ cwd, args }) => {
    try {
      gitInTemp({ args, cwd });
      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error.message : String(error));
    }
  },
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function commit({
  dir,
  file,
  content,
  message,
}: {
  dir: string;
  file: string;
  content: string;
  message: string;
}): void {
  writeFileSync(join(dir, file), content);
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-m", message], cwd: dir });
}

describe(
  "measureRequiredBaseFreshness's production reverted-files measurement, against a real remote",
  { timeout: REAL_GIT_TIMEOUT_MS },
  () => {
    it("surfaces a squash-reverted file even while ancestry reports fresh", () => {
      const remoteDir = mkdtempSync(join(tmpdir(), "base-freshness-remote-"));
      fixtureDirs.push(remoteDir);
      gitInTemp({ args: ["init", "--bare", "-b", "main"], cwd: remoteDir });

      const workDir = mkdtempSync(join(tmpdir(), "base-freshness-work-"));
      fixtureDirs.push(workDir);
      gitInTemp({ args: ["clone", remoteDir, "."], cwd: workDir });
      gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: workDir });
      gitInTemp({ args: ["config", "user.name", "Test"], cwd: workDir });
      gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: workDir });
      commit({ content: "export const version = 1;\n", dir: workDir, file: "poster.ts", message: "fork point" });
      gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });
      gitInTemp({ args: ["checkout", "-b", "feature"], cwd: workDir });
      commit({ content: "export const work = 1;\n", dir: workDir, file: "feature-work.ts", message: "feature work" });
      gitInTemp({ args: ["checkout", "main"], cwd: workDir });
      commit({
        content: "export const version = 2;\n",
        dir: workDir,
        file: "poster.ts",
        message: "446: main changes poster.ts",
      });
      gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });
      gitInTemp({ args: ["checkout", "feature"], cwd: workDir });
      gitInTemp({ args: ["reset", "--soft", "main"], cwd: workDir });
      gitInTemp({ args: ["commit", "-m", "squashed onto main"], cwd: workDir });
      const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: workDir });

      const result = measureRequiredBaseFreshness({
        cwd: workDir,
        defaultBranch: "main",
        deps: productionBaseFreshnessRunDeps({ git: realGit }),
        headSha,
        remote: "origin",
      });

      const forkPoint = gitInTemp({ args: ["rev-parse", "main~1"], cwd: workDir }).trim();
      const freshness = unwrap(result);
      expect(freshness.kind).toBe("fresh");
      expect(freshness.reverted).toEqual([{ path: "poster.ts", restoresBaseCommit: forkPoint }]);
    });
  },
);

describe(
  "the staleness advisory, measured over a real remote the worktree is actually behind",
  { timeout: REAL_GIT_TIMEOUT_MS },
  () => {
    /** A bare remote plus a clone sitting on `feature`, with `main` `aheadBy` commits past the fork point. */
    function worktreeBehindBy({ aheadBy }: { aheadBy: number }): { workDir: string; headSha: string } {
      const remoteDir = mkdtempSync(join(tmpdir(), "behind-base-remote-"));
      fixtureDirs.push(remoteDir);
      gitInTemp({ args: ["init", "--bare", "-b", "main"], cwd: remoteDir });

      const workDir = mkdtempSync(join(tmpdir(), "behind-base-work-"));
      fixtureDirs.push(workDir);
      gitInTemp({ args: ["clone", remoteDir, "."], cwd: workDir });
      gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: workDir });
      gitInTemp({ args: ["config", "user.name", "Test"], cwd: workDir });
      gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: workDir });
      commit({ content: "export const version = 1;\n", dir: workDir, file: "poster.ts", message: "fork point" });
      gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });
      gitInTemp({ args: ["checkout", "-b", "feature"], cwd: workDir });
      commit({ content: "export const work = 1;\n", dir: workDir, file: "feature-work.ts", message: "feature work" });
      gitInTemp({ args: ["checkout", "main"], cwd: workDir });
      for (let index = 0; index < aheadBy; index += 1) {
        commit({
          content: `export const landed = ${String(index)};\n`,
          dir: workDir,
          file: `landed-${String(index)}.ts`,
          message: `main lands ${String(index)}`,
        });
      }
      gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });
      gitInTemp({ args: ["checkout", "feature"], cwd: workDir });
      return { headSha: gitInTemp({ args: ["rev-parse", "HEAD"], cwd: workDir }), workDir };
    }

    it("counts the commits the branch is behind and renders them into one advisory line", () => {
      const { workDir, headSha } = worktreeBehindBy({ aheadBy: 3 });
      const measurement = measureRequiredBaseFreshness({
        cwd: workDir,
        defaultBranch: "main",
        deps: productionBaseFreshnessRunDeps({ git: realGit }),
        headSha,
        remote: "origin",
      });

      const freshness = unwrap(measurement);
      expect(freshness.kind).toBe("base-moved");
      expect(behindBaseLines({ measurement })).toStrictEqual(["⚠ this branch is 3 commits behind origin/main"]);
    });

    it("says nothing at all once the branch carries the base tip — the common case stays quiet", () => {
      const { workDir } = worktreeBehindBy({ aheadBy: 3 });
      gitInTemp({ args: ["rebase", "origin/main"], cwd: workDir });
      const rebasedHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: workDir });
      const measurement = measureRequiredBaseFreshness({
        cwd: workDir,
        defaultBranch: "main",
        deps: productionBaseFreshnessRunDeps({ git: realGit }),
        headSha: rebasedHead,
        remote: "origin",
      });

      const freshness = unwrap(measurement);
      expect(freshness.kind).toBe("fresh");
      expect(behindBaseLines({ measurement })).toStrictEqual([]);
    });
  },
);
