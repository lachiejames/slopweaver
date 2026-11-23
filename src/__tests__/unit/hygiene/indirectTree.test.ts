/**
 * The indirect walk over a REAL temp directory — a genuine filesystem fixture, no git. The map row and the
 * dictionary are synthetic (`zorblatt`, `Quillmore`), so no test file carries a hit it plants.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseIndirectMap } from "../../../hygiene/indirectMap.js";
import { readHarvestDictionary } from "../../../hygiene/indirectScan.js";
import { harvestSkips, scanIndirectTree } from "../../../hygiene/indirectTree.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const MAP = unwrap(
  parseIndirectMap({
    text: "class\tflags\tdisposition\tpattern\treplacement\nperson\ti\treview\t\\bzorblatt\\b\ta synthetic person\n",
  }),
);
const DICTIONARY = readHarvestDictionary({ propernames: ["Quillmore"], words: ["clean"] });

let root: string;

/** Write one file under the fixture tree. */
const put = ({ path, content }: { path: string; content: string | Buffer }): void => {
  const absolute = join(root, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ind-tree-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("scanIndirectTree", () => {
  it("maps every file and link, harvests text it does not skip, and reads a binary by the map only", () => {
    put({ content: "clean\nQuillmore wrote this\n", path: "docs/a.md" });
    put({ content: "Quillmore\n", path: "src/generated/b.ts" });
    put({ content: Buffer.from("\u0000Quillmore zorblatt\u0000", "latin1"), path: "img.bin" });
    symlinkSync("zorblatt-target", join(root, "link"));

    const scan = unwrap(scanIndirectTree({ dictionary: DICTIONARY, expected: 4, map: MAP, treeRoot: root }));
    expect(scan.filesScanned).toBe(4);
    expect(scan.binaryFiles).toBe(1);
    expect(scan.harvestSkipped).toBe(1);
    const seen = scan.places.map((p) => `${p.className} ${p.path}:${String(p.line)}`).toSorted();
    expect(seen).toEqual(["harvest:proper-name docs/a.md:2", "map:person img.bin:1", "map:person link:1"]);
  });

  it("matches a binary as its bytes are and with NULs dropped, reporting each term once", () => {
    const nulMap = unwrap(
      parseIndirectMap({
        text: "class\tflags\tdisposition\tpattern\treplacement\nissue-key\t-\tremove\tzo\\x00rb\tx\nperson\ti\treview\tzorblatt\tx\n",
      }),
    );
    put({
      content: Buffer.from("zo\u0000rb \u0000zorblatt z\u0000o\u0000r\u0000b\u0000l\u0000a\u0000t\u0000t", "latin1"),
      path: "a.bin",
    });

    const scan = unwrap(scanIndirectTree({ dictionary: DICTIONARY, expected: 1, map: nulMap, treeRoot: root }));
    expect(scan.places.map((p) => `${p.className} ${p.term.replaceAll("\u0000", "\\0")}`)).toEqual([
      "map:issue-key zo\\0rb",
      "map:person zorblatt",
    ]);
  });

  it("keeps a binary's remove place when a review row of the same class matched the same term first", () => {
    const twoRows = unwrap(
      parseIndirectMap({
        text: "class\tflags\tdisposition\tpattern\treplacement\nissue-key\t-\treview\tABC\tr\nissue-key\t-\tremove\tABC\tx\n",
      }),
    );
    put({ content: Buffer.from("A\u0000B\u0000C", "latin1"), path: "a.bin" });

    const scan = unwrap(scanIndirectTree({ dictionary: DICTIONARY, expected: 1, map: twoRows, treeRoot: root }));
    expect(scan.places.map((p) => p.disposition)).toEqual(["review", "remove"]);
  });

  it("reads a file that is not UTF-8 as a binary, so a row matching its raw bytes still fires", () => {
    const rawMap = unwrap(
      parseIndirectMap({
        text: "class\tflags\tdisposition\tpattern\treplacement\nissue-key\t-\tremove\t\\xFFABC\tx\n",
      }),
    );
    put({ content: Buffer.from([0xff, 0x41, 0x42, 0x43]), path: "a.bin" });

    const scan = unwrap(scanIndirectTree({ dictionary: DICTIONARY, expected: 1, map: rawMap, treeRoot: root }));
    expect(scan.binaryFiles).toBe(1);
    expect(scan.places.map((p) => p.disposition)).toEqual(["remove"]);
  });

  it("reads a link target that is not UTF-8 by its raw bytes, so the row still fires", () => {
    const rawMap = unwrap(
      parseIndirectMap({
        text: "class\tflags\tdisposition\tpattern\treplacement\nissue-key\t-\tremove\t\\xFFABC\tx\n",
      }),
    );
    symlinkSync(Buffer.from([0xff, 0x41, 0x42, 0x43]), join(root, "link"));

    const scan = unwrap(scanIndirectTree({ dictionary: DICTIONARY, expected: 1, map: rawMap, treeRoot: root }));
    expect(scan.places.map((p) => `${p.disposition} ${p.path}`)).toEqual(["remove link"]);
  });

  it("refuses an extraction whose entry count is not the commit's", () => {
    put({ content: "clean\n", path: "a.md" });
    const error = unwrapErr(scanIndirectTree({ dictionary: DICTIONARY, expected: 2, map: MAP, treeRoot: root }));
    expect(error.code).toBe("EXPORT_INCOMPLETE");
  });

  it("refuses a root that cannot be walked", () => {
    const error = unwrapErr(
      scanIndirectTree({ dictionary: DICTIONARY, expected: 0, map: MAP, treeRoot: join(root, "absent") }),
    );
    expect(error.code).toBe("EXPORT_STEP_FAILED");
  });
});

describe("harvestSkips", () => {
  it.each([
    ["src/atlas/generated/x.ts", true],
    ["yarn.lock", true],
    ["fixtures/recording.har", true],
    ["src/generatedish/x.ts", false],
    ["docs/yarn.lock.md", false],
  ])("%s skipped: %s", (path, expected) => {
    expect(harvestSkips({ path })).toBe(expected);
  });
});
