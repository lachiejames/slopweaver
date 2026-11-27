/**
 * The salvage scan over real git, judging a blob at EVERY path the push publishes it under. `rev-list --objects`
 * names an object once, at the first path its walk meets, and the repository-content scanner forgives by path — the
 * owner's account on a `.github/CODEOWNERS` rule row, the one owner reference in the README. So a byte-identical copy
 * of a forgiven file at any other path is the case: it must decline there exactly as a fresh file would — and so must
 * a copy of a blob the destination's default branch already holds, which `rev-list` does not list at all.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type ForbiddenIdentifierRules, identifierDigest } from "../../../../hygiene/identifierScan.js";
import {
  CODE_OWNERS_PATH,
  repositoryContentIdentifierScanner,
  SOURCE_REPOSITORY,
} from "../../../../hygiene/ownRepository.js";
import { gitSalvageEdges, salvageScanDecline } from "../../../../worktree/salvageScan.js";
import { REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import { git, origin, REF, root, useSalvageRepos } from "./harness.js";

/** The source repository's owner, derived rather than spelled, and the one word these rules forbid. */
const SOURCE_OWNER = SOURCE_REPOSITORY.slice(0, SOURCE_REPOSITORY.indexOf("/"));

const OWNER_RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [],
    substringCs: [],
    teamKeys: [],
    wordCi: [identifierDigest({ text: SOURCE_OWNER })],
    wordCs: [],
  },
  providerLocations: [],
};

/** A code-owner rule row naming the owner's account: forgiven at {@link CODE_OWNERS_PATH} and nowhere else. */
const OWNER_ROW = `* @${SOURCE_OWNER}\n`;

/**
 * Write each file, commit them in one commit, and scan what a salvage push of it would send under the owner rules.
 *
 * @param files each tree-relative path and its content, a nested one's directory made first
 * @returns the decline line, or null when the push is allowed
 */
const commitAndScan = ({ files }: { files: readonly { path: string; content: string }[] }): string | null => {
  for (const { path, content } of files) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "owners");
  return salvageScanDecline({
    denylist: { kind: "absent" },
    edges: gitSalvageEdges({ cwd: root, sha: git("rev-parse", "HEAD"), url: origin }),
    identifiers: repositoryContentIdentifierScanner({ rules: OWNER_RULES }),
    refName: REF,
  });
};

describe("salvageScanDecline over a blob published at two paths", REAL_GIT_SUITE, () => {
  useSalvageRepos();

  it(
    "allows the owner's account on a code-owner row at the one path that forgives it",
    () => {
      expect(commitAndScan({ files: [{ content: OWNER_ROW, path: CODE_OWNERS_PATH }] })).toBe(null);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a byte-identical copy of that row at an unforgiven path, which rev-list names only at the first",
    () => {
      const line = commitAndScan({
        files: [
          { content: OWNER_ROW, path: CODE_OWNERS_PATH },
          { content: OWNER_ROW, path: "docs/owners.txt" },
        ],
      });
      expect(git("rev-parse", `HEAD:${CODE_OWNERS_PATH}`)).toBe(git("rev-parse", "HEAD:docs/owners.txt"));
      expect(line).toBe(
        "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in docs/owners.txt, and the destination is public — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a copy at a new path of a blob the DESTINATION already holds, which rev-list does not list at all",
    () => {
      expect(commitAndScan({ files: [{ content: OWNER_ROW, path: CODE_OWNERS_PATH }] })).toBe(null);
      git("push", "-q", "origin", "main");
      const line = commitAndScan({ files: [{ content: OWNER_ROW, path: "docs/owners.txt" }] });
      expect(git("rev-parse", `origin/main:${CODE_OWNERS_PATH}`)).toBe(git("rev-parse", "HEAD:docs/owners.txt"));
      expect(line).toBe(
        "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in docs/owners.txt, and the destination is public — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "still allows a blob the destination holds restored at the SAME forgiven path, so no forgiveness is lost",
    () => {
      expect(commitAndScan({ files: [{ content: OWNER_ROW, path: CODE_OWNERS_PATH }] })).toBe(null);
      git("push", "-q", "origin", "main");
      git("rm", "-q", CODE_OWNERS_PATH);
      git("commit", "-q", "-m", "drop owners");
      const line = commitAndScan({ files: [{ content: OWNER_ROW, path: CODE_OWNERS_PATH }] });
      expect(git("log", "--format=", "--name-only", "-z", "origin/main..HEAD").split("\0")).toContain(CODE_OWNERS_PATH);
      expect(line).toBe(null);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines a copy only a MERGE's resolution writes, which only a per-parent diff of the merge lists",
    () => {
      git("checkout", "-q", "-b", "side");
      commitAndScan({ files: [{ content: OWNER_ROW, path: CODE_OWNERS_PATH }] });
      git("checkout", "-q", "main");
      commitAndScan({ files: [{ content: "export const C = 3;\n", path: "c.ts" }] });
      git("merge", "-q", "--no-ff", "--no-commit", "side");
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "docs/owners.txt"), OWNER_ROW);
      git("add", "-A");
      git("commit", "-q", "--no-edit");
      expect(git("show", "-s", "--format=%p", "HEAD").split(" ").length).toBe(2);
      expect(git("log", "--format=", "--name-only", "--no-merges", "-z", "HEAD")).not.toContain("docs/owners.txt");
      expect(
        salvageScanDecline({
          denylist: { kind: "absent" },
          edges: gitSalvageEdges({ cwd: root, sha: git("rev-parse", "HEAD"), url: origin }),
          identifiers: repositoryContentIdentifierScanner({ rules: OWNER_RULES }),
          refName: REF,
        }),
      ).toBe(
        "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in docs/owners.txt, and the destination is public — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "declines the copy in a parentless ROOT commit too, with log.showRoot off, which only an explicit --root diffs",
    () => {
      git("config", "log.showRoot", "false");
      git("checkout", "-q", "--orphan", "solo");
      git("rm", "-q", "-rf", ".");
      const line = commitAndScan({
        files: [
          { content: OWNER_ROW, path: CODE_OWNERS_PATH },
          { content: OWNER_ROW, path: "docs/owners.txt" },
        ],
      });
      expect(git("rev-list", "--parents", "-n", "1", "HEAD").split(" ").length).toBe(1);
      expect(line).toBe(
        "the work it would push carries 1 forbidden-identifier hit(s) (forbidden-word-ci) in docs/owners.txt, and the destination is public — nothing was pushed",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
