/**
 * What `--fields-only` may touch, and what it may no longer reach.
 *
 * Two defects are pinned here, and they are the same defect wearing different clothes: `--fields-only`
 * advertises that it cannot overwrite prose, and both halves of that promise were false. It sent the form's
 * `title` unconditionally, silently renaming any ticket whose live title the caller did not reproduce
 * byte-exact; and the ownership ledger refused the whole operation on any issue slopweaver did not itself
 * create, which is every hand-filed ticket a cycle-hygiene close list is made of.
 *
 * The verb is driven end-to-end through plain injected functions. No mocks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";
import { dryRunLines } from "../../../../../cli/commands/linear/core.js";
import { updateInputFor } from "../../../../../cli/commands/linear/issueInput.js";
import { runLinearIssue } from "../../../../../cli/commands/linear/run.js";
import type { LinearWriteDeps } from "../../../../../cli/commands/linear/writeDeps.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { LinearWriteApi, ReadIssue, WrittenObject } from "../../../../../corpus/linear/write.js";
import type { AssigneeResolution } from "../../../../../outbound/linear/assigneeIndex.js";
import type { StateCatalog } from "../../../../../outbound/linear/stateCatalog.js";
import type { LinearIssueFields, LinearIssueForm } from "../../../../../outbound/linear/types.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { emptyMentionResolution } from "../../../../linearMentionFixtures.js";

/** Every scratch home this file mints, removed in `afterAll` — see `.claude/rules/testing.md`. */
const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-fields-only-"));
  homes.push(home);
  return home;
}

/** A UUID v4 slopweaver has never seen, standing in for a ticket a colleague filed by hand. */
const FOREIGN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const FIELDS: LinearIssueFields = {
  teamId: "00000000-0000-4000-8000-000000000001",
  title: "A title the caller happened to author",
};

const FORM_TEXT = JSON.stringify({
  artifact: {
    aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
    kind: "structured",
    problem: [{ kind: "para", text: "It is broken." }],
    solution: [{ kind: "para", text: "Unbreak it." }],
  },
  fields: {
    stateId: "state-done",
    teamId: "00000000-0000-4000-8000-000000000001",
    title: "A title the caller happened to author",
  },
});

const FORM: LinearIssueForm = JSON.parse(FORM_TEXT) as LinearIssueForm;

// A write echoes an id and nothing else; every display field is the read-back's to give.
const WRITTEN: WrittenObject = { id: FOREIGN_ID };

/** What Linear holds: a title nobody in this test authored, which is the whole point. */
const LIVE_TITLE = "The live title, written by somebody else";
const READ: ReadIssue = {
  description: "prose a colleague wrote",
  id: FOREIGN_ID,
  identifier: "EEEE-589",
  url: "https://linear.test/EEEE-589",
  title: LIVE_TITLE,
  updatedAt: "2026-08-30T10:00:00.000Z",
};

const EMPTY_RESOLUTION: AssigneeResolution = {
  held: false,
  roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
  target: undefined,
};

/** The destination gate needs evidence the state id came from the team, so the catalog is read evidence. */
const CATALOG: StateCatalog = {
  members: [],
  readAtIso: "2026-08-30T09:00:00.000Z",
  states: [{ id: "state-done", name: "Done", type: "completed" }],
  teamId: "00000000-0000-4000-8000-000000000001",
  teamKey: "EEEE",
};

const NOT_THIS_LANE = (): never => {
  throw new Error("linear issue never calls the project/milestone/comment lane");
};

