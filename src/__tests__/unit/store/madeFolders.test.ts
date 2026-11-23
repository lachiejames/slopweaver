/**
 * The folders a destination's mkdir made, and taking them back: only what this run made, matched by device and
 * inode, and only while empty. Every folder is a real one under a per-test temp parent.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { madeFolders, makeFolders, makeFoldersHeld, removeMadeFolders } from "../../../store/backup/madeFolders.js";

const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A throwaway parent, removed after the test that minted it.
 *
 * @returns its absolute path
 */
function parentDir(): string {
  const parent = mkdtempSync(join(tmpdir(), "made-folders-"));
  minted.push(parent);
  return parent;
}

describe("makeFolders", () => {
  it("names every folder it made, deepest first, and none when the root was already there", () => {
    const parent = parentDir();
    const root = join(parent, "a", "b");
    expect(makeFolders({ root }).map((folder) => folder.path)).toEqual([root, join(parent, "a")]);
    expect(makeFolders({ root })).toEqual([]);
  });
});

describe("makeFoldersHeld", () => {
  it("keeps what it made when the check after the mkdir holds", () => {
    const parent = parentDir();
    const root = join(parent, "a", "b");
    expect(makeFoldersHeld({ root, stillHolds: () => true })!.map((folder) => folder.path)).toEqual([
      root,
      join(parent, "a"),
    ]);
    expect(existsSync(root)).toBe(true);
  });

  it("takes back everything it made when the check after the mkdir fails, and keeps what was already there", () => {
    const parent = parentDir();
    const asked: boolean[] = [];
    const held = makeFoldersHeld({
      root: join(parent, "a", "b"),
      stillHolds: () => {
        asked.push(existsSync(join(parent, "a", "b")));
        return false;
      },
    });
    expect(held).toBe(null);
    expect(asked).toEqual([true]);
    expect(existsSync(join(parent, "a"))).toBe(false);
    expect(existsSync(parent)).toBe(true);
  });
});

describe("removeMadeFolders", () => {
  it("walks up from the root to the first folder made, and stops at one that holds anything", () => {
    const parent = parentDir();
    mkdirSync(join(parent, "a", "b", "c"), { recursive: true });
    const made = madeFolders({ first: join(parent, "a"), root: join(parent, "a", "b", "c") });
    expect(made.map((folder) => folder.path)).toEqual([
      join(parent, "a", "b", "c"),
      join(parent, "a", "b"),
      join(parent, "a"),
    ]);
    writeFileSync(join(parent, "a", "kept.txt"), "already here");
    removeMadeFolders({ made });
    expect(existsSync(join(parent, "a", "b"))).toBe(false);
    expect(existsSync(join(parent, "a", "kept.txt"))).toBe(true);
  });

  it("removes nothing when the run made no folder", () => {
    const parent = parentDir();
    mkdirSync(join(parent, "there"));
    removeMadeFolders({ made: [] });
    expect(existsSync(join(parent, "there"))).toBe(true);
  });

  it("leaves a folder another process put at the same path, and every folder above it", () => {
    const parent = parentDir();
    mkdirSync(join(parent, "a", "b"), { recursive: true });
    const made = madeFolders({ first: join(parent, "a"), root: join(parent, "a", "b") });
    renameSync(join(parent, "a", "b"), join(parent, "moved"));
    mkdirSync(join(parent, "a", "b"));
    removeMadeFolders({ made });
    expect(existsSync(join(parent, "a", "b"))).toBe(true);
    expect(existsSync(join(parent, "moved"))).toBe(true);
  });
});
