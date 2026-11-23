/**
 * JSON's escapes undone with a map back to the source, so a span found in the unescaped copy lands on the
 * characters it came from.
 */
import { describe, expect, it } from "vitest";

import { unescapeJson } from "../../../talk/jsonEscapes.js";

describe("unescapeJson", () => {
  it("undoes quote, newline and unicode escapes and maps each character to where it started", () => {
    const unescaped = unescapeJson({ text: String.raw`a\"b\nc\u0041` })!;
    expect(unescaped.text).toBe('a"b\ncA');
    expect(unescaped.origin).toEqual([0, 1, 3, 4, 6, 7, 13]);
  });

  it("leaves a backslash that starts no escape, and one at the very end, as it is", () => {
    const unescaped = unescapeJson({ text: String.raw`C:\q\u12` + "\\" })!;
    expect(unescaped.text).toBe(String.raw`C:\q\u12` + "\\");
    expect(unescaped.origin).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("answers undefined for a text with no backslash to undo", () => {
    expect(unescapeJson({ text: '{"a":"b"}' })).toBeUndefined();
  });
});
