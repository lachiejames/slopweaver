/**
 * `cmux/worktreeHeldBranch.ts` over real files in a throwaway directory — the state git writes for a rebase or
 * bisect, laid out by hand, so each of git's own predicates is pinned without running git. The real-git
 * regression is `subprocess/cmux/worktree.test.ts`'s.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  gitBranchName,
  heldBranchesAnywhere,
  heldBranchesInGitDir,
  type ListingRepository,
  type ObjectIds,
  readHeldBranches,
  worktreeAdminDirs,
} from "../../../cmux/worktreeHeldBranch.js";

const FULL_ID = "a".repeat(40);

const FULL_SHA256_ID = "b".repeat(64);

/** A fake SHA-1 repository standing in for git: seven-character abbreviations, as a small repository gets. */
const sevenChars: ObjectIds = { abbreviate: ({ objectId }) => objectId.slice(0, 7), hexLength: () => 40 };

/** A fake SHA-1 repository whose store lacks the object, where `rev-parse --short` refuses. */
const cannotAbbreviate: ObjectIds = { abbreviate: () => null, hexLength: () => 40 };

/** A fake SHA-256 repository, whose `get_oid_hex` wants sixty-four digits. */
const sha256: ObjectIds = { abbreviate: ({ objectId }) => objectId.slice(0, 7), hexLength: () => 64 };

let root: string;

