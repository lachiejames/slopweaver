/**
 * What the KnowBe4 projectors share: the freeze, a row's group ids, the refusal for a per-parent page projected
 * with no parent, and the registry the publish checks a detail against.
 */
import { describe, expect, it } from "vitest";

import {
  campaignContent,
  deepFreeze,
  isProjectedDetail,
  parentMissing,
  projected,
  publishableWords,
  targetGroups,
} from "../../../../atlas/knowbe4/fill/projectShapes.js";
import { BoundaryErrors } from "../../../../lib/boundary.js";
import { unwrapErr } from "../../../../lib/result.js";

describe("projected and isProjectedDetail", () => {
  it("recognises the very object a projector recorded, frozen, under its own path only, and no equal copy of it", () => {
    const detail = projected({ detail: { email: "a@example.com", family: "/v1/users" } });

    expect([
      isProjectedDetail({ detail, template: "/v1/users" }),
      isProjectedDetail({ detail, template: "/v1/account" }),
      isProjectedDetail({ detail: { email: "a@example.com", family: "/v1/users" }, template: "/v1/users" }),
      Object.isFrozen(detail),
    ]).toEqual([true, false, false, true]);
  });
});

describe("deepFreeze", () => {
  it("freezes the value and every object nested under it", () => {
    const detail = { counts: { clicked: 1 }, groupIds: ["7"], name: "a" };
    deepFreeze({ value: detail });

    expect([Object.isFrozen(detail), Object.isFrozen(detail.counts), Object.isFrozen(detail.groupIds)]).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe("targetGroups", () => {
  it("keeps each target's id and name in KnowBe4's order, the special All Users target included", () => {
    expect(targetGroups({ groups: [{ group_id: 0, name: "All Users" }, { group_id: 3 }] })).toEqual([
      { groupId: "0", name: "All Users" },
      { groupId: "3", name: null },
    ]);
  });
});

describe("campaignContent", () => {
  it("keeps each item's type, name and the purchase or policy it names, and none for absent content", () => {
    expect([
      campaignContent({ content: [{ content_type: "Store Purchase", name: "Module", store_purchase_id: 5 }] }),
      campaignContent({ content: null }),
      campaignContent({ content: undefined }),
    ]).toEqual([[{ contentType: "Store Purchase", name: "Module", policyId: null, storePurchaseId: "5" }], [], []]);
  });
});

describe("publishableWords", () => {
  it("names a field this repository declared and only counts one KnowBe4 chose", () => {
    const error = BoundaryErrors.shapeChanged({
      drift: [
        { detail: 'field "[0].email" is missing', kind: "missing", path: "[0].email" },
        { detail: 'new field "[0].ssn_123_45_6789"', kind: "new", path: "[0].ssn_123_45_6789" },
        { detail: 'field "[0].name" renamed to "[0].nam"?', kind: "renamed", path: "[0].nam" },
      ],
      endpoint: "GET /v1/users",
    });

    expect(error.message).toContain("ssn_123_45_6789");
    expect(publishableWords({ error })).toBe(
      'GET /v1/users answered a shape this version does not read — refused, not guessed: field "[0].email" is missing; 2 undeclared field(s), named nowhere since KnowBe4 chose the names',
    );
  });

  it("passes any other refusal's own words through", () => {
    expect(publishableWords({ error: { code: "OWNER_MISSING", message: "row 9 names neither" } })).toBe(
      "row 9 names neither",
    );
  });
});

describe("parentMissing", () => {
  it("refuses with PARENT_MISSING, naming the path", () => {
    expect(unwrapErr(parentMissing({ path: "/v1/groups/{id}/members" }))).toEqual({
      code: "PARENT_MISSING",
      message: "/v1/groups/{id}/members was projected without the parent id its call was made under",
    });
  });
});