/** Drive the real verb, capturing the exact input bag the update mutation was handed. */
function harness({ home }: { home: string }): {
  deps: LinearWriteDeps;
  calls: string[];
  err: string[];
  updateInput: () => Readonly<Record<string, unknown>> | undefined;
} {
  const calls: string[] = [];
  const err: string[] = [];
  let updateInput: Readonly<Record<string, unknown>> | undefined;
  const api: LinearWriteApi = {
    createComment: NOT_THIS_LANE,
    createIssue: NOT_THIS_LANE,
    createMilestone: NOT_THIS_LANE,
    createProject: NOT_THIS_LANE,
    createProjectUpdate: NOT_THIS_LANE,
    deleteProjectUpdate: NOT_THIS_LANE,
    readProjectUpdate: NOT_THIS_LANE,
    createRelation: NOT_THIS_LANE,
    deleteComment: NOT_THIS_LANE,
    deleteIssue: NOT_THIS_LANE,
    deleteMilestone: NOT_THIS_LANE,
    deleteProject: NOT_THIS_LANE,
    deleteRelation: NOT_THIS_LANE,
    readComment: NOT_THIS_LANE,
    readIssue: () => {
      calls.push("read");
      return okAsync(READ);
    },
    readMilestone: NOT_THIS_LANE,
    readProject: NOT_THIS_LANE,
    readRelation: NOT_THIS_LANE,
    updateIssue: ({ id, input }) => {
      calls.push(`update:${id}`);
      updateInput = input;
      return okAsync(WRITTEN);
    },
    updateProject: NOT_THIS_LANE,
  };
  return {
    calls,
    deps: {
      autonomy: memoryAutonomyLedgerPort(),
      bareRefContext: () => ({ repos: [] }),
      env: () => undefined,
      doorLedger: memoryDoorLedger().port,
      err: (line) => err.push(line),
      makeApi: () => api,
      nowIso: () => "2026-08-30T10:00:00.000Z",
      out: () => undefined,
      previewMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      resolveMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      previewAssignee: async () => ok(EMPTY_RESOLUTION),
      readForm: () => FORM_TEXT,
      resolveAssignee: async () => ok(EMPTY_RESOLUTION),
      // Uses the home the verb was given, so a token resolved against the DEFAULT home — which would put
      // the door ledger somewhere else entirely — shows up as a call rather than passing silently.
      resolveToken: ({ home: given }) => {
        calls.push(given === home ? "token:same-home" : "token:WRONG-HOME");
        return "lin_api_fake";
      },
      stateCatalog: () => CATALOG,
    },
    err,
    updateInput: () => updateInput,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "issue", ...rest];
}

describe("updateInputFor", () => {
  it("omits the title on a fields-only update, so moving a state cannot rename the ticket", () => {
    const input = updateInputFor({
      assigneeId: undefined,
      description: "a rendered body",
      fields: { ...FIELDS, stateId: "state-done" },
      fieldsOnly: true,
    });

    expect(input["title"]).toBe(undefined);
    expect(input["description"]).toBe(undefined);
    expect(input["stateId"]).toBe("state-done");
  });

  it("carries the title and the body together on a body-replacing update", () => {
    const input = updateInputFor({
      assigneeId: undefined,
      description: "a rendered body",
      fields: FIELDS,
      fieldsOnly: false,
    });

    expect(input["title"]).toBe("A title the caller happened to author");
    expect(input["description"]).toBe("a rendered body");
  });
});

describe("dryRunLines", () => {
  it("says the title is not sent when the invocation is fields-only", () => {
    const lines = dryRunLines({ assigneeId: undefined, fieldsOnly: true, form: FORM, id: FOREIGN_ID });

    expect(lines).toContain("title:     (not sent — --fields-only touches no prose)");
    expect(lines).toContain("--- description (NOT sent — --fields-only) ---");
  });

  it("shows the title on a body-replacing preview", () => {
    const lines = dryRunLines({ assigneeId: undefined, fieldsOnly: false, form: FORM, id: FOREIGN_ID });

    expect(lines).toContain("title:     A title the caller happened to author");
    expect(lines).toContain("--- description ---");
  });
});

describe("the ownership ledger gates a body replacement, not a field change", () => {
  it("lets a fields-only update through on an issue slopweaver never created", async () => {
    const home = tempHome();
    const h = harness({ home });

    const code = await runLinearIssue({
      argv: argv({ rest: ["update", "--form", "-", "--issue-id", FOREIGN_ID, "--fields-only", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toContain("token:same-home");
    expect(h.calls).toContain(`update:${FOREIGN_ID}`);
    expect(h.updateInput()!["stateId"]).toBe("state-done");
  });

  it("sends neither title nor description on that write, so the live title survives", async () => {
    const home = tempHome();
    const h = harness({ home });

    await runLinearIssue({
      argv: argv({ rest: ["update", "--form", "-", "--issue-id", FOREIGN_ID, "--fields-only", "--home", home] }),
      deps: h.deps,
    });

    const input = h.updateInput()!;
    expect(input["title"]).toBe(undefined);
    expect(input["description"]).toBe(undefined);
    expect(READ.title).toBe(LIVE_TITLE);
  });

  it("still refuses a BODY-replacing update on that same unowned issue", async () => {
    const home = tempHome();
    const h = harness({ home });

    const code = await runLinearIssue({
      argv: argv({ rest: ["update", "--form", "-", "--issue-id", FOREIGN_ID, "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).not.toContain(`update:${FOREIGN_ID}`);
    expect(h.err.join("\n")).toContain("slopweaver has no record of creating issue");
  });
});
