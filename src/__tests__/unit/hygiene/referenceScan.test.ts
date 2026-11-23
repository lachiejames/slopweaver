/**
 * The zero-references scan over SYNTHETIC rules: the map rows and the hashed gate rule below are invented, and
 * the workspace id is assembled at runtime, so no test file carries the hit it plants.
 */
import { describe, expect, it } from "vitest";

import { type ForbiddenIdentifierRules, identifierDigest, identifierScanner } from "../../../hygiene/identifierScan.js";
import { parseReferenceMap } from "../../../hygiene/referenceMap.js";
import {
  printablePath,
  printableRefusal,
  referenceArea,
  referenceClasses,
  scanBinaryReferences,
  scanFileReferences,
  scanReferences,
} from "../../../hygiene/referenceScan.js";
import { summariseReferences } from "../../../hygiene/referenceSummary.js";
import { unwrap } from "../../../lib/result.js";

const MAP = unwrap(
  parseReferenceMap({
    text: ["class\tflags\tpattern", "people\ti\t\\bzorblatt\\b", "hosts\t-\tquux\\.example"].join("\n"),
  }),
);

const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [{ hash: identifierDigest({ text: "blorpcorp" }), length: 9 }],
    substringCs: [],
    teamKeys: [],
    wordCi: [],
    wordCs: [],
  },
  providerLocations: [],
};

const SCANNER = identifierScanner({ rules: RULES });

/** A real-shaped Slack user id, built here so this file never carries one. */
const REAL_SHAPED_ID = ["U", "04", "QWERTY", "9"].join("");

/** Scan one synthetic file. */
const scan = ({ path, content, denylist = [] }: { path: string; content: string; denylist?: readonly string[] }) =>
  scanReferences({ content, denylist, map: MAP, path, scanner: SCANNER });

describe("scanReferences", () => {
  it("reports each source under its qualified class, with the line it sits on", () => {
    const hits = scan({
      content: `ok\nZorblatt said\nsee quux.example\nthe BlorpCorp team\n${REAL_SHAPED_ID}`,
      path: "a.ts",
    });
    expect(hits).toEqual([
      { className: "map:people", line: 2, path: "a.ts", source: "map" },
      { className: "map:hosts", line: 3, path: "a.ts", source: "map" },
      { className: "gate:substring-ci", line: 4, path: "a.ts", source: "gate" },
      { className: "leak:raw-workspace-id", line: 5, path: "a.ts", source: "leak" },
    ]);
  });

  it("scans the path itself at line 0", () => {
    expect(scan({ content: "", path: "docs/zorblatt-notes.md" })).toEqual([
      { className: "map:people", line: 0, path: "docs/zorblatt-notes.md", source: "map" },
    ]);
  });

  it("scans the path for the leak classes too, so a real-shaped id in a file name is counted", () => {
    expect(scan({ content: "clean\n", path: `${REAL_SHAPED_ID}.txt` })).toEqual([
      { className: "leak:raw-workspace-id", line: 0, path: `${REAL_SHAPED_ID}.txt`, source: "leak" },
    ]);
  });

  it("counts one place once per class, however many times the line repeats it", () => {
    expect(scan({ content: "zorblatt and Zorblatt", path: "a.ts" }).length).toBe(1);
  });

  it("does not count a synthetic id, a home-path placeholder, or a near miss", () => {
    const synthetic = ["U", "0SYN", "000001"].join("");
    expect(scan({ content: `${synthetic}\n/Users/someone/x\nzorblatts\nquuxXexample`, path: "a.ts" })).toEqual([]);
  });

  it("counts a private denylist word", () => {
    expect(scan({ content: "carries frobnicate here", denylist: ["frobnicate"], path: "a.ts" })).toEqual([
      { className: "leak:denylist", line: 1, path: "a.ts", source: "leak" },
    ]);
  });
});

