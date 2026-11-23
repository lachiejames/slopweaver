/**
 * `responseSpecLeaf.ts` — one dereferenced specification node, with no composition, classified into the one shape
 * the merge table reads.
 */
import { describe, expect, it } from "vitest";

import { DatadogSpecErrors } from "../../../../atlas/datadog/responseSpecErrors.js";
import {
  datadogMalformedKeyword,
  datadogNullOnly,
  datadogSpecLeaf,
} from "../../../../atlas/datadog/responseSpecLeaf.js";

const STACK = ["schemas/Item"];

describe("datadogSpecLeaf", () => {
  it("classifies an object, declaring a required name its properties omit, and carries the stack down", () => {
    const node = { properties: { id: { type: "string" } }, required: ["id", "extra"], type: "object" };
    expect(datadogSpecLeaf({ node, stack: STACK })).toEqual({
      class: "object",
      nullable: false,
      properties: { extra: {}, id: { type: "string" } },
      required: ["id", "extra"],
      stack: STACK,
    });
  });

  it("classifies properties beside open additionalProperties as mixed, and a type list naming two shapes as free", () => {
    const mixed = { additionalProperties: true, properties: { a: { type: "string" } } };
    expect(datadogSpecLeaf({ node: mixed, stack: [] })).toEqual({ class: "mixed", nullable: false });
    expect(datadogSpecLeaf({ node: { type: ["object", "string", "null"] }, stack: [] })).toEqual({
      class: "free",
      nullable: true,
    });
  });

  it("classifies a map by its value schema, an array by its items, and an untyped enum by its values", () => {
    const value = { type: "integer" };
    expect(datadogSpecLeaf({ node: { additionalProperties: value }, stack: STACK })).toEqual({
      class: "map",
      nullable: false,
      value: { node: value, stack: STACK },
    });
    expect(datadogSpecLeaf({ node: { type: "array" }, stack: [] })).toEqual({
      class: "array",
      items: null,
      nullable: false,
    });
    expect(datadogSpecLeaf({ node: { enum: ["a", 1, null] }, stack: [] })).toEqual({
      class: "primitive",
      kinds: ["string", "number"],
      nullable: true,
    });
  });
});

describe("datadogMalformedKeyword", () => {
  it("names a structural keyword of the wrong JSON type, and nothing for a well-formed node", () => {
    expect(datadogMalformedKeyword({ node: { items: false } })).toEqual({
      code: "MALFORMED_KEYWORD",
      keyword: "items",
      message: "an items that is not a schema object, which this generator does not read",
    });
    expect(datadogMalformedKeyword({ node: { required: [1] } })).toEqual(
      DatadogSpecErrors.malformedKeyword({ keyword: "required" }),
    );
    expect(datadogMalformedKeyword({ node: { items: {}, type: "array" } })).toBe(null);
  });
});

describe("datadogNullOnly", () => {
  it("is true only of a primitive leaf of no kind that admits null", () => {
    expect(datadogNullOnly({ leaf: datadogSpecLeaf({ node: { type: "null" }, stack: [] }) })).toBe(true);
    expect(datadogNullOnly({ leaf: datadogSpecLeaf({ node: { nullable: true, type: "string" }, stack: [] }) })).toBe(
      false,
    );
    expect(datadogNullOnly({ leaf: { class: "free", nullable: true } })).toBe(false);
  });
});
