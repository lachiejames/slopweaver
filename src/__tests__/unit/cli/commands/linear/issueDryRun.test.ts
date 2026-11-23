/**
 * The `linear issue` dry run's destination lines: what an unset state or project says the write will do.
 * The cycle, assignee, parent and team cases stay in `backlogMove.test.ts` and `stepUp.test.ts`, where they
 * were written against the same function through `./core.ts`.
 */
import { describe, expect, it } from "vitest";

import { intentId, issueWriteId, parseLinearIssueArgs } from "../../../../../cli/commands/linear/core.js";
import { dryRunLines } from "../../../../../cli/commands/linear/issueDryRun.js";
import { unwrap } from "../../../../../lib/result.js";
import type { LinearIssueForm } from "../../../../../outbound/linear/types.js";

const FORM: LinearIssueForm = {
  artifact: {
    aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
    kind: "structured",
    problem: [{ kind: "para", text: "It is broken." }],
    solution: [{ kind: "para", text: "Unbreak it." }],
  },
  fields: { teamId: "team-1", title: "A ticket" },
};

describe("dryRunLines — the destination an unset field means", () => {
  it("says an issue with no state lands in the team default, and one with no project in none", () => {
    const lines = dryRunLines({ assigneeId: undefined, form: FORM, id: "id-1" });
    expect(lines[7]).toBe("state:     (team default)");
    expect(lines[8]).toBe("project:   (none)");
  });

  it("names the state and project ids a form sets", () => {
    const lines = dryRunLines({
      assigneeId: undefined,
      form: { ...FORM, fields: { ...FORM.fields, projectId: "project-9", stateId: "state-3" } },
      id: "id-1",
    });
    expect(lines[7]).toBe("state:     state-3");
    expect(lines[8]).toBe("project:   project-9");
  });

  it("spells a null project as a detach, never as the unset (none)", () => {
    const lines = dryRunLines({
      assigneeId: undefined,
      form: { ...FORM, fields: { ...FORM.fields, projectId: null } },
      id: "id-1",
    });
    expect(lines[8]).toBe("project:   (DETACHED — this write takes the issue out of its project)");
  });

  it("spells a null estimate as a clear, never as the unset triage line", () => {
    const lines = dryRunLines({
      assigneeId: undefined,
      form: { ...FORM, fields: { ...FORM.fields, estimate: null } },
      id: "id-1",
    });
    expect(lines[6]).toBe("estimate:  (CLEARED — this write removes the estimate)");
  });
});

describe("issueWriteId", () => {
  it("uses the --issue-id the operator named", () => {
    const issueUuid = "0b5e6c1e-7f3a-4c2d-9e8f-1a2b3c4d5e6f";
    const args = unwrap(parseLinearIssueArgs({ argv: ["update", "--form", "f.json", "--issue-id", issueUuid] }));
    expect(issueWriteId({ args, form: FORM })).toBe("0b5e6c1e-7f3a-4c2d-9e8f-1a2b3c4d5e6f");
  });

  it("derives a create's id from its intent, the same id every time", () => {
    const args = unwrap(parseLinearIssueArgs({ argv: ["create", "--form", "f.json"] }));
    expect(issueWriteId({ args, form: FORM })).toBe(intentId({ form: FORM }));
    expect(issueWriteId({ args, form: FORM })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});
