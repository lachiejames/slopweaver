/**
 * `mergeFacts.ts` — the pure parsers against literal git output, plus the real-git proof of the two
 * measurements against a genuine temp repository. `gitInTemp` per `src/__tests__/tempGitRepo.ts` — a test may
 * not shell git any other way.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  combineDiffPaths,
  measureMergeFacts,
  parseAddedPaths,
  parseLsTreeBlobs,
  parseNameStatus,
  parseNumstatRemovals,
  parseRawBlobHistory,
  pathSlices,
  revertedPaths,
} from "../../../../outbound/github/mergeFacts.js";
import { mergeGuardFindings } from "../../../../outbound/github/mergeGuard.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";

/** `--numstat -z`'s real shape: tab between the three numeric/path fields, NUL as the record terminator. */
const NUMSTAT_RECORD_SEP = "\0";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("parseNumstatRemovals", () => {
  it("reads the removed-line count for each record", () => {
    const output = ["5\t2\tsrc/a.ts", "3\t0\tsrc/b.ts"].join(NUMSTAT_RECORD_SEP) + NUMSTAT_RECORD_SEP;
    expect(parseNumstatRemovals({ output })).toEqual(
      new Map([
        ["src/a.ts", 2],
        ["src/b.ts", 0],
      ]),
    );
  });

  it("reports 0 for a binary file's `-`/`-` counts, never guessing", () => {
    const output = `-\t-\tsrc/image.png${NUMSTAT_RECORD_SEP}`;
    expect(parseNumstatRemovals({ output })).toEqual(new Map([["src/image.png", 0]]));
  });

  it("returns an empty map for empty output", () => {
    expect(parseNumstatRemovals({ output: "" })).toEqual(new Map());
  });
});

describe("parseNameStatus", () => {
  it("maps A/D to added/deleted and anything else to modified", () => {
    // `-z` NUL-separates every FIELD, not just the record: a plain entry prints `status<NUL>path<NUL>`,
    // never `status<TAB>path<NUL>` — measured directly against real git output, which is why every field
    // below is joined with a NUL rather than a tab.
    const tokens = ["A", "src/new.ts", "D", "src/gone.ts", "M", "src/changed.ts", "T", "src/typechange.ts"];
    const output = tokens.join("\0") + "\0";
    expect(parseNameStatus({ output })).toEqual([
      { path: "src/new.ts", status: "added" },
      { path: "src/gone.ts", status: "deleted" },
      { path: "src/changed.ts", status: "modified" },
      { path: "src/typechange.ts", status: "modified" },
    ]);
  });

  it("returns an empty list for empty output", () => {
    expect(parseNameStatus({ output: "" })).toEqual([]);
  });
});

describe("combineDiffPaths", () => {
  it("attaches each path's removal count, defaulting to 0 when the path has none", () => {
    const statuses = [
      { path: "src/a.ts", status: "modified" as const },
      { path: "src/b.ts", status: "added" as const },
    ];
    const removals = new Map([["src/a.ts", 7]]);
    expect(combineDiffPaths({ removals, statuses })).toEqual([
      { deleted: 7, path: "src/a.ts", status: "modified" },
      { deleted: 0, path: "src/b.ts", status: "added" },
    ]);
  });
});

describe("parseAddedPaths", () => {
  it("collects non-blank lines as a set", () => {
    expect(parseAddedPaths({ output: "src/a.ts\n\nsrc/b.ts\n" })).toEqual(new Set(["src/a.ts", "src/b.ts"]));
  });

  it("returns an empty set for empty output", () => {
    expect(parseAddedPaths({ output: "" })).toEqual(new Set());
  });
});

