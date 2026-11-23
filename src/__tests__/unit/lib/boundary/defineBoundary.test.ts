/**
 * `defineBoundary`: a provider's answer is read through a strict schema, and every way the wire can drift from
 * it — a field added, dropped, renamed or retyped — is refused by name rather than read as absence. A loose
 * schema is refused at definition, and nothing but `defineBoundary` can make a `Boundary`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Boundary, BoundaryErrors, defineBoundary } from "../../../../lib/boundary.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const GRANTS = defineBoundary({
  endpoint: "GET /grants",
  schema: z.strictObject({
    grants: z.array(z.strictObject({ id: z.string(), resets_left: z.number() })),
    label: z.string().optional(),
  }),
});

describe("defineBoundary", () => {
  it("reads an answer that matches its declared shape", () => {
    expect(unwrap(GRANTS.parseJson({ text: '{"grants":[{"id":"g1","resets_left":2}]}' }))).toEqual({
      grants: [{ id: "g1", resets_left: 2 }],
    });
  });

  it("refuses a new field by name instead of dropping it", () => {
    const error = unwrapErr(GRANTS.parse({ value: { grants: [], tier: "max" } }));

    expect(error).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [{ detail: 'new field "tier"', kind: "new", path: "tier" }],
        endpoint: "GET /grants",
      }),
    );
    expect(error.message).toBe(
      'GET /grants answered a shape this version does not read — refused, not guessed: new field "tier"',
    );
  });

  it("names a rename as one drift, pairing the missing field with its close new sibling", () => {
    const error = unwrapErr(GRANTS.parse({ value: { grants: [{ id: "g1", resets_left_n: 2 }] } }));

    expect(error).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [
          {
            detail: 'field "grants[0].resets_left" renamed to "grants[0].resets_left_n"?',
            kind: "renamed",
            path: "grants[0].resets_left_n",
          },
        ],
        endpoint: "GET /grants",
      }),
    );
  });

  it("names a missing field, and a field whose type changed, separately", () => {
    const missing = unwrapErr(GRANTS.parse({ value: { grants: [{ id: "g1" }] } }));
    const retyped = unwrapErr(GRANTS.parse({ value: { grants: [{ id: "g1", resets_left: "2" }] } }));

    expect(missing).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [{ detail: 'field "grants[0].resets_left" is missing', kind: "missing", path: "grants[0].resets_left" }],
        endpoint: "GET /grants",
      }),
    );
    expect(retyped.message).toContain('field "grants[0].resets_left" changed: ');
  });

  it("keeps an unrelated new field and a missing field apart rather than inventing a rename", () => {
    const error = unwrapErr(GRANTS.parse({ value: { grants: [{ id: "g1", zone: "eu" }] } }));

    expect(error.message).toBe(
      'GET /grants answered a shape this version does not read — refused, not guessed: new field "grants[0].zone"; field "grants[0].resets_left" is missing',
    );
  });

  it("refuses text that is not JSON as its own error", () => {
    expect(unwrapErr(GRANTS.parseJson({ text: "<html>" }))).toEqual(
      BoundaryErrors.notJson({ endpoint: "GET /grants" }),
    );
  });

  it("throws at definition when any object under the schema is not strict", () => {
    expect(() =>
      defineBoundary({
        endpoint: "GET /loose",
        schema: z.strictObject({ inner: z.array(z.object({ id: z.string() })).optional() }),
      }),
    ).toThrow("defineBoundary(GET /loose): every object must be z.strictObject — inner[] is z.object");
  });

  it("is the only maker of a Boundary, so a permissive parser with the same methods cannot pose as one", () => {
    const permissive = {
      endpoint: "GET /loose",
      parse: ({ value }: { value: unknown }) => ok(value),
      parseJson: ({ text }: { text: string }) => ok(text),
    };
    // @ts-expect-error: a hand-written object has no #schema, which is what makes the class nominal
    const posing: Boundary<unknown> = permissive;
    expect(posing.endpoint).toBe("GET /loose");
    expect(posing instanceof Boundary).toBe(false);
  });

  it("cannot be forged by spreading a real one with its parser swapped out", () => {
    const real = defineBoundary({ endpoint: "GET /strict", schema: z.strictObject({ id: z.string() }) });
    // The spread the lint rule refuses is the forgery under test: losing the class is exactly what must happen.
    // oxlint-disable-next-line no-misused-spread
    const spread = { ...real, parseJson: () => ok({ id: "forged" }) };
    // @ts-expect-error: a spread copies no #private field, so it is not a Boundary
    const forged: Boundary<{ id: string }> = spread;
    expect(forged instanceof Boundary).toBe(false);
    expect(real instanceof Boundary).toBe(true);
    expect(unwrapErr(real.parseJson({ text: "{}" })).code).toBe("BOUNDARY_SHAPE_CHANGED");
  });
});
