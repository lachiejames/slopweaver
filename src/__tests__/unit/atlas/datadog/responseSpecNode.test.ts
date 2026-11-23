/**
 * `responseSpecNode.ts` — the two reads every part of the Datadog response generator stands on: whether a parsed
 * value contains itself, and what a `$ref` resolves to.
 */
import { describe, expect, it } from "vitest";

import { DatadogSpecErrors } from "../../../../atlas/datadog/responseSpecErrors.js";
import {
  datadogSpecCyclic,
  datadogSpecDereferenced,
  datadogSpecMember,
} from "../../../../atlas/datadog/responseSpecNode.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const DOCUMENT = {
  components: {
    schemas: {
      Alias: { $ref: "#/components/schemas/Item" },
      Item: { properties: { id: { type: "string" } }, type: "object" },
      Loop: { $ref: "#/components/schemas/Loop" },
    },
  },
} as const;

describe("datadogSpecCyclic", () => {
  it("answers true for a value that is its own descendant and false for one only shared twice", () => {
    const shared = { type: "string" };
    const cyclic: Record<string, unknown> = { a: shared };
    cyclic["self"] = cyclic;
    expect(datadogSpecCyclic({ value: cyclic })).toBe(true);
    expect(datadogSpecCyclic({ value: { a: shared, b: shared } })).toBe(false);
    expect(datadogSpecCyclic({ value: "a scalar" })).toBe(false);
  });
});

describe("datadogSpecMember", () => {
  it("reads an own member and never an inherited one", () => {
    expect(datadogSpecMember({ key: "a", value: { a: 1 } })).toBe(1);
    expect(datadogSpecMember({ key: "constructor", value: { a: 1 } })).toBe(undefined);
    expect(datadogSpecMember({ key: "a", value: "not an object" })).toBe(undefined);
  });
});

describe("datadogSpecDereferenced", () => {
  it("follows a reference through an alias to its component, recording each component on the path", () => {
    const resolved = unwrap(
      datadogSpecDereferenced({
        document: DOCUMENT,
        located: { node: { $ref: "#/components/schemas/Alias" }, stack: [] },
      }),
    );
    expect(resolved).toEqual({
      node: DOCUMENT.components.schemas.Item,
      stack: ["schemas/Alias", "schemas/Item"],
    });
  });

  it("answers recursive at a component's first re-entry rather than walking it forever", () => {
    const located = { node: { $ref: "#/components/schemas/Loop" }, stack: [] };
    expect(unwrap(datadogSpecDereferenced({ document: DOCUMENT, located }))).toBe("recursive");
  });

  it("refuses a reference carrying a constraining keyword, and one into a component's insides", () => {
    const beside = { node: { $ref: "#/components/schemas/Item", type: "object" }, stack: [] };
    expect(unwrapErr(datadogSpecDereferenced({ document: DOCUMENT, located: beside }))).toEqual({
      code: "REFERENCE_ANNOTATED",
      message:
        "the reference #/components/schemas/Item carries type beside it, which OpenAPI 3.0 ignores and this refuses",
      ref: "#/components/schemas/Item",
    });
    const inside = { node: { $ref: "#/components/schemas/Item/properties/id" }, stack: [] };
    expect(unwrapErr(datadogSpecDereferenced({ document: DOCUMENT, located: inside }))).toEqual(
      DatadogSpecErrors.referenceNotLocal({ ref: "#/components/schemas/Item/properties/id" }),
    );
    const missing = { node: { $ref: "#/components/schemas/Absent" }, stack: [] };
    expect(unwrapErr(datadogSpecDereferenced({ document: DOCUMENT, located: missing })).code).toBe(
      "REFERENCE_UNRESOLVED",
    );
  });
});
