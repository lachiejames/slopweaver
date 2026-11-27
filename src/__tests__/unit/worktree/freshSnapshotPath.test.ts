import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { MAX_BOUND_SECONDS } from "../../../codex/bounds.js";
import {
  FRESH_SNAPSHOT_COMMIT_MESSAGE,
  FRESH_SNAPSHOT_MIN_AGE_MS,
  FRESH_SNAPSHOT_PREFIX,
  isFreshSnapshotTree,
  snapshotWarmReason,
  snapshotWitnessed,
} from "../../../worktree/freshSnapshotPath.js";
import type { GitRunner } from "../../../worktree/pruneGit.js";

/** An empty private gitdir, so the private-history read finds nothing and the shape and provenance decide. */
const PRIVATE_GIT_DIR = mkdtempSync(join(tmpdir(), "fresh-snapshot-gitdir-"));
afterAll(() => {
  rmSync(PRIVATE_GIT_DIR, { force: true, recursive: true });
});

/** Both spellings darwin gives its per-user temp directory, as `osTempRoots` returns them. */
const ROOTS = ["/var/folders/2g/abc/T/", "/private/var/folders/2g/abc/T"];

/** A git whose HEAD commit message is `message` for every tree — a plain fake passed in, not a mock. */
function gitWithHead({
  message,
  parent = "p1",
  tree = "t1",
  parentTree = "t1",
  holder = "refs/heads/main",
}: {
  message: string | null;
  parent?: string | null;
  tree?: string | null;
  parentTree?: string | null;
  holder?: string | null;
}): GitRunner {
  return ({ args }) => {
    if (args[0] === "log") {
      return message;
    }
    // The private-history read: an empty private gitdir, no replace or per-worktree refs, an index matching HEAD.
    const privateRead = ["--format=%(objectname)", "--resolve-undo", "refs/replace/", "--cached"];
    if (privateRead.some((flag) => args.includes(flag))) {
      return "";
    }
    if (args.includes("--absolute-git-dir")) {
      return PRIVATE_GIT_DIR;
    }
    if (args.includes("--git-common-dir")) {
      return "/shared/.git";
    }
    if (args[0] === "for-each-ref") {
      return holder;
    }
    const rev = args.at(-1)!;
    if (rev.endsWith("^")) {
      return parent;
    }
    if (rev === `${String(parent)}^{tree}`) {
      return parentTree;
    }
    return tree;
  };
}

