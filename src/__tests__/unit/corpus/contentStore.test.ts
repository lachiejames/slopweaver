import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { contentDigest, contentPath, storeContent } from "../../../corpus/contentStore.js";

const dirs: string[] = [];

/** A throwaway store root, removed after the test that minted it. */
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-content-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("contentDigest", () => {
  it("is the SHA-256 of the bytes, lowercase hex", () => {
    const bytes = Buffer.from("the body of a notion page", "utf8");
    expect(contentDigest({ bytes })).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("names the empty input rather than refusing it", () => {
    expect(contentDigest({ bytes: Buffer.alloc(0) })).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("contentPath", () => {
  it("shards on the digest's first two characters", () => {
    const digest = "ab".repeat(32);
    expect(contentPath({ digest, root: "/store" })).toBe(`/store/ab/${digest}`);
  });

  it("gives two digests differing in their first byte two different shards", () => {
    const first = contentPath({ digest: `0a${"1".repeat(62)}`, root: "/store" });
    const second = contentPath({ digest: `0b${"1".repeat(62)}`, root: "/store" });
    expect(first.startsWith("/store/0a/")).toBe(true);
    expect(second.startsWith("/store/0b/")).toBe(true);
  });
});

describe("storeContent", () => {
  it("writes the bytes at the digest's path and reports it as new", () => {
    const root = freshRoot();
    const bytes = Buffer.from("first write", "utf8");
    const stored = storeContent({ bytes, root });
    expect(stored.deduped).toBe(false);
    expect(stored.path).toBe(contentPath({ digest: contentDigest({ bytes }), root }));
    expect(readFileSync(stored.path).equals(bytes)).toBe(true);
  });

  it("recognises identical bytes on a second call and writes nothing — the re-pull property", () => {
    const root = freshRoot();
    const bytes = Buffer.from("identical on both runs", "utf8");
    const first = storeContent({ bytes, root });
    const second = storeContent({ bytes: Buffer.from("identical on both runs", "utf8"), root });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.digest).toBe(first.digest);
    expect(second.path).toBe(first.path);
  });

  it("gives different bytes different names, so one never overwrites the other", () => {
    const root = freshRoot();
    const first = storeContent({ bytes: Buffer.from("one", "utf8"), root });
    const second = storeContent({ bytes: Buffer.from("two", "utf8"), root });
    expect(second.digest === first.digest).toBe(false);
    expect(readFileSync(first.path, "utf8")).toBe("one");
    expect(readFileSync(second.path, "utf8")).toBe("two");
  });

  it("stores raw bytes rather than text, so a binary attachment survives the round trip", () => {
    const root = freshRoot();
    const bytes = Buffer.from([0x00, 0xff, 0x80, 0x0a, 0xc3, 0x28]);
    const stored = storeContent({ bytes, root });
    expect(readFileSync(stored.path).equals(bytes)).toBe(true);
  });
});
