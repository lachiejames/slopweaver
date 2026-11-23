/**
 * `privateHistoryWithinHead` over a fake git and a hand-written private gitdir: which reads it makes, and what
 * refuses. The real-git shapes — a reflog line on either side, `refs/bisect/keep`, `ORIG_HEAD` and a second
 * `FETCH_HEAD` line each holding a commit alone — are `pruneReclaim/snapshotTree.test.ts`'s.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GitRunner } from "../../../worktree/pruneGit.js";
import { privateHistoryWithinHead } from "../../../worktree/snapshotPrivateHistory.js";

const HEAD = "a".repeat(40);
const PARENT = "b".repeat(40);
const STRAY = "c".repeat(40);
const NULL = "0".repeat(40);
const TAG = "d".repeat(40);

let dir = "";
let gitDir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "private-history-"));
  gitDir = join(dir, "worktrees", "tree");
  mkdirSync(gitDir, { recursive: true });
});
afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/**
 * A git that answers each read from a table, and counts a commit as contained only when it is HEAD or its parent.
 * `TAG` is a tag object whose `merge-base` reads contained, as real git's does once it peels the tag to its commit.
 * The tree's gitdir is the test's own private one unless a test answers otherwise.
 *
 * @returns the runner, and every argument list it was asked
 */
function fakeGit({ answers = {} }: { answers?: Readonly<Record<string, string | null>> } = {}): {
  git: GitRunner;
  asked: string[];
} {
  const asked: string[] = [];
  const table: Readonly<Record<string, string | null>> = {
    "--absolute-git-dir": gitDir,
    "--git-common-dir": dir,
    "for-each-ref": "",
    "diff-index": "",
    "ls-files": "",
    "refs/replace/": "",
    ...answers,
  };
  const git: GitRunner = ({ args }) => {
    asked.push(args.join(" "));
    if (args[1] === "cat-file") {
      return args[3] === TAG ? "tag" : "commit";
    }
    if (args[1] === "merge-base") {
      return args[3] === HEAD || args[3] === PARENT || args[3] === TAG ? "" : null;
    }
    const keyedByLast = args[0] === "rev-parse" || args.at(-1) === "refs/replace/";
    const key = keyedByLast ? args.at(-1)! : args[0]!;
    return key in table ? table[key]! : null;
  };
  return { asked, git };
}