beforeEach(() => {
  // Canonical, because git lists a tree whose gitdir record is relative at its real path (darwin's tmpdir is a link).
  root = realpathSync(mkdtempSync(join(tmpdir(), "held-branch-")));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Write one file under the fixture root, creating its parents. */
function put({ path, text }: { path: string; text: string }): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
}

/** The branches held in one fixture git directory. */
function heldIn({ dir }: { dir: string }): readonly string[] {
  return heldBranchesInGitDir({ gitDir: join(root, dir), objectIds: sevenChars });
}

describe("gitBranchName", () => {
  it("strips refs/heads/ and keeps any other refs/ name whole, as get_branch does", () => {
    expect(gitBranchName({ objectIds: sevenChars, text: "refs/heads/feat/x\n" })).toBe("feat/x");
    expect(gitBranchName({ objectIds: sevenChars, text: "refs/remotes/origin/x\n" })).toBe("refs/remotes/origin/x");
  });

  // Reproduced on git 2.54.0: a bisect started on a detached HEAD held the id's abbreviation.
  it("shortens a full object id through the given shortener, and holds nothing when it cannot", () => {
    expect(gitBranchName({ objectIds: sevenChars, text: `${FULL_ID}\n` })).toBe("aaaaaaa");
    expect(gitBranchName({ objectIds: sevenChars, text: `${FULL_ID}zz\n` })).toBe("aaaaaaa");
    expect(gitBranchName({ objectIds: cannotAbbreviate, text: `${FULL_ID}\n` })).toBe(null);
  });

  //a SHA-256 repository's get_oid_hex wants sixty-four digits, so forty is a branch name there.
  it("keeps a forty-hex name verbatim in a SHA-256 repository and shortens a sixty-four-digit id", () => {
    expect(gitBranchName({ objectIds: sha256, text: `${FULL_ID}\n` })).toBe(FULL_ID);
    expect(gitBranchName({ objectIds: sha256, text: `${FULL_SHA256_ID}\n` })).toBe("bbbbbbb");
  });

  it("never asks the object format of a name too short to be any id", () => {
    const formatNeverRead: ObjectIds = {
      abbreviate: () => null,
      hexLength: () => {
        throw new Error("the object format was read for a name no format could parse as an id");
      },
    };
    expect(gitBranchName({ objectIds: formatNeverRead, text: "abc1234\n" })).toBe("abc1234");
  });

  it("holds nothing for detached HEAD, an empty file or an unreadable one", () => {
    expect(gitBranchName({ objectIds: sevenChars, text: "detached HEAD\n" })).toBe(null);
    expect(gitBranchName({ objectIds: sevenChars, text: "\n" })).toBe(null);
    expect(gitBranchName({ objectIds: sevenChars, text: null })).toBe(null);
  });

  it("keeps anything else verbatim, stripping trailing LF only", () => {
    expect(gitBranchName({ objectIds: sevenChars, text: "feat/x\n\n" })).toBe("feat/x");
    expect(gitBranchName({ objectIds: sevenChars, text: "feat/x\r\n" })).toBe("feat/x\r");
  });
});

describe("worktreeAdminDirs", () => {
  const wtEntry = (): string => join(root, "main", ".git", "worktrees", "wt");

  it("answers the common directory for the main checkout", () => {
    const commonDir = join(root, "main", ".git");
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "main") })).toEqual([commonDir]);
  });

  //a --separate-git-dir main checkout is listed at the common directory itself.
  it("answers the common directory for a main checkout listed at that directory itself", () => {
    const commonDir = join(root, "common");
    expect(worktreeAdminDirs({ commonDir, worktreePath: commonDir })).toEqual([commonDir]);
  });

  it("answers the worktrees entry whose absolute gitdir names the tree's .git", () => {
    const commonDir = join(root, "main", ".git");
    put({ path: "main/.git/worktrees/other/gitdir", text: `${join(root, "other", ".git")}\n` });
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}\n` });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "wt") })).toEqual([wtEntry()]);
  });

  //`worktree add --force` over a missing tree's path records a second entry naming that path.
  it("answers every entry naming the path, in directory order", () => {
    const commonDir = join(root, "main", ".git");
    put({ path: "main/.git/worktrees/a-first/gitdir", text: `${join(root, "wt", ".git")}\n` });
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}\n` });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "wt") })).toEqual([
      join(commonDir, "worktrees", "a-first"),
      wtEntry(),
    ]);
  });

  //a linked record naming the main checkout's own path is listed, and its state read, too.
  it("answers a linked record naming the main checkout's path after the common directory", () => {
    const commonDir = join(root, "main", ".git");
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "main", ".git")}\n` });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "main") })).toEqual([commonDir, wtEntry()]);
  });

  //git keeps an absolute record verbatim, so porcelain lists the `..` and the lookup must match it.
  it("matches an absolute record carrying a dot segment by its text, as git lists it", () => {
    const commonDir = join(root, "main", ".git");
    const listed = `${join(root, "x")}/../wt`;
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${listed}/.git\n` });
    expect(worktreeAdminDirs({ commonDir, worktreePath: listed })).toEqual([wtEntry()]);
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "wt") })).toEqual([]);
  });

  //git's get_linked_worktree strbuf_rtrims the record, so trailing spaces still name the tree.
  it("matches a gitdir record carrying trailing whitespace, as git's rtrim does", () => {
    const commonDir = join(root, "main", ".git");
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}   \t\r\n` });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "wt") })).toEqual([wtEntry()]);
  });

  it("keeps a trailing Unicode space, which git's isspace does not trim", () => {
    const commonDir = join(root, "main", ".git");
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")} \n` });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "wt") })).toEqual([]);
  });

  it("resolves a relative gitdir against its own entry, as worktree.useRelativePaths writes it", () => {
    const commonDir = join(root, "main", ".git");
    put({ path: "main/.git/worktrees/wt/gitdir", text: "../../../../wt/.git\n" });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "wt") })).toEqual([wtEntry()]);
  });

  //git realpaths a RELATIVE record, so a symlink on its way lists the tree at the real path.
  it("resolves symlinks in a relative gitdir record, but takes an absolute one as written", () => {
    const commonDir = join(root, "main", ".git");
    put({ path: "real/wt/.git", text: "gitdir: elsewhere\n" });
    symlinkSync(join(root, "real"), join(root, "alias"));
    put({ path: "main/.git/worktrees/wt/gitdir", text: "../../../../alias/wt/.git\n" });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "real", "wt") })).toEqual([wtEntry()]);
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "alias", "wt", ".git")}\n` });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "alias", "wt") })).toEqual([wtEntry()]);
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "real", "wt") })).toEqual([]);
  });

  it("resolves the existing prefix of a relative record whose tree is gone, as git's forgiving realpath does", () => {
    const commonDir = join(root, "main", ".git");
    symlinkSync(join(root, "main"), join(root, "alias"));
    put({ path: "main/.git/worktrees/wt/gitdir", text: "../../../../alias/gone/.git\n" });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "main", "gone") })).toEqual([wtEntry()]);
  });

  it("answers none when the repository records no tree at the path, whatever .git sits there", () => {
    const commonDir = join(root, "main", ".git");
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "moved", ".git")}\n` });
    put({ path: "wt/.git", text: `gitdir: ${join(root, "foreign", "wt")}\n` });
    expect(worktreeAdminDirs({ commonDir, worktreePath: join(root, "wt") })).toEqual([]);
    expect(worktreeAdminDirs({ commonDir: join(root, "gone", ".git"), worktreePath: join(root, "wt") })).toEqual([]);
  });
});

