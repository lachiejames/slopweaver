import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { homeFingerprint } from "../../homeFingerprint.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fingerprint-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("homeFingerprint", () => {
  it("DETECTS a same-size rewrite, which a size-based fingerprint cannot", () => {
    // The exact counterexample from review: rewrite `profile.json`'s first byte from `{` to `[` and the
    // length is unchanged, so a `path:size` fingerprint stays identical and every "this run changed
    // nothing" test built on it passes over a rewritten file.
    const dir = freshDir();
    writeFileSync(join(dir, "profile.json"), "{}");
    const before = homeFingerprint({ home: dir });
    writeFileSync(join(dir, "profile.json"), "[]");

    expect(homeFingerprint({ home: dir })).not.toEqual(before);
  });

  it("is stable when nothing changed", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "a.txt"), "hello");
    expect(homeFingerprint({ home: dir })).toEqual(homeFingerprint({ home: dir }));
  });

  it("detects an append", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "a.txt"), "hello");
    const before = homeFingerprint({ home: dir });
    writeFileSync(join(dir, "a.txt"), "hello world");
    expect(homeFingerprint({ home: dir })).not.toEqual(before);
  });

  it("walks NESTED files, which a top-level listing cannot see", () => {
    const dir = freshDir();
    mkdirSync(join(dir, "corpus", "github"), { recursive: true });
    writeFileSync(join(dir, "corpus", "github", "w.jsonl"), "one\n");
    const before = homeFingerprint({ home: dir });
    writeFileSync(join(dir, "corpus", "github", "w.jsonl"), "one\ntwo\n");
    expect(homeFingerprint({ home: dir })).not.toEqual(before);
  });

  it("reports one entry per file, in path order", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "b.txt"), "b");
    writeFileSync(join(dir, "a.txt"), "a");
    const printed = homeFingerprint({ home: dir });
    expect(printed.length).toBe(2);
    expect(printed[0]!.startsWith(join(dir, "a.txt"))).toBe(true);
  });
});