/** Write a file under the fake private gitdir. */
function writePrivate({ name, lines }: { name: string; lines: readonly string[] }): void {
  const file = join(gitDir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`);
}

/** One reflog line, moving a ref from `from` to `to`. */
function logLine({ from, to }: { from: string; to: string }): string {
  return `${from} ${to} A U Thor <a@example.com> 1700000000 +0000\tmove`;
}

describe("privateHistoryWithinHead", () => {
  it("passes a snapshot whose private names are its HEAD and its parent alone", () => {
    writePrivate({
      lines: [logLine({ from: NULL, to: PARENT }), logLine({ from: PARENT, to: HEAD })],
      name: "logs/HEAD",
    });
    writePrivate({ lines: [PARENT], name: "ORIG_HEAD" });
    writePrivate({ lines: [HEAD], name: "HEAD" });
    writePrivate({ lines: ["../.."], name: "commondir" });
    writePrivate({ lines: [join(dir, "tree", ".git")], name: "gitdir" });
    writeFileSync(join(gitDir, "index"), `DIRC\0${STRAY}\0`);
    const { git, asked } = fakeGit();

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(true);
    // Every id once, whichever order the directory lists its files in.
    expect(new Set(asked.filter((line) => line.includes("merge-base")))).toEqual(
      new Set([
        `--no-replace-objects merge-base --is-ancestor ${PARENT} ${HEAD}`,
        `--no-replace-objects merge-base --is-ancestor ${HEAD} ${HEAD}`,
      ]),
    );
  });

  it("refuses a commit only the moved-FROM side of a reflog line names", () => {
    writePrivate({
      lines: [logLine({ from: PARENT, to: HEAD }), logLine({ from: STRAY, to: HEAD })],
      name: "logs/HEAD",
    });

    expect(privateHistoryWithinHead({ git: fakeGit().git, path: dir, rev: HEAD })).toBe(false);
  });

  it("skips the index, whatever hex it carries", () => {
    writeFileSync(join(gitDir, "index"), `DIRC\0${STRAY}\0`);

    expect(privateHistoryWithinHead({ git: fakeGit().git, path: dir, rev: HEAD })).toBe(true);
  });

  // HEAD alone would pass the ancestry read, so what refuses is the NUL itself.
  it("refuses a NUL in any file but the index, whatever id sits beside it", () => {
    writeFileSync(join(gitDir, "ORIG_HEAD"), `${HEAD}\0\n`);
    const { git, asked } = fakeGit();

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
    expect(asked.filter((line) => line.includes("merge-base"))).toEqual([]);
  });

  it("refuses when a private file cannot be read", () => {
    writePrivate({ lines: [HEAD], name: "ORIG_HEAD" });
    chmodSync(join(gitDir, "ORIG_HEAD"), 0o000);

    expect(privateHistoryWithinHead({ git: fakeGit().git, path: dir, rev: HEAD })).toBe(false);
  });

  it("refuses a tag object, though merge-base would peel it to a contained commit", () => {
    writePrivate({ lines: [TAG], name: "ORIG_HEAD" });
    const { git, asked } = fakeGit();

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
    expect(asked).toContain(`--no-replace-objects cat-file -t ${TAG}`);
  });

  // Each would let gc read parents this check does not, so the repository refuses before any id is asked.
  it("refuses a repository carrying a replace ref", () => {
    const { git, asked } = fakeGit({ answers: { "refs/replace/": `refs/replace/${HEAD}` } });

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
    expect(asked.filter((line) => line.includes("merge-base"))).toEqual([]);
  });

  it("refuses when the replace refs cannot be read", () => {
    const { git } = fakeGit({ answers: { "refs/replace/": null } });

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
  });

  it("refuses a repository carrying an info/grafts file", () => {
    mkdirSync(join(dir, "info"));
    writeFileSync(join(dir, "info", "grafts"), `${HEAD}\n`);
    const { git, asked } = fakeGit();

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
    expect(asked.filter((line) => line.includes("merge-base"))).toEqual([]);
  });

  it("refuses a repository whose info directory cannot be read, a grafts file it may hide counting", () => {
    mkdirSync(join(dir, "info"));
    chmodSync(join(dir, "info"), 0o000);
    try {
      expect(privateHistoryWithinHead({ git: fakeGit().git, path: dir, rev: HEAD })).toBe(false);
    } finally {
      chmodSync(join(dir, "info"), 0o700);
    }
  });

  it("refuses a commit only a per-worktree ref names", () => {
    const { git } = fakeGit({ answers: { "for-each-ref": `${STRAY}\n` } });

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
  });

  it("refuses a commit only an uppercase id names, asking git about it in lowercase", () => {
    writePrivate({ lines: [STRAY.toUpperCase()], name: "ORIG_HEAD" });
    const { git, asked } = fakeGit();

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
    expect(asked).toContain(`--no-replace-objects merge-base --is-ancestor ${STRAY} ${HEAD}`);
  });

  // Each names only HEAD, so the id read would pass it: what refuses is the file being there at all.
  it.each([
    { lines: [HEAD], name: "CHERRY_PICK_HEAD" },
    { lines: [PARENT, HEAD], name: "MERGE_HEAD" },
    { lines: [`${HEAD}\t\tbranch 'main' of /r`], name: "FETCH_HEAD" },
    { lines: ["pick ae7413e only sequencer names me"], name: "sequencer/todo" },
    { lines: [HEAD], name: "refs/bisect/keep" },
    { lines: [logLine({ from: NULL, to: HEAD })], name: "logs/refs/worktree/kept" },
    { lines: ["[core]"], name: "config.worktree" },
  ])("refuses a gitdir holding $name, a file no snapshot's creation writes", ({ lines, name }) => {
    writePrivate({ lines, name });
    const { git, asked } = fakeGit();

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
    expect(asked.filter((line) => line.includes("merge-base"))).toEqual([]);
  });

  it("refuses a gitdir holding a symlink where a file was allowed", () => {
    symlinkSync(join(dir, "elsewhere"), join(gitDir, "ORIG_HEAD"));

    expect(privateHistoryWithinHead({ git: fakeGit().git, path: dir, rev: HEAD })).toBe(false);
  });

  it("refuses a tree whose gitdir is the repository's shared one", () => {
    const { git } = fakeGit({ answers: { "--git-common-dir": gitDir } });

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
  });

  it("refuses when the gitdir cannot be asked", () => {
    const { git } = fakeGit({ answers: { "--absolute-git-dir": null } });

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
  });

  it("refuses when the per-worktree refs cannot be read", () => {
    const { git } = fakeGit({ answers: { "for-each-ref": null } });

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
  });

  it("refuses an index whose resolve-undo record keeps a resolved conflict's sides", () => {
    const { git } = fakeGit({ answers: { "ls-files": `100644 ${STRAY} 2\tf.txt` } });

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
  });

  it("refuses an index whose entries are not rev's, a blob staged since standing on nothing else", () => {
    const { git } = fakeGit({ answers: { "diff-index": null } });

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
  });

  it("refuses when the resolve-undo record cannot be read", () => {
    const { git } = fakeGit({ answers: { "ls-files": null } });

    expect(privateHistoryWithinHead({ git, path: dir, rev: HEAD })).toBe(false);
  });

  it("asks git only for the two gitdirs, the replace and per-worktree refs, the index's diff and resolve-undo", () => {
    const { git, asked } = fakeGit();
    privateHistoryWithinHead({ git, path: dir, rev: HEAD });

    expect(asked).toEqual([
      "rev-parse --absolute-git-dir",
      "rev-parse --path-format=absolute --git-common-dir",
      "for-each-ref --format=%(refname) refs/replace/",
      "for-each-ref --format=%(objectname) refs/bisect/ refs/worktree/ refs/rewritten/",
      `diff-index --cached --quiet --ignore-submodules=none ${HEAD} --`,
      "ls-files --resolve-undo",
    ]);
  });
});
