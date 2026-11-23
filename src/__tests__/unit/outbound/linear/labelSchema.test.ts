import { describe, expect, it } from "vitest";

import { linearLabelCreateFormSchema } from "../../../../outbound/linear/labelSchema.js";

/** Every rejection message, joined, for one raw form. */
function refusal({ form }: { form: unknown }): string {
  const parsed = linearLabelCreateFormSchema.safeParse(form);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
}

describe("linearLabelCreateFormSchema", () => {
  it("accepts a team issue label and a workspace project label", () => {
    expect(
      linearLabelCreateFormSchema.parse({
        fields: { color: "#5e6ad2", name: "Can drive", teamId: "t-1" },
        kind: "issue",
      }),
    ).toEqual({ fields: { color: "#5e6ad2", name: "Can drive", teamId: "t-1" }, kind: "issue" });
    expect(linearLabelCreateFormSchema.parse({ fields: { name: "Audit" }, kind: "project" })).toEqual({
      fields: { name: "Audit" },
      kind: "project",
    });
  });

  it("accepts an issue label group with a groupType", () => {
    const form = { fields: { groupType: "singleSelect", isGroup: true, name: "Bucket", teamId: "t-1" }, kind: "issue" };

    expect(linearLabelCreateFormSchema.parse(form)).toEqual(form);
  });

  it("refuses a key nobody declared, rather than dropping it", () => {
    expect(refusal({ form: { fields: { name: "Audit", replaceTeamLabels: true }, kind: "issue" } })).toContain(
      "replaceTeamLabels",
    );
  });

  it("refuses a groupType on a project label, because only the issue vocabulary has one", () => {
    expect(
      refusal({ form: { fields: { groupType: "multiSelect", isGroup: true, name: "G" }, kind: "project" } }),
    ).toContain("groupType");
  });

  it("refuses a name with a line break or surrounding whitespace, and an empty one", () => {
    expect(refusal({ form: { fields: { name: "Can\ndrive" }, kind: "issue" } })).toContain("one line");
    expect(refusal({ form: { fields: { name: " Audit" }, kind: "issue" } })).toContain("leading or trailing");
    expect(refusal({ form: { fields: { name: "" }, kind: "issue" } })).toContain("fields.name");
  });

  it("refuses a colour that is not six-digit hex", () => {
    expect(refusal({ form: { fields: { color: "blue", name: "Audit" }, kind: "issue" } })).toContain("six-digit hex");
  });

  it("refuses a groupType on a label that is not a group", () => {
    expect(refusal({ form: { fields: { groupType: "singleSelect", name: "Can drive" }, kind: "issue" } })).toContain(
      "needs isGroup: true",
    );
  });

  it("refuses a group under a parent", () => {
    expect(refusal({ form: { fields: { isGroup: true, name: "G", parentId: "p-1" }, kind: "project" } })).toContain(
      "cannot itself sit under a parent",
    );
  });

  it("refuses a kind outside the two vocabularies", () => {
    expect(refusal({ form: { fields: { name: "Audit" }, kind: "initiative" } })).toContain("kind");
  });
});