describe("heldBranchesInGitDir", () => {
  it("reads an interactive or merge rebase's head-name", () => {
    put({ path: "g/rebase-merge/head-name", text: "refs/heads/backup-ssd\n" });
    expect(heldIn({ dir: "g" })).toEqual(["backup-ssd"]);
  });

  it("reads an apply rebase's head-name", () => {
    put({ path: "g/rebase-apply/head-name", text: "refs/heads/feat/x\n" });
    expect(heldIn({ dir: "g" })).toEqual(["feat/x"]);
  });

  it("holds nothing for git am, whose rebase-apply carries applying", () => {
    put({ path: "g/rebase-apply/head-name", text: "refs/heads/feat/x\n" });
    put({ path: "g/rebase-apply/applying", text: "" });
    expect(heldIn({ dir: "g" })).toEqual([]);
  });

  //git's wt_status_check_rebase never reads rebase-merge once rebase-apply exists.
  it("holds nothing from a rebase-merge beside a git am's rebase-apply, which shadows it", () => {
    put({ path: "g/rebase-apply/applying", text: "" });
    put({ path: "g/rebase-merge/head-name", text: "refs/heads/held\n" });
    expect(heldIn({ dir: "g" })).toEqual([]);
  });

  //git asks rebase-apply with a bare stat, so even a non-directory one shadows rebase-merge.
  it("holds nothing from a rebase-merge beside a rebase-apply that is not even a directory", () => {
    put({ path: "g/rebase-apply", text: "" });
    put({ path: "g/rebase-merge/head-name", text: "refs/heads/held\n" });
    expect(heldIn({ dir: "g" })).toEqual([]);
  });

  it("holds nothing for a rebase of a detached HEAD", () => {
    put({ path: "a/rebase-merge/head-name", text: "detached HEAD\n" });
    expect(heldIn({ dir: "a" })).toEqual([]);
  });

  it("reads a bisect's starting branch when BISECT_LOG is there", () => {
    put({ path: "g/BISECT_LOG", text: "git bisect start\n" });
    put({ path: "g/BISECT_START", text: "feat/x\n" });
    expect(heldIn({ dir: "g" })).toEqual(["feat/x"]);
  });

  it("holds nothing for a BISECT_START with no BISECT_LOG", () => {
    put({ path: "a/BISECT_START", text: "feat/x\n" });
    expect(heldIn({ dir: "a" })).toEqual([]);
  });

  // A hex-named branch shorter than an id is a name, kept verbatim; a full id is shortened.
  it("reads a short hex BISECT_START verbatim and a full id as its abbreviation", () => {
    put({ path: "a/BISECT_LOG", text: "git bisect start\n" });
    put({ path: "a/BISECT_START", text: "abc1234\n" });
    put({ path: "b/BISECT_LOG", text: "git bisect start\n" });
    put({ path: "b/BISECT_START", text: `${FULL_ID}\n` });
    expect(heldIn({ dir: "a" })).toEqual(["abc1234"]);
    expect(heldIn({ dir: "b" })).toEqual(["aaaaaaa"]);
  });

  //git asks rebase and bisect independently, so a detached rebase inside a bisect hides nothing.
  it("reads the bisect's branch through a rebase of the HEAD the bisect detached", () => {
    put({ path: "g/rebase-merge/head-name", text: "detached HEAD\n" });
    put({ path: "g/BISECT_LOG", text: "git bisect start\n" });
    put({ path: "g/BISECT_START", text: "held\n" });
    expect(heldIn({ dir: "g" })).toEqual(["held"]);
  });

  it("reads both branches when a rebase of another branch started mid-bisect, the rebase's first", () => {
    put({ path: "g/rebase-merge/head-name", text: "refs/heads/other\n" });
    put({ path: "g/BISECT_LOG", text: "git bisect start\n" });
    put({ path: "g/BISECT_START", text: "held\n" });
    expect(heldIn({ dir: "g" })).toEqual(["other", "held"]);
  });

  // A counterexample: git held `other` and `aaaaaaa`, never the forty-character name.
  it("reads a rebase's branch beside a detached bisect's abbreviated starting id", () => {
    put({ path: "g/rebase-merge/head-name", text: "refs/heads/other\n" });
    put({ path: "g/BISECT_LOG", text: "git bisect start\n" });
    put({ path: "g/BISECT_START", text: `${FULL_ID}\n` });
    expect(heldIn({ dir: "g" })).toEqual(["other", "aaaaaaa"]);
  });

  it("names a branch once when the rebase and the bisect hold the same one", () => {
    put({ path: "g/rebase-merge/head-name", text: "refs/heads/held\n" });
    put({ path: "g/BISECT_LOG", text: "git bisect start\n" });
    put({ path: "g/BISECT_START", text: "held\n" });
    expect(heldIn({ dir: "g" })).toEqual(["held"]);
  });

  //a corrupt state path must not throw out of every worktree listing.
  it("holds nothing, rather than throwing, when head-name is a directory", () => {
    mkdirSync(join(root, "g", "rebase-merge", "head-name"), { recursive: true });
    expect(heldIn({ dir: "g" })).toEqual([]);
  });

  it("holds nothing in a git directory with no operation in progress", () => {
    mkdirSync(join(root, "g"), { recursive: true });
    expect(heldIn({ dir: "g" })).toEqual([]);
  });
});

