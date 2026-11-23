/**
 * The measurement walk over a real temp home: every depth under each root, Finder's folder state skipped, and
 * an absent root a fresh install rather than a failure.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { homeRelativePath } from "../../../../store/fleet/homeWalk.js";
import { listMeasurementFiles, measurementRoots } from "../../../../store/fleet/measurementFiles.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "measurement-files-"));
  homes.push(home);
  return home;
}

/** Write one file, making its directory. */
function put({ home, path }: { home: string; path: string }): void {
  const full = join(home, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "x");
}

describe("listMeasurementFiles", () => {
  it("finds every file at any depth under a root and skips .DS_Store", () => {
    const home = freshHome();
    put({ home, path: "evidence/a.png" });
    put({ home, path: "evidence/sup-3534/deep/b.md" });
    put({ home, path: "evidence/.DS_Store" });
    put({ home, path: "evidence/sup-3534/.DS_Store" });

    const listing = listMeasurementFiles({ root: measurementRoots({ home }).evidence });

    expect(listing.files.map((path) => homeRelativePath({ home, path })).toSorted()).toEqual([
      "evidence/a.png",
      "evidence/sup-3534/deep/b.md",
    ]);
    expect(listing.unreadable).toEqual([]);
  });

  it("reports an absent root as empty, not as a failure", () => {
    const listing = listMeasurementFiles({ root: measurementRoots({ home: freshHome() }).proof });

    expect(listing).toEqual({ files: [], links: [], unreadable: [] });
  });
});

describe("listMeasurementFiles over a symbolic link", () => {
  it("lists a link under links, never under files, so the leg can name it", () => {
    const home = freshHome();
    put({ home, path: "proof/real.md" });
    symlinkSync(join(home, "proof", "real.md"), join(home, "proof", "linked.md"));

    const listing = listMeasurementFiles({ root: measurementRoots({ home }).proof });

    expect(listing.files.map((path) => homeRelativePath({ home, path }))).toEqual(["proof/real.md"]);
    expect(listing.links.map((path) => homeRelativePath({ home, path }))).toEqual(["proof/linked.md"]);
  });
});
