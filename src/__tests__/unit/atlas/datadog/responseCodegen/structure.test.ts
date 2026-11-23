/*
 * What a generated Datadog response boundary declares for a schema's shape: which fields it requires, how an
 * unmeasured operation or array root is declared by name, how oneOf arms merge, and how a map's one value
 * schema is checked across its keys.
 */
import { describe, expect, it } from "vitest";

import type { DatadogOperationCensus } from "../../../../../atlas/datadog/responseCensus.js";
import { datadogBoundarySource } from "../../../../../atlas/datadog/responseCodegen.js";
import { unwrap } from "../../../../../lib/result.js";

import { censusOf, DOCUMENT, generate, schemaOf } from "./harness.js";

const OBJECT = {
  properties: { id: { type: "integer" }, name: { type: "string" }, note: { nullable: true, type: "string" } },
  required: ["id", "name"],
  type: "object",
};

describe("datadogBoundarySource — structure and requiredness", () => {
  it("requires a field only where the specification requires it AND every measured object carried it", () => {
    const generated = unwrap(generate({ answers: ['{"id":1,"name":"a"}', '{"id":2,"note":null}'], schema: OBJECT }));
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ id: z.number(), name: z.string().optional(), note: z.string().nullable().optional() })",
    );
    expect(generated.measured).toBe(true);
    expect(generated.source).toContain('source: "measured"');
  });

  it("requires nothing under a parent a census file counts zero objects at", () => {
    const census: DatadogOperationCensus = {
      ...censusOf({ answers: ['{"id":1,"name":"a"}'] }),
      objects: { "": 0 },
      paths: {
        id: { emptyArrays: 0, kinds: { number: 0 }, present: 0 },
        name: { emptyArrays: 0, kinds: { string: 0 }, present: 0 },
      },
    };
    const generated = unwrap(
      datadogBoundarySource({ census, document: DOCUMENT, schema: { node: OBJECT, stack: [] }, surface: "op" }),
    );
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ id: z.number().optional(), name: z.string().optional(), note: z.unknown().optional() })",
    );
  });

  it("declares a field no answer carried by name only", () => {
    const generated = unwrap(generate({ answers: ['{"id":1,"name":"a"}'], schema: OBJECT }));
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ id: z.number(), name: z.string(), note: z.unknown().optional() })",
    );
  });

  it("declares an operation that never answered by the specification's names only", () => {
    const generated = unwrap(generate({ answers: null, schema: OBJECT }));
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ id: z.unknown().optional(), name: z.unknown().optional(), note: z.unknown().optional() })",
    );
    expect(generated.measured).toBe(false);
    expect(generated.source).toContain('source: "spec-names-only"');
  });

  it("declares an unmeasured array root's items by name, never as z.unknown()", () => {
    const schema = { items: OBJECT, type: "array" };
    expect(schemaOf({ source: unwrap(generate({ answers: ["[]"], schema })).source })).toBe(
      "z.array(z.strictObject({ id: z.unknown().optional(), name: z.unknown().optional(), note: z.unknown().optional() }))",
    );
  });

  it("merges oneOf arms into one object, one array and their primitives", () => {
    const schema = {
      properties: {
        v: { oneOf: [{ type: "string" }, { items: { type: "integer" }, type: "array" }, OBJECT] },
      },
      type: "object",
    };
    const answers = ['{"v":"x"}', '{"v":[1]}', '{"v":{"id":1,"name":"a"}}'];
    expect(schemaOf({ source: unwrap(generate({ answers, schema })).source })).toBe(
      "z.strictObject({ v: z.union([z.array(z.number()), z.strictObject({ id: z.number(), name: z.string(), note: z.unknown().optional() }), z.string()]).optional() })",
    );
  });
});

describe("datadogBoundarySource — maps", () => {
  it("checks a map's one value schema against every key's value, requiredness summed across them", () => {
    const schema = { properties: { tags: { $ref: "#/components/schemas/Tags" } }, type: "object" };
    const generated = unwrap(generate({ answers: ['{"tags":{"env":{"n":1},"svc":{"n":2}}}'], schema }));
    expect(schemaOf({ source: generated.source })).toBe(
      "z.strictObject({ tags: z.record(z.string(), z.strictObject({ n: z.number().optional() })).optional() })",
    );
  });

  it("checks a map's values under an <unsafe> key rather than refusing the key", () => {
    const schema = { properties: { tags: { $ref: "#/components/schemas/Tags" } }, type: "object" };
    const generated = unwrap(generate({ answers: ['{"tags":{"a.b":{"n":1}}}'], schema }));
    expect(generated.cuts).toEqual([]);
  });
});
