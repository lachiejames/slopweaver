/*
 * The change digest a description review is bound to, over real git: a pure rebase keeps it, and any content
 * change moves it — a file edit, a rename, a mode-only change and a binary swapped for another. Real git because
 * the whole claim is about what git's tree delta reports, and only git can say.
 */
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { computeChangeDigest } from "../../../../outbound/github/descriptionChangeDigest.js";
import { gitInTemp } from "../../../tempGitRepo.js";

/** A fixed identity, no signing and no hooks, for every command that writes a commit. */
const IDENTITY: readonly string[] = [
  "-c",
  "user.name=fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

/** Ten numbered lines, so a change at the top and one at the bottom of the same file never conflict. */
const A_LINES = Array.from({ length: 10 }, (_, index) => `export const line${String(index)} = ${String(index)};`);

/** Commit everything in the working tree. */
function commitAll({ repo, message }: { repo: string; message: string }): void {
  gitInTemp({ args: ["add", "--all"], cwd: repo });
  gitInTemp({ args: [...IDENTITY, "commit", "--quiet", "--no-verify", "-m", message], cwd: repo });
}

/** Commit one change on main, then rebase the feature branch onto it. */
function moveBaseThenRebase({ repo, change }: { repo: string; change: () => void }): void {
  gitInTemp({ args: ["checkout", "--quiet", "main"], cwd: repo });
  change();
  commitAll({ message: "base moves", repo });
  gitInTemp({ args: ["checkout", "--quiet", "feature"], cwd: repo });
  gitInTemp({ args: [...IDENTITY, "rebase", "--quiet", "main"], cwd: repo });
}

/** The digest of the feature branch against main. */
function digest({ repo }: { repo: string }): string {
  return unwrap(computeChangeDigest({ baseRef: "main", headRef: "feature", repoDir: repo })).changeDigest;
}

describe("computeChangeDigest", () => {
  let repo = "";

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "sw-change-digest-"));
    gitInTemp({ args: ["init", "--quiet", "--initial-branch=main"], cwd: repo });
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "a.ts"), `${A_LINES.join("\n")}\n`);
    writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
    writeFileSync(join(repo, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    writeFileSync(join(repo, "run.sh"), "echo run\n");
    commitAll({ message: "base", repo });
    gitInTemp({ args: ["checkout", "--quiet", "-b", "feature"], cwd: repo });
    writeFileSync(join(repo, "src", "a.ts"), `${["export const line0 = 100;", ...A_LINES.slice(1)].join("\n")}\n`);
    commitAll({ message: "feature change", repo });
  });

  afterEach(() => {
    rmSync(repo, { force: true, recursive: true });
  });

  it("reads the feature's one changed path between the merge base and the head", () => {
    const reading = unwrap(computeChangeDigest({ baseRef: "main", headRef: "feature", repoDir: repo }));
    expect(reading.entries.map((entry) => `${entry.status} ${entry.path}`)).toStrictEqual(["M src/a.ts"]);
    expect(reading.mergeBaseSha).toBe(gitInTemp({ args: ["rev-parse", "main"], cwd: repo }));
    expect(reading.headSha).toBe(gitInTemp({ args: ["rev-parse", "feature"], cwd: repo }));
  });

  it("keeps the digest across a pure rebase onto a base that moved elsewhere", () => {
    const before = digest({ repo });
    const headBefore = gitInTemp({ args: ["rev-parse", "feature"], cwd: repo });
    moveBaseThenRebase({
      change: () => {
        writeFileSync(join(repo, "src", "b.ts"), "export const b = 2;\n");
      },
      repo,
    });
    expect(gitInTemp({ args: ["rev-parse", "feature"], cwd: repo })).not.toBe(headBefore);
    expect(digest({ repo })).toBe(before);
  });

  it("moves the digest when a rebase brings in a base change to a path the feature also changes", () => {
    const before = digest({ repo });
    moveBaseThenRebase({
      change: () => {
        writeFileSync(
          join(repo, "src", "a.ts"),
          `${[...A_LINES.slice(0, 9), "export const line9 = 900;"].join("\n")}\n`,
        );
      },
      repo,
    });
    expect(digest({ repo })).not.toBe(before);
  });

  it("moves the digest when a changed file's content is edited", () => {
    const before = digest({ repo });
    writeFileSync(join(repo, "src", "a.ts"), `${["export const line0 = 101;", ...A_LINES.slice(1)].join("\n")}\n`);
    commitAll({ message: "edit", repo });
    expect(digest({ repo })).not.toBe(before);
  });

  it("moves the digest when a file is renamed with its content unchanged", () => {
    const before = digest({ repo });
    renameSync(join(repo, "src", "b.ts"), join(repo, "src", "c.ts"));
    commitAll({ message: "rename", repo });
    const reading = unwrap(computeChangeDigest({ baseRef: "main", headRef: "feature", repoDir: repo }));
    expect(reading.entries.map((entry) => `${entry.status} ${entry.path}`)).toStrictEqual([
      "M src/a.ts",
      "D src/b.ts",
      "A src/c.ts",
    ]);
    expect(reading.changeDigest).not.toBe(before);
  });

  it("moves the digest on a mode-only change, where every blob id stays the same", () => {
    const before = digest({ repo });
    chmodSync(join(repo, "run.sh"), 0o755);
    gitInTemp({ args: ["update-index", "--chmod=+x", "run.sh"], cwd: repo });
    commitAll({ message: "mode", repo });
    const reading = unwrap(computeChangeDigest({ baseRef: "main", headRef: "feature", repoDir: repo }));
    const run = reading.entries.find((entry) => entry.path === "run.sh")!;
    expect(run.oldBlob).toBe(run.newBlob);
    expect(`${run.oldMode} -> ${run.newMode}`).toBe("100644 -> 100755");
    expect(reading.changeDigest).not.toBe(before);
  });

  it("moves the digest when a binary file is replaced by other bytes", () => {
    writeFileSync(join(repo, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x09, 0x09, 0x09]));
    commitAll({ message: "first logo", repo });
    const before = digest({ repo });
    writeFileSync(join(repo, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x07, 0x07, 0x07]));
    commitAll({ message: "second logo", repo });
    const reading = unwrap(computeChangeDigest({ baseRef: "main", headRef: "feature", repoDir: repo }));
    expect(reading.entries.map((entry) => `${entry.status} ${entry.path}`)).toStrictEqual(["M logo.png", "M src/a.ts"]);
    expect(reading.changeDigest).not.toBe(before);
  });

  it("names a base ref the checkout cannot resolve", () => {
    const failure = unwrapErr(computeChangeDigest({ baseRef: "origin/nowhere", headRef: "feature", repoDir: repo }));
    expect(failure.code).toBe("CHANGE_DIGEST_FAILED");
    expect(failure.message).toContain("the change set's digest could not be computed");
  });
});
