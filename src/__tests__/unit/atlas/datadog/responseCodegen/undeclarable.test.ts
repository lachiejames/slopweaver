/*
 * What no generated Datadog response boundary can declare, and the refusal generation answers with: a
 * non-finite number, an unsafe or data-shaped key, a self-containing or over-deep schema, an unresolved
 * reference, plus the place-depth count that bounds the descent and the cuts that land before a refusal could.
 */
import { describe, expect, it } from "vitest";

import type { DatadogOperationCensus } from "../../../../../atlas/datadog/responseCensus.js";
import { datadogBoundarySource } from "../../../../../atlas/datadog/responseCodegen.js";
import { datadogPlaceDepth } from "../../../../../atlas/datadog/responseCodegenPlace.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

import { censusOf, DOCUMENT, generate, schemaOf } from "./harness.js";

describe("datadogBoundarySource — what no boundary can declare", () => {
  const numberField = { properties: { n: { type: "number" } }, type: "object" };

  it.each([
    ['{"n":1e400}', "op at n: a number too large for JSON to read back, which no number schema admits"],
    [
      '{"a.b":1}',
      "op at <unsafe>: a key no path or schema can carry: path notation, empty, or an Object.prototype name",
    ],
    ['{"0123":1}', "op at <int>: a data-shaped key (<int>) where the specification declares fields"],
    [
      '{"constructor":1}',
      "op at <unsafe>: a key no path or schema can carry: path notation, empty, or an Object.prototype name",
    ],
    ["", "op (root): a 2xx answer measured as empty-text, which a JSON boundary refuses"],
  ])("refuses %s", (answer, message) => {
    const error = unwrapErr(generate({ answers: [answer], schema: numberField }));
    expect(error.code).toBe("UNDECLARABLE");
    expect(error.message).toBe(message);
  });

  it("refuses a non-finite number under an undeclared key, which lag admission never reaches past", () => {
    const error = unwrapErr(generate({ answers: ['{"m":1e400}'], schema: numberField }));
    expect(error.code).toBe("UNDECLARABLE");
    expect(error.message).toBe("op at m: a number too large for JSON to read back, which no number schema admits");
  });

  it("refuses a schema that contains itself by identity, which no walk of it ends", () => {
    const schema: Record<string, unknown> = { type: "array" };
    schema["items"] = schema;
    const error = unwrapErr(generate({ answers: ["[]"], schema }));
    expect(error.code).toBe("SPEC_UNREADABLE");
    expect(error.message).toBe(
      "op (root): a schema that contains itself other than by a $ref, which no walk of it ends",
    );
  });

  it("merges two map arms into one map, as object arms merge, never a conflict between them", () => {
    const x = {
      oneOf: [
        { additionalProperties: { type: "number" }, type: "object" },
        { additionalProperties: { type: "string" }, type: "object" },
      ],
    };
    const generated = unwrap(generate({ answers: ['{"x":{"a":1}}'], schema: { properties: { x }, type: "object" } }));
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ x: z.record(z.string(), z.union([z.number(), z.string()])).optional() })",
    );
    expect(generated.cuts).toEqual([]);
  });

  it("cuts a specification's own oneof-conflict before measured structural lag could call it unspecified", () => {
    const items = { additionalProperties: { type: "number" }, type: "object" };
    const x = { oneOf: [{ type: "string" }, { items, type: "array" }] };
    const generated = unwrap(generate({ answers: ['{"x":{"a":1}}'], schema: { properties: { x }, type: "object" } }));
    expect(generated.cuts).toEqual([{ path: "x", reason: "oneof-conflict" }]);
    expect(generated.lag).toEqual([]);
  });

  it("reads an unmeasured array arm's item specification beside another arm, refusing one it cannot read", () => {
    const items = { oneOf: [{ additionalProperties: { type: "number" } }, { $ref: "#/components/schemas/Missing" }] };
    const x = { oneOf: [{ type: "string" }, { items, type: "array" }] };
    const error = unwrapErr(generate({ answers: ['{"x":"s"}'], schema: { properties: { x }, type: "object" } }));
    expect(error.code).toBe("SPEC_UNREADABLE");
    expect(error.message).toBe(
      "op at x[]: the reference #/components/schemas/Missing resolves to nothing in the pinned specification",
    );
  });

  it("refuses a document made to contain itself after an earlier generation read it whole", () => {
    const document: Record<string, unknown> = {};
    const schema = { node: { type: "string" }, stack: [] };
    expect(unwrap(datadogBoundarySource({ census: null, document, schema, surface: "op" })).source).toBe(
      'defineDatadogResponseBoundary({ schema: z.string(), source: "spec-names-only", surface: "op" })',
    );
    document["self"] = document;
    const error = unwrapErr(datadogBoundarySource({ census: null, document, schema, surface: "op" }));
    expect(error.code).toBe("SPEC_UNREADABLE");
  });

  it("refuses a finite schema nested deeper than generation descends, rather than overflowing", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 10_000; level += 1) {
      schema = { items: schema, type: "array" };
    }
    const error = unwrapErr(generate({ answers: ["[]"], schema }));
    expect(error.code).toBe("SPEC_UNREADABLE");
    expect(error.message).toBe(
      `op at ${"[]".repeat(65)}: a schema nested past 64 levels, deeper than this generator descends`,
    );
  });

  it("refuses arrays nested deeper than generation descends beside a scalar arm, rather than overflowing", () => {
    let items: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 10_000; level += 1) {
      items = { items, type: "array" };
    }
    const schema = { properties: { x: { oneOf: [{ type: "string" }, items] } }, type: "object" };
    const error = unwrapErr(generate({ answers: ['{"x":"s"}'], schema }));
    expect(error.code).toBe("SPEC_UNREADABLE");
    expect(error.message).toBe(
      `op at x${"[]".repeat(64)}: a schema nested past 64 levels, deeper than this generator descends`,
    );
  });

  it.each([
    ["", 0],
    ["a", 1],
    ["a[]", 2],
    ["[].b.<value>", 3],
    ["[][]", 2],
  ])("counts %s as %i levels deep", (path, depth) => {
    expect(datadogPlaceDepth({ path })).toBe(depth);
  });

  it("refuses a reference the pinned specification does not resolve", () => {
    const missing = { properties: { x: { $ref: "#/components/schemas/Absent" } }, type: "object" };
    const error = unwrapErr(generate({ answers: ['{"x":1}'], schema: missing }));
    expect(error.code).toBe("SPEC_UNREADABLE");
    expect(error.message).toBe(
      "op at x: the reference #/components/schemas/Absent resolves to nothing in the pinned specification",
    );
  });

  it("ends on arms YAML aliases double at every level of an unmeasured root, refusing them", () => {
    let node: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 64; level += 1) {
      node = { oneOf: [node, node] };
    }
    const error = unwrapErr(generate({ answers: null, schema: node }));
    expect(error.code).toBe("SPEC_UNREADABLE");
    expect(error.message).toBe("op (root): compositions expanding past 1024 arms, more than this generator merges");
  });

  it("refuses a measured array whose items schema is false, never cutting it free as if it declared none", () => {
    const closed = { properties: { x: { items: false, type: "array" } }, required: ["x"], type: "object" };
    const error = unwrapErr(generate({ answers: ['{"x":[1]}'], schema: closed }));
    expect(error.code).toBe("SPEC_UNREADABLE");
    expect(error.message).toBe("op at x: an items that is not a schema object, which this generator does not read");
  });

  it("refuses an undeclared raw prototype-named key a hand-built census carries, as a declared one is", () => {
    const census: DatadogOperationCensus = {
      ...censusOf({ answers: ["{}"] }),
      paths: { constructor: { emptyArrays: 0, kinds: { number: 1 }, present: 1 } },
    };
    const error = unwrapErr(
      datadogBoundarySource({ census, document: DOCUMENT, schema: { node: numberField, stack: [] }, surface: "op" }),
    );
    expect(error.message).toBe(
      "op at constructor: a key no path or schema can carry: path notation, empty, or an Object.prototype name",
    );
  });

  it("declares an unmeasured field by name without reading its specification, so a broken reference there is moot", () => {
    const schema = {
      properties: { absent: { $ref: "#/components/schemas/Absent" }, good: { type: "string" } },
      type: "object",
    };
    const generated = unwrap(generate({ answers: ['{"good":"x"}'], schema }));
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ absent: z.unknown().optional(), good: z.string().optional() })",
    );
    expect(generated.cuts).toEqual([]);
  });

  it("ignores a non-finite number inside a cut, where nothing is read", () => {
    const cut = { properties: { x: { type: "object" } }, type: "object" };
    expect(unwrap(generate({ answers: ['{"x":{"n":1e400}}'], schema: cut })).cuts).toEqual([
      { path: "x", reason: "free" },
    ]);
  });

  it.each([
    ["a map", { additionalProperties: { type: "number" }, type: "object" }, '{"x":{"a":1e400}}'],
    [
      "an array of maps",
      { items: { additionalProperties: { type: "number" }, type: "object" }, type: "array" },
      '{"x":[{"a":1e400}]}',
    ],
  ])("cuts %s beside a scalar before reading the values a non-finite number sits in", (_, arm, answer) => {
    const conflict = { properties: { x: { oneOf: [{ type: "string" }, arm] } }, type: "object" };
    expect(unwrap(generate({ answers: [answer], schema: conflict })).cuts).toEqual([
      { path: "x", reason: "oneof-conflict" },
    ]);
  });
});
