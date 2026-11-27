/**
 * The two identity-bound acts over a throwaway directory: each acts on the object the plan captured, and a name
 * that now holds a different object is refused as `PLAN_CHANGED` with that object put back exactly where it was.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { moveBoundToTrash, removeBoundTree } from "../../../../../live/machine/freeDisk/boundAct.js";
import type { PathIdentity } from "../../../../../live/machine/freeDisk/types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bound-act-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** A directory holding one file, and the identity a plan would have captured for it. */
function planned({ name }: { name: string }): { path: string; identity: PathIdentity } {
  const path = join(root, name);
  mkdirSync(path);
  writeFileSync(join(path, "f.bin"), "x");
  const stats = lstatSync(path);
  return { identity: { dev: stats.dev, ino: stats.ino }, path };
}

describe("removeBoundTree", () => {
  it("removes the planned tree and leaves no holding directory behind", () => {
    const target = planned({ name: "pip" });

    expect(unwrap(removeBoundTree(target))).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });

  it("refuses a name that now holds a different directory, and puts that directory back", () => {
    const target = planned({ name: "pip" });
    const other = planned({ name: "other" });

    const refused = unwrapErr(removeBoundTree({ identity: other.identity, path: target.path }));

    expect([refused.code, refused.message]).toEqual([
      "PLAN_CHANGED",
      `${target.path} changed since the plan read it (a different object took its name before the act); nothing further was touched`,
    ]);
    expect([existsSync(join(target.path, "f.bin")), readdirSync(root).toSorted()]).toEqual([true, ["other", "pip"]]);
  });
});

describe("moveBoundToTrash", () => {
  it("moves the planned bundle to its destination", () => {
    const source = planned({ name: "Example.app" });
    mkdirSync(join(root, "Trash"));
    const destination = join(root, "Trash", "Example.app");

    expect(unwrap(moveBoundToTrash({ destination, identity: source.identity, source: source.path }))).toBe(true);
    expect([existsSync(source.path), existsSync(join(destination, "f.bin"))]).toEqual([false, true]);
  });

  it("refuses a bundle name that now holds a different object, and moves it back", () => {
    const source = planned({ name: "Example.app" });
    const other = planned({ name: "other" });
    mkdirSync(join(root, "Trash"));
    const destination = join(root, "Trash", "Example.app");

    const refused = unwrapErr(moveBoundToTrash({ destination, identity: other.identity, source: source.path }));

    expect(refused.code).toBe("PLAN_CHANGED");
    expect([existsSync(join(source.path, "f.bin")), existsSync(destination)]).toEqual([true, false]);
  });
});
