import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { containmentRefusal, firstLinkedEntry, isContained } from "../../../lib/pathContainment.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("isContained (pure)", () => {
  it("accepts the root itself and anything under it", () => {
    expect(isContained({ candidate: "/a/b", root: "/a/b" })).toBe(true);
    expect(isContained({ candidate: "/a/b/c/d.jsonl", root: "/a/b" })).toBe(true);
  });

  it("rejects a sibling whose name merely STARTS with the root's", () => {
    // The reason the comparison appends a separator: `/corpus/history-old` is not inside `/corpus/history`.
    expect(isContained({ candidate: "/corpus/history-old/x", root: "/corpus/history" })).toBe(false);
  });

  it("rejects a parent and an unrelated path", () => {
    expect(isContained({ candidate: "/a", root: "/a/b" })).toBe(false);
    expect(isContained({ candidate: "/x/y", root: "/a/b" })).toBe(false);
  });

  it("resolves `..` before comparing, so a traversal cannot sneak through", () => {
    expect(isContained({ candidate: "/a/b/../../etc/passwd", root: "/a/b" })).toBe(false);
  });
});

describe("containmentRefusal (real filesystem)", () => {
  it("permits a normal absent first write", () => {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-contain-"));
    fixtureDirs.push(root);
    expect(containmentRefusal({ path: join(root, "linear.jsonl"), root })).toBeUndefined();
  });

  it("permits a normal existing file", () => {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-contain-"));
    fixtureDirs.push(root);
    const path = join(root, "linear.jsonl");
    writeFileSync(path, "{}\n", "utf8");
    expect(containmentRefusal({ path, root })).toBeUndefined();
  });

  it("REFUSES a leaf that is a symlink pointing out of the root", () => {
    // The adversarial review pass's counterexample, exactly: a symlink at the store's own filename, aimed at
    // bronze, with the target absent so nothing looks wrong on the way in.
    const home = mkdtempSync(join(tmpdir(), "slopweaver-contain-"));
    fixtureDirs.push(home);
    const history = join(home, "history");
    const bronze = join(home, "bronze", "linear");
    mkdirSync(history, { recursive: true });
    mkdirSync(bronze, { recursive: true });
    const path = join(history, "linear.jsonl");
    symlinkSync(join(bronze, "history.jsonl"), path);
    const refusal = containmentRefusal({ path, root: history })!;
    expect(refusal).toContain("is a symlink");
  });

  it("REFUSES a leaf whose symlink points INSIDE the root — a link is a link", () => {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-contain-"));
    fixtureDirs.push(root);
    const path = join(root, "linear.jsonl");
    symlinkSync(join(root, "real.jsonl"), path);
    expect(containmentRefusal({ path, root })).toContain("is a symlink");
  });

  it("REFUSES a leaf that is a HARD link — it shares an inode, so lstat sees an ordinary file", () => {
    // The adversarial pass's SECOND counterexample, after the symlink check was added. A hard link is invisible
    // to `lstat`'s type check; the link COUNT is what gives it away.
    const home = mkdtempSync(join(tmpdir(), "slopweaver-contain-"));
    fixtureDirs.push(home);
    const history = join(home, "history");
    const bronze = join(home, "bronze");
    mkdirSync(history, { recursive: true });
    mkdirSync(bronze, { recursive: true });
    const inBronze = join(bronze, "events.jsonl");
    writeFileSync(inBronze, "{}\n", "utf8");
    const path = join(history, "linear.jsonl");
    linkSync(inBronze, path);
    expect(containmentRefusal({ path, root: history })).toContain("hard link");
  });

  it("REFUSES when the DIRECTORY is a link out of the root", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-contain-"));
    fixtureDirs.push(home);
    const real = join(home, "bronze");
    mkdirSync(real, { recursive: true });
    const linkedDir = join(home, "history");
    symlinkSync(real, linkedDir);
    // The leaf does not exist, so only the parent check can catch this one.
    const refusal = containmentRefusal({ path: join(linkedDir, "linear.jsonl"), root: linkedDir })!;
    expect(refusal).toContain("resolves outside");
  });
});

describe("firstLinkedEntry (real filesystem)", () => {
  it("names the first linked hop below the top, and none when the walk is clean or not yet created", () => {
    const top = mkdtempSync(join(tmpdir(), "slopweaver-linked-"));
    fixtureDirs.push(top);
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-linked-out-"));
    fixtureDirs.push(outside);
    mkdirSync(join(top, "store", "ab"), { recursive: true });
    writeFileSync(join(top, "store", "ab", "blob"), "x");
    symlinkSync(outside, join(top, "linked"));
    expect(firstLinkedEntry({ path: join(top, "store", "ab", "blob"), top })).toBeUndefined();
    expect(firstLinkedEntry({ path: join(top, "absent", "ab", "blob"), top })).toBeUndefined();
    expect(firstLinkedEntry({ path: join(top, "linked", "ab", "blob"), top })).toBe(join(top, "linked"));
  });

  it("never checks the top itself, which the operator may place as a link", () => {
    const real = mkdtempSync(join(tmpdir(), "slopweaver-linked-real-"));
    fixtureDirs.push(real);
    const holder = mkdtempSync(join(tmpdir(), "slopweaver-linked-holder-"));
    fixtureDirs.push(holder);
    const top = join(holder, "home");
    symlinkSync(real, top);
    mkdirSync(join(real, "store"));
    expect(firstLinkedEntry({ path: join(top, "store", "blob"), top })).toBeUndefined();
  });
});
