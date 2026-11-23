/**
 * The auto-memory mirror: the pure plan over name-to-hash maps, the write-back target of a stored path, and one
 * sync run over real temp directories standing in for `~/.claude/projects` and the home's mirror.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { memoryRestoreTarget, planMemoryMirror } from "../../../../store/fleet/claudeMemoryMirror.js";
import { MIRROR_QUIET_MS, syncClaudeMemoryMirror } from "../../../../store/fleet/claudeMemorySync.js";

/** One project's files, by name to hash. */
function files(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries));
}

describe("planMemoryMirror", () => {
  it("writes a new or changed file and removes one gone from a corpus that still exists", () => {
    const plan = planMemoryMirror({
      mirror: new Map([["p", files({ "MEMORY.md": "m1", "gone.md": "g", "same.md": "s" })]]),
      source: new Map([["p", files({ "MEMORY.md": "m2", "new.md": "n", "same.md": "s" })]]),
    });

    expect(plan).toEqual({
      remove: [{ file: "gone.md", project: "p" }],
      retire: [
        { attic: "m1-MEMORY.md", file: "MEMORY.md", project: "p", sha256: "m1" },
        { attic: "g-gone.md", file: "gone.md", project: "p", sha256: "g" },
      ],
      write: [
        { file: "MEMORY.md", project: "p" },
        { file: "new.md", project: "p" },
      ],
    });
  });

  it("keeps the whole mirror of a corpus missing from disk — a fresh machine before the write-back", () => {
    const plan = planMemoryMirror({
      mirror: new Map([["p", files({ "MEMORY.md": "m", "a.md": "a" })]]),
      source: new Map(),
    });

    expect(plan).toEqual({ remove: [], retire: [], write: [] });
  });

  it("retires every old version a fresh corpus replaces or drops, so none of it is lost", () => {
    const plan = planMemoryMirror({
      mirror: new Map([["p", files({ "MEMORY.md": "old", "a.md": "a", "user_role.md": "oldrole" })]]),
      source: new Map([["p", files({ "MEMORY.md": "fresh", "user_role.md": "newrole" })]]),
    });

    expect(plan.retire).toEqual([
      { attic: "old-MEMORY.md", file: "MEMORY.md", project: "p", sha256: "old" },
      { attic: "oldrole-user_role.md", file: "user_role.md", project: "p", sha256: "oldrole" },
      { attic: "a-a.md", file: "a.md", project: "p", sha256: "a" },
    ]);
    expect(plan.remove).toEqual([{ file: "a.md", project: "p" }]);
  });

  it("names an attic copy by a 12-hex prefix of its content hash", () => {
    const plan = planMemoryMirror({
      mirror: new Map([["p", files({ "a.md": "0123456789abcdef" })]]),
      source: new Map([["p", files({})]]),
    });

    expect(plan.retire).toEqual([
      { attic: "0123456789ab-a.md", file: "a.md", project: "p", sha256: "0123456789abcdef" },
    ]);
  });

  it("plans nothing for an empty source and an empty mirror", () => {
    expect(planMemoryMirror({ mirror: new Map(), source: new Map() })).toEqual({ remove: [], retire: [], write: [] });
  });
});

describe("memoryRestoreTarget", () => {
  it("maps a mirrored markdown file into its project's memory directory", () => {
    expect(
      memoryRestoreTarget({ projectsDir: "/u/.claude/projects", relativePath: "claude-memory/-u-repo/a.md" }),
    ).toEqual({ directory: "/u/.claude/projects/-u-repo/memory", path: "/u/.claude/projects/-u-repo/memory/a.md" });
  });

  it("has no target for a nested path, a non-markdown file, a traversal, or another directory", () => {
    const projectsDir = "/u/.claude/projects";

    expect(memoryRestoreTarget({ projectsDir, relativePath: "claude-memory/p/sub/a.md" })).toBeUndefined();
    expect(
      memoryRestoreTarget({ projectsDir, relativePath: "claude-memory/p/attic/0123456789ab-a.md" }),
    ).toBeUndefined();
    expect(memoryRestoreTarget({ projectsDir, relativePath: "claude-memory/p/a.txt" })).toBeUndefined();
    expect(memoryRestoreTarget({ projectsDir, relativePath: "claude-memory/../a.md" })).toBeUndefined();
    expect(memoryRestoreTarget({ projectsDir, relativePath: "briefs/p/a.md" })).toBeUndefined();
  });
});

