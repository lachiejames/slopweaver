import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ownProtoPaths, prototypeKeys, recordKeyRefusals } from "../../../lib/boundaryKeys.js";

const prototypeRefusal = ({ key }: { key: string }): string =>
  `(body) declares "${key}", named like an Object.prototype member, which Zod reads through the prototype when it is absent — read it under z.record(z.string(), …)`;
const nonString = "(body) is a record keyed by other than strings, whose keys a refusal would print as list indexes";

describe("prototypeKeys", () => {
  it("refuses every key an absent value would be read through the prototype for, __proto__ included", () => {
    expect(prototypeKeys({ at: "(body)", keys: ["id", "toString", "__proto__", "valueOf", "label"] })).toEqual([
      prototypeRefusal({ key: "toString" }),
      prototypeRefusal({ key: "__proto__" }),
      prototypeRefusal({ key: "valueOf" }),
    ]);
  });

  it("refuses a symbol key, which no JSON answer carries", () => {
    expect(prototypeKeys({ at: "(body)", keys: ["id", Symbol("internal")] })).toEqual([
      "(body) declares Symbol(internal), a symbol key no JSON answer carries, so every read names it",
    ]);
  });

  it("allows ordinary keys, and a key that only resembles a member", () => {
    expect(prototypeKeys({ at: "(body)", keys: ["id", "to_string", "Constructor", "prototype"] })).toEqual([]);
  });
});

describe("ownProtoPaths", () => {
  it("finds an own __proto__ key JSON.parse made, at any depth and inside lists", () => {
    const value: unknown = JSON.parse('{"__proto__":{"__proto__":0},"a":[{"b":1},{"__proto__":2}]}');

    expect(ownProtoPaths({ path: [], value })).toEqual([
      ["__proto__"],
      ["__proto__", "__proto__"],
      ["a", 1, "__proto__"],
    ]);
  });

  it("finds nothing in an answer without one, and in a scalar", () => {
    expect(ownProtoPaths({ path: [], value: { a: [{ proto: 1 }], constructor: "x" } })).toEqual([]);
    expect(ownProtoPaths({ path: ["a"], value: "__proto__" })).toEqual([]);
  });
});

describe("recordKeyRefusals", () => {
  it("allows a string, a template literal, and an enum or literal of strings", () => {
    const keyed = [
      z.string(),
      z.templateLiteral(["id_", z.number()]),
      z.enum(["five_hour", "seven_day"]),
      z.literal(["a", "b"]),
    ];

    expect(keyed.flatMap((keyType) => recordKeyRefusals({ at: "(body)", keyType }))).toEqual([]);
  });

  it("refuses a number key however it is spelled, since its path segment reads as a list index", () => {
    expect(recordKeyRefusals({ at: "(body)", keyType: z.number() })).toEqual([nonString]);
    expect(recordKeyRefusals({ at: "(body)", keyType: z.literal([200, 404]) })).toEqual([nonString]);
    expect(recordKeyRefusals({ at: "(body)", keyType: z.union([z.literal("a"), z.literal(1)]) })).toEqual([nonString]);
  });

  it("refuses a fixed key set naming a prototype member", () => {
    expect(recordKeyRefusals({ at: "(body)", keyType: z.enum(["a", "hasOwnProperty"]) })).toEqual([
      prototypeRefusal({ key: "hasOwnProperty" }),
    ]);
  });
});
