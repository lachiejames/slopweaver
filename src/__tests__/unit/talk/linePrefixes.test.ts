/** Taking a numbered listing's and a patch's line prefixes off, and mapping each kept character back. */
import { describe, expect, it } from "vitest";

import { stripLinePrefixes } from "../../../talk/linePrefixes.js";

describe("stripLinePrefixes", () => {
  it("takes a line number, an arrow-numbered line and a diff marker off, and maps each kept char back", () => {
    const text = "12\tab\n   3→cd\n+ef\n-gh\n";
    const stripped = stripLinePrefixes({ text })!;
    expect(stripped.text).toBe("ab\ncd\nef\ngh\n");
    expect(stripped.origin.length).toBe(stripped.text.length + 1);
    expect(stripped.origin[0]).toBe(3);
    expect(text[stripped.origin[stripped.text.indexOf("c")]!]).toBe("c");
    expect(text[stripped.origin[stripped.text.indexOf("e")]!]).toBe("e");
    expect(stripped.origin.at(-1)).toBe(text.length);
  });

  it("takes a grep hit's path and number, a combined diff's ++ and a quoted reply's > off", () => {
    const text = "config/app.yml:3:  pw: a\n12:b\n++  c\n> > d\n";
    expect(stripLinePrefixes({ text })!.text).toBe("  pw: a\nb\n  c\nd\n");
  });

  it("keeps a patch's --- and +++ headers whole", () => {
    expect(stripLinePrefixes({ text: "--- a/x\n+++ b/x\n+y" })!.text).toBe("--- a/x\n+++ b/x\ny");
  });

  it("answers undefined when no line carries a prefix", () => {
    expect(stripLinePrefixes({ text: "plain\n  password: x\n" })).toBeUndefined();
    expect(stripLinePrefixes({ text: "" })).toBeUndefined();
  });
});