describe("scanBinaryReferences", () => {
  it("finds a name stored as UTF-16 in either byte order, once per class, at line 1", () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00]), Buffer.from("zorblatt\nzorblatt", "utf16le")]);
    const be = Buffer.from(Buffer.from("x Zorblatt", "utf16le").map((_, i, all) => all[i ^ 1]!));
    expect(scanBinaryReferences({ bytes: le, denylist: [], map: MAP, path: "a.bin", scanner: SCANNER })).toEqual([
      { className: "map:people", line: 1, path: "a.bin", source: "map" },
    ]);
    expect(scanBinaryReferences({ bytes: be, denylist: [], map: MAP, path: "b.bin", scanner: SCANNER })).toEqual([
      { className: "map:people", line: 1, path: "b.bin", source: "map" },
    ]);
  });

  it("still reports the path at line 0, and nothing for a clean binary", () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02]);
    expect(scanBinaryReferences({ bytes, denylist: [], map: MAP, path: "zorblatt.bin", scanner: SCANNER })).toEqual([
      { className: "map:people", line: 0, path: "zorblatt.bin", source: "map" },
    ]);
    expect(scanBinaryReferences({ bytes, denylist: [], map: MAP, path: "clean.bin", scanner: SCANNER })).toEqual([]);
  });
});

describe("scanBinaryReferences over a non-ASCII name", () => {
  it("decodes real UTF-16 in both byte orders and at an odd offset", () => {
    const accented = unwrap(parseReferenceMap({ text: "class\tflags\tpattern\npeople\t-\tĀdam" }));
    const le = Buffer.concat([Buffer.from([0x00]), Buffer.from("Ādam", "utf16le")]);
    const be = Buffer.from("Ādam", "utf16le").swap16();
    for (const bytes of [le, be]) {
      expect(scanBinaryReferences({ bytes, denylist: [], map: accented, path: "a.bin", scanner: SCANNER })).toEqual([
        { className: "map:people", line: 1, path: "a.bin", source: "map" },
      ]);
    }
  });
});

describe("scanFileReferences", () => {
  const cjk = unwrap(parseReferenceMap({ text: "class\tflags\tpattern\npeople\t-\t中文" }));

  it("finds a UTF-16 name with no zero byte in it, in either byte order, in a file that is not binary", () => {
    const le = Buffer.from("中文", "utf16le");
    const be = Buffer.from("中文", "utf16le").swap16();
    for (const bytes of [le, be]) {
      expect(scanFileReferences({ bytes, denylist: [], map: cjk, path: "a.bin", scanner: SCANNER })).toEqual({
        binary: false,
        hits: [{ className: "map:people", line: 1, path: "a.bin", source: "map" }],
      });
    }
  });

  it("counts a text file by its own lines, never a second time from another reading", () => {
    const bytes = Buffer.from("ok\nzorblatt\n");
    expect(scanFileReferences({ bytes, denylist: [], map: MAP, path: "a.ts", scanner: SCANNER })).toEqual({
      binary: false,
      hits: [{ className: "map:people", line: 2, path: "a.ts", source: "map" }],
    });
  });
});

describe("printableRefusal", () => {
  it("prints a clean refusal and withholds one whose text carries a reference, keeping its code", () => {
    const args = { code: "EXPORT_STEP_FAILED", denylist: [], map: MAP, scanner: SCANNER };
    expect(printableRefusal({ ...args, message: "resolve failed: no such ref" })).toBe("resolve failed: no such ref");
    const withheld = printableRefusal({ ...args, message: "resolve failed: zorblatt^{commit}" });
    expect(withheld).toBe("EXPORT_STEP_FAILED (its text is withheld: it carries a reference itself)");
  });
});

describe("printablePath", () => {
  it("prints a clean path and withholds one that carries a reference", () => {
    expect(printablePath({ denylist: [], map: MAP, path: "src/a.ts", scanner: SCANNER })).toBe("src/a.ts");
    expect(printablePath({ denylist: [], map: MAP, path: "docs/Zorblatt.bin", scanner: SCANNER })).toBe(
      "(a file whose own path carries a reference)",
    );
  });
});

