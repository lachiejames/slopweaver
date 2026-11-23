/*
 * Where a generated Datadog response boundary cuts a field it must leave unread, and which reason it records:
 * a free, mixed or unbuildable map, a recursive component, an itemless array, a oneOf conflict, and the
 * places a cut cannot sit, which generation refuses instead.
 */
import { describe, expect, it } from "vitest";

import { DatadogCodegenErrors } from "../../../../../atlas/datadog/responseCodegenErrors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

import { generate, schemaOf } from "./harness.js";

describe("datadogBoundarySource — cuts", () => {
  it.each([
    ["Free", "free"],
    ["Mixed", "mixed"],
    ["Untyped", "unbuildable-map"],
  ])("cuts a field whose schema is %s, recording %s", (component, reason) => {
    const schema = { properties: { x: { $ref: `#/components/schemas/${component}` } }, type: "object" };
    const generated = unwrap(generate({ answers: ['{"x":{"a":"b","c":"d"}}'], schema }));
    expect(schemaOf({ source: generated.source })).toBe("z.strictObject({ x: z.unknown().optional() })");
    expect(generated.cuts).toEqual([{ path: "x", reason }]);
  });

  it("cuts a component at its first re-entry, so depth never follows what one answer nested", () => {
    const schema = { $ref: "#/components/schemas/Node" };
    const generated = unwrap(generate({ answers: ['{"name":"a","child":{"name":"b","child":{"name":"c"}}}'], schema }));
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ child: z.unknown().optional(), name: z.string().optional() })",
    );
    expect(generated.cuts).toEqual([{ path: "child", reason: "recursive" }]);
  });

  it("moves an item's cut out to the array's field", () => {
    const schema = { properties: { list: { items: { type: "object" }, type: "array" } }, type: "object" };
    const generated = unwrap(generate({ answers: ['{"list":[{"a":1}]}'], schema }));
    expect(schemaOf({ source: generated.source })).toBe("z.strictObject({ list: z.unknown().optional() })");
    expect(generated.cuts).toEqual([{ path: "list", reason: "free" }]);
  });

  it("cuts an array whose specification declares no items", () => {
    const schema = { properties: { list: { type: "array" } }, type: "object" };
    expect(unwrap(generate({ answers: ['{"list":[1]}'], schema })).cuts).toEqual([{ path: "list", reason: "free" }]);
  });

  it("cuts a map beside another arm, since a record arm reads every other arm's drift as its own", () => {
    const schema = {
      properties: { x: { oneOf: [{ type: "string" }, { $ref: "#/components/schemas/Tags" }] } },
      type: "object",
    };
    expect(unwrap(generate({ answers: ['{"x":"s"}'], schema })).cuts).toEqual([
      { path: "x", reason: "oneof-conflict" },
    ]);
  });

  it("cuts a lagged scalar where a map is declared, listing the cut in place of its lag", () => {
    const schema = {
      properties: { x: { additionalProperties: { type: "string" }, type: "object" } },
      required: ["x"],
      type: "object",
    };
    const generated = unwrap(generate({ answers: ['{"x":{"a":"v"}}', '{"x":"oops"}'], schema }));
    expect(generated.cuts).toEqual([{ path: "x", reason: "oneof-conflict" }]);
    expect(generated.lag).toEqual([]);
  });

  it("declares an object naming its fields only in required, cutting each unconstrained value on its own name", () => {
    const generated = unwrap(generate({ answers: ['{"a":"s"}'], schema: { required: ["a"], type: "object" } }));
    expect(generated.cuts).toEqual([{ path: "a", reason: "free" }]);
    expect(generated.lag).toEqual([]);
  });

  it("refuses a prototype-named field of an unmeasured object, since no boundary can declare even its name", () => {
    const schema = { properties: { constructor: { type: "string" } }, type: "object" };
    const error = unwrapErr(generate({ answers: null, schema }));
    expect(error.code).toBe("UNDECLARABLE");
    expect(error.message).toBe(
      "op (root): the field constructor is named like an Object.prototype member, which defineBoundary refuses",
    );
  });

  it("refuses a oneOf that is not a list, as the header names", () => {
    const error = unwrapErr(generate({ answers: ['"s"'], schema: { oneOf: "bad" } }));
    expect(error.code).toBe("SPEC_UNREADABLE");
    expect(error.message).toBe("op (root): a oneOf or anyOf that is not a list");
  });

  it("refuses a cut reaching the root, where no field can hold it", () => {
    const error = unwrapErr(generate({ answers: ['{"a":1}'], schema: { type: "object" } }));
    expect(error).toEqual(DatadogCodegenErrors.uncuttable({ path: "", reason: "free", surface: "op" }));
    expect(error.message).toBe("op (root): a free node must be left unread, and no named field holds it");
  });

  it.each([
    ["<unsafe>", '{"a.b":1}'],
    ["0123456789abcdef01234567", '{"fedcba9876543210fedcba98":1}'],
  ])("refuses a measured object's field %s, which the census only ever counts under a placeholder", (key, answer) => {
    const schema = { properties: { [key]: { type: "number" } }, required: [key], type: "object" };
    const error = unwrapErr(generate({ answers: [answer], schema }));
    expect(error.code).toBe("UNDECLARABLE");
    expect(error.message).toBe(
      `op at ${key}: the field ${key} is a key the census records only under a placeholder, so nothing measured it`,
    );
  });

  it("declares a placeholder-shaped field of an unmeasured object by name, since nothing was counted there", () => {
    const schema = {
      properties: { x: { properties: { "<unsafe>": { type: "number" } }, type: "object" } },
      type: "object",
    };
    const generated = unwrap(generate({ answers: ['{"y":1}'], schema }));
    expect(generated.cuts).toEqual([]);
  });

  it.each([
    ["an itemless array", { type: "array" }, ['{"x":1e400}'], "free"],
    ["an itemless array measured as an object", { type: "array" }, ['{"x":{"a":1}}', '{"x":1e400}'], "free"],
    [
      "a free map measured as an array",
      { additionalProperties: true, type: "object" },
      ['{"x":[1]}'],
      "unbuildable-map",
    ],
    [
      "a map its measured string lag sets beside a scalar",
      { additionalProperties: { type: "number" }, type: "object" },
      ['{"x":{"a":1}}', '{"x":"s"}', '{"x":1e400}'],
      "oneof-conflict",
    ],
    [
      "an array arm whose free items cut it outward",
      { oneOf: [{ items: {}, type: "array" }, { type: "string" }] },
      ['{"x":1e400}'],
      "free",
    ],
    [
      "an array whose mixed items cut it outward",
      { items: { $ref: "#/components/schemas/Mixed" }, type: "array" },
      ['{"x":[{"a":"s"}]}', '{"x":1e400}'],
      "mixed",
    ],
  ])("cuts %s before a non-finite number measured at it can refuse", (_, x, answers, reason) => {
    const generated = unwrap(generate({ answers, schema: { properties: { x }, type: "object" } }));
    expect(generated.cuts).toEqual([{ path: "x", reason }]);
    expect(generated.lag).toEqual([]);
  });

  it("refuses a cut root as uncuttable before reading an empty answer measured there", () => {
    const error = unwrapErr(generate({ answers: [""], schema: { type: "object" } }));
    expect(error.code).toBe("UNCUTTABLE");
    expect(error.message).toBe("op (root): a free node must be left unread, and no named field holds it");
  });
});
