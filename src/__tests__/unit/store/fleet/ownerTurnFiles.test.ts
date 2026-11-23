/**
 * The one owner-turn walk both readers share, over a real temp home: every depth under the root, owner-turn
 * files only, an absent root being a fresh install rather than a failure.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { homeRelativePath } from "../../../../store/fleet/homeWalk.js";
import { listOwnerTurnFiles, ownerTurnRoots } from "../../../../store/fleet/ownerTurnFiles.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "owner-turn-files-"));
  homes.push(home);
  return home;
}

/** Write one file, making its directory. */
function put({ home, path, text }: { home: string; path: string; text: string }): void {
  const full = join(home, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
}

describe("ownerTurnRoots", () => {
  it("names the archive and the scratch root under the home it was given", () => {
    const home = freshHome();

    expect(ownerTurnRoots({ home })).toEqual({
      "archive-turn": join(home, "handovers", "archive"),
      "scratch-turn": join(home, "supervisor-scratch"),
    });
  });
});

describe("listOwnerTurnFiles", () => {
  it("finds owner-turn files at every depth, each folder's own files before its subfolders, and nothing else", () => {
    const home = freshHome();
    put({ home, path: "supervisor-scratch/handoff-9002/owner-turn-2-b.txt", text: "b" });
    put({ home, path: "supervisor-scratch/handoff-9002/owner-turn-2-a.txt", text: "a" });
    put({ home, path: "supervisor-scratch/handoff-9002/notes.txt", text: "not an owner turn" });
    put({ home, path: "supervisor-scratch/handoff-9002/deeper/owner-turn-2-c.txt", text: "deeper" });
    put({ home, path: "supervisor-scratch/handoff-9290/owner-turns/archive/owner-turn-290-1.txt", text: "deepest" });
    put({ home, path: "supervisor-scratch/owner-turn-0-0.txt", text: "top" });
    const root = ownerTurnRoots({ home })["scratch-turn"];

    const listing = listOwnerTurnFiles({ root });

    expect(listing.files.map((path) => homeRelativePath({ home, path }))).toEqual([
      "supervisor-scratch/owner-turn-0-0.txt",
      "supervisor-scratch/handoff-9002/owner-turn-2-a.txt",
      "supervisor-scratch/handoff-9002/owner-turn-2-b.txt",
      "supervisor-scratch/handoff-9002/deeper/owner-turn-2-c.txt",
      "supervisor-scratch/handoff-9290/owner-turns/archive/owner-turn-290-1.txt",
    ]);
    expect(listing.unreadable).toEqual([]);
  });

  it("reads an absent root as nothing, with nothing unreadable", () => {
    const home = freshHome();

    expect(listOwnerTurnFiles({ root: join(home, "handovers", "archive") })).toEqual({
      files: [],
      links: [],
      unreadable: [],
    });
  });

  it("reports a root that exists and is not a directory as unreadable", () => {
    const home = freshHome();
    put({ home, path: "handovers/archive", text: "a file where a directory belongs" });
    const root = join(home, "handovers", "archive");

    const listing = listOwnerTurnFiles({ root });

    expect(listing.files).toEqual([]);
    expect(listing.unreadable.map((entry) => entry.locator)).toEqual([root]);
  });
});
