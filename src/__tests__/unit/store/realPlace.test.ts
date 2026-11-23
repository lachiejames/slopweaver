/**
 * Resolving a host path once through its links, over real temporary directories.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  type EntryIdentity,
  heldByIdentity,
  type IdentityOf,
  placeWithin,
  realPlace,
  statIdentity,
} from "../../../store/backup/realPlace.js";

const made: string[] = [];

/**
 * A fresh temporary directory, resolved, removed after each test.
 *
 * @returns its real path
 */
function scratch(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "sw-real-place-")));
  made.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of made.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("realPlace", () => {
  it("resolves a link along the way and keeps the not-yet-existing rest", () => {
    const target = scratch();
    const outside = scratch();
    symlinkSync(target, join(outside, "link"));
    expect(unwrap(realPlace({ path: join(outside, "link", "new", "file") }))).toBe(join(target, "new", "file"));
  });

  it("returns an existing real path unchanged", () => {
    const directory = scratch();
    mkdirSync(join(directory, "a"));
    expect(unwrap(realPlace({ path: join(directory, "a") }))).toBe(join(directory, "a"));
  });

  it("refuses a path through a link that points at nothing, rather than keeping the link", () => {
    const outside = scratch();
    symlinkSync(join(outside, "nothing-here"), join(outside, "link"));
    const refused = unwrapErr(realPlace({ path: join(outside, "link", "file") }));
    expect(refused.code).toBe("PLACE_UNRESOLVED");
    expect(refused.at).toBe(join(outside, "link"));
    expect(refused.message).toContain(`cannot be resolved to a real place at ${join(outside, "link")}`);
  });

  it("refuses a final component that is itself a dangling link", () => {
    const outside = scratch();
    symlinkSync(join(outside, "nothing-here"), join(outside, "link"));
    const refused = unwrapErr(realPlace({ path: join(outside, "link") }));
    expect(refused.message).toContain(`cannot be resolved to a real place at ${join(outside, "link")}`);
  });
});

describe("heldByIdentity", () => {
  // A seam, not a mock: a fixed table of path → identity, standing in for a volume that names one
  // directory two ways (an APFS firmlink, a case-insensitive spelling, a bind mount).
  const table = new Map<string, EntryIdentity>([
    ["/", { dev: 1, ino: 2 }],
    ["/Users", { dev: 1, ino: 10 }],
    ["/Users/me", { dev: 1, ino: 11 }],
    ["/Users/me/dest", { dev: 1, ino: 12 }],
    ["/Users/me/dest/victim", { dev: 1, ino: 13 }],
    ["/System", { dev: 1, ino: 20 }],
    ["/System/Volumes", { dev: 1, ino: 21 }],
    ["/System/Volumes/Data", { dev: 1, ino: 22 }],
    ["/System/Volumes/Data/Users", { dev: 1, ino: 10 }],
    ["/System/Volumes/Data/Users/me", { dev: 1, ino: 11 }],
    ["/System/Volumes/Data/Users/me/dest", { dev: 1, ino: 12 }],
    ["/System/Volumes/Data/Users/me/dest/victim", { dev: 1, ino: 13 }],
    ["/Users/me/elsewhere", { dev: 1, ino: 30 }],
  ]);
  const identityOf: IdentityOf = ({ path }) => {
    const found = table.get(path);
    if (found === undefined) {
      return null;
    }
    return found;
  };

  it("holds a target reached through a second spelling of the root", () => {
    expect(
      heldByIdentity({ identityOf, place: "/System/Volumes/Data/Users/me/dest/victim", root: "/Users/me/dest" }),
    ).toBe(true);
  });

  it("holds a not-yet-existing target below a second spelling of the root", () => {
    expect(
      heldByIdentity({ identityOf, place: "/System/Volumes/Data/Users/me/dest/new/file", root: "/Users/me/dest" }),
    ).toBe(true);
  });

  it("does not hold a target elsewhere on the same volume", () => {
    expect(heldByIdentity({ identityOf, place: "/Users/me/elsewhere/file", root: "/Users/me/dest" })).toBe(false);
  });

  it("falls back to the path test for a root that does not exist yet", () => {
    expect(heldByIdentity({ identityOf, place: "/Users/me/new-root/a", root: "/Users/me/new-root" })).toBe(true);
    expect(heldByIdentity({ identityOf, place: "/Users/me/elsewhere/a", root: "/Users/me/new-root" })).toBe(false);
  });

  it("holds when an identity cannot be read, so nothing is written on a check that did not run", () => {
    const unreadable: IdentityOf = ({ path }) => {
      if (path === "/Users/me") {
        throw new Error("EACCES");
      }
      return identityOf({ path });
    };
    expect(heldByIdentity({ identityOf: unreadable, place: "/Users/me/elsewhere/file", root: "/Users/me/dest" })).toBe(
      true,
    );
  });

  it("reads real identities through stat: the root and a link to it are the same entry", () => {
    const root = scratch();
    const outside = scratch();
    symlinkSync(root, join(outside, "alias"));
    expect(statIdentity({ path: join(outside, "alias") })).toEqual(statIdentity({ path: root }));
    expect(statIdentity({ path: join(root, "absent") })).toBe(null);
  });
});

describe("placeWithin", () => {
  it("holds the root and below, never a sibling sharing its name as a prefix", () => {
    expect(placeWithin({ place: "/r/dest", root: "/r/dest" })).toBe(true);
    expect(placeWithin({ place: "/r/dest/a/b", root: "/r/dest" })).toBe(true);
    expect(placeWithin({ place: "/r/dest-other/x", root: "/r/dest" })).toBe(false);
    expect(placeWithin({ place: "/r", root: "/r/dest" })).toBe(false);
  });

  it("holds a child whose name merely starts with two dots, and refuses a real climb", () => {
    expect(placeWithin({ place: "/r/dest/..victim", root: "/r/dest" })).toBe(true);
    expect(placeWithin({ place: "/r/dest/a/..b", root: "/r/dest" })).toBe(true);
    expect(placeWithin({ place: "/r/other", root: "/r/dest" })).toBe(false);
  });
});
