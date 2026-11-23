/**
 * The canon reader over a real fixture tree: which repository a `cwd` belongs to, and which of its documents
 * load into every session. Filesystem, because the reader IS the filesystem edge — a `mkdtempSync` round trip,
 * removed after each case.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCanonSections, repositoryRootOf } from "../../../memory/canonReader.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "canon-reader-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Write one file under the fixture root, creating its directory. */
function put({ path, content }: { path: string; content: string }): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("repositoryRootOf", () => {
  it("finds a checkout's root from a directory inside it", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    mkdirSync(join(root, "repo", "src", "deep"), { recursive: true });

    expect(repositoryRootOf({ cwd: join(root, "repo", "src", "deep") })).toBe(join(root, "repo"));
  });

  it("finds a worktree's root, where `.git` is a file", () => {
    put({ content: "gitdir: /elsewhere\n", path: "wt/.git" });

    expect(repositoryRootOf({ cwd: join(root, "wt") })).toBe(join(root, "wt"));
  });
});

describe("repositoryRootOf outside any repository", () => {
  it("is null when no ancestor holds a .git", () => {
    mkdirSync(join(root, "nowhere"), { recursive: true });

    expect(repositoryRootOf({ cwd: join(root, "nowhere") })).toBe(null);
  });
});

describe("readCanonSections", () => {
  it("reads the entry, what it imports, and the unscoped rules — never a scoped one", () => {
    put({ content: "", path: "repo/.git/HEAD" });
    put({ content: "# Agents\n\n## Rules\n\nSee @.claude/rules/imported.md.\n", path: "repo/AGENTS.md" });
    put({
      content: "---\npaths: src/**\n---\n\n## Imported\n\nImported anyway.\n",
      path: "repo/.claude/rules/imported.md",
    });
    put({ content: "## Unscoped\n\nEvery session.\n", path: "repo/.claude/rules/unscoped.md" });
    put({ content: "---\npaths: src/**\n---\n\n## Scoped\n\nOnly in src.\n", path: "repo/.claude/rules/scoped.md" });

    expect(readCanonSections({ cwd: join(root, "repo") }).map((section) => section.id)).toEqual([
      "AGENTS.md",
      "AGENTS.md § Rules",
      ".claude/rules/imported.md § Imported",
      ".claude/rules/unscoped.md § Unscoped",
    ]);
  });
});
