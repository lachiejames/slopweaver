/**
 * `findDuplicateKey`: the first key one object spells twice, by its path, which `JSON.parse` would have read as the
 * last value alone.
 */
import { describe, expect, it } from "vitest";

import { findDuplicateKey } from "../../../lib/jsonDuplicateKey.js";

describe("findDuplicateKey", () => {
  it("names a key spelled twice in a nested object by its whole path, an array position as its index", () => {
    const text = '{"id":"c","mapping":{"n":{"message":"lost"},"n":{"message":null}},"list":[{},{"a":1,"a":2}]}';
    expect(findDuplicateKey({ text })).toEqual(["mapping", "n"]);
    expect(findDuplicateKey({ text: '{"list":[{"a":1},{"b":[0,0],"a":1,"a":2}]}' })).toEqual(["list", "1", "a"]);
  });

  it("compares a key decoded, so an escape spelling the same key is the same key", () => {
    expect(findDuplicateKey({ text: '{"id":"a", "\\u0069d" : "b"}' })).toEqual(["id"]);
  });

  it("finds nothing where every object's keys differ, whatever the values spell", () => {
    const text = '{"a":"\\"a\\":1,","b":{"a":["a","a"]},"c":[{"a":1},{"a":2}],"d":"x:y"}';
    expect(findDuplicateKey({ text })).toBe(undefined);
    expect(findDuplicateKey({ text: "[]" })).toBe(undefined);
  });
});