/** A fresh temp git repo, initialised on `main` with committer identity set. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "merge-facts-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  return dir;
}

describe("measureMergeFacts against a real repository", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reports added, modified and deleted paths with correct removal counts", () => {
    const dir = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };
    writeFileSync(join(dir, "kept.txt"), "line one\nline two\nline three\n");
    git("add", "-A");
    git("commit", "-m", "base");
    git("checkout", "-b", "feature");
    writeFileSync(join(dir, "kept.txt"), "line one\n");
    writeFileSync(join(dir, "new.ts"), "export const added = 1;\n");
    git("add", "-A");
    git("commit", "-m", "work");

    const facts = measureMergeFacts({ base: "main", cwd: dir, head: "feature" });

    expect(facts.diff).toEqual([
      { deleted: 2, path: "kept.txt", status: "modified" },
      { deleted: 0, path: "new.ts", status: "added" },
    ]);
  });

  it("reports a path base holds and head has never seen as `baseAhead` — staleness, not a deletion", () => {
    const dir = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };
    writeFileSync(join(dir, "kept.txt"), "original\n");
    git("add", "-A");
    git("commit", "-m", "fork point");
    git("checkout", "-b", "feature");
    writeFileSync(join(dir, "feature-work.ts"), "export const work = 1;\n");
    git("add", "-A");
    git("commit", "-m", "feature work");
    git("checkout", "main");
    writeFileSync(join(dir, "gained.ts"), "export const gained = 1;\n");
    git("add", "-A");
    git("commit", "-m", "base gains a file");

    const facts = measureMergeFacts({ base: "main", cwd: dir, head: "feature" });

    expect(facts.baseAhead).toEqual(["gained.ts"]);
  });

  it("returns an empty baseAhead when the branch is level with base", () => {
    const dir = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };
    writeFileSync(join(dir, "kept.txt"), "original\n");
    git("add", "-A");
    git("commit", "-m", "fork point");
    git("checkout", "-b", "feature");
    writeFileSync(join(dir, "feature-work.ts"), "export const work = 1;\n");
    git("add", "-A");
    git("commit", "-m", "feature work");

    const facts = measureMergeFacts({ base: "main", cwd: dir, head: "feature" });

    expect(facts.baseAhead).toEqual([]);
  });

  /**
   * The measured incident, reconstructed exactly: a branch forks, `main` gains a file while the branch is in
   * flight, and the branch is squashed with `git reset --soft main` — which keeps the branch's own tree and
   * moves it directly onto `main`'s CURRENT tip.
   *
   * The two cases are separated by WHICH signal fires, not by both firing.
   *
   * Here, `baseAhead` is provably empty: `reset --soft` makes the squash commit's parent base's own tip, so
   * `merge-base head base` returns that tip and "paths base added strictly after the merge-base" asks about
   * the empty range `<tip>..<tip>`. Nothing was gained after a fork point that IS the tip. What catches this
   * incident is the DIFF — base's file is genuinely absent from the squashed tree, so it reads as a plain
   * unmentioned deletion, and that alone makes the guard refuse.
   *
   * A branch that merely forked early is the mirror image: `baseAhead` names the files base has gained, and
   * the merge-base diff shows no deletion at all, because merging would keep every one of them.
   */
  it("the reset --soft incident: baseAhead is provably empty and the DELETION is what refuses it", () => {
    const dir = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };
    writeFileSync(join(dir, "kept.txt"), "original\n");
    git("add", "-A");
    git("commit", "-m", "fork point");
    git("checkout", "-b", "feature");
    writeFileSync(join(dir, "feature-work.ts"), "export const work = 1;\n");
    git("add", "-A");
    git("commit", "-m", "feature work");
    git("checkout", "main");
    writeFileSync(join(dir, "gained.ts"), "export const gained = 1;\nexport const also = 2;\n");
    git("add", "-A");
    git("commit", "-m", "213: base gains a file");
    git("checkout", "feature");
    git("reset", "--soft", "main");
    git("commit", "-m", "214: squashed onto main");

    const facts = measureMergeFacts({ base: "main", cwd: dir, head: "feature" });

    expect(facts.diff).toEqual([
      { deleted: 0, path: "feature-work.ts", status: "added" },
      { deleted: 2, path: "gained.ts", status: "deleted" },
    ]);
    expect(facts.baseAhead).toEqual([]);
    // `gained.ts` never existed at the fork point, so it is not a candidate for `reverted` either — the
    // MODIFIED-file case is reconstructed separately below.
    expect(facts.reverted).toEqual([]);

    const findings = mergeGuardFindings({
      baseAhead: facts.baseAhead,
      deletionThreshold: 100,
      description: "adds feature work",
      diff: facts.diff,
      regressions: [],
      reverted: facts.reverted,
    });

    expect(findings.map((f) => `${f.kind}:${f.subject}`)).toEqual(["unmentioned-deletion:gained.ts"]);
  });

  /**
   * The gap the above incident leaves open: a file that existed AT the fork point, which `main` modified
   * afterward. A `git reset --soft main` squash's tree is the branch's old, pre-fork tree, so this file
   * reappears in the diff as though the branch deliberately reverted `main`'s change — with no new-file
   * signature to catch it, and (unlike a deletion) no guarantee the line count crosses any threshold.
   */
  it("the reset --soft incident on a MODIFIED file: reports it as reverted, naming base's own commit", () => {
    const dir = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };
    writeFileSync(join(dir, "poster.ts"), "export const version = 1;\n");
    git("add", "-A");
    git("commit", "-m", "fork point");
    git("checkout", "-b", "feature");
    writeFileSync(join(dir, "feature-work.ts"), "export const work = 1;\n");
    git("add", "-A");
    git("commit", "-m", "feature work");
    git("checkout", "main");
    writeFileSync(join(dir, "poster.ts"), "export const version = 2;\n");
    git("add", "-A");
    git("commit", "-m", "446: main changes poster.ts");
    git("checkout", "feature");
    git("reset", "--soft", "main");
    git("commit", "-m", "squashed onto main");

    const facts = measureMergeFacts({ base: "main", cwd: dir, head: "feature" });
    const forkPoint = gitInTemp({ args: ["rev-parse", "main~1"], cwd: dir }).trim();

    // The commit travels with the path: base held this exact content at the fork point and holds `version = 2`
    // at its tip, which is the whole of what was measured and the whole of what the finding may claim.
    expect(facts.reverted).toEqual([{ path: "poster.ts", restoresBaseCommit: forkPoint }]);

    const findings = mergeGuardFindings({
      baseAhead: facts.baseAhead,
      deletionThreshold: 100,
      description: "adds feature work, mentions poster.ts too",
      diff: facts.diff,
      regressions: [],
      reverted: facts.reverted,
    });

    // Reported even though the description NAMES poster.ts — a mention does not make discarding base's
    // own change on that file any safer, unlike `unmentioned-deletion`.
    expect(findings.map((f) => `${f.kind}:${f.subject}`)).toEqual(["reverts-main:poster.ts"]);
  });

  it("does not report a file the branch itself independently touched, even if base also changed it", () => {
    const dir = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };
    writeFileSync(join(dir, "poster.ts"), "export const version = 1;\n");
    git("add", "-A");
    git("commit", "-m", "fork point");
    git("checkout", "-b", "feature");
    writeFileSync(join(dir, "poster.ts"), "export const version = 1;\nexport const branchOwn = true;\n");
    git("add", "-A");
    git("commit", "-m", "feature: branch edits poster.ts too");
    git("checkout", "main");
    writeFileSync(join(dir, "poster.ts"), "export const version = 2;\n");
    git("add", "-A");
    git("commit", "-m", "446: main changes poster.ts");

    const facts = measureMergeFacts({ base: "main", cwd: dir, head: "feature" });

    expect(facts.reverted).toEqual([]);
  });

  it("reads a path holding glob characters literally, and judges several restored paths in one read", () => {
    const dir = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: dir });
    };
    writeFileSync(join(dir, "[ab].ts"), "old bracket\n");
    writeFileSync(join(dir, "a.ts"), "old a\n");
    writeFileSync(join(dir, "plain.ts"), "old plain\n");
    git("add", "-A");
    git("commit", "-m", "first");
    const first = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    writeFileSync(join(dir, "[ab].ts"), "new bracket\n");
    writeFileSync(join(dir, "a.ts"), "new a\n");
    writeFileSync(join(dir, "plain.ts"), "new plain\n");
    git("add", "-A");
    git("commit", "-m", "second");
    git("checkout", "-b", "feature");
    writeFileSync(join(dir, "[ab].ts"), "old bracket\n");
    writeFileSync(join(dir, "plain.ts"), "old plain\n");
    git("add", "-A");
    git("commit", "-m", "restore two");

    const facts = measureMergeFacts({ base: "main", cwd: dir, head: "feature" });

    // As a glob, `[ab].ts` matches `a.ts` and never the file literally named `[ab].ts`, so its history would read
    // empty and its restore go unreported; read literally it restores `first`.
    expect(facts.reverted).toEqual([
      { path: "[ab].ts", restoresBaseCommit: first },
      { path: "plain.ts", restoresBaseCommit: first },
    ]);
  });

  it("still finds a revert over signed commits when the repository shows signatures in its log", () => {
    const dir = initRepo();
    const git = (...args: string[]): string => gitInTemp({ args, cwd: dir });
    const key = join(dir, ".signing-key");
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "test@example.invalid", "-f", key]);
    const publicKey = readFileSync(`${key}.pub`, "utf8").trim();
    writeFileSync(join(dir, ".allowed-signers"), `test@example.invalid ${publicKey}\n`);
    writeFileSync(join(dir, ".git", "info", "exclude"), ".signing-key*\n.allowed-signers\n");
    git("config", "gpg.format", "ssh");
    git("config", "user.signingkey", `${key}.pub`);
    git("config", "gpg.ssh.allowedSignersFile", join(dir, ".allowed-signers"));
    git("config", "commit.gpgsign", "true");
    git("config", "log.showSignature", "true");
    writeFileSync(join(dir, "shared.ts"), "old\n");
    git("add", "-A");
    git("commit", "-m", "first");
    const first = git("rev-parse", "HEAD");
    writeFileSync(join(dir, "shared.ts"), "current\n");
    git("commit", "-am", "second");
    git("checkout", "-b", "feature");
    writeFileSync(join(dir, "shared.ts"), "old\n");
    git("commit", "-am", "restore");

    // With signatures shown, the verification line lands in the same NUL token as the commit marker.
    expect(git("log", "-1", "--format=%x01%H", "main")).toContain("signature");
    expect(measureMergeFacts({ base: "main", cwd: dir, head: "feature" }).reverted).toEqual([
      { path: "shared.ts", restoresBaseCommit: first },
    ]);
  });
});

