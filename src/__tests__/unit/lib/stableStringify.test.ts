/**
 * `stableStringify` over JSON-shaped values only: key order never changes the bytes, array order always does,
 * and a field present with value `undefined` serialises as `null`, while an absent key is omitted.
 * Non-JSON values (a Date, a function, a bigint) are deliberately NOT pinned here.
 */
import { describe, expect, it } from "vitest";

import { stableStringify } from "../../../lib/stableStringify.js";

describe("stableStringify", () => {
  it("produces identical bytes for two nested objects whose keys were inserted in different orders", () => {
    const first = { b: { y: 2, x: 1 }, a: [{ d: 4, c: 3 }] };
    const second = { a: [{ c: 3, d: 4 }], b: { x: 1, y: 2 } };

    expect(stableStringify({ value: first })).toBe('{"a":[{"c":3,"d":4}],"b":{"x":1,"y":2}}');
    expect(stableStringify({ value: second })).toBe('{"a":[{"c":3,"d":4}],"b":{"x":1,"y":2}}');
  });

  it("sorts keys at every nesting level while keeping each array's own element order", () => {
    expect(stableStringify({ value: { z: [3, 1, 2], m: { k: ["b", "a"], j: true } } })).toBe(
      '{"m":{"j":true,"k":["b","a"]},"z":[3,1,2]}',
    );
  });

  it("serialises a top-level undefined as null", () => {
    expect(stableStringify({ value: undefined })).toBe("null");
  });

  it("serialises an undefined array element as null, as JSON.stringify would", () => {
    expect(stableStringify({ value: [1, undefined, 3] })).toBe("[1,null,3]");
  });

  it("serialises an undefined object field exactly like an explicit null one", () => {
    expect(stableStringify({ value: { a: undefined, b: 1 } })).toBe('{"a":null,"b":1}');
    expect(stableStringify({ value: { a: null, b: 1 } })).toBe('{"a":null,"b":1}');
  });

  it("omits an absent key, so absence and an explicit null do NOT fingerprint alike", () => {
    expect(stableStringify({ value: { b: 1 } })).toBe('{"b":1}');
  });

  it("escapes quotes and backslashes in both keys and string values", () => {
    expect(stableStringify({ value: { 'say "hi"': 'back\\slash "quoted"' } })).toBe(
      '{"say \\"hi\\"":"back\\\\slash \\"quoted\\""}',
    );
  });

  it("serialises an empty object and an empty array as their JSON forms", () => {
    expect(stableStringify({ value: { a: {}, b: [] } })).toBe('{"a":{},"b":[]}');
  });
});
