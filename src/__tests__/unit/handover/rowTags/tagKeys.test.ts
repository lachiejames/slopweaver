/*
 * `TAG_KEYS` — the closed board-row tag key registry: each key defined once, the declared context and effort keys,
 * and every derived key naming its source field. It moved here when `rowTags.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { parseTagAssignment, TAG_KEYS, writableAssignment } from "../../../../handover/rowTags.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("TAG_KEYS", () => {
  it("defines each key once, including the owner's workstream and impact keys", () => {
    expect(TAG_KEYS.length).toBeGreaterThan(0);
    const keys = TAG_KEYS.map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("workstream");
    expect(keys).toContain("impact");
  });

  it("declares context as one of the two console contexts, writable like any declared key", () => {
    expect(TAG_KEYS.find((spec) => spec.key === "context")).toMatchObject({
      cardinality: "one",
      source: "declared",
      values: { allowed: ["work", "slopweaver"], kind: "enum" },
    });
    expect(unwrap(parseTagAssignment({ text: "context=work" }))).toEqual({ key: "context", value: "work" });
    expect(unwrap(writableAssignment({ assignment: { key: "context", value: "slopweaver" } })).key).toBe("context");
    expect(unwrapErr(writableAssignment({ assignment: { key: "context", value: "acme" } })).code).toBe("TAG_BAD_VALUE");
  });

  it("declares effort as Linear's t-shirt estimate, one value, writable like any declared key", () => {
    expect(TAG_KEYS.find((spec) => spec.key === "effort")).toMatchObject({
      cardinality: "one",
      source: "declared",
      values: { allowed: ["xs", "s", "m", "l", "xl"], kind: "enum" },
    });
    expect(unwrap(parseTagAssignment({ text: "effort=m" }))).toEqual({ key: "effort", value: "m" });
    expect(unwrap(writableAssignment({ assignment: { key: "effort", value: "m" } })).key).toBe("effort");
    expect(unwrapErr(writableAssignment({ assignment: { key: "effort", value: "medium" } })).code).toBe(
      "TAG_BAD_VALUE",
    );
  });

  it("gives every derived key the field a refusal names instead", () => {
    const derived = TAG_KEYS.filter((spec) => spec.source === "derived");
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.filter((spec) => spec.derivedFrom === undefined)).toEqual([]);
  });
});
