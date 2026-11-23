/**
 * The control-byte gate, tested on inline fixtures so the gate never scans itself.
 *
 * Forbidden characters are built with `String.fromCodePoint` rather than written literally, so this test
 * file stays clean under the very rule it exercises — a fixture containing a raw NUL would make THIS file
 * binary to git and hide it from review, which is the defect being ratcheted.
 */
import { describe, expect, it } from "vitest";

import { isForbiddenControl, isScannablePath, scanControlBytes } from "../../../devLint/controlBytes.js";

/** The byte that shipped in `issueLedger.ts`. */
const NUL = String.fromCodePoint(0x00);

describe("isForbiddenControl", () => {
  it("refuses NUL", () => {
    expect(isForbiddenControl({ codePoint: 0x00 })).toBe(true);
  });

  it("refuses DEL", () => {
    expect(isForbiddenControl({ codePoint: 0x7f })).toBe(true);
  });

  it("refuses a vertical tab", () => {
    expect(isForbiddenControl({ codePoint: 0x0b })).toBe(true);
  });

  it("allows tab, line feed and carriage return", () => {
    expect([0x09, 0x0a, 0x0d].map((codePoint) => isForbiddenControl({ codePoint }))).toEqual([false, false, false]);
  });

  it("allows a printable space", () => {
    expect(isForbiddenControl({ codePoint: 0x20 })).toBe(false);
  });

  it("allows a non-ASCII letter", () => {
    expect(isForbiddenControl({ codePoint: "é".codePointAt(0)! })).toBe(false);
  });
});

describe("scanControlBytes", () => {
  it("finds nothing in clean source", () => {
    expect(scanControlBytes({ content: 'const a = "ok";\nconst b = 1;\n', path: "src/a.ts" })).toEqual([]);
  });

  it("reports the exact line, column and code point of the shipped defect's shape", () => {
    const content = `const material = description === undefined ? "${NUL}absent" : "x";`;

    expect(scanControlBytes({ content, path: "src/outbound/linear/issueLedger.ts" })).toEqual([
      { codePoint: 0x00, column: 47, line: 1, path: "src/outbound/linear/issueLedger.ts" },
    ]);
  });

  it("counts a line by line feeds, so a hit on the third line reports line 3", () => {
    const content = `first\nsecond\nth${NUL}ird`;
    const hits = scanControlBytes({ content, path: "src/a.ts" });

    expect(hits).toEqual([{ codePoint: 0x00, column: 3, line: 3, path: "src/a.ts" }]);
  });

  it("reports every hit, not just the first", () => {
    const content = `a${NUL}b${String.fromCodePoint(0x7f)}c`;

    expect(scanControlBytes({ content, path: "src/a.ts" }).map((hit) => hit.codePoint)).toEqual([0x00, 0x7f]);
  });

  it("does not trip on the tab and CRLF that legitimately appear in text", () => {
    expect(scanControlBytes({ content: "a\tb\r\nc", path: "src/a.ts" })).toEqual([]);
  });

  it("finds nothing in empty content", () => {
    expect(scanControlBytes({ content: "", path: "src/a.ts" })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans TypeScript", () => {
    expect(isScannablePath({ path: "src/outbound/linear/issueLedger.ts" })).toBe(true);
  });

  it("scans markdown, so a doc cannot hide one either", () => {
    expect(isScannablePath({ path: "docs/security.md" })).toBe(true);
  });

  it("scans an extensionless file — the hole the allow list left", () => {
    expect(isScannablePath({ path: "LICENSE" })).toBe(true);
  });

  it("scans the plugin's own entry point, which has no extension", () => {
    expect(isScannablePath({ path: "bin/slopweaver" })).toBe(true);
  });

  it("scans a dotfile", () => {
    expect(isScannablePath({ path: ".gitignore" })).toBe(true);
  });

  it("scans the lockfile", () => {
    expect(isScannablePath({ path: "yarn.lock" })).toBe(true);
  });

  it("scans a recorded cassette too — a HAR cannot legitimately hold a control character", () => {
    expect(isScannablePath({ path: "src/__tests__/integration/__recordings__/x/y/recording.har" })).toBe(true);
  });

  it("skips a genuinely binary asset", () => {
    expect(isScannablePath({ path: "docs/diagram.png" })).toBe(false);
  });

  it("skips a binary asset whose extension is upper-case", () => {
    expect(isScannablePath({ path: "docs/DIAGRAM.PNG" })).toBe(false);
  });
});
