/**
 * `classifyDrift` through a boundary: a key Zod would read through the prototype is refused at definition or
 * named as a new field, a schema Zod built as another type is refused, and a dotted key stays apart from the
 * nesting it resembles.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineBoundary } from "../../../../lib/boundary.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("classifyDrift through a boundary", () => {
  it("refuses at definition a key named like a prototype member, which Zod reads through the prototype", () => {
    expect(() =>
      defineBoundary({ endpoint: "GET /proto", schema: z.strictObject({ id: z.string(), toString: z.string() }) }),
    ).toThrow(
      'defineBoundary(GET /proto): every object must be z.strictObject — (body) declares "toString", named like an Object.prototype member, which Zod reads through the prototype when it is absent — read it under z.record(z.string(), …)',
    );
  });

  it("refuses a __proto__ key a record skips, once, and names it beside the object's own drift", () => {
    const boundary = defineBoundary({
      endpoint: "GET /names",
      schema: z.strictObject({ byName: z.record(z.string(), z.number()) }),
    });
    const refused = "GET /names answered a shape this version does not read — refused, not guessed: ";

    expect(unwrapErr(boundary.parseJson({ text: '{"byName":{"ok":1,"__proto__":"x"}}' })).message).toBe(
      `${refused}new field "byName.__proto__"`,
    );
    expect(unwrapErr(boundary.parseJson({ text: '{"__proto__":1,"byName":{"__proto__":2}}' })).message).toBe(
      `${refused}new field "__proto__"; new field "byName.__proto__"`,
    );
    expect(unwrap(boundary.parseJson({ text: '{"byName":{"ok":1}}' }))).toEqual({ byName: { ok: 1 } });
  });

  it("refuses at definition a relabelled object, and a plain union given a discriminator, by what Zod built", () => {
    const loose = z.object({ id: z.string() });
    Object.assign(loose._zod.def, { type: "string" });
    const plain = z.union([z.strictObject({ a: z.string() }), z.strictObject({ b: z.string() })]);
    Object.assign(plain._zod.def, { discriminator: "a" });

    expect(() => defineBoundary({ endpoint: "GET /relabelled", schema: z.strictObject({ grant: loose }) })).toThrow(
      "defineBoundary: a schema labelled z.string that Zod built as another type — a type param overwrote its def, so the walk would read the wrong schema",
    );
    expect(() => defineBoundary({ endpoint: "GET /plain", schema: plain })).toThrow(
      "(body) is a z.union with 2 arms that read objects",
    );
  });

  it("keeps a dotted key and the nesting it resembles as two drift lines", () => {
    const boundary = defineBoundary({
      endpoint: "GET /dotted",
      schema: z.strictObject({ a: z.strictObject({ b: z.string() }), "a.b": z.string() }),
    });

    expect(unwrapErr(boundary.parse({ value: { a: {}, "a.c": "x" } })).message).toBe(
      'GET /dotted answered a shape this version does not read — refused, not guessed: field "a.b" renamed to "a.c"?; field "a.b" is missing',
    );
  });
});
