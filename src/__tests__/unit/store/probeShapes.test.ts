import { describe, expect, it } from "vitest";

import {
  escapeLike,
  escapeRegex,
  isIndexed,
  longestLiteralRun,
  PROBE_SHAPE_SPECS,
  PROBE_SHAPES,
  probeShapeSpec,
  shapeRegex,
  TRIGRAM_FLOOR,
} from "../../../store/probe/shapes.js";

describe("the seven shapes", () => {
  it("declares exactly the seven the owner named, narrowest first", () => {
    expect([...PROBE_SHAPES]).toEqual(["exact", "wild-left", "slash", "alnum", "wild-right", "wild-both", "regex"]);
  });

  it("has one spec per shape and no spec without a shape", () => {
    expect(PROBE_SHAPE_SPECS.map((spec) => spec.shape)).toEqual([...PROBE_SHAPES]);
  });

  it("reaches the tsvector for exact and the trigram index for every substring shape", () => {
    expect(probeShapeSpec({ shape: "exact" }).access).toBe("lexeme");
    expect(probeShapeSpec({ shape: "alnum" }).access).toBe("trigram");
    expect(probeShapeSpec({ shape: "wild-both" }).access).toBe("trigram");
  });
});

describe("escapeLike", () => {
  it("leaves an ordinary keyword alone", () => {
    expect(escapeLike({ term: "barten" })).toBe("barten");
  });

  it("escapes the two LIKE wildcards so a keyword searches for itself", () => {
    expect(escapeLike({ term: "100%_off" })).toBe("100\\%\\_off");
  });

  it("escapes the backslash FIRST, so the escapes it writes are not escaped again", () => {
    expect(escapeLike({ term: "a\\%b" })).toBe("a\\\\\\%b");
  });
});

describe("escapeRegex", () => {
  it("leaves an ordinary keyword alone", () => {
    expect(escapeRegex({ term: "decagon" })).toBe("decagon");
  });

  it("escapes every POSIX metacharacter", () => {
    expect(escapeRegex({ term: "a.b*c+d?e" })).toBe("a\\.b\\*c\\+d\\?e");
  });

  it("escapes a dollar without letting it rewrite the replacement", () => {
    expect(escapeRegex({ term: "$&x" })).toBe("\\$&x");
  });

  it("escapes brackets and braces", () => {
    expect(escapeRegex({ term: "[a]{2}(b)" })).toBe("\\[a\\]\\{2\\}\\(b\\)");
  });
});

describe("shapeRegex", () => {
  it("anchors wild-left at the END of a word, not the end of the body", () => {
    expect(shapeRegex({ shape: "wild-left", term: "barten" })).toBe("barten\\M");
  });

  it("anchors wild-right at the START of a word", () => {
    expect(shapeRegex({ shape: "wild-right", term: "barten" })).toBe("\\mbarten");
  });

  it("lets the alnum wildcards expand over alphanumerics only, bounded to one word", () => {
    expect(shapeRegex({ shape: "alnum", term: "17000" })).toBe("\\m[0-9a-z]*17000[0-9a-z]*\\M");
  });

  it("bounds the slash shape by a slash on the left and a slash or word end on the right", () => {
    expect(shapeRegex({ shape: "slash", term: "17000" })).toBe("/[^/[:space:]]*17000[^/[:space:]]*(/|\\M)");
  });

  it("escapes the term inside every generated pattern", () => {
    expect(shapeRegex({ shape: "wild-right", term: "a.b" })).toBe("\\ma\\.b");
  });

  it("builds no pattern for the two shapes that do not use one", () => {
    expect(shapeRegex({ shape: "exact", term: "x" })).toBe(null);
    expect(shapeRegex({ shape: "wild-both", term: "x" })).toBe(null);
  });
});

describe("longestLiteralRun", () => {
  it("counts a plain literal whole", () => {
    expect(longestLiteralRun({ pattern: "decagon" })).toBe(7);
  });

  it("ends a run at a metacharacter and keeps the longest side", () => {
    expect(longestLiteralRun({ pattern: "ab*decagon" })).toBe(7);
  });

  it("ends a run at an escape, because an escaped character contributes no seekable trigram", () => {
    expect(longestLiteralRun({ pattern: "abc\\.def" })).toBe(3);
  });

  it("is zero for a pattern made only of classes and quantifiers", () => {
    expect(longestLiteralRun({ pattern: "[a-z]+[0-9]*" })).toBe(0);
  });
});

describe("isIndexed", () => {
  it("is always true for exact, which the tsvector serves at any term length", () => {
    expect(isIndexed({ shape: "exact", term: "nz" })).toBe(true);
  });

  it("is false for a substring shape below the trigram floor", () => {
    expect(TRIGRAM_FLOOR).toBe(3);
    expect(isIndexed({ shape: "wild-both", term: "nz" })).toBe(false);
  });

  it("is true for a substring shape at the trigram floor", () => {
    expect(isIndexed({ shape: "wild-both", term: "glp" })).toBe(true);
  });

  it("judges a regex by its longest literal run rather than by its length", () => {
    expect(isIndexed({ shape: "regex", term: "[a-z]+[0-9]+" })).toBe(false);
    expect(isIndexed({ shape: "regex", term: "[a-z]*decagon" })).toBe(true);
  });
});
