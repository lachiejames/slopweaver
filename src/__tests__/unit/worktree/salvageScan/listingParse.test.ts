/**
 * The pure parsers a salvage scan reads git's answers through: the object listing, the `cat-file --batch` stream,
 * and the destination's advertised tips that bound the walk.
 */
import { describe, expect, it } from "vitest";

import { newBlobsIn, parseCatFileBatch, remoteTips, revListInput } from "../../../../worktree/salvageScan.js";
import { batchOf, SHA_A, SHA_B } from "./harness.js";

describe("newBlobsIn", () => {
  it("keeps each object once, a commit's bare name included, since its headers are published too", () => {
    const listing = ["c".repeat(40), `${SHA_A} src/a.ts`, `${SHA_B} docs/b.md`, `${SHA_A} src/copy.ts`, ""].join("\n");
    expect(newBlobsIn({ listing })).toEqual([
      { path: "a commit's headers or message", sha: "c".repeat(40) },
      { path: "src/a.ts", sha: SHA_A },
      { path: "docs/b.md", sha: SHA_B },
    ]);
  });

  it("answers nothing for an empty listing — a tree with nothing past the remote", () => {
    expect(newBlobsIn({ listing: "" })).toEqual([]);
  });
});

describe("parseCatFileBatch", () => {
  it("slices by BYTE count, so a multi-byte character does not shift the next object", () => {
    const parsed = parseCatFileBatch({
      output: batchOf({
        objects: [
          { content: "café\nline two", sha: SHA_A },
          { content: "next", sha: SHA_B },
        ],
      }),
    });
    expect([...parsed!.entries()].map(([sha, body]) => [sha, body.toString("utf8")])).toEqual([
      [SHA_A, "café\nline two"],
      [SHA_B, "next"],
    ]);
  });

  it("answers null for an object git reports missing", () => {
    expect(parseCatFileBatch({ output: Buffer.from(`${SHA_A} missing\n`) })).toBe(null);
  });

  it("answers null for a truncated answer", () => {
    expect(parseCatFileBatch({ output: Buffer.from(`${SHA_A} blob 10\nshort`) })).toBe(null);
  });
});

describe("remoteTips and revListInput", () => {
  it("keeps every advertised tip once, peeled tag lines included", () => {
    const listing = [`${SHA_A}\tHEAD`, `${SHA_A}\trefs/heads/main`, `${SHA_B}\trefs/tags/v1^{}`, ""].join("\n");
    expect(remoteTips({ listing })).toEqual([SHA_A, SHA_B]);
  });

  it("walks from the pushed sha with every tip negated, one revision a line", () => {
    expect(revListInput({ sha: SHA_A, tips: [SHA_B] })).toBe(`${SHA_A}\n^${SHA_B}\n`);
  });
});
