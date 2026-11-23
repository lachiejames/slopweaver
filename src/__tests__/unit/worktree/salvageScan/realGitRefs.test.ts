/**
 * The salvage scan over real git, bounding the walk by what the DESTINATION carries: only its default branch counts,
 * never a commit another remote, a stale tracking ref or a deletable branch holds; the url is the one the push
 * reaches; the sha is the one it was given; and a destination it cannot ask declines. Each is built in a throwaway
 * repository and scanned through the production edge, so what is proven is the argv that ships.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import { commit, git, origin, scan, TOKEN, useSalvageRepos } from "./harness.js";

describe("salvageScanDecline over real git", REAL_GIT_SUITE, () => {
  useSalvageRepos();

  it(
    "declines a secret ANOTHER remote carries, because the push publishes it to this one",
    () => {
      const leaked = commit({ content: `export const T = "${TOKEN}";\n`, file: "config.ts", message: "leak" });
      git("update-ref", "refs/remotes/fork/leak", leaked);
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in config.ts — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a secret a STALE tracking ref still names after the destination deleted the branch",
    () => {
      commit({ content: `export const T = "${TOKEN}";\n`, file: "config.ts", message: "leak" });
      git("push", "-q", "origin", "HEAD:temporary");
      gitInTemp({ args: ["branch", "-D", "temporary"], cwd: origin });
      commit({ content: "export const B = 2;\n", file: "b.ts", message: "clean" });
      expect(git("rev-parse", "--verify", "-q", "refs/remotes/origin/temporary")).not.toBe("");
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in config.ts — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a secret only a NON-default destination branch carries, which can be deleted before the push lands",
    () => {
      commit({ content: `export const T = "${TOKEN}";\n`, file: "config.ts", message: "leak" });
      git("push", "-q", "origin", "HEAD:temporary");
      commit({ content: "export const B = 2;\n", file: "b.ts", message: "clean" });
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in config.ts — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reads the url the PUSH reaches even when GIT_CONFIG_* in the environment rewrites it for plain git",
    () => {
      // The push strips every GIT_* variable, so a scan that kept them could read a repository the push never
      // reaches: here one whose default branch already carries the secret, hiding it.
      const other = mkdtempSync(join(tmpdir(), "salvage-other-"));
      gitInTemp({ args: ["init", "-q", "--bare", "-b", "main"], cwd: other });
      commit({ content: `export const T = "${TOKEN}";\n`, file: "config.ts", message: "leak" });
      git("push", "-q", other, "HEAD:main");
      commit({ content: "export const B = 2;\n", file: "b.ts", message: "clean" });
      const injected = {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.${other}.insteadOf`,
        GIT_CONFIG_VALUE_0: origin,
      };
      Object.assign(process.env, injected);
      try {
        expect(scan()).toBe(
          "the work it would push carries 1 secret-class line(s) (github-oauth-token) in config.ts — nothing was pushed",
        );
      } finally {
        for (const key of Object.keys(injected)) {
          delete process.env[key];
        }
        rmSync(other, { force: true, recursive: true });
      }
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "allows content the destination already carries, since the push sends none of it",
    () => {
      commit({ content: `export const T = "${TOKEN}";\n`, file: "config.ts", message: "old" });
      git("push", "-q", "origin", "main");
      commit({ content: "export const B = 2;\n", file: "b.ts", message: "new" });
      expect(scan()).toBe(null);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "scans the sha it is GIVEN, not wherever HEAD has since moved",
    () => {
      const scanned = commit({ content: "export const B = 2;\n", file: "b.ts", message: "clean" });
      commit({ content: `export const T = "${TOKEN}";\n`, file: "config.ts", message: "later" });
      expect(scan({ sha: scanned })).toBe(null);
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in config.ts — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines when the destination cannot be asked what it carries",
    () => {
      rmSync(origin, { force: true, recursive: true });
      commit({ content: "export const B = 2;\n", file: "b.ts", message: "clean" });
      expect(scan()).toContain("what it would push could not be listed for the secrets scan — ");
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
