import { describe, expect, it } from "vitest";
import {
  attachedCommentAbove,
  flaggedSymbolsOf,
  INTERNAL_MARKER,
  isInternallyMarked,
  parseBaselineJson,
  parseKnipReport,
  violationsOf,
} from "../../../devLint/internalExports.js";
import { unwrapErr } from "../../../lib/result.js";

describe("parseKnipReport", () => {
  it("decodes a valid report", () => {
    const text = JSON.stringify({
      issues: [{ exports: [{ line: 5, name: "foo" }], file: "src/a.ts", nsExports: [], nsTypes: [], types: [] }],
    });
    const result = parseKnipReport({ text });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().issues).toHaveLength(1);
  });

  it("rejects invalid JSON", () => {
    expect(unwrapErr(parseKnipReport({ text: "not json" })).message).toBe("knip report: invalid JSON");
  });

  it("rejects a missing issues field", () => {
    expect(unwrapErr(parseKnipReport({ text: "{}" })).message).toBe(
      "knip report: unexpected shape (expected { issues: [{ file, exports, types, … }] })",
    );
  });
});

describe("flaggedSymbolsOf", () => {
  it("flattens exports/types/nsExports/nsTypes into one list", () => {
    const report = {
      issues: [
        {
          exports: [{ line: 5, name: "foo" }],
          file: "src/a.ts",
          nsExports: [{ line: 10, name: "NsFoo" }],
          nsTypes: [],
          types: [{ line: 8, name: "Foo" }],
        },
      ],
    };
    expect(flaggedSymbolsOf({ report })).toEqual([
      { line: 5, name: "foo", path: "src/a.ts" },
      { line: 8, name: "Foo", path: "src/a.ts" },
      { line: 10, name: "NsFoo", path: "src/a.ts" },
    ]);
  });

  it("returns empty for a report with no issues", () => {
    expect(flaggedSymbolsOf({ report: { issues: [] } })).toEqual([]);
  });
});

describe("attachedCommentAbove", () => {
  it("collects the contiguous comment block directly above the declaration", () => {
    const lines = ["/**", " * a doc comment", " */", "export function f() {}"];
    expect(attachedCommentAbove({ declLine: 4, lines })).toBe(["/**", "* a doc comment", "*/"].join("\n"));
  });

  it("stops at a blank line, so a detached comment is not attached", () => {
    const lines = ["/** a doc comment */", "", "export function f() {}"];
    expect(attachedCommentAbove({ declLine: 3, lines })).toBe("");
  });

  it("is empty when nothing precedes the declaration", () => {
    expect(attachedCommentAbove({ declLine: 1, lines: ["export function f() {}"] })).toBe("");
  });
});

describe("isInternallyMarked", () => {
  it("recognises @internal as its own tag line", () => {
    const lines = ["/**", " * a doc comment", " * @internal", " */", "export function f() {}"];
    expect(isInternallyMarked({ declLine: 5, lines })).toBe(true);
  });

  it("does NOT match @internal merely mentioned in prose", () => {
    const lines = ["/** describes @internal in prose, not as a tag */", "export function f() {}"];
    expect(isInternallyMarked({ declLine: 2, lines })).toBe(false);
  });

  it("returns false when there is no attached comment at all", () => {
    expect(isInternallyMarked({ declLine: 1, lines: ["export function f() {}"] })).toBe(false);
  });
});

describe("INTERNAL_MARKER", () => {
  it("is @internal", () => {
    expect(INTERNAL_MARKER).toBe("@internal");
  });
});

describe("violationsOf", () => {
  it("flags a symbol that is neither marked nor baselined", () => {
    const flagged = [{ line: 1, name: "foo", path: "src/a.ts" }];
    expect(violationsOf({ baseline: { symbols: [] }, flagged, marked: new Set() })).toEqual(flagged);
  });

  it("does not flag a marked symbol", () => {
    const flagged = [{ line: 1, name: "foo", path: "src/a.ts" }];
    expect(violationsOf({ baseline: { symbols: [] }, flagged, marked: new Set(["src/a.ts\tfoo"]) })).toEqual([]);
  });

  it("does not flag a baselined symbol", () => {
    const flagged = [{ line: 1, name: "foo", path: "src/a.ts" }];
    const baseline = { symbols: [{ name: "foo", path: "src/a.ts" }] };
    expect(violationsOf({ baseline, flagged, marked: new Set() })).toEqual([]);
  });

  it("matches baseline entries by path+name only, ignoring line drift", () => {
    const flagged = [{ line: 99, name: "foo", path: "src/a.ts" }];
    const baseline = { symbols: [{ name: "foo", path: "src/a.ts" }] };
    expect(violationsOf({ baseline, flagged, marked: new Set() })).toEqual([]);
  });
});

describe("parseBaselineJson", () => {
  it("decodes a valid baseline", () => {
    const result = parseBaselineJson({ text: '{"symbols": [{"path": "src/a.ts", "name": "foo"}]}' });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ symbols: [{ name: "foo", path: "src/a.ts" }] });
  });

  it("rejects invalid JSON", () => {
    expect(unwrapErr(parseBaselineJson({ text: "not json" })).message).toBe("internal-exports baseline: invalid JSON");
  });

  it("rejects a missing symbols field", () => {
    expect(unwrapErr(parseBaselineJson({ text: "{}" })).message).toBe(
      "internal-exports baseline: unexpected shape (expected { symbols: [{ path, name }] })",
    );
  });
});
