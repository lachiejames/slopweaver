/**
 * `linkChangeTimesOn` over real links in a throwaway directory: every link a path passes through, a link inside
 * another link's target included, a `..` taken after the link before it, a cycle refused, and a path that will not
 * resolve thrown rather than read as linkless.
 */
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isGenuinelyAbsent, linkChangeTimesOn } from "#lib/pathLinks.js";

const minted: string[] = [];

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A scratch directory by its real path, so the temp root's own links (darwin's `/var`) are not on it. */
const scratch = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "links-")));
  minted.push(dir);
  return dir;
};

const ctimeOf = ({ path }: { path: string }): number => lstatSync(path).ctimeMs;
const ascending = ({ times }: { times: readonly number[] }): readonly number[] => times.toSorted((a, b) => a - b);

describe("linkChangeTimesOn", () => {
  it("finds no link on a path that passes through none", () => {
    const root = scratch();
    writeFileSync(join(root, "plain.md"), "");

    expect(linkChangeTimesOn({ path: join(root, "plain.md") })).toEqual([]);
  });

  it("finds a link on the path, and a link only its target passes through", () => {
    const root = scratch();
    mkdirSync(join(root, "real"));
    writeFileSync(join(root, "real", "file.md"), "");
    symlinkSync(join(root, "real"), join(root, "mid"));
    symlinkSync(join(root, "mid", "file.md"), join(root, "top.md"));

    expect(ascending({ times: linkChangeTimesOn({ path: join(root, "top.md") }) })).toEqual(
      ascending({ times: [ctimeOf({ path: join(root, "top.md") }), ctimeOf({ path: join(root, "mid") })] }),
    );
  });

  it("follows a link before taking the `..` after it, as the kernel does, never collapsing the text", () => {
    const root = scratch();
    mkdirSync(join(root, "shared", "one"), { recursive: true });
    writeFileSync(join(root, "shared", "old.md"), "");
    symlinkSync(join(root, "shared", "one"), join(root, "pivot"));
    // Lexically `pivot/../old.md` is `<root>/old.md`, which does not exist; the kernel reads `shared/old.md`.
    symlinkSync("pivot/../old.md", join(root, "leaf.md"));

    expect(ascending({ times: linkChangeTimesOn({ path: join(root, "leaf.md") }) })).toEqual(
      ascending({ times: [ctimeOf({ path: join(root, "leaf.md") }), ctimeOf({ path: join(root, "pivot") })] }),
    );
  });

  it("refuses a cycle of links as the kernel does, never spinning", () => {
    const root = scratch();
    symlinkSync(join(root, "b"), join(root, "a"));
    symlinkSync(join(root, "a"), join(root, "b"));

    expect(() => linkChangeTimesOn({ path: join(root, "a") })).toThrow("ELOOP");
  });

  it("throws on a path behind a dangling link, never reading it as one with no links", () => {
    const root = scratch();
    symlinkSync(join(root, "gone"), join(root, "claude"));

    expect(() => linkChangeTimesOn({ path: join(root, "claude", "projects") })).toThrow("dangling");
  });

  it("throws on a path that will not resolve, never reading it as one with no links", () => {
    const root = scratch();

    expect(() => linkChangeTimesOn({ path: join(root, "missing", "file.md") })).toThrow("ENOENT");
  });
});

describe("isGenuinelyAbsent", () => {
  it("calls a missing component of the path absent, through a link that resolves too", () => {
    const root = scratch();
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "claude"));

    expect([
      isGenuinelyAbsent({ path: join(root, "projects") }),
      isGenuinelyAbsent({ path: join(root, "claude", "projects") }),
    ]).toEqual([true, true]);
  });

  it("never calls a path absent behind a dangling link, under a file, or when it is there", () => {
    const root = scratch();
    symlinkSync(join(root, "gone"), join(root, "claude"));
    writeFileSync(join(root, "flat"), "");

    expect([
      isGenuinelyAbsent({ path: join(root, "claude", "projects") }),
      isGenuinelyAbsent({ path: join(root, "claude") }),
      isGenuinelyAbsent({ path: join(root, "flat", "memory") }),
      isGenuinelyAbsent({ path: root }),
    ]).toEqual([false, false, false, false]);
  });
});
