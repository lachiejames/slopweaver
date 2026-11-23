/**
 * `plainDataProblems`: which values survive `JSON.stringify` → `JSON.parse` unchanged, so a row event holding
 * them cannot lose a field the write path's read-back would never see.
 */
import { describe, expect, it } from "vitest";

import { plainDataProblems } from "../../../handover/plainData.js";

describe("plainDataProblems", () => {
  it("passes nested plain objects, arrays, strings, finite numbers, booleans and null", () => {
    const value = { a: [{ b: "x", c: 1, d: true, e: null }], f: Object.create(null) as object };
    expect(plainDataProblems({ path: "e", value })).toEqual([]);
  });

  it("passes an undefined field, which is absent on disk as in memory", () => {
    expect(plainDataProblems({ path: "e", value: { lean: undefined } })).toEqual([]);
  });

  it("names a value that contains itself instead of overflowing the stack", () => {
    const value: Record<string, unknown> = { a: "x" };
    value["self"] = { back: value };
    expect(plainDataProblems({ path: "e", value })).toEqual(["e.self.back contains itself, which JSON cannot write"]);
  });

  it("passes one object reached by two paths, which JSON writes twice", () => {
    const shared = { k: "v" };
    expect(plainDataProblems({ path: "e", value: { a: shared, b: [shared] } })).toEqual([]);
  });

  it("names a symbol key", () => {
    expect(plainDataProblems({ path: "e", value: { [Symbol("s")]: 1 } })).toEqual([
      "e carries the symbol key Symbol(s), which JSON drops",
    ]);
  });

  it("names a named array property, including a digits-only one that is not an index", () => {
    const value = Object.assign(["a"], { "01": "b", extra: "c" });
    expect(plainDataProblems({ path: "e", value })).toEqual([
      'e carries the named key "01", which JSON drops from an array',
      'e carries the named key "extra", which JSON drops from an array',
    ]);
  });

  it("names a hole in an array", () => {
    const value: unknown[] = ["a"];
    value[2] = "c";
    expect(plainDataProblems({ path: "e", value })).toEqual(["e[1] is a hole, which JSON writes as null"]);
  });

  it("names a non-enumerable field and an accessor", () => {
    const value = {};
    Object.defineProperty(value, "hidden", { enumerable: false, value: 1 });
    Object.defineProperty(value, "got", { enumerable: true, get: () => 1 });
    expect(plainDataProblems({ path: "e", value })).toEqual([
      "e.hidden is not enumerable, so JSON drops it",
      "e.got is an accessor, not a value",
    ]);
  });

  it("names a class instance, a function and a non-finite number", () => {
    const value = { at: new Date(0), f: (): number => 1, n: Number.NaN };
    expect(plainDataProblems({ path: "e", value })).toEqual([
      "e.at is a class instance, not a plain object",
      "e.f is a function, which JSON cannot carry",
      "e.n is NaN, which JSON writes as null",
    ]);
  });

  it("names an Array subclass, which can inherit a toJSON that rewrites its members", () => {
    class VanishingArray<T> extends Array<T> {
      /** Serialises as empty, whatever it holds. */
      toJSON(): readonly T[] {
        return [];
      }
    }
    const value = { set: VanishingArray.from([{ key: "platform", value: "slack" }]) };
    expect(plainDataProblems({ path: "e", value })).toEqual(["e.set is an Array subclass, not a plain array"]);
  });

  it("names a toJSON method, since it would replace the value on the way to disk", () => {
    expect(plainDataProblems({ path: "e", value: { toJSON: (): string => "x" } })).toEqual([
      "e.toJSON is a function, which JSON cannot carry",
    ]);
  });
});
