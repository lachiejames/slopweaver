/**
 * The two reads behind the holds: ignored files no build writes again, and stashes made from a tree.
 * The pure halves against literal listings, then each read against a real repository, including the `null` a
 * read git cannot answer turns into.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isReproducibleLinkCandidate,
  isReproducibleOutput,
  readIgnoredWork,
  readTreeStashes,
  stashesTiedTo,
  uncommittedIgnored,
} from "../../../worktree/pruneContext.js";
import { readWorkingTree, realGit } from "../../../worktree/pruneGit.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const IDENTITY = ["-c", "user.email=a@b.c", "-c", "user.name=t"];

describe("isReproducibleOutput", () => {
  it.each([
    "node_modules/",
    "packages/app/node_modules/",
    "dist/",
    ".vitest-reports/",
    "apps/web/.next/",
    "apps/web/.next-e2e/",
    "tsconfig.tsbuildinfo",
    "src/routeTree.gen.ts",
    ".yarn/install-state.gz",
    ".DS_Store",
    ".gql-target",
    "packages/x/.gql-target",
    ".husky/_/pre-commit",
    ".claude/scheduled_tasks.lock",
    "packages/zenstack/logical-schema.prisma",
  ])("recognises %s as output a build writes again", (entry) => {
    expect(isReproducibleOutput({ entry })).toBe(true);
  });

  it.each([
    ".slopweaver/",
    ".slopweaver/run.json",
    ".codex/",
    ".env.local",
    "notes.md",
    ".claude/settings.local.json",
    "dist",
    ".gql-target/x",
  ])("holds %s, which nothing writes again", (entry) => {
    expect(isReproducibleOutput({ entry })).toBe(false);
  });
});

describe("isReproducibleLinkCandidate", () => {
  it.each(["node_modules", "packages/app/node_modules", "dist"])("names %s as a possible link", (entry) => {
    expect(isReproducibleLinkCandidate({ entry })).toBe(true);
  });

  it.each(["node_modules/", ".slopweaver", "notes.md", "node_modules.bak"])("does not name %s", (entry) => {
    expect(isReproducibleLinkCandidate({ entry })).toBe(false);
  });

  it("does not name an entry git printed in bytes that are not UTF-8, so it stays held", () => {
    expect(isReproducibleLinkCandidate({ entry: "�/node_modules" })).toBe(false);
  });

  it("holds such an entry even when the decoded path is a known link", () => {
    const entry = "�/node_modules";
    expect(uncommittedIgnored({ links: new Set([entry]), listing: `${entry}\0` })).toEqual([entry]);
  });
});

describe("uncommittedIgnored", () => {
  const none: ReadonlySet<string> = new Set();

  it("keeps only what the allowlist does not recognise, in git's order", () => {
    expect(uncommittedIgnored({ links: none, listing: "node_modules/\0.slopweaver/\0dist/\0.env.local\0" })).toEqual([
      ".slopweaver/",
      ".env.local",
    ]);
  });

  it("reads an empty listing as nothing held", () => {
    expect(uncommittedIgnored({ links: none, listing: "" })).toEqual([]);
  });

  it("passes a node_modules the disk shows is a link, and holds the same entry when it is a file", () => {
    const listing = "node_modules\0.env.local\0";
    expect(uncommittedIgnored({ links: new Set(["node_modules"]), listing })).toEqual([".env.local"]);
    expect(uncommittedIgnored({ links: none, listing })).toEqual(["node_modules", ".env.local"]);
  });

  it("holds a link the candidate rule does not name, whatever the disk says", () => {
    expect(uncommittedIgnored({ links: new Set([".slopweaver"]), listing: ".slopweaver\0" })).toEqual([".slopweaver"]);
  });
});

describe("stashesTiedTo", () => {
  const listing = [
    "s1\tabc\tWIP on topic: abc wip",
    "s2\tdef\tOn topic: named",
    "s3\tabc idx\tWIP on (no branch): abc detached",
    "s4\tfff\tOn other: unrelated",
    "s5\tfff\tOn topic-two: a prefix is not a match",
  ].join("\n");

  it("ties a stash by the branch its subject names, or by being made on the tree's HEAD", () => {
    expect(stashesTiedTo({ branch: "topic", headSha: "abc", listing })).toBe(3);
  });

  it("ties a detached tree's stash by its HEAD alone", () => {
    expect(stashesTiedTo({ branch: null, headSha: "abc", listing })).toBe(2);
  });

  it("ties nothing from an empty stash list", () => {
    expect(stashesTiedTo({ branch: "topic", headSha: "abc", listing: "" })).toBe(0);
  });
});

describe("the reads against a real repository", REAL_GIT_SUITE, () => {
  let dir = "";
  let tree = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-context-"));
    const repo = join(dir, "repo");
    mkdirSync(repo);
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: repo });
    writeFileSync(join(repo, ".gitignore"), "node_modules\n.slopweaver\n*.tsbuildinfo\n");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...IDENTITY, "commit", "-qm", "base"], cwd: repo });
    tree = join(dir, "tree");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "topic", tree], cwd: repo });
  }, REAL_GIT_TIMEOUT_MS);

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("reads a tree holding only build output as holding nothing", () => {
    mkdirSync(join(tree, "node_modules", "x"), { recursive: true });
    writeFileSync(join(tree, "node_modules", "x", "index.js"), "");
    writeFileSync(join(tree, "tsconfig.tsbuildinfo"), "{}");
    expect(readIgnoredWork({ git: realGit, path: tree })).toEqual([]);
  });

  it("reads a node_modules symlinked to another tree's as holding nothing, and a node_modules FILE as holding it", () => {
    const target = join(dir, "elsewhere-node_modules");
    mkdirSync(target);
    symlinkSync(target, join(tree, "node_modules"));
    expect(readIgnoredWork({ git: realGit, path: tree })).toEqual([]);
    rmSync(join(tree, "node_modules"));
    writeFileSync(join(tree, "node_modules"), "not a link\n");
    expect(readIgnoredWork({ git: realGit, path: tree })).toEqual(["node_modules"]);
  });

  it("holds an ignored file whose name opens with a space beside a node_modules symlink, rather than trimming it onto the link", () => {
    writeFileSync(join(tree, ".gitignore"), "node_modules\n.slopweaver\n*.tsbuildinfo\n/ node_modules\n");
    writeFileSync(join(tree, " node_modules"), "only copy\n");
    const target = join(dir, "elsewhere-node_modules");
    mkdirSync(target);
    symlinkSync(target, join(tree, "node_modules"));
    expect(readIgnoredWork({ git: realGit, path: tree })).toEqual([" node_modules"]);
  });

  it("reads `.slopweaver` state in the tree as ignored work that holds it", () => {
    mkdirSync(join(tree, ".slopweaver"));
    writeFileSync(join(tree, ".slopweaver", "run.json"), "{}");
    expect(readIgnoredWork({ git: realGit, path: tree })).toEqual([".slopweaver/"]);
  });

  it("reads an untracked file as an uncommitted change, which holds the tree", () => {
    writeFileSync(join(tree, "notes.md"), "only copy\n");
    expect(readWorkingTree({ git: realGit, path: tree }).dirtyCount).toBe(1);
  });

  it("counts a stash made from the tree, and none for a tree nothing was stashed from", () => {
    expect(readTreeStashes({ branch: "topic", git: realGit, path: tree })).toBe(0);
    writeFileSync(join(tree, "a.ts"), "export const a = 2;\n");
    gitInTemp({ args: [...IDENTITY, "stash", "push", "-q", "-m", "half done"], cwd: tree });
    expect(readTreeStashes({ branch: "topic", git: realGit, path: tree })).toBe(1);
  });

  it("answers null for both reads when the path is not a repository at all", () => {
    const outside = join(dir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, ".git"), "gitdir: /nowhere\n");
    expect(readIgnoredWork({ git: realGit, path: outside })).toBe(null);
    expect(readTreeStashes({ branch: "topic", git: realGit, path: outside })).toBe(null);
  });
});
