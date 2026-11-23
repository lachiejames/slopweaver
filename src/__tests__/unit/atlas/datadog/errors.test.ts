import { describe, expect, it } from "vitest";

import { DatadogAtlasErrors } from "../../../../atlas/datadog/errors.js";

describe("DatadogAtlasErrors", () => {
  it("distinguishes a refused surface from an inventoried-and-refused one", () => {
    const unknown = DatadogAtlasErrors.surfaceRefused({ surface: "v9-nope" });
    const refused = DatadogAtlasErrors.surfaceRefused({
      excludedBecause: "renders a widget and uploads the image",
      surface: "v1-snapshots-get-graph-snapshot",
    });

    expect(unknown.message).toContain("the registry is closed");
    expect(refused.message).toContain("inventoried and deliberately never called");
    expect(refused.excludedBecause).toBe("renders a widget and uploads the image");
  });

  // A permission boundary and a broken credential look identical from a single failed call, and the
  // difference is what a coverage cell has to say.
  it("separates an invalid credential from a permission boundary", () => {
    expect(DatadogAtlasErrors.unauthorised({ surface: "s" }).code).toBe("UNAUTHORISED");
    expect(DatadogAtlasErrors.forbidden({ surface: "s" }).message).toContain("permission boundary");
  });

  it("says when a rate-limited budget refills, and says so honestly when Datadog did not", () => {
    expect(DatadogAtlasErrors.rateLimited({ resetSeconds: 30, surface: "s" }).message).toContain("refills in 30s");
    expect(DatadogAtlasErrors.rateLimited({ resetSeconds: null, surface: "s" }).message).toContain(
      "sent no reset header",
    );
  });

  it("carries the cause forward on a transport failure rather than flattening it to a string", () => {
    const cause = new Error("socket hang up");
    const error = DatadogAtlasErrors.transportFailed({ cause, surface: "s" });

    expect(error.cause).toBe(cause);
    expect(error.message).toContain("socket hang up");
  });

  it("names the detail on an unexpected shape, so a provider change is diagnosable from the failure", () => {
    const error = DatadogAtlasErrors.unexpectedShape({ detail: "data was an array", surface: "s" });

    expect(error.detail).toBe("data was an array");
    expect(error.message).toContain("data was an array");
  });

  it("names a field every record on a page grew once, and counts the distinct fields beyond three", () => {
    const fields = ["owner", "team", "tier", "region"];
    const drift = [0, 1].flatMap((index) =>
      fields.map((field) => ({
        detail: `new field "data[${String(index)}].${field}"`,
        kind: "new" as const,
        path: `data[${String(index)}].${field}`,
      })),
    );
    const error = DatadogAtlasErrors.bodyShapeChanged({ drift, surface: "ListTeams" });

    expect(error.code).toBe("BODY_SHAPE_CHANGED");
    expect(error.drift).toHaveLength(8);
    expect(error.message).toBe(
      'ListTeams answered a shape this version does not read, so nothing it answered is held: new field "data[].owner"; new field "data[].team"; new field "data[].tier" (+1 more)',
    );
  });
});
