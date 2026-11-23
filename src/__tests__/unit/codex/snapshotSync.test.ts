/**
 * How a held pool slot is moved, decided over a scripted fake git: which branch resets in place, which rebuilds,
 * and which refuses the tree. The same behaviour against a real repository is
 * `subprocess/codex/snapshotPool.test.ts`; this file pins the decisions themselves, one input at a time.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshotGitPrefix } from "../../../codex/snapshot.js";
import { checkoutFingerprint, type SnapshotGit } from "../../../codex/snapshotCheckout.js";
import type { HeldSlot } from "../../../codex/snapshotLease.js";
import { refuseUnpoolableTree, syncHeldSlot } from "../../../codex/snapshotSync.js";

/** What the fake answers one git call with: its stdout, or an error standing for a non-zero exit. */
type Answer = string | Error;

/** One scripted call, keyed by the label the code under test gives it. */
type Script = Record<string, Answer | ((call: { readonly cwd: string }) => Answer)>;

const COMMIT = "c0ffee";
const PREVIOUS = "decade";

let root: string;
let held: HeldSlot;
let commonGitDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "snap-sync-"));
  const slot = join(root, "pool", "slot-0");
  held = { busyMarker: "state.busy.1.000000000000.x", slot, tree: join(slot, "tree") };
  mkdirSync(held.tree, { recursive: true });
  writeFileSync(join(held.tree, ".git"), "gitdir: elsewhere\n");
  commonGitDir = join(root, "common");
  mkdirSync(join(commonGitDir, "info"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** A git that answers every call a clean, reusable slot makes, with `over` replacing any answer by label. */
function scriptedGit({ over = {} }: { over?: Script } = {}): { readonly git: SnapshotGit; readonly labels: string[] } {
  const unset = new Error("key unset");
  const script: Script = {
    "git cat-file": "",
    "git clean": "",
    "git config": "core.autocrlf=false\nuser.name=someone\n",
    "git config core.checkstat": unset,
    "git config core.filemode": unset,
    "git config core.trustctime": unset,
    "git diff --name-only": "src/a.ts\0",
    "git ls-files": "H src/a.ts\0",
    "git ls-tree": "100644 blob aaa\tsrc/a.ts\0",
    "git reset --hard": "",
    "git rev-parse": `${held.tree}\n`,
    "git rev-parse --git-path": `${join(root, "no-config.worktree")}\n`,
    "git var GIT_ATTR_GLOBAL": `${join(root, "no-global")}\n`,
    "git var GIT_ATTR_SYSTEM": `${join(root, "no-system")}\n`,
    "git worktree add": () => {
      mkdirSync(held.tree, { recursive: true });
      writeFileSync(join(held.tree, ".git"), "gitdir: rebuilt\n");
      return "";
    },
    "git worktree remove": "",
    ...over,
  };
  const labels: string[] = [];
  const git: SnapshotGit = (call) => {
    labels.push(call.label);
    const scripted = script[call.label];
    if (scripted === undefined) {
      throw new Error(`unscripted ${call.label}`);
    }
    const answer = typeof scripted === "function" ? scripted({ cwd: call.cwd }) : scripted;
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  return { git, labels };
}

/** Write the slot's own records: the checkout rules its tree was written under, and the commit it was synced to. */
function recordSlot({ checkout, synced }: { checkout: string; synced?: string }): void {
  writeFileSync(join(held.slot, "checkout"), checkout);
  if (synced !== undefined) {
    writeFileSync(join(held.slot, "synced"), synced);
  }
}

/** The fingerprint the default script yields. */
function scriptedFingerprint(): string {
  return checkoutFingerprint({
    commonGitDir,
    git: scriptedGit().git,
    off: snapshotGitPrefix({ staging: held.slot }),
    repoRoot: root,
  });
}

/** Sync the held slot with `git`, against the default script's fingerprint. */
function sync({ git }: { git: SnapshotGit }): void {
  syncHeldSlot({
    checkout: scriptedFingerprint(),
    commit: COMMIT,
    commonGitDir,
    git,
    held,
    poolRoot: join(root, "pool"),
    repoRoot: root,
  });
}

describe("syncHeldSlot", () => {
  it("resets in place when the slot was written under the same rules and nothing it checks changed", () => {
    recordSlot({ checkout: scriptedFingerprint(), synced: PREVIOUS });
    const { git, labels } = scriptedGit();
    sync({ git });
    expect(labels).toEqual([
      "git diff --name-only",
      "git rev-parse --git-path",
      "git rev-parse",
      "git config core.filemode",
      "git config core.trustctime",
      "git config core.checkstat",
      "git config",
      "git var GIT_ATTR_GLOBAL",
      "git var GIT_ATTR_SYSTEM",
      "git reset --hard",
      "git clean",
      "git ls-files",
    ]);
    expect(readFileSync(join(held.slot, "synced"), "utf8")).toBe(COMMIT);
  });

  it("rebuilds without diffing when the slot was written under different checkout rules", () => {
    recordSlot({ checkout: "stale", synced: PREVIOUS });
    const { git, labels } = scriptedGit();
    sync({ git });
    expect(labels).toEqual(["git worktree remove", "git worktree add"]);
    expect(readFileSync(join(held.slot, "checkout"), "utf8")).toBe(scriptedFingerprint());
    expect(readFileSync(join(held.slot, "synced"), "utf8")).toBe(COMMIT);
  });

  it("rebuilds when no synced commit is recorded", () => {
    recordSlot({ checkout: scriptedFingerprint() });
    const { git, labels } = scriptedGit();
    sync({ git });
    expect(labels).toEqual(["git worktree remove", "git worktree add"]);
  });

  it("rebuilds when a .gitattributes changed between the commit it last wrote and this one", () => {
    recordSlot({ checkout: scriptedFingerprint(), synced: PREVIOUS });
    const { git, labels } = scriptedGit({ over: { "git diff --name-only": "src/a.ts\0docs/.gitattributes\0" } });
    sync({ git });
    expect(labels).toEqual(["git diff --name-only", "git worktree remove", "git worktree add"]);
  });

  it("rebuilds when the slot gained a config of its own", () => {
    recordSlot({ checkout: scriptedFingerprint(), synced: PREVIOUS });
    const own = join(root, "config.worktree");
    writeFileSync(own, "[core]\n\tautocrlf = true\n");
    const { git, labels } = scriptedGit({ over: { "git rev-parse --git-path": `${own}\n` } });
    sync({ git });
    expect(labels).toEqual([
      "git diff --name-only",
      "git rev-parse --git-path",
      "git worktree remove",
      "git worktree add",
    ]);
  });

  it("rebuilds when the slot's git acts on some other tree", () => {
    recordSlot({ checkout: scriptedFingerprint(), synced: PREVIOUS });
    const { git, labels } = scriptedGit({ over: { "git rev-parse": `${root}\n` } });
    sync({ git });
    expect(labels.at(-3)).toBe("git rev-parse");
    expect(labels.slice(-2)).toEqual(["git worktree remove", "git worktree add"]);
  });

  it("rebuilds when config only the slot sees ignores ctime", () => {
    recordSlot({ checkout: scriptedFingerprint(), synced: PREVIOUS });
    const { git, labels } = scriptedGit({
      over: { "git config core.trustctime": ({ cwd }) => (cwd === held.tree ? "false" : new Error("key unset")) },
    });
    sync({ git });
    expect(labels).not.toContain("git reset --hard");
    expect(labels.slice(-2)).toEqual(["git worktree remove", "git worktree add"]);
  });

  it("rebuilds when the reset index still flags an entry skip-worktree", () => {
    recordSlot({ checkout: scriptedFingerprint(), synced: PREVIOUS });
    const { git, labels } = scriptedGit({ over: { "git ls-files": "H src/a.ts\0S src/b.ts\0" } });
    sync({ git });
    expect(labels.slice(-4)).toEqual(["git clean", "git ls-files", "git worktree remove", "git worktree add"]);
    expect(readFileSync(join(held.slot, "synced"), "utf8")).toBe(COMMIT);
  });

  it("rebuilds when git refuses the reset, and moves the old tree aside first", () => {
    recordSlot({ checkout: scriptedFingerprint(), synced: PREVIOUS });
    writeFileSync(join(held.tree, "left-behind.txt"), "x");
    const { git, labels } = scriptedGit({ over: { "git reset --hard": new Error("index.lock exists") } });
    sync({ git });
    expect(labels.slice(-3)).toEqual(["git reset --hard", "git worktree remove", "git worktree add"]);
    expect(existsSync(join(held.tree, "left-behind.txt"))).toBe(false);
  });

  it("discards the whole slot and rethrows when the rebuild fails", () => {
    recordSlot({ checkout: "stale", synced: PREVIOUS });
    const { git, labels } = scriptedGit({ over: { "git worktree add": new Error("disk full") } });
    expect(() => {
      sync({ git });
    }).toThrow("disk full");
    expect(labels).toEqual(["git worktree remove", "git worktree add", "git worktree remove"]);
    expect(existsSync(held.slot)).toBe(false);
  });
});

describe("refuseUnpoolableTree", () => {
  /** Run the refusal against `over`. */
  const refuse = ({ over }: { over: Script }): void => {
    refuseUnpoolableTree({
      commit: COMMIT,
      commonGitDir,
      git: scriptedGit({ over }).git,
      repoRoot: root,
      staging: held.slot,
    });
  };

  it("passes a plain tree, reading every check it makes", () => {
    const { git, labels } = scriptedGit();
    refuseUnpoolableTree({ commit: COMMIT, commonGitDir, git, repoRoot: root, staging: held.slot });
    expect(labels).toEqual([
      "git config core.filemode",
      "git config core.trustctime",
      "git config core.checkstat",
      "git ls-tree",
      "git var GIT_ATTR_GLOBAL",
      "git var GIT_ATTR_SYSTEM",
      "git config",
    ]);
  });

  it("refuses a repository whose core.filemode is false", () => {
    expect(() => {
      refuse({ over: { "git config core.filemode": "false\n" } });
    }).toThrow("core.filemode is false, so a pooled slot cannot restore a file's mode — use a fresh snapshot");
  });

  it("refuses a repository that ignores ctime, by core.trustctime or core.checkstat", () => {
    expect(() => {
      refuse({ over: { "git config core.trustctime": "false\n" } });
    }).toThrow("core.trustctime is false or core.checkstat is minimal");
    expect(() => {
      refuse({ over: { "git config core.checkstat": "minimal\n" } });
    }).toThrow("core.trustctime is false or core.checkstat is minimal");
  });

  it("refuses a tree carrying a gitlink", () => {
    expect(() => {
      refuse({ over: { "git ls-tree": "100644 blob aaa\tsrc/a.ts\u0000160000 commit bbb\tvendor/lib\u0000" } });
    }).toThrow("the tree carries a gitlink");
  });

  it("refuses a tree whose committed attributes route files through a smudging driver", () => {
    expect(() => {
      refuse({
        over: {
          "git cat-file": "*.bin filter=lfs diff=lfs\n",
          "git config": "filter.lfs.smudge=git-lfs smudge -- %f\n",
          "git ls-tree": "100644 blob aaa\tsrc/a.ts\u0000100644 blob ccc\tassets/.gitattributes\u0000",
        },
      });
    }).toThrow('the tree routes files through the "lfs" smudge filter');
  });

  it("refuses a driver named only by the repository's info/attributes", () => {
    writeFileSync(join(commonGitDir, "info", "attributes"), "*.dat filter=crypt\n");
    expect(() => {
      refuse({ over: { "git config": "filter.crypt.process=crypt-filter\n" } });
    }).toThrow('the "crypt" smudge filter');
  });

  it("pools a tree whose configured smudging driver nothing routes to", () => {
    expect(() => {
      refuse({ over: { "git config": "filter.lfs.smudge=git-lfs smudge -- %f\nfilter.lfs.required=true\n" } });
    }).not.toThrow();
  });
});

describe("checkoutFingerprint", () => {
  const fingerprint = ({ over }: { over: Script }): string =>
    checkoutFingerprint({
      commonGitDir,
      git: scriptedGit({ over }).git,
      off: snapshotGitPrefix({ staging: held.slot }),
      repoRoot: root,
    });

  it("ignores config that does not change a checkout's bytes", () => {
    expect(fingerprint({ over: { "git config": "core.autocrlf=false\nuser.name=someone else\n" } })).toBe(
      scriptedFingerprint(),
    );
  });

  it("moves with a checkout key, and tells an empty info/attributes from an absent one", () => {
    expect(fingerprint({ over: { "git config": "core.autocrlf=true\n" } })).not.toBe(scriptedFingerprint());
    const absent = scriptedFingerprint();
    writeFileSync(join(commonGitDir, "info", "attributes"), "");
    expect(scriptedFingerprint()).not.toBe(absent);
  });

  it("reads the global attributes file at the path git reports, trailing space and all", () => {
    const global = join(root, "attributes ");
    writeFileSync(global, "* text=auto\n");
    expect(fingerprint({ over: { "git var GIT_ATTR_GLOBAL": `${global}\n` } })).not.toBe(scriptedFingerprint());
  });
});
