import { describe, expect, it } from "vitest";

import { type AtlasFieldDenial, projectAtlasValue } from "../../../../atlas/kit/projection.js";

/** Denies `apiKey` as a credential and `cursor` as a pagination token; every other field is kept. */
const denyField: AtlasFieldDenial = ({ field }) => {
  if (field === "apiKey") {
    return "secret-material";
  }
  if (field === "cursor") {
    return "ephemeral-token";
  }
  return null;
};

describe("projectAtlasValue", () => {
  it("drops every denied field at any depth and reports each by escaped pointer and reason, sorted", () => {
    const projected = projectAtlasValue({
      denyField,
      value: { apiKey: "s3cret", name: "billing", nested: { "a/b": { apiKey: 1, kept: true }, cursor: "c" } },
    });

    expect(projected.value).toEqual({ name: "billing", nested: { "a/b": { kept: true } } });
    expect(projected.dropped).toEqual([
      { pointer: "/apiKey", reason: "secret-material" },
      { pointer: "/nested/a~1b/apiKey", reason: "secret-material" },
      { pointer: "/nested/cursor", reason: "ephemeral-token" },
    ]);
  });

  it("projects an absent document to JSON's own absence, null, with nothing dropped", () => {
    const projected = projectAtlasValue({ denyField, value: undefined });

    expect(projected.value).toBe(null);
    expect(projected.dropped).toEqual([]);
  });

  it("walks what a writer would serialise, so a toJSON cannot reintroduce a denied field", () => {
    const projected = projectAtlasValue({
      denyField,
      value: { toJSON: (): Record<string, string> => ({ apiKey: "s3cret", name: "billing" }) },
    });

    expect(projected.value).toEqual({ name: "billing" });
    expect(projected.dropped).toEqual([{ pointer: "/apiKey", reason: "secret-material" }]);
  });

  it("reports the depth bound as its own drop rather than truncating silently", () => {
    let deep: unknown = "bottom";
    for (let level = 0; level < 30; level += 1) {
      deep = { child: deep };
    }

    const projected = projectAtlasValue({ denyField, value: deep });

    expect(projected.dropped).toEqual([{ pointer: `${"/child".repeat(25)}`, reason: "depth-limit" }]);
  });

  it("freezes the drop report, since it is evidence about the value beside it", () => {
    const projected = projectAtlasValue({ denyField, value: { apiKey: "s3cret" } });

    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.dropped)).toBe(true);
    expect(Object.isFrozen(projected.dropped[0])).toBe(true);
  });
});
