/**
 * The salvage scan over real git, reading what the push publishes beside blob content: a changed path's NAME, a
 * rename that sends no new blob, a commit's author, and an intermediate or tip commit's message. Each is built in a
 * throwaway repository and scanned through the production edge, so what is proven is the argv that ships.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { IdentifierScanner } from "../../../../hygiene/identifierScan.js";
import { gitSalvageEdges, salvageScanDecline } from "../../../../worktree/salvageScan.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import { commit, git, IDENTIFIERS, ORG, origin, REF, root, scan, TOKEN, useSalvageRepos } from "./harness.js";

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
        identifiers: IDENTIFIERS,
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

describe("salvageScanDecline over a forbidden identifier in real git", REAL_GIT_SUITE, () => {
  useSalvageRepos();

  it(
    "declines a captured file naming the organisation, which the push would publish",
    () => {
      commit({ content: `notes for ${ORG}\n`, file: "notes.md", message: "salvage: captured" });
      expect(scan()).toBe(
        "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in notes.md, and the destination is public — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines the organisation in a commit MESSAGE",
    () => {
      commit({ content: "export const B = 2;\n", file: "b.ts", message: `for ${ORG}` });
      expect(scan()).toBe(
        "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in a commit's headers or message, and the destination is public — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "passes the organisation in a commit's AUTHOR header alone, which every public commit carries a person in",
    () => {
      writeFileSync(join(root, "b.ts"), "export const B = 2;\n");
      git("add", "-A");
      gitInTemp({
        args: ["-c", "user.email=a@b.c", "-c", `user.name=${ORG}`, "commit", "-q", "-m", "clean"],
        cwd: root,
      });
      expect(git("log", "-1", "--format=%an")).toBe(ORG);
      expect(scan()).toBe(null);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "withholds a changed path that itself names the organisation, so the decline never prints it",
    () => {
      mkdirSync(join(root, ORG));
      commit({ content: `notes for ${ORG}\n`, file: `${ORG}/notes.md`, message: "salvage: captured" });
      // The witness: the input carries the name, in the path as well as the blob.
      expect(git("ls-files")).toContain(`${ORG}/notes.md`);
      const line = scan();
      expect(line).toBe(
        "the work it would push carries 2 forbidden-identifier hit(s) (forbidden-word-ci) in the changed paths, a path that itself carries a forbidden identifier, and the destination is public — nothing was pushed",
      );
      expect(line).not.toContain(ORG);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "withholds a SECRET's path that names the organisation, the secret decline included",
    () => {
      mkdirSync(join(root, ORG));
      commit({ content: `token=${TOKEN}\n`, file: `${ORG}/key.txt`, message: "salvage: captured" });
      expect(git("ls-files")).toContain(`${ORG}/key.txt`);
      const line = scan();
      expect(line).toBe(
        "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a path that itself carries a forbidden identifier — nothing was pushed",
      );
      expect(line).not.toContain(ORG);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines, rather than ending the run, when the identifier scanner throws",
    () => {
      commit({ content: "export const B = 2;\n", file: "b.ts", message: "salvage: captured" });
      const throwing: IdentifierScanner = {
        scan: () => {
          throw new Error("rules unreadable");
        },
        spans: () => [],
      };
      const line = salvageScanDecline({
        denylist: { kind: "absent" },
        edges: gitSalvageEdges({ cwd: root, sha: git("rev-parse", "HEAD"), url: origin }),
        identifiers: throwing,
        refName: REF,
      });
      expect(line).toBe(
        "what it would push could not be scanned for identifiers — the identifier scanner threw, its message withheld; nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