describe("syncClaudeMemoryMirror", () => {
  const roots: string[] = [];
  const STILL = new Date("2026-09-01T00:00:00.000Z");
  const NOW = STILL.getTime() + MIRROR_QUIET_MS * 10;

  afterEach(() => {
    for (const dir of roots.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A throwaway root holding a projects directory and a mirror. */
  function fresh(): { projectsDir: string; mirrorRoot: string } {
    const root = mkdtempSync(join(tmpdir(), "memory-mirror-"));
    roots.push(root);
    return { mirrorRoot: join(root, "home", "claude-memory"), projectsDir: join(root, "projects") };
  }

  /** Write one corpus file with a fixed mtime. */
  function put({ dir, name, text, at = STILL }: { dir: string; name: string; text: string; at?: Date }): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), text);
    utimesSync(join(dir, name), at, at);
  }

  it("mirrors each corpus byte-exact with its mtime, and only corpora holding a MEMORY.md", () => {
    const { projectsDir, mirrorRoot } = fresh();
    const corpus = join(projectsDir, "-u-repo", "memory");
    put({ dir: corpus, name: "MEMORY.md", text: "- [a](a.md)\n" });
    put({ dir: corpus, name: "a.md", text: "a fact\n" });
    put({ dir: corpus, name: "notes.txt", text: "not corpus\n" });
    put({ dir: join(projectsDir, "-u-empty", "memory"), name: "stray.md", text: "no index\n" });

    const outcome = unwrap(syncClaudeMemoryMirror({ apply: true, mirrorRoot, now: NOW, projectsDir }));

    expect(outcome.corpora).toBe(1);
    expect(outcome.plan.write).toHaveLength(2);
    expect(readdirSync(mirrorRoot)).toEqual(["-u-repo"]);
    expect(readFileSync(join(mirrorRoot, "-u-repo", "a.md"), "utf8")).toBe("a fact\n");
    expect(statSync(join(mirrorRoot, "-u-repo", "a.md")).mtime.toISOString()).toBe(STILL.toISOString());
  });

  it("writes nothing when not applying, and leaves out a corpus changed inside the quiet window", () => {
    const { projectsDir, mirrorRoot } = fresh();
    put({ dir: join(projectsDir, "-u-still", "memory"), name: "MEMORY.md", text: "still\n" });
    put({ at: new Date(NOW - 1_000), dir: join(projectsDir, "-u-busy", "memory"), name: "MEMORY.md", text: "busy\n" });

    const outcome = unwrap(syncClaudeMemoryMirror({ apply: false, mirrorRoot, now: NOW, projectsDir }));

    expect(outcome.recent).toEqual(["-u-busy"]);
    expect(outcome.plan.write).toEqual([{ file: "MEMORY.md", project: "-u-still" }]);
    expect(outcome.applied).toBe(false);
    expect(() => readdirSync(mirrorRoot)).toThrow(/ENOENT/);
  });

  it("redoes an attic copy a failed pass left torn, before it overwrites the only whole copy", () => {
    const { projectsDir, mirrorRoot } = fresh();
    const sha = createHash("sha256").update("old\n").digest("hex");
    const torn = join(mirrorRoot, "-u-repo", "attic", `${sha.slice(0, 12)}-MEMORY.md`);
    put({ dir: join(mirrorRoot, "-u-repo"), name: "MEMORY.md", text: "old\n" });
    put({ dir: join(mirrorRoot, "-u-repo", "attic"), name: `${sha.slice(0, 12)}-MEMORY.md`, text: "" });
    put({ dir: join(projectsDir, "-u-repo", "memory"), name: "MEMORY.md", text: "fresh\n" });

    unwrap(syncClaudeMemoryMirror({ apply: true, mirrorRoot, now: NOW, projectsDir }));

    expect(readFileSync(torn, "utf8")).toBe("old\n");
    expect(readFileSync(join(mirrorRoot, "-u-repo", "MEMORY.md"), "utf8")).toBe("fresh\n");
  });

  it("keeps every replaced or dropped version in the attic, and a later pass adds nothing to it", () => {
    const { projectsDir, mirrorRoot } = fresh();
    const corpus = join(projectsDir, "-u-repo", "memory");
    const attic = join(mirrorRoot, "-u-repo", "attic");
    put({ dir: join(mirrorRoot, "-u-repo"), name: "MEMORY.md", text: "old\n" });
    put({ dir: join(mirrorRoot, "-u-repo"), name: "a.md", text: "a\n" });
    put({ dir: corpus, name: "MEMORY.md", text: "fresh\n" });
    put({ dir: corpus, name: "n1.md", text: "n1\n" });
    unwrap(syncClaudeMemoryMirror({ apply: true, mirrorRoot, now: NOW, projectsDir }));

    const second = unwrap(syncClaudeMemoryMirror({ apply: true, mirrorRoot, now: NOW, projectsDir }));

    expect(second.plan).toEqual({ remove: [], retire: [], write: [] });
    expect(readdirSync(join(mirrorRoot, "-u-repo")).toSorted()).toEqual(["MEMORY.md", "attic", "n1.md"]);
    expect(readFileSync(join(mirrorRoot, "-u-repo", "MEMORY.md"), "utf8")).toBe("fresh\n");
    const kept = readdirSync(attic).toSorted();
    expect(kept.map((name) => name.slice(13))).toEqual(["MEMORY.md", "a.md"]);
    expect(kept.map((name) => readFileSync(join(attic, name), "utf8"))).toEqual(["old\n", "a\n"]);
  });

  it("leaves a corpus out whole when its mirror directory will not read, rather than overwrite it", () => {
    const { projectsDir, mirrorRoot } = fresh();
    put({ dir: join(projectsDir, "-u-repo", "memory"), name: "MEMORY.md", text: "fresh\n" });
    put({ dir: join(mirrorRoot, "-u-repo"), name: "MEMORY.md", text: "old\n" });
    put({ dir: join(mirrorRoot, "-u-repo"), name: "a.md", text: "a\n" });
    chmodSync(join(mirrorRoot, "-u-repo", "a.md"), 0o000);

    const outcome = unwrap(syncClaudeMemoryMirror({ apply: true, mirrorRoot, now: NOW, projectsDir }));
    chmodSync(join(mirrorRoot, "-u-repo", "a.md"), 0o600);

    expect(outcome.corpora).toBe(0);
    expect(outcome.plan).toEqual({ remove: [], retire: [], write: [] });
    expect(outcome.unreadable.map((entry) => entry.locator)).toEqual([join(mirrorRoot, "-u-repo")]);
    expect(readFileSync(join(mirrorRoot, "-u-repo", "MEMORY.md"), "utf8")).toBe("old\n");
  });

  it("removes a file deleted from a corpus that still exists", () => {
    const { projectsDir, mirrorRoot } = fresh();
    const corpus = join(projectsDir, "-u-repo", "memory");
    put({ dir: corpus, name: "MEMORY.md", text: "index\n" });
    put({ dir: corpus, name: "a.md", text: "a\n" });
    put({ dir: corpus, name: "b.md", text: "b\n" });
    unwrap(syncClaudeMemoryMirror({ apply: true, mirrorRoot, now: NOW, projectsDir }));
    rmSync(join(corpus, "a.md"));

    const outcome = unwrap(syncClaudeMemoryMirror({ apply: true, mirrorRoot, now: NOW, projectsDir }));

    expect(outcome.plan.remove).toEqual([{ file: "a.md", project: "-u-repo" }]);
    expect(readdirSync(join(mirrorRoot, "-u-repo")).toSorted()).toEqual(["MEMORY.md", "attic", "b.md"]);
  });
});
