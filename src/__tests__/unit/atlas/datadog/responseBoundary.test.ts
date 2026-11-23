/**
 * How one admitted Datadog operation's answer is read — `src/atlas/datadog/responseBoundary.ts`.
 *
 * A body is admitted whole or not at all: a field Datadog added, dropped, renamed or retyped refuses by name, and a
 * body that is not JSON keeps the atlas's existing wording without carrying a byte of it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DatadogAtlasErrors } from "../../../../atlas/datadog/errors.js";
import { defineDatadogResponseBoundary } from "../../../../atlas/datadog/responseBoundary.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const SURFACE = "ListTeams";
const PATH = "/api/v2/team?page[size]=100";
const TEAM = z.strictObject({ attributes: z.strictObject({ handle: z.string() }), id: z.string(), type: z.string() });
const boundary = defineDatadogResponseBoundary({
  schema: z.strictObject({ data: z.array(TEAM), meta: z.strictObject({ count: z.number() }).optional() }),
  source: "measured",
  surface: SURFACE,
});

/** One v2 team record as text, with whatever its attributes carry. */
function teamsText({ attributes }: { attributes: Record<string, unknown> }): string {
  return JSON.stringify({ data: [{ attributes, id: "t1", type: "team" }] });
}

describe("defineDatadogResponseBoundary", () => {
  it("admits a measured answer whole, and carries its name and provenance", () => {
    const admitted = unwrap(
      boundary.admit({ path: PATH, status: 200, text: teamsText({ attributes: { handle: "a" } }) }),
    );

    expect(admitted).toEqual({ data: [{ attributes: { handle: "a" }, id: "t1", type: "team" }] });
    expect(boundary.surface).toBe(SURFACE);
    expect(boundary.source).toBe("measured");
  });

  it("refuses a field Datadog added, naming it and holding nothing", () => {
    const text = teamsText({ attributes: { handle: "a", owner: "x" } });
    const refused = unwrapErr(boundary.admit({ path: PATH, status: 200, text }));

    expect(refused).toEqual(
      DatadogAtlasErrors.bodyShapeChanged({
        drift: [{ detail: 'new field "data[0].attributes.owner"', kind: "new", path: "data[0].attributes.owner" }],
        surface: SURFACE,
      }),
    );
  });

  it("refuses a renamed field as a rename, not as an absence", () => {
    const refused = unwrapErr(
      boundary.admit({ path: PATH, status: 200, text: teamsText({ attributes: { handles: "a" } }) }),
    );

    expect(refused.message).toBe(
      `${SURFACE} answered a shape this version does not read, so nothing it answered is held: field "data[].attributes.handle" renamed to "data[].attributes.handles"?`,
    );
  });

  it("refuses a dropped field and a retyped field by name", () => {
    const dropped = unwrapErr(
      boundary.admit({ path: PATH, status: 200, text: '{"data":[{"attributes":{},"id":"t1","type":"team"}]}' }),
    );
    const retyped = unwrapErr(
      boundary.admit({ path: PATH, status: 200, text: teamsText({ attributes: { handle: 7 } }) }),
    );

    expect(dropped.message).toBe(
      `${SURFACE} answered a shape this version does not read, so nothing it answered is held: field "data[].attributes.handle" is missing`,
    );
    expect(retyped.code).toBe("BODY_SHAPE_CHANGED");
    expect(retyped.message).toContain('field "data[].attributes.handle" changed');
  });

  it("keeps the existing not-JSON wording, naming the path and status and never the body", () => {
    const refused = unwrapErr(boundary.admit({ path: PATH, status: 200, text: "<html>sk-secret-sentinel</html>" }));

    expect(refused).toEqual(
      DatadogAtlasErrors.unexpectedShape({
        detail: `${PATH} answered HTTP 200 with a body that is not JSON`,
        surface: SURFACE,
      }),
    );
    expect(refused.message).not.toContain("sk-secret-sentinel");
  });

  it("refuses an empty body as not JSON rather than reading it as an empty answer", () => {
    expect(unwrapErr(boundary.admit({ path: PATH, status: 204, text: "" })).code).toBe("UNEXPECTED_SHAPE");
  });

  it("throws at declaration for a schema that is not strict all the way down", () => {
    expect(() =>
      defineDatadogResponseBoundary({
        schema: z.object({ data: z.array(z.string()) }),
        source: "measured",
        surface: "Loose",
      }),
    ).toThrow("defineBoundary(Loose): every object must be z.strictObject");
  });
});
