/**
 * The pure parsers a salvage scan reads git's answers through: the object listing, the `cat-file --batch` stream,
 * the destination's advertised tips that bound the walk, and the raw metadata walk that says where each blob is written.
 */
import { describe, expect, it } from "vitest";

import { parseSalvageMetadata } from "../../../../worktree/salvageMetadata.js";
import { newBlobsIn, parseCatFileBatch, remoteTips, revListInput } from "../../../../worktree/salvageScan.js";
import { batchOf, NO_SHA, rawRecord, SHA_A, SHA_B } from "./harness.js";

const MALFORMED = "the paths it would push were in a git listing the scan could not read — nothing was pushed";

describe("parseSalvageMetadata", () => {
  it("maps one blob to EVERY path a commit writes it at, the case rev-list names only once", () => {
    const output =
      rawRecord({ path: ".github/CODEOWNERS", sha: SHA_A }) + rawRecord({ path: "docs/o.txt", sha: SHA_A });
    expect(parseSalvageMetadata({ output })).toStrictEqual({
      changedPaths: ".github/CODEOWNERS\u0000docs/o.txt\u0000",
      pathsByBlob: new Map([[SHA_A, [".github/CODEOWNERS", "docs/o.txt"]]]),
    });
  });

  it("keeps one blob/path pair once when two commits write it, and every changed path in the text", () => {
    const output =
      rawRecord({ path: "a.md", sha: SHA_A }) +
      rawRecord({ newMode: "100755", oldMode: "100644", path: "a.md", sha: SHA_A, status: "M" });
    expect(parseSalvageMetadata({ output })).toStrictEqual({
      changedPaths: "a.md\u0000a.md\u0000",
      pathsByBlob: new Map([[SHA_A, ["a.md"]]]),
    });
  });

  it("adds a DELETED path to the text and nothing to the map, its new side being all zeros", () => {
    const output = rawRecord({ newMode: "000000", oldMode: "100644", path: "gone.md", sha: NO_SHA, status: "D" });
    expect(parseSalvageMetadata({ output })).toStrictEqual({ changedPaths: "gone.md\u0000", pathsByBlob: new Map() });
  });

  it("records a TYPE change's new-side blob only, a symlink here", () => {
    const output = rawRecord({ newMode: "120000", oldMode: "100644", path: "link", sha: SHA_A, status: "T" });
    expect(parseSalvageMetadata({ output })).toStrictEqual({
      changedPaths: "link\u0000",
      pathsByBlob: new Map([[SHA_A, ["link"]]]),
    });
  });

  it("reads a SHA-256 object name", () => {
    const sha = "c".repeat(64);
    const output = `:000000 100644 ${"0".repeat(64)} ${sha} A\u0000a.md\u0000`;
    expect(parseSalvageMetadata({ output })).toStrictEqual({
      changedPaths: "a.md\u0000",
      pathsByBlob: new Map([[sha, ["a.md"]]]),
    });
  });

  it("answers nothing for an empty walk — a range that changes no path", () => {
    expect(parseSalvageMetadata({ output: "" })).toStrictEqual({ changedPaths: "", pathsByBlob: new Map() });
  });

  it("declines a new-side SUBMODULE entry on its own line, since nothing the scan reads covers it", () => {
    const output = rawRecord({ newMode: "160000", path: "vendor/lib", sha: SHA_A });
    expect(parseSalvageMetadata({ output })).toBe(
      "what it would push writes a submodule entry, and a submodule is not scanned — nothing was pushed",
    );
  });

  it("declines every stream it cannot read whole, rather than answer a partial map", () => {
    const record = rawRecord({ path: "a.md", sha: SHA_A });
    const outputs = [
      record.slice(0, -1),
      `${record}a.md\u0000`,
      rawRecord({ path: "", sha: SHA_A }),
      rawRecord({ path: "a.md", sha: SHA_A.slice(0, 12) }),
      rawRecord({ path: "a.md", sha: SHA_A, status: "R100" }),
      rawRecord({ newMode: "040000", path: "dir", sha: SHA_A }),
      rawRecord({ newMode: "000000", oldMode: "100644", path: "a.md", sha: NO_SHA, status: "M" }),
      rawRecord({ path: "a.md", sha: SHA_A, status: "D" }),
      `a.md\u0000`,
      `:000000 100644 ${NO_SHA} ${"a".repeat(64)} A\u0000a.md\u0000`,
      rawRecord({ oldMode: "777777", path: "a.md", sha: SHA_A, status: "M" }),
      rawRecord({ path: "a.md", sha: SHA_A, status: "M" }),
    ];
    expect(outputs.map((output) => parseSalvageMetadata({ output }))).toStrictEqual(outputs.map(() => MALFORMED));
  });
});

describe("newBlobsIn", () => {
  it("keeps each object once, a commit's bare name included, since its headers are published too", () => {
    const listing = ["c".repeat(40), `${SHA_A} src/a.ts`, `${SHA_B} docs/b.md`, `${SHA_A} src/copy.ts`, ""].join("\n");
    expect(newBlobsIn({ listing })).toEqual([
      { commit: true, path: "a commit's headers or message", sha: "c".repeat(40) },
      { commit: false, path: "src/a.ts", sha: SHA_A },
      { commit: false, path: "docs/b.md", sha: SHA_B },
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
