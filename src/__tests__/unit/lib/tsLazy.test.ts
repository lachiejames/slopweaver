/**
 * The lazily-loaded TypeScript seam: an identifier counts only as a syntax node, never inside a comment or a string.
 */

import { describe, expect, it } from "vitest";
import { identifierReferenced } from "#lib/tsLazy.js";

describe("identifierReferenced", () => {
  it("finds an identifier used as code", () => {
    expect(identifierReferenced({ symbol: "flush", text: "export function flush(): void {}\n" })).toBe(true);
  });

  it("does not count a comment or a string that only names it", () => {
    const text = '// see flush\nconst note = "flush";\n/** flush */\nexport const x = 1;\n';
    expect(identifierReferenced({ symbol: "flush", text })).toBe(false);
  });

  it("matches the exact spelling, never a longer identifier containing it", () => {
    expect(identifierReferenced({ symbol: "flush", text: "flushAll();\n" })).toBe(false);
  });

  it("answers false for an empty file", () => {
    expect(identifierReferenced({ symbol: "flush", text: "" })).toBe(false);
  });
});
