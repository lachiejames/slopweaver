/**
 * The salvage scan over real git, reading what the push publishes beside blob content: a changed path's NAME, a
 * rename that sends no new blob, a commit's author, and an intermediate or tip commit's message. Each is built in a
 * throwaway repository and scanned through the production edge, so what is proven is the argv that ships.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { gitSalvageEdges, salvageScanDecline } from "../../../../worktree/salvageScan.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import { commit, git, origin, REF, root, scan, TOKEN, useSalvageRepos } from "./harness.js";

describe("salvageScanDecline over real git", REAL_GIT_SUITE, () => {
  useSalvageRepos();

  it(
    "declines a secret only a FILE NAME carries, whose blob is clean",
    () => {
      commit({ content: "clean\n", file: `${TOKEN}.txt`, message: "named" });
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in the changed paths — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a denylisted FILE NAME holding a backslash, which git would otherwise C-quote past the scan",
    () => {
      const name = "zanzibar\\internal";
      commit({ content: "clean\n", file: name, message: "named" });
      expect(git("ls-files", "zanzibar*")).toBe(`"zanzibar\\\\internal"`);
      const declined = salvageScanDecline({
        denylist: { kind: "loaded", lines: [name] },
        edges: gitSalvageEdges({ cwd: root, sha: git("rev-parse", "HEAD"), url: origin }),
        refName: REF,
      });
      expect(declined).toBe(
        "the work it would push carries 1 secret-class line(s) (denylist) in the changed paths — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a clean file the destination already carries RENAMED to a secret name, which sends no new blob",
    () => {
      git("mv", "a.ts", `${TOKEN}.ts`);
      git("commit", "-q", "-m", "rename");
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in the changed paths — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a secret only a commit's AUTHOR carries, which no message or path shows",
    () => {
      writeFileSync(join(root, "b.ts"), "export const B = 2;\n");
      git("add", "-A");
      gitInTemp({
        args: ["-c", "user.email=a@b.c", "-c", `user.name=${TOKEN}`, "commit", "-q", "-m", "clean"],
        cwd: root,
      });
      expect(git("log", "-1", "--format=%an")).toBe(TOKEN);
      expect(scan()).toBe(
        "the work it would push carries 2 secret-class line(s) (github-oauth-token) in a commit's headers or message — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a secret in an INTERMEDIATE commit's message, which a blob-filtered walk does not list",
    () => {
      commit({ content: "export const B = 2;\n", file: "b.ts", message: `token ${TOKEN}` });
      commit({ content: "export const C = 3;\n", file: "c.ts", message: "clean tip" });
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a commit's headers or message — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a secret only a COMMIT MESSAGE carries",
    () => {
      commit({ content: "export const B = 2;\n", file: "b.ts", message: `token ${TOKEN}` });
      expect(scan()).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a commit's headers or message — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