describe("referenceArea", () => {
  it("is docs under docs/ or for a prose extension, code otherwise", () => {
    expect(
      ["docs/x.ts", "AGENTS.md", "skills/a/SKILL.md", "d.mmd", "n.txt", "src/a.ts", "x.json"].map((path) =>
        referenceArea({ path }),
      ),
    ).toEqual(["docs", "docs", "docs", "docs", "docs", "code", "code"]);
  });
});

describe("summariseReferences", () => {
  it("lists every known class at zero on a clean tree", () => {
    const summary = summariseReferences({
      binaryFiles: 0,
      classes: referenceClasses({ map: MAP }),
      filesScanned: 3,
      hits: [],
    });
    expect(summary.totalHits).toBe(0);
    expect(summary.residue).toEqual([]);
    expect(summary.classes.length).toBeGreaterThan(0);
    expect(summary.classes.slice(0, 2)).toEqual([
      { className: "map:people", codeFiles: 0, docsFiles: 0, files: 0, hits: 0, section: "acceptance", source: "map" },
      { className: "map:hosts", codeFiles: 0, docsFiles: 0, files: 0, hits: 0, section: "acceptance", source: "map" },
    ]);
    expect(summary.acceptance).toEqual({ codeFiles: 0, docsFiles: 0, files: 0, hits: 0 });
    expect(summary.ownName).toEqual({ codeFiles: 0, docsFiles: 0, files: 0, hits: 0 });
    expect(summary.classes.some((row) => row.className === "leak:absolute-home-path")).toBe(false);
  });

  it("folds hits into per-class counts and a sorted residue that marks a path carrying a reference", () => {
    const hits = [
      ...scan({ content: "zorblatt\nzorblatt again", path: "src/b.ts" }),
      ...scan({ content: "quux.example", path: "docs/zorblatt.md" }),
    ];
    const summary = summariseReferences({
      binaryFiles: 1,
      classes: referenceClasses({ map: MAP }),
      filesScanned: 9,
      hits,
    });
    expect(summary.totalHits).toBe(4);
    expect(summary.codeFiles).toBe(1);
    expect(summary.docsFiles).toBe(1);
    expect(summary.classes.find((row) => row.className === "map:people")).toEqual({
      className: "map:people",
      codeFiles: 1,
      docsFiles: 1,
      files: 2,
      hits: 3,
      section: "acceptance",
      source: "map",
    });
    expect(summary.residue).toEqual([
      { area: "docs", classes: ["map:hosts", "map:people"], path: "docs/zorblatt.md", pathCarriesReference: true },
      { area: "code", classes: ["map:people"], path: "src/b.ts", pathCarriesReference: false },
    ]);
  });

  it("counts the owner's personal name in its own section, outside the acceptance, and the owner's employer handle inside it", () => {
    const map = unwrap(
      parseReferenceMap({
        text: ["class\tflags\tpattern", "owner\t-\t\\bquimby\\b", "owner-employer\t-\tquimby-blorp"].join("\n"),
      }),
    );
    const hits = [
      ...scanReferences({ content: "by quimby", denylist: [], map, path: "src/a.ts", scanner: SCANNER }),
      ...scanReferences({ content: "quimby\nquimby", denylist: [], map, path: "docs/b.md", scanner: SCANNER }),
      ...scanReferences({ content: "@quimby-blorp", denylist: [], map, path: "src/c.ts", scanner: SCANNER }),
    ];
    const summary = summariseReferences({ binaryFiles: 0, classes: referenceClasses({ map }), filesScanned: 3, hits });
    expect(summary.classes.find((row) => row.className === "map:owner")!.section).toBe("own-name");
    expect(summary.classes.find((row) => row.className === "map:owner-employer")!.section).toBe("acceptance");
    // `\bquimby\b` also matches inside the employer handle, so src/c.ts counts in both sections.
    expect(summary.ownName).toEqual({ codeFiles: 2, docsFiles: 1, files: 3, hits: 4 });
    expect(summary.acceptance).toEqual({ codeFiles: 1, docsFiles: 0, files: 1, hits: 1 });
  });
});
