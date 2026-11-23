/**
 * The salvage scan over real git, reading OBJECTS rather than a rendered patch: the counterexamples a rendered-diff
 * scan missed — a secret the final tree no longer carries, a `-diff` file, a merge resolution and a replaced commit.
 * Each is built in a throwaway repository and scanned through the production edge, so what is proven is the argv
 * that ships.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import { commit, git, root, scan, TOKEN, useSalvageRepos } from "./harness.js";

describe("salvageScanDecline over real git", REAL_GIT_SUITE, () => {
  useSalvageRepos();

  it(
    "allows clean work past the destination",
    () => {
      commit({ content: "export const B = 2;\n", file: "b.ts", message: "clean" });
      expect(scan()).toBe(null);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a secret added in one commit and deleted in the next, which the final tree no longer carries",
    () => {
      commit({ content: `export const T = "${TOKEN}";\n`, file: "config.ts", message: "add" });
      commit({ content: "export const T = process.env.T;\n", file: "config.ts", message: "remove" });
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in config.ts — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a secret in a file marked -diff, which a rendered patch shows only as 'Binary files differ'",
    () => {
      commit({ content: "vault.txt -diff\n", file: ".gitattributes", message: "attrs" });
      commit({ content: `token=${TOKEN}\n`, file: "vault.txt", message: "vault" });
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in vault.txt — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a secret written only by a merge's conflict resolution, which `log -p` renders no patch for",
    () => {
      git("checkout", "-q", "-b", "side");
      commit({ content: "export const A = 'side';\n", file: "a.ts", message: "side" });
      git("checkout", "-q", "main");
      commit({ content: "export const A = 'main';\n", file: "a.ts", message: "main" });
      expect(() => git("merge", "-q", "side")).toThrow();
      writeFileSync(join(root, "a.ts"), `export const A = "${TOKEN}";\n`);
      git("add", "a.ts");
      git("commit", "-q", "--no-edit");
      expect(git("show", "-s", "--format=%p", "HEAD").split(" ").length).toBe(2);
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a.ts — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a secret a local REPLACE ref hides, because the push sends the original object",
    () => {
      const leaked = commit({ content: `export const T = "${TOKEN}";\n`, file: "config.ts", message: "leak" });
      const stand = git("commit-tree", `${leaked}^^{tree}`, "-p", `${leaked}^`, "-m", "stand-in");
      git("replace", leaked, stand);
      expect(git("show", "-s", "--format=%s", leaked)).toBe("stand-in");
      expect(scan({ sha: leaked })).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in config.ts — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