describe("snapshotWitnessed — a snapshot is the last copy of nothing", () => {
  const witnessed = (over: Partial<Parameters<typeof gitWithHead>[0]>): boolean =>
    snapshotWitnessed({
      git: gitWithHead({ message: FRESH_SNAPSHOT_COMMIT_MESSAGE, ...over }),
      path: "/t/tree",
      rev: "HEAD",
    });

  it("is true when its tree is its parent's and a ref contains that parent", () => {
    expect(witnessed({})).toBe(true);
  });

  it("is false when no branch, tag or remote contains the commit it was frozen from", () => {
    expect(witnessed({ holder: "" })).toBe(false);
  });

  it("is false when it froze changes its source had not committed", () => {
    expect(witnessed({ tree: "t2" })).toBe(false);
  });

  it("asks for a witness among origin's remote-tracking refs only, so an archive remote's copy witnesses nothing", () => {
    const asked: string[] = [];
    const inner = gitWithHead({ message: FRESH_SNAPSHOT_COMMIT_MESSAGE });
    const git: GitRunner = ({ args, cwd }) => {
      asked.push(args.join(" "));
      return inner({ args, cwd });
    };
    expect(snapshotWitnessed({ git, path: "/t/tree", rev: "HEAD" })).toBe(true);
    expect(asked.filter((argv) => argv.startsWith("for-each-ref"))).toEqual([
      "for-each-ref --contains p1 --count=1 --format=%(refname) refs/heads/ refs/tags/ refs/remotes/origin/",
    ]);
  });

  it("is false when its parent, its tree or the ref list cannot be read", () => {
    expect([witnessed({ parent: null }), witnessed({ tree: null }), witnessed({ holder: null })]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

/** The snapshot code's own commit at HEAD, so a shape case decides on the shape alone. */
const SNAPSHOT_HEAD = gitWithHead({ message: FRESH_SNAPSHOT_COMMIT_MESSAGE });

/** Whether `path` is taken, at the snapshot's own commit unless another git is given. */
function taken({
  path,
  tempRoots = ROOTS,
  git = SNAPSHOT_HEAD,
}: {
  path: string;
  tempRoots?: readonly string[];
  git?: GitRunner;
}): boolean {
  return isFreshSnapshotTree({ git, path, tempRoots });
}

describe("isFreshSnapshotTree", () => {
  it("takes the exact shape git registers, under the realpath spelling", () => {
    expect(taken({ path: "/private/var/folders/2g/abc/T/slopweaver-snap-1aIQkT/tree" })).toBe(true);
  });

  it("takes it under a temp root given with a trailing separator", () => {
    expect(taken({ path: "/var/folders/2g/abc/T/slopweaver-snap-3H3vH8/tree" })).toBe(true);
  });

  it("refuses the exact shape when its HEAD is not the snapshot's own commit", () => {
    expect(
      taken({
        git: gitWithHead({ message: "my own work" }),
        path: "/private/var/folders/2g/abc/T/slopweaver-snap-1aIQkT/tree",
      }),
    ).toBe(false);
  });

  it("refuses the exact shape when its HEAD message cannot be read", () => {
    expect(
      taken({ git: gitWithHead({ message: null }), path: "/private/var/folders/2g/abc/T/slopweaver-snap-1aIQkT/tree" }),
    ).toBe(false);
  });

  it("refuses a pool slot, which the lease pool judges instead", () => {
    expect(taken({ path: "/private/var/folders/2g/abc/T/slopweaver-snap-pool/tree" })).toBe(false);
  });

  it("refuses the same shape outside every temp root", () => {
    expect(taken({ path: "/Users/someone/slopweaver-snap-1aIQkT/tree" })).toBe(false);
  });

  it("refuses a staging directory that is not the tree itself", () => {
    expect(taken({ path: "/private/var/folders/2g/abc/T/slopweaver-snap-1aIQkT" })).toBe(false);
  });

  it("refuses a tree one level deeper than the shape", () => {
    expect(taken({ path: "/private/var/folders/2g/abc/T/x/slopweaver-snap-1aIQkT/tree" })).toBe(false);
  });

  it("refuses a suffix that is not six mkdtemp characters", () => {
    expect(taken({ path: "/private/var/folders/2g/abc/T/slopweaver-snap-1aIQk/tree" })).toBe(false);
  });

  it("refuses any path when no temp root is known", () => {
    expect(taken({ path: "/private/var/folders/2g/abc/T/slopweaver-snap-1aIQkT/tree", tempRoots: [] })).toBe(false);
  });
});

describe("the snapshot constants", () => {
  it("names the prefix the snapshot code mints with", () => {
    expect(FRESH_SNAPSHOT_PREFIX).toBe("slopweaver-snap-");
  });

  it("names the message the snapshot code commits with", () => {
    expect(FRESH_SNAPSHOT_COMMIT_MESSAGE).toBe("slopweaver: frozen tree for one Codex pass");
  });

  it("waits longer than the longest Codex pass may run, so no live pass loses its snapshot", () => {
    expect(FRESH_SNAPSHOT_MIN_AGE_MS).toBeGreaterThan(MAX_BOUND_SECONDS * 1000);
  });
});

describe("snapshotWarmReason", () => {
  const NOW = 1_800_000_000_000;

  it("lets a snapshot untouched for exactly the minimum age go", () => {
    expect(snapshotWarmReason({ activityMs: NOW - FRESH_SNAPSHOT_MIN_AGE_MS, nowMs: NOW })).toBe(null);
  });

  it("keeps one touched a millisecond inside the minimum age — the commit made since the scan", () => {
    expect(snapshotWarmReason({ activityMs: NOW - FRESH_SNAPSHOT_MIN_AGE_MS + 1, nowMs: NOW })).toBe(
      "it was touched since the scan, inside the longest Codex pass — kept",
    );
  });

  it("keeps one whose activity could not be re-read", () => {
    expect(snapshotWarmReason({ activityMs: null, nowMs: NOW })).toBe(
      "its activity could not be re-read before removal — kept",
    );
  });
});
