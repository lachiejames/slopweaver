import { describe, expect, it } from "vitest";

import { linearMilestoneFieldsSchema, linearProjectFieldsSchema } from "../../../../outbound/linear/projectSchema.js";

describe("linearProjectFieldsSchema", () => {
  it("accepts the minimal valid shape", () => {
    const parsed = linearProjectFieldsSchema.safeParse({ name: "A project", teamIds: ["t1"] });

    expect(parsed.success).toBe(true);
  });

  it("accepts every optional field filled in", () => {
    const parsed = linearProjectFieldsSchema.safeParse({
      description: "a one-line summary",
      labelIds: ["l1"],
      leadId: "u1",
      name: "A project",
      priority: 2,
      statusId: "s1",
      targetDate: "2026-12-01",
      teamIds: ["t1", "t2"],
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses an empty teamIds array — a project needs at least one team", () => {
    const parsed = linearProjectFieldsSchema.safeParse({ name: "x", teamIds: [] });

    expect(parsed.success).toBe(false);
  });

  it("refuses a name carrying a newline, which Linear would drop silently", () => {
    const parsed = linearProjectFieldsSchema.safeParse({ name: "line one\nline two", teamIds: ["t1"] });

    expect(parsed.success).toBe(false);
  });

  it("refuses a description carrying a newline — a project description renders as one line", () => {
    const parsed = linearProjectFieldsSchema.safeParse({ description: "a\nb", name: "x", teamIds: ["t1"] });

    expect(parsed.success).toBe(false);
  });

  it("refuses a target date that is not YYYY-MM-DD", () => {
    const parsed = linearProjectFieldsSchema.safeParse({ name: "x", targetDate: "12/01/2026", teamIds: ["t1"] });

    expect(parsed.success).toBe(false);
  });

  it("refuses a priority outside Linear's 0-4 scale", () => {
    const parsed = linearProjectFieldsSchema.safeParse({ name: "x", priority: 5, teamIds: ["t1"] });

    expect(parsed.success).toBe(false);
  });

  it("REFUSES an unknown field rather than silently dropping it", () => {
    const parsed = linearProjectFieldsSchema.safeParse({ initiative: "x", name: "x", teamIds: ["t1"] });

    expect(parsed.success).toBe(false);
  });
});

describe("linearMilestoneFieldsSchema", () => {
  it("accepts the minimal valid shape", () => {
    const parsed = linearMilestoneFieldsSchema.safeParse({ name: "A milestone", projectId: "p1" });

    expect(parsed.success).toBe(true);
  });

  it("accepts every optional field filled in", () => {
    const parsed = linearMilestoneFieldsSchema.safeParse({
      description: "**Goal.** Ship the audit.",
      name: "A milestone",
      projectId: "p1",
      sortOrder: 1.5,
      targetDate: "2026-12-01",
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses a description carrying Linear's collapsible delimiter", () => {
    const parsed = linearMilestoneFieldsSchema.safeParse({
      description: "before\n+++\nafter",
      name: "x",
      projectId: "p1",
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a markdown description carrying raw HTML, at the description's path", () => {
    const parsed = linearMilestoneFieldsSchema.safeParse({
      description: "Ship <!-- later",
      name: "x",
      projectId: "p1",
    });

    expect(parsed.error!.issues.map((issue) => [issue.path, issue.message.slice(0, 8)])).toEqual([
      [["description"], "raw HTML"],
    ]);
  });

  it("refuses a description carrying a markdown heading", () => {
    const parsed = linearMilestoneFieldsSchema.safeParse({ description: "## Escape", name: "x", projectId: "p1" });

    expect(parsed.success).toBe(false);
  });

  it("refuses a delimiter or heading a vertical tab, form feed or NEL puts on its own line", () => {
    const messages = [0x0b, 0x0c, 0x85].flatMap((code) =>
      ["+++", "## Escape"].map((line) => {
        const parsed = linearMilestoneFieldsSchema.safeParse({
          description: `before${String.fromCodePoint(code)}${line}`,
          name: "x",
          projectId: "p1",
        });
        return parsed.error!.issues.map((issue) => issue.message.slice(0, 30));
      }),
    );

    expect(messages).toEqual(
      [0x0b, 0x0c, 0x85].flatMap(() => [['a line beginning with "+++" is'], ['a line beginning with "#" open']]),
    );
  });

  it("refuses a missing projectId", () => {
    const parsed = linearMilestoneFieldsSchema.safeParse({ name: "x" });

    expect(parsed.success).toBe(false);
  });

  it("REFUSES an unknown field rather than silently dropping it", () => {
    const parsed = linearMilestoneFieldsSchema.safeParse({ dueDate: "2026-12-01", name: "x", projectId: "p1" });

    expect(parsed.success).toBe(false);
  });
});
