/** Where a run of base64 text ends, padding included, from a chosen start. */
import { describe, expect, it } from "vitest";

import { base64RunEnd, characterRunEnd } from "#lib/base64Run.js";

describe("characterRunEnd", () => {
  it("stops at the first character the negated class names", () => {
    expect(characterRunEnd({ from: 5, outside: /[^a-z]/, text: "data:image/png" })).toBe(10);
  });

  it("answers the text's length when the run reaches the end", () => {
    expect(characterRunEnd({ from: 0, outside: /[^a-z0-9.+-]/, text: "svg+xml" })).toBe(7);
  });

  it("ignores the pattern's own lastIndex and flags", () => {
    const outside = /[^a-z]/y;
    outside.lastIndex = 9;

    expect(characterRunEnd({ from: 0, outside, text: "abc/def" })).toBe(3);
    expect(outside.lastIndex).toBe(9);
  });
});

describe("base64RunEnd", () => {
  it("stops at the first character outside the alphabet", () => {
    expect(base64RunEnd({ from: 0, text: "AB+/cd09==>rest" })).toBe(10);
  });

  it("answers the text's length when the run reaches the end", () => {
    expect(base64RunEnd({ from: 3, text: "<a>QUJD" })).toBe(7);
  });

  it("answers the start itself when the first character is already outside the alphabet", () => {
    expect(base64RunEnd({ from: 2, text: 'AB"CD' })).toBe(2);
  });

  it("ignores everything before the start", () => {
    expect(base64RunEnd({ from: 4, text: "!!!!AAAA!" })).toBe(8);
  });

  it("stops at a non-ASCII character", () => {
    expect(base64RunEnd({ from: 0, text: "AAé" })).toBe(2);
  });

  it("keeps a `=` inside the run, padding being part of the alphabet here", () => {
    expect(base64RunEnd({ from: 0, text: "QQ=QQ==;" })).toBe(7);
  });

  it("walks a run the length of an image at the per-image cap", () => {
    const run = Buffer.alloc(4 * 1024 * 1024).toString("base64");

    expect(base64RunEnd({ from: 1, text: `"${run}"` })).toBe(run.length + 1);
  });

  it("answers the start on an empty remainder", () => {
    expect(base64RunEnd({ from: 3, text: "abc" })).toBe(3);
  });
});
