/**
 * Taking a ticket OUT of a cycle, and off its assignee.
 *
 * The defect these pin is one an owner ruling walked straight into: a request to move a ticket to the backlog
 * meant all three of a state change, a cycle removal and an unassign, and only the first had any path
 * through this verb at all. `cycleId` existed nowhere in the write surface, and an omitted `assignee` means
 * LEAVE IT ALONE, so an issue could be assigned but never handed back.
 *
 * The distinction under test throughout is `undefined` versus `null`. They are not the same instruction and
 * a treatment that collapses them silently does the wrong one of two opposite things.
 */
import { describe, expect, it } from "vitest";
import { dryRunLines, parseLinearIssueForm } from "../../../../../cli/commands/linear/core.js";
import { linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import { createInputFor, updateInputFor } from "../../../../../cli/commands/linear/issueInput.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { LinearIssueFields, LinearIssueForm } from "../../../../../outbound/linear/types.js";

const FIELDS: LinearIssueFields = {
  teamId: "00000000-0000-4000-8000-000000000001",
  title: "A ticket that is going to the backlog",
};

const FORM: LinearIssueForm = {
  artifact: {
    aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
    kind: "structured",
    problem: [{ kind: "para", text: "It is broken." }],
    solution: [{ kind: "para", text: "Unbreak it." }],
  },
  fields: FIELDS,
};

describe("updateInputFor carries the project", () => {
  it("omits projectId entirely when the form says nothing about the project", () => {
    const input = updateInputFor({ assigneeId: undefined, description: "a body", fields: FIELDS, fieldsOnly: true });

    expect("projectId" in input).toBe(false);
  });

  it("sends an explicit null so the issue is detached from its project", () => {
    const input = updateInputFor({
      assigneeId: undefined,
      description: "a body",
      fields: { ...FIELDS, projectId: null },
      fieldsOnly: true,
    });

    expect("projectId" in input).toBe(true);
    expect(input["projectId"]).toBe(null);
  });

  it("accepts a null projectId in the form, and refuses an empty string", () => {
    const detach = parseLinearIssueForm({ raw: JSON.stringify({ ...FORM, fields: { ...FIELDS, projectId: null } }) });
    const empty = parseLinearIssueForm({ raw: JSON.stringify({ ...FORM, fields: { ...FIELDS, projectId: "" } }) });

    expect(unwrap(detach).fields.projectId).toBe(null);
    expect(linearVerbErrorLines({ error: unwrapErr(empty) }).join("\n")).toContain("projectId");
  });
});

describe("updateInputFor carries the estimate", () => {
  it("omits estimate when the form says nothing, and sends an explicit null to clear it", () => {
    const untouched = updateInputFor({
      assigneeId: undefined,
      description: "a body",
      fields: FIELDS,
      fieldsOnly: true,
    });
    const cleared = updateInputFor({
      assigneeId: undefined,
      description: "a body",
      fields: { ...FIELDS, estimate: null },
      fieldsOnly: true,
    });

    expect("estimate" in untouched).toBe(false);
    expect("estimate" in cleared).toBe(true);
    expect(cleared["estimate"]).toBe(null);
  });

  it("accepts a null estimate in the form, and refuses a negative one", () => {
    const clear = parseLinearIssueForm({ raw: JSON.stringify({ ...FORM, fields: { ...FIELDS, estimate: null } }) });
    const negative = parseLinearIssueForm({ raw: JSON.stringify({ ...FORM, fields: { ...FIELDS, estimate: -1 } }) });

    expect(unwrap(clear).fields.estimate).toBe(null);
    expect(linearVerbErrorLines({ error: unwrapErr(negative) }).join("\n")).toContain("estimate");
  });
});

describe("updateInputFor carries the cycle", () => {
  it("omits cycleId entirely when the form says nothing about the cycle", () => {
    const input = updateInputFor({
      assigneeId: undefined,
      description: "a rendered body",
      fields: FIELDS,
      fieldsOnly: true,
    });

    expect("cycleId" in input).toBe(false);
  });

  it("sends an explicit null so the issue leaves its cycle", () => {
    const input = updateInputFor({
      assigneeId: undefined,
      description: "a rendered body",
      fields: { ...FIELDS, cycleId: null },
      fieldsOnly: true,
    });

    expect("cycleId" in input).toBe(true);
    expect(input["cycleId"]).toBe(null);
  });

  it("sends a cycle id when the form moves the issue into one", () => {
    const input = updateInputFor({
      assigneeId: undefined,
      description: "a rendered body",
      fields: { ...FIELDS, cycleId: "cycle-133" },
      fieldsOnly: true,
    });

    expect(input["cycleId"]).toBe("cycle-133");
  });
});

describe("updateInputFor carries the unassign", () => {
  it("omits assigneeId when nobody is named, which leaves the current assignee alone", () => {
    const input = updateInputFor({
      assigneeId: undefined,
      description: "a rendered body",
      fields: FIELDS,
      fieldsOnly: true,
    });

    expect("assigneeId" in input).toBe(false);
  });

  it("sends an explicit null so the ticket goes back to its team", () => {
    const input = updateInputFor({
      assigneeId: null,
      description: "a rendered body",
      fields: { ...FIELDS, assignee: null },
      fieldsOnly: true,
    });

    expect("assigneeId" in input).toBe(true);
    expect(input["assigneeId"]).toBe(null);
  });

  it("still sends a resolved user id when the form names somebody", () => {
    const input = updateInputFor({
      assigneeId: "user-7",
      description: "a rendered body",
      fields: { ...FIELDS, assignee: "person:someone" },
      fieldsOnly: true,
    });

    expect(input["assigneeId"]).toBe("user-7");
  });
});

describe("the whole backlog move, as one fields-only input", () => {
  it("carries the state, the cycle removal and the unassign together and no prose", () => {
    const input = updateInputFor({
      assigneeId: null,
      description: "a rendered body",
      fields: { ...FIELDS, assignee: null, cycleId: null, stateId: "state-backlog" },
      fieldsOnly: true,
    });

    expect(input["stateId"]).toBe("state-backlog");
    expect(input["cycleId"]).toBe(null);
    expect(input["assigneeId"]).toBe(null);
    expect(input["title"]).toBe(undefined);
    expect(input["description"]).toBe(undefined);
  });
});

describe("createInputFor", () => {
  it("omits cycleId when the form does not name one", () => {
    const input = createInputFor({ assigneeId: undefined, description: "body", fields: FIELDS });

    expect("cycleId" in input).toBe(false);
  });

  it("files a new issue straight into a cycle when the form names one", () => {
    const input = createInputFor({
      assigneeId: undefined,
      description: "body",
      fields: { ...FIELDS, cycleId: "cycle-133" },
    });

    expect(input["cycleId"]).toBe("cycle-133");
  });
});

describe("the dry run distinguishes cleared from unset", () => {
  it("reports an untouched cycle and an untouched assignee as unchanged", () => {
    const lines = dryRunLines({ assigneeId: undefined, fieldsOnly: true, form: FORM, id: "id-1" });

    expect(lines).toContain("cycle:     (unchanged)");
    expect(lines).toContain("assignee:  (unassigned — triage decides)");
  });

  it("names the removal and the clearing in words, so a preview cannot read as a no-op", () => {
    const lines = dryRunLines({
      assigneeId: null,
      fieldsOnly: true,
      form: { ...FORM, fields: { ...FIELDS, assignee: null, cycleId: null } },
      id: "id-1",
    });

    expect(lines).toContain("cycle:     (REMOVED — this write takes the issue out of its cycle)");
    expect(lines).toContain("assignee:  (CLEARED — this write removes whoever is assigned)");
  });
});

describe("the form schema accepts the two null instructions", () => {
  it("parses a backlog-move form carrying both nulls", () => {
    const raw = JSON.stringify({
      artifact: FORM.artifact,
      fields: {
        assignee: null,
        cycleId: null,
        stateId: "state-backlog",
        teamId: "00000000-0000-4000-8000-000000000001",
        title: "T",
      },
    });

    const parsed = parseLinearIssueForm({ raw });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).fields.cycleId).toBe(null);
    expect(unwrap(parsed).fields.assignee).toBe(null);
  });

  it("refuses an empty-string cycle id, which is a mistake rather than a removal", () => {
    const raw = JSON.stringify({
      artifact: FORM.artifact,
      fields: { cycleId: "", teamId: "00000000-0000-4000-8000-000000000001", title: "T" },
    });

    const parsed = parseLinearIssueForm({ raw });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "fields.cycleId: Too small: expected string to have >=1 characters",
    ]);
  });
});
