/*
 * How a generated Datadog response boundary admits and records lag, a measured kind or key the specification
 * does not declare, and where it records none: at a cut, for a null the specification declares, or where the
 * census and specification agree.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";

import { generate, schemaOf } from "./harness.js";

describe("datadogBoundarySource — lag", () => {
  const integerField = { properties: { n: { type: "integer" } }, type: "object" };

  it("admits a measured scalar kind the specification does not declare beside the declared one, and records it", () => {
    const generated = unwrap(generate({ answers: ['{"n":7}', '{"n":"7"}'], schema: integerField }));
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ n: z.union([z.number(), z.string()]).optional() })",
    );
    expect(generated.lag).toEqual([{ lag: "string", path: "n" }]);
  });

  it("admits a measured null the specification does not declare as .nullable()", () => {
    const generated = unwrap(generate({ answers: ['{"n":null}'], schema: integerField }));
    expect(schemaOf({ source: generated.source })).toBe("z.strictObject({ n: z.number().nullable().optional() })");
    expect(generated.lag).toEqual([{ lag: "null", path: "n" }]);
  });

  it("admits an undeclared key as optional with its measured scalars, never required", () => {
    const generated = unwrap(
      generate({ answers: ['{"n":1,"extra":true}', '{"n":2,"extra":null}'], schema: integerField }),
    );
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ extra: z.boolean().nullable().optional(), n: z.number().optional() })",
    );
    expect(generated.lag).toEqual([{ lag: "key", path: "extra" }]);
  });

  it("cuts an undeclared key measured as structure the specification says nothing of, the cut listed in place of its lag", () => {
    const generated = unwrap(generate({ answers: ['{"extra":{"a":1}}'], schema: integerField }));
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ extra: z.unknown().optional(), n: z.unknown().optional() })",
    );
    expect(generated.cuts).toEqual([{ path: "extra", reason: "unspecified" }]);
    expect(generated.lag).toEqual([]);
  });

  it("cuts a declared scalar field measured as structure, the unspecified cut listed in place of its lag", () => {
    const generated = unwrap(generate({ answers: ['{"n":[1]}'], schema: integerField }));
    expect(generated.cuts).toEqual([{ path: "n", reason: "unspecified" }]);
    expect(generated.lag).toEqual([]);
  });

  it.each([
    ["a declared field", "n"],
    ["an undeclared key", "extra"],
  ])("cuts %s measured as structure and a non-finite number, rather than refusing what it leaves unread", (_, key) => {
    const generated = unwrap(generate({ answers: [`{"${key}":{}}`, `{"${key}":1e400}`], schema: integerField }));
    expect(generated.cuts).toEqual([{ path: key, reason: "unspecified" }]);
  });

  it("forgets lag measured where a later-found cut leaves the place unread", () => {
    const itemless = { properties: { x: { type: "array" } }, type: "object" };
    const generated = unwrap(generate({ answers: ['{"x":"s"}'], schema: itemless }));
    expect(generated.cuts).toEqual([{ path: "x", reason: "free" }]);
    expect(generated.lag).toEqual([]);
  });

  it("forgets lag and cuts recorded under a place a sibling arm then cuts", () => {
    const conflict = {
      properties: {
        x: {
          oneOf: [
            { items: { properties: { a: { type: "object" } }, type: "object" }, type: "array" },
            { $ref: "#/components/schemas/Tags" },
          ],
        },
      },
      type: "object",
    };
    const generated = unwrap(generate({ answers: ['{"x":[{"a":{"b":1},"extra":true}]}'], schema: conflict }));
    expect(generated.cuts).toEqual([{ path: "x", reason: "oneof-conflict" }]);
    expect(generated.lag).toEqual([]);
  });

  it("records no lag at a cut, whose kinds are never compared and which the cut inventory lists instead", () => {
    const cut = { properties: { x: { type: "object" } }, type: "object" };
    const generated = unwrap(generate({ answers: ['{"x":"s"}'], schema: cut }));
    expect(generated.cuts).toEqual([{ path: "x", reason: "free" }]);
    expect(generated.lag).toEqual([]);
  });

  it("declares a nullable composition of one map as a nullable record", () => {
    const schema = { nullable: true, oneOf: [{ additionalProperties: { type: "string" }, type: "object" }] };
    const generated = unwrap(generate({ answers: ['{"a":"x"}'], schema }));
    expect(schemaOf({ source: generated.source })).toBe("z.record(z.string(), z.string()).nullable()");
    expect(generated.cuts).toEqual([]);
  });

  it("declares a string arm beside a null type as a nullable string", () => {
    const generated = unwrap(generate({ answers: ['"s"'], schema: { oneOf: [{ type: "string" }, { type: "null" }] } }));
    expect(schemaOf({ source: generated.source })).toBe("z.string().nullable()");
    expect(generated.cuts).toEqual([]);
    expect(generated.lag).toEqual([]);
  });

  it("declares a closed object naming no properties as an empty strict object, never a free cut", () => {
    const closed = { additionalProperties: false, properties: {}, type: "object" };
    const schema = { properties: { x: closed }, required: ["x"], type: "object" };
    const generated = unwrap(generate({ answers: ['{"x":{}}'], schema }));
    expect(schemaOf({ source: generated.source })).toBe("z.strictObject({ x: z.strictObject({  }) })");
    expect(generated.cuts).toEqual([]);
  });

  it("cuts a map whose values are an empty schema at the map, never reading its values", () => {
    const schema = { properties: { x: { additionalProperties: {}, type: "object" } }, type: "object" };
    const generated = unwrap(generate({ answers: ['{"x":{"a":1}}'], schema }));
    expect(schemaOf({ source: generated.source })).toBe("z.strictObject({ x: z.unknown().optional() })");
    expect(generated.cuts).toEqual([{ path: "x", reason: "unbuildable-map" }]);
  });

  it("declares a required name the properties omit as a required free field, never as lag", () => {
    const schema = { properties: { a: { type: "string" } }, required: ["a", "b"], type: "object" };
    const generated = unwrap(generate({ answers: ['{"a":"x","b":"y"}'], schema }));
    expect(schemaOf({ source: generated.source })).toBe("z.strictObject({ a: z.string(), b: z.unknown() })");
    expect(generated.cuts).toEqual([{ path: "b", reason: "free" }]);
    expect(generated.lag).toEqual([]);
  });

  it("records no lag for a null an untyped enum declares", () => {
    const generated = unwrap(generate({ answers: ["null"], schema: { enum: [null] } }));
    expect(schemaOf({ source: generated.source })).toBe("z.null()");
    expect(generated.lag).toEqual([]);
  });

  it("records no lag for a null a type list declares beside an object", () => {
    const listed = { properties: { a: { type: "string" } }, type: ["object", "null"] };
    const generated = unwrap(generate({ answers: ["null"], schema: listed }));
    expect(schemaOf({ source: generated.source })).toBe("z.strictObject({ a: z.unknown().optional() }).nullable()");
    expect(generated.lag).toEqual([]);
  });

  it("records no lag where the census and specification agree", () => {
    expect(unwrap(generate({ answers: ['{"n":7}'], schema: integerField })).lag).toEqual([]);
  });
});