describe("readHeldBranches", () => {
  const commonDir = (): string => join(root, "main", ".git");
  const repository = (): ListingRepository => ({ commonDir: commonDir(), cwd: join(root, "main") });

  it("reads the hold through the repository's own record of a linked worktree", () => {
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}\n` });
    put({ path: "main/.git/worktrees/wt/rebase-merge/head-name", text: "refs/heads/backup-ssd\n" });
    expect(readHeldBranches({ repository: repository(), worktreePath: join(root, "wt") })).toEqual(["backup-ssd"]);
  });

  it("answers no branches for a path the repository records no worktree at", () => {
    mkdirSync(commonDir(), { recursive: true });
    expect(readHeldBranches({ repository: repository(), worktreePath: join(root, "gone") })).toEqual([]);
  });

  //a moved checkout can leave another repository's tree at the listed path.
  it("never reads a hold out of a foreign repository's tree sitting at the listed path", () => {
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "moved", ".git")}\n` });
    put({ path: "wt/.git", text: `gitdir: ${join(root, "foreign", "wt")}\n` });
    put({ path: "foreign/wt/rebase-merge/head-name", text: "refs/heads/evil\n" });
    expect(readHeldBranches({ repository: repository(), worktreePath: join(root, "wt") })).toEqual([]);
  });

  //the hold lives in the repository's records, so a tree this process may not read still has it.
  it("reads the hold of a worktree directory this process may not read", () => {
    put({ path: "main/.git/worktrees/locked/gitdir", text: `${join(root, "locked", ".git")}\n` });
    put({ path: "main/.git/worktrees/locked/rebase-merge/head-name", text: "refs/heads/backup-ssd\n" });
    mkdirSync(join(root, "locked"), { recursive: true });
    chmodSync(join(root, "locked"), 0o000);
    try {
      expect(readHeldBranches({ repository: repository(), worktreePath: join(root, "locked") })).toEqual([
        "backup-ssd",
      ]);
    } finally {
      chmodSync(join(root, "locked"), 0o755);
    }
  });

  //this read runs inside every worktree listing, so an unreadable record must not throw for all of them.
  it("answers no branches rather than throwing when the repository's worktree records may not be read", () => {
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}\n` });
    chmodSync(join(commonDir(), "worktrees"), 0o000);
    try {
      expect(readHeldBranches({ repository: repository(), worktreePath: join(root, "wt") })).toEqual([]);
    } finally {
      chmodSync(join(commonDir(), "worktrees"), 0o755);
    }
  });
});

//a branch deletion reads every admin directory, since a path lookup misses a slot and a duplicate.
describe("heldBranchesAnywhere", () => {
  const repository = (): ListingRepository => ({ commonDir: join(root, "main", ".git"), cwd: join(root, "main") });

  it("reads a hold in the second of two records naming one path, and in the common directory", () => {
    const dotGit = `${join(root, "wt", ".git")}\n`;
    put({ path: "main/.git/worktrees/a-clean/gitdir", text: dotGit });
    put({ path: "main/.git/worktrees/z-held/gitdir", text: dotGit });
    put({ path: "main/.git/worktrees/z-held/BISECT_LOG", text: "git bisect start\n" });
    put({ path: "main/.git/worktrees/z-held/BISECT_START", text: "held\n" });
    put({ path: "main/.git/rebase-merge/head-name", text: "refs/heads/main-held\n" });

    expect(readHeldBranches({ repository: repository(), worktreePath: join(root, "wt") })).toEqual(["held"]);
    expect(heldBranchesAnywhere({ repository: repository() })!.toSorted()).toEqual(["held", "main-held"]);
  });

  it("answers unknown when a record's rebase state is there but its head-name cannot be read", () => {
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}\n` });
    put({ path: "main/.git/worktrees/wt/rebase-merge/head-name", text: "refs/heads/feature\n" });
    const headName = join(root, "main", ".git", "worktrees", "wt", "rebase-merge", "head-name");
    expect(heldBranchesAnywhere({ repository: repository() })).toEqual(["feature"]);
    chmodSync(headName, 0o000);
    try {
      expect(heldBranchesAnywhere({ repository: repository() })).toBe(null);
    } finally {
      chmodSync(headName, 0o644);
    }
  });

  it("answers unknown when a record's rebase-merge is a file, so its head-name cannot be read", () => {
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}\n` });
    put({ path: "main/.git/worktrees/wt/rebase-merge", text: "not a directory\n" });
    expect(heldBranchesAnywhere({ repository: repository() })).toBe(null);
    expect(readHeldBranches({ repository: repository(), worktreePath: join(root, "wt") })).toEqual([]);
  });

  it("answers unknown when a running bisect's BISECT_START is missing", () => {
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}\n` });
    put({ path: "main/.git/worktrees/wt/BISECT_LOG", text: "git bisect start\n" });
    expect(heldBranchesAnywhere({ repository: repository() })).toBe(null);
    expect(readHeldBranches({ repository: repository(), worktreePath: join(root, "wt") })).toEqual([]);
  });

  it("answers unknown when a record's own directory cannot be searched", () => {
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}\n` });
    const entry = join(root, "main", ".git", "worktrees", "wt");
    chmodSync(entry, 0o000);
    try {
      expect(heldBranchesAnywhere({ repository: repository() })).toBe(null);
    } finally {
      chmodSync(entry, 0o755);
    }
  });

  it("reads nothing held in a repository with no rebase, bisect or linked worktree", () => {
    put({ path: "main/.git/HEAD", text: "ref: refs/heads/main\n" });
    expect(heldBranchesAnywhere({ repository: repository() })).toEqual([]);
  });

  it("answers unknown when the linked records are there but cannot be listed", () => {
    put({ path: "main/.git/worktrees/wt/gitdir", text: `${join(root, "wt", ".git")}\n` });
    chmodSync(join(root, "main", ".git", "worktrees"), 0o000);
    try {
      expect(heldBranchesAnywhere({ repository: repository() })).toBe(null);
    } finally {
      chmodSync(join(root, "main", ".git", "worktrees"), 0o755);
    }
  });
});
