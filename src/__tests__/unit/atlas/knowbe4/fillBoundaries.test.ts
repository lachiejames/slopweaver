/**
 * The KnowBe4 boundaries read the Reporting API document's own shapes strictly: a declared row parses, a row
 * carrying an undeclared field or missing its id is refused rather than guessed at.
 */
import { describe, expect, it } from "vitest";

import { GET_ACCOUNT, LIST_GROUPS, LIST_STORE_PURCHASES } from "../../../../atlas/knowbe4/fill/boundaries.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("the KnowBe4 boundaries", () => {
  it("parses a group row the document declares", () => {
    expect(unwrap(LIST_GROUPS.parse({ value: [{ id: 10, member_count: 4, name: "Engineering" }] }))).toEqual([
      { id: 10, member_count: 4, name: "Engineering" },
    ]);
  });

  it("refuses a group row carrying a field the document never declared", () => {
    expect(unwrapErr(LIST_GROUPS.parse({ value: [{ id: 10, owner: "x" }] })).code).toBe("BOUNDARY_SHAPE_CHANGED");
  });

  it("refuses a group row with no id, since every entity is keyed by it", () => {
    expect(unwrapErr(LIST_GROUPS.parse({ value: [{ name: "Engineering" }] })).code).toBe("BOUNDARY_SHAPE_CHANGED");
  });

  it("reads a store purchase by the wire's `store_purchase_id`, the spelling a credentialed sync answered", () => {
    expect(unwrap(LIST_STORE_PURCHASES.parse({ value: [{ name: "Module", store_purchase_id: 3 }] }))).toEqual([
      { name: "Module", store_purchase_id: 3 },
    ]);
  });

  it("refuses a store purchase spelled as the OpenAPI document's `store_purchased_id`", () => {
    expect(unwrapErr(LIST_STORE_PURCHASES.parse({ value: [{ name: "Module", store_purchased_id: 3 }] })).code).toBe(
      "BOUNDARY_SHAPE_CHANGED",
    );
  });

  it("refuses an account answered as a list", () => {
    expect(unwrapErr(GET_ACCOUNT.parse({ value: [] })).code).toBe("BOUNDARY_SHAPE_CHANGED");
  });
});