describe("parseRawBlobHistory", () => {
  const OLD = "1".repeat(40);
  const NEW = "2".repeat(40);
  const NULL = "0".repeat(40);
  const C1 = "a".repeat(40);
  const C2 = "b".repeat(40);

  it("collects each path's blobs most recent first, skipping a deletion's null blob", () => {
    // The shape `git log --raw --no-abbrev -z --format=%x01%H` prints, measured against real git output.
    const output = [
      `\u0001${C2}`,
      `\n:100644 000000 ${NEW} ${NULL} D`,
      "x.ts",
      `:100644 100644 ${OLD} ${NEW} M`,
      "y: odd.ts",
      `\u0001${C1}`,
      `\n:000000 100644 ${NULL} ${OLD} A`,
      "y: odd.ts",
      "",
    ].join("\0");
    expect(parseRawBlobHistory({ output })).toEqual(
      new Map([
        [
          "y: odd.ts",
          [
            { blob: NEW, commit: C2 },
            { blob: OLD, commit: C1 },
          ],
        ],
      ]),
    );
  });

  it("attributes a rename's blob to its destination and keeps every later path in step", () => {
    // A rename record carries two path tokens; reading one would file the blob under the source and every
    // following meta token as a path.
    const output = [
      `\u0001${C2}`,
      `\n:100644 100644 ${OLD} ${OLD} R100`,
      "old.ts",
      "new.ts",
      `:100644 100644 ${OLD} ${NEW} M`,
      "z.ts",
      "",
    ].join("\0");
    expect(parseRawBlobHistory({ output })).toEqual(
      new Map([
        ["new.ts", [{ blob: OLD, commit: C2 }]],
        ["z.ts", [{ blob: NEW, commit: C2 }]],
      ]),
    );
  });

  it("parses the rename record real git prints when rename detection is on", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const dir = initRepo();
    const git = (...args: string[]): string => gitInTemp({ args, cwd: dir });
    writeFileSync(join(dir, "old.ts"), "same\n");
    git("add", "-A");
    git("commit", "-m", "add");
    git("mv", "old.ts", "new.ts");
    git("commit", "-m", "rename");
    const renamed = git("rev-parse", "HEAD");
    const blob = git("rev-parse", "HEAD:new.ts");
    const output = git("log", "-1", "-M", "--raw", "--no-abbrev", "-z", "--format=%x01%H", "HEAD");
    const history = parseRawBlobHistory({ output });
    expect(output).toContain("R100");
    expect([...history.keys()]).toEqual(["new.ts"]);
    expect(history.get("new.ts")).toEqual([{ blob, commit: renamed }]);
  });

  it("returns an empty map for empty output", () => {
    expect(parseRawBlobHistory({ output: "" })).toEqual(new Map());
  });
});

