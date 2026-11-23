import { describe, expect, it } from "vitest";

import {
  labelDoorRequestFor,
  labelInputFor,
  labelIntentId,
  labelSubject,
  parseLinearLabelForm,
} from "../../../../../cli/commands/linear/labelCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { LinearLabelCreateForm } from "../../../../../outbound/linear/labelTypes.js";

const TEAM_ID = "5fd296ef-baa7-4bc4-ab3d-3afbc6202759";
const ISSUE: LinearLabelCreateForm = { fields: { name: "Audit", teamId: TEAM_ID }, kind: "issue" };
const PROJECT: LinearLabelCreateForm = { fields: { name: "Audit", teamId: TEAM_ID }, kind: "project" };

describe("labelIntentId", () => {
  it("is a UUID v4 layout, and the same form always maps to the same id", () => {
    const id = labelIntentId({ form: ISSUE });

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(labelIntentId({ form: ISSUE })).toBe(id);
  });

  it("gives an issue label and a project label of one name two ids, because they are two objects", () => {
    expect(labelIntentId({ form: ISSUE }) === labelIntentId({ form: PROJECT })).toBe(false);
  });

  it("does not depend on the order the caller wrote the form's keys in", () => {
    const reordered = unwrap(
      parseLinearLabelForm({ raw: `{"kind":"issue","fields":{"teamId":"${TEAM_ID}","name":"Audit"}}` }),
    );

    expect(labelIntentId({ form: reordered })).toBe(labelIntentId({ form: ISSUE }));
  });
});

describe("labelSubject", () => {
  it("is the team for a team label and `workspace` for a workspace one", () => {
    expect(labelSubject({ form: ISSUE })).toBe(TEAM_ID);
    expect(labelSubject({ form: { fields: { name: "Audit" }, kind: "issue" } })).toBe("workspace");
  });
});

describe("labelInputFor", () => {
  it("sends only the fields the form carries", () => {
    expect(labelInputFor({ form: { fields: { description: undefined, name: "Audit" }, kind: "project" } })).toEqual({
      name: "Audit",
    });
  });
});

describe("parseLinearLabelForm", () => {
  it("refuses text that is not JSON", () => {
    expect(unwrapErr(parseLinearLabelForm({ raw: "not json" })).code).toBe("FORM_NOT_JSON");
  });
});

describe("labelDoorRequestFor", () => {
  it("declares an external write that creates no work item, and records what was added where", () => {
    expect(labelDoorRequestFor({ form: ISSUE, home: "/h", id: "x" })).toEqual({
      action: { kind: "verb", noun: "linear", verb: "label create" },
      artifact: { id: "x", kind: "issue", name: "Audit", subject: TEAM_ID },
      meta: { createsWorkItem: false, effect: "external-write", home: "/h", requiresApproval: false },
    });
  });
});
