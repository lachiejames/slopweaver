/**
 * The extracted-tree walk over a REAL temp directory — a genuine filesystem fixture, no git. The map row is
 * synthetic (`zorblatt`), so no test file carries a hit it plants.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseReferenceMap } from "../../../hygiene/referenceMap.js";
import { scanExtractedTree } from "../../../hygiene/referenceTree.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const MAP = unwrap(parseReferenceMap({ text: "class\tflags\tpattern\npeople\ti\t\\bzorblatt\\b\n" }));

let root: string;

/** Write one file under the fixture tree. */
const put = ({ path, content }: { path: string; content: string | Buffer }): void => {
  const absolute = join(root, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zr-tree-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("scanExtractedTree", () => {
  it("scans every file's bytes, a link's target and every path, counting binaries", () => {
    put({ content: "clean\n", path: "src/a.ts" });
    put({ content: "intro\nZorblatt wrote this\n", path: "docs/b.md" });
    put({ content: Buffer.from([0, 1, 2, 0]), path: "img.bin" });
    symlinkSync("zorblatt-target", join(root, "link"));

    const summary = unwrap(scanExtractedTree({ denylist: [], expected: 4, map: MAP, treeRoot: root }));
    expect(summary.filesScanned).toBe(4);
    expect(summary.binaryFiles).toBe(1);
    expect(summary.totalHits).toBe(2);
    expect(summary.residue).toEqual([
      { area: "docs", classes: ["map:people"], path: "docs/b.md", pathCarriesReference: false },
      { area: "code", classes: ["map:people"], path: "link", pathCarriesReference: false },
    ]);
  });

  it("refuses an extraction holding a different number of entries than the commit", () => {
    put({ content: "a\n", path: "a.ts" });
    const error = unwrapErr(scanExtractedTree({ denylist: [], expected: 2, map: MAP, treeRoot: root }));
    expect(error.code).toBe("EXPORT_INCOMPLETE");
    expect(error.message).toContain("the commit holds 2 entries and the extracted zip 1");
  });

  it("refuses a Git LFS pointer, withholding a path that carries a reference", () => {
    put({ content: "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n", path: "docs/Zorblatt.bin" });
    const error = unwrapErr(scanExtractedTree({ denylist: [], expected: 1, map: MAP, treeRoot: root }));
    expect(error.message).toContain("(a file whose own path carries a reference) is a Git LFS pointer");
    expect(error.message).not.toContain("Zorblatt");
  });

  it("refuses a link whose target is a Git LFS pointer line", () => {
    symlinkSync("version https://git-lfs.github.com/spec/v1", join(root, "pointer"));
    const error = unwrapErr(scanExtractedTree({ denylist: [], expected: 1, map: MAP, treeRoot: root }));
    expect(error.message).toContain("pointer is a Git LFS pointer, not its content");
  });

  it("names the walk step when the tree root is not there", () => {
    const error = unwrapErr(
      scanExtractedTree({ denylist: [], expected: 0, map: MAP, treeRoot: join(root, "no-such-tree") }),
    );
    expect(error.code).toBe("EXPORT_STEP_FAILED");
    expect(error.message).toContain("walk failed");
  });
});