describe("parseLsTreeBlobs", () => {
  it("keeps a blob and a submodule's commit, and leaves a tree out", () => {
    const output = [
      `100644 blob ${"1".repeat(40)}\tsrc/a.ts`,
      `160000 commit ${"2".repeat(40)}\tvendor`,
      `040000 tree ${"3".repeat(40)}\tdocs`,
      "",
    ].join("\u0000");
    expect(parseLsTreeBlobs({ output })).toEqual(
      new Map([
        ["src/a.ts", "1".repeat(40)],
        ["vendor", "2".repeat(40)],
      ]),
    );
  });
});

describe("revertedPaths", () => {
  const history = new Map([
    [
      "a.ts",
      [
        { blob: "now", commit: "c3" },
        { blob: "mid", commit: "c2" },
        { blob: "old", commit: "c1" },
      ],
    ],
  ]);

  it("reports the most recent earlier commit holding head's blob", () => {
    expect(revertedPaths({ headBlobs: new Map([["a.ts", "mid"]]), history, paths: ["a.ts"] })).toEqual([
      { path: "a.ts", restoresBaseCommit: "c2" },
    ]);
  });

  it("says nothing of head matching base's current blob, a blob base never held, or a path with no history", () => {
    const headBlobs = new Map([
      ["a.ts", "now"],
      ["b.ts", "old"],
    ]);
    expect(revertedPaths({ headBlobs, history, paths: ["a.ts", "b.ts"] })).toEqual([]);
    expect(revertedPaths({ headBlobs: new Map([["a.ts", "novel"]]), history, paths: ["a.ts"] })).toEqual([]);
  });
});

describe("pathSlices", () => {
  it("keeps an ordinary diff in one slice", () => {
    expect(pathSlices({ paths: ["a.ts", "b.ts"] })).toEqual([["a.ts", "b.ts"]]);
  });

  it("splits a diff whose paths overflow one read's argv budget, in order", () => {
    const long = "p".repeat(200 * 1024);
    expect(pathSlices({ paths: [long, long, "c.ts"] })).toEqual([[long], [long, "c.ts"]]);
  });

  it("returns no slice for no paths", () => {
    expect(pathSlices({ paths: [] })).toEqual([]);
  });
});
