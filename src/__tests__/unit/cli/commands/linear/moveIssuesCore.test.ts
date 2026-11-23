/** `linear move-issues`'s pure half: the arguments, the per-issue refusals, the form, and the report. */
import { describe, expect, it } from "vitest";

import { parseLinearIssueForm } from "../../../../../cli/commands/linear/core.js";
import { linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import { updateInputFor } from "../../../../../cli/commands/linear/issueInput.js";
import {
  type IssueMoveApplication,
  parseLinearMoveIssuesArgs,
  planExitCode,
  planIssueMoves,
} from "../../../../../cli/commands/linear/moveIssuesCore.js";
import { moveIssuesJson, moveIssuesTextLines } from "../../../../../cli/commands/linear/moveIssuesReport.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { LinearIssueRow } from "../../../../../live/linear/issues.js";
import type { LinearStatesDocument } from "../../../../../live/linear/states.js";

const VIEWER = "user-me";

/** Each synthetic team's UUID: a planned form carries it as `teamId`, and the issue form refuses a key. */
const TEAM_IDS: Readonly<Record<string, string>> = {
  SOPS: "00000000-0000-4000-8000-0000000005a2",
  SUP: "00000000-0000-4000-8000-0000000005a1",
};

/** A team's states document. */
function team({
  key,
  states,
}: {
  key: string;
  states: readonly { id: string; name: string; type: string }[];
}): LinearStatesDocument {
  return {
    members: [],
    readAtIso: "2026-10-24T09:00:00.000Z",
    source: "linear",
    states: states.map((state, position) => ({ ...state, position })),
    team: { id: TEAM_IDS[key]!, key, name: key },
    workspace: "acme",
  };
}

const SUP = team({
  key: "SUP",
  states: [
    { id: "sup-todo", name: "Todo", type: "unstarted" },
    { id: "sup-review", name: "In Review", type: "started" },
    { id: "sup-merged", name: "Merged", type: "completed" },
  ],
});
const SOPS = team({
  key: "SOPS",
  states: [
    { id: "sops-todo", name: "Todo", type: "unstarted" },
    { id: "sops-review", name: "In Review", type: "started" },
    { id: "sops-done", name: "Done", type: "completed" },
  ],
});

/** One SUP issue the planner may move, every field overridable. */
function issue(over: Partial<LinearIssueRow> & { identifier: string }): LinearIssueRow {
  return {
    addedToProjectAt: null,
    archivedAt: null,
    assigneeId: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    creatorId: VIEWER,
    cycleId: null,
    id: `id-${over.identifier}`,
    labelIds: [],
    parentId: null,
    projectId: null,
    stateId: "sup-todo",
    teamId: SUP.team.id,
    teamKey: "SUP",
    title: `title ${over.identifier}`,
    url: `https://linear.app/acme/issue/${over.identifier}`,
    ...over,
  };
}

/** Plan with the standard teams and viewer. */
function plan({
  identifiers,
  issues,
  children = [],
}: {
  identifiers: readonly string[];
  issues: readonly LinearIssueRow[];
  children?: readonly LinearIssueRow[];
}) {
  return planIssueMoves({ children, destination: SOPS, identifiers, issues, sources: [SUP], viewerId: VIEWER });
}

describe("parseLinearMoveIssuesArgs", () => {
  it("reads the destination, the identifiers in order, and the switches", () => {
    expect(
      unwrap(
        parseLinearMoveIssuesArgs({
          rest: ["--to", "SOPS", "--identifier", "SUP-9, SUP-3", "--apply", "--json", "--home", "/h"],
        }),
      ),
    ).toEqual({ apply: true, destinationTeamKey: "SOPS", home: "/h", identifiers: ["SUP-9", "SUP-3"], json: true });
  });

  it("refuses a missing destination and missing identifiers together", () => {
    const error = unwrapErr(parseLinearMoveIssuesArgs({ rest: [] }));
    expect(linearVerbErrorLines({ error })).toEqual([
      "--to takes the destination team's key, such as SOPS, got nothing",
      "name the issues with --identifier <KEY-1,KEY-2,...>",
    ]);
  });

  it("refuses a malformed identifier and a repeated one", () => {
    const error = unwrapErr(parseLinearMoveIssuesArgs({ rest: ["--to", "SOPS", "--identifier", "SUP-9,sup-3,SUP-9"] }));
    expect(linearVerbErrorLines({ error })).toEqual([
      '"sup-3" is not an issue identifier like SUP-42',
      "SUP-9 is named twice; name each issue once",
    ]);
  });

  it("refuses a number no Linear issue can hold before any read, and accepts the widest one it can", () => {
    const tooLong = `SUP-${"9".repeat(309)}`;
    const error = unwrapErr(
      parseLinearMoveIssuesArgs({ rest: ["--to", "SOPS", "--identifier", `${tooLong},SUP-0,SUP-07`] }),
    );
    expect(linearVerbErrorLines({ error })).toEqual([
      `"${tooLong}" is not an issue identifier like SUP-42`,
      '"SUP-0" is not an issue identifier like SUP-42',
      '"SUP-07" is not an issue identifier like SUP-42',
    ]);
    expect(
      unwrap(parseLinearMoveIssuesArgs({ rest: ["--to", "SOPS", "--identifier", "SUP-999999999"] })).identifiers,
    ).toEqual(["SUP-999999999"]);
  });

  it("refuses a destination that is not a team key", () => {
    const error = unwrapErr(parseLinearMoveIssuesArgs({ rest: ["--to", "sops", "--identifier", "SUP-9"] }));
    expect(linearVerbErrorLines({ error })).toEqual([
      `--to takes the destination team's key, such as SOPS, got "sops"`,
    ]);
  });

  it("refuses an undeclared flag", () => {
    const error = unwrapErr(parseLinearMoveIssuesArgs({ rest: ["--to", "SOPS", "--identifier", "SUP-9", "--force"] }));
    expect(error.code).toBe("FLAGS_REFUSED");
  });
});

describe("planIssueMoves", () => {
  it("plans the exact fields-only form: destination team, same-name state, out of its cycle and labels", () => {
    const planned = plan({ identifiers: ["SUP-9"], issues: [issue({ cycleId: "cycle-1", identifier: "SUP-9" })] });

    expect(planned.moveCount).toBe(1);
    const [row] = planned.rows;
    expect(row!.kind).toBe("move");
    expect(row).toMatchObject({ cycleId: "cycle-1", destinationStateId: "sops-todo", issueId: "id-SUP-9" });
    expect((row as { form: unknown }).form).toEqual({
      artifact: {
        aiPrompt: [{ kind: "para", text: "**Goal.** Not sent: --fields-only." }],
        kind: "structured",
        problem: [{ kind: "para", text: "Not sent: --fields-only." }],
        solution: [{ kind: "para", text: "Not sent: --fields-only." }],
      },
      fields: { cycleId: null, labelIds: [], stateId: "sops-todo", teamId: SOPS.team.id, title: "title SUP-9" },
    });
  });

  it("lets the viewer's own issue move and refuses a colleague's", () => {
    const planned = plan({
      identifiers: ["SUP-1", "SUP-2"],
      issues: [
        issue({ assigneeId: VIEWER, identifier: "SUP-1" }),
        issue({ assigneeId: "user-colleague", identifier: "SUP-2" }),
      ],
    });
    expect(planned.rows.map((row) => row.kind)).toEqual(["move", "refused"]);
    expect(planned.rows[1]).toMatchObject({ reasons: [{ assigneeId: "user-colleague", code: "FOREIGN_ASSIGNEE" }] });
  });

  it("reports every reason on one row, in order, and a missing identifier as its own row in caller order", () => {
    const planned = plan({
      identifiers: ["SUP-404", "SUP-7"],
      issues: [
        issue({
          archivedAt: "2026-10-02T00:00:00.000Z",
          identifier: "SUP-7",
          labelIds: ["label-1"],
          projectId: "project-1",
          stateId: "sup-merged",
        }),
      ],
    });

    expect(planned.rows).toEqual([
      { identifier: "SUP-404", kind: "refused", reasons: [{ code: "ISSUE_NOT_RETURNED" }], title: undefined },
      {
        identifier: "SUP-7",
        kind: "refused",
        reasons: [
          { archivedAt: "2026-10-02T00:00:00.000Z", code: "ARCHIVED" },
          { code: "HAS_PROJECT", projectId: "project-1" },
          { code: "HAS_LABELS", labelIds: ["label-1"] },
          { code: "DESTINATION_STATE_MISSING", stateName: "Merged" },
        ],
        title: "title SUP-7",
      },
    ]);
    expect(planned.refusalCount).toBe(2);
  });

  it("refuses an issue already in the destination", () => {
    const planned = plan({
      identifiers: ["SOPS-1"],
      issues: [issue({ identifier: "SOPS-1", stateId: "sops-todo", teamId: SOPS.team.id, teamKey: "SOPS" })],
    });
    expect(planned.rows[0]).toMatchObject({
      reasons: [
        { code: "ALREADY_DESTINATION", teamKey: "SOPS" },
        { code: "SOURCE_STATE_NOT_READ", stateId: "sops-todo" },
      ],
    });
  });

  it("refuses a parent with children in its own team, and moves a child whose parent stays", () => {
    const planned = plan({
      children: [issue({ identifier: "SUP-11", parentId: "id-SUP-10" })],
      identifiers: ["SUP-10", "SUP-12"],
      issues: [issue({ identifier: "SUP-10" }), issue({ identifier: "SUP-12", parentId: "id-SUP-99" })],
    });
    expect(planned.rows[0]).toMatchObject({ reasons: [{ code: "SAME_TEAM_CHILDREN", identifiers: ["SUP-11"] }] });
    expect(planned.rows[1]!.kind).toBe("move");
  });

  it("does not refuse a parent whose only children already sit in another team", () => {
    const planned = plan({
      children: [issue({ identifier: "SOPS-11", parentId: "id-SUP-10", teamId: SOPS.team.id, teamKey: "SOPS" })],
      identifiers: ["SUP-10"],
      issues: [issue({ identifier: "SUP-10" })],
    });
    expect(planned.rows[0]!.kind).toBe("move");
  });

  it("refuses a same-named destination state of another type, so a started child never lands completed", () => {
    const doneIsCompleted = team({ key: "SOPS", states: [{ id: "sops-done", name: "In Review", type: "completed" }] });
    const planned = planIssueMoves({
      children: [],
      destination: doneIsCompleted,
      identifiers: ["SUP-2"],
      issues: [issue({ identifier: "SUP-2", stateId: "sup-review" })],
      sources: [SUP],
      viewerId: VIEWER,
    });
    expect(planned.rows).toEqual([
      {
        identifier: "SUP-2",
        kind: "refused",
        reasons: [
          {
            code: "DESTINATION_STATE_TYPE_DIFFERS",
            destinationType: "completed",
            sourceType: "started",
            stateName: "In Review",
          },
        ],
        title: "title SUP-2",
      },
    ]);
  });

  it("maps by exact name, never by a name's near match, and refuses two destination states sharing the name", () => {
    const twoTodos = team({
      key: "SOPS",
      states: [
        { id: "sops-todo-a", name: "Todo", type: "unstarted" },
        { id: "sops-todo-b", name: "Todo", type: "unstarted" },
      ],
    });
    const planned = planIssueMoves({
      children: [],
      destination: twoTodos,
      identifiers: ["SUP-1", "SUP-2"],
      issues: [issue({ identifier: "SUP-1" }), issue({ identifier: "SUP-2", stateId: "sup-merged" })],
      sources: [SUP],
      viewerId: VIEWER,
    });
    expect(planned.rows.map((row) => (row.kind === "refused" ? row.reasons : []))).toEqual([
      [{ code: "DESTINATION_STATE_AMBIGUOUS", stateIds: ["sops-todo-a", "sops-todo-b"], stateName: "Todo" }],
      [{ code: "DESTINATION_STATE_MISSING", stateName: "Merged" }],
    ]);
  });

  it("plans a form the real `linear issue` parser accepts, whose fields-only provider input carries no prose", () => {
    const planned = plan({ identifiers: ["SUP-9"], issues: [issue({ identifier: "SUP-9" })] });
    const form = unwrap(parseLinearIssueForm({ raw: JSON.stringify((planned.rows[0] as { form: unknown }).form) }));

    expect(
      updateInputFor({
        assigneeId: undefined,
        description: "unsent",
        fields: form.fields,
        fieldsOnly: true,
        moveTeam: true,
      }),
    ).toEqual({ cycleId: null, labelIds: [], stateId: "sops-todo", teamId: SOPS.team.id });
  });
});

describe("planExitCode", () => {
  it("is 0 when all move, 1 when some are refused, 3 when none would", () => {
    const all = plan({ identifiers: ["SUP-1"], issues: [issue({ identifier: "SUP-1" })] });
    const partial = plan({ identifiers: ["SUP-1", "SUP-2"], issues: [issue({ identifier: "SUP-1" })] });
    const none = plan({ identifiers: ["SUP-2"], issues: [] });

    expect([planExitCode({ plan: all }), planExitCode({ plan: partial }), planExitCode({ plan: none })]).toEqual([
      EXIT_OK,
      EXIT_ERROR,
      EXIT_EXPECTED_EMPTY,
    ]);
  });
});

describe("moveIssuesTextLines", () => {
  it("prints a preview row per issue, the counts, and that nothing is applied while any row is refused", () => {
    const partial = plan({
      identifiers: ["SUP-1", "SUP-2"],
      issues: [issue({ cycleId: "cycle-1", identifier: "SUP-1" })],
    });
    expect(moveIssuesTextLines({ applications: undefined, plan: partial })).toEqual([
      'move     SUP-1 "title SUP-1" → SOPS, keeps state "Todo", leaves cycle cycle-1',
      "refused  SUP-2: ISSUE_NOT_RETURNED: Linear returned no issue by this identifier",
      "1 would move into SOPS, 1 refused",
      "nothing applied: --apply moves only a plan with no refusal",
    ]);
  });

  it("reports landed, failed and not attempted rows under --apply", () => {
    const planned = plan({
      identifiers: ["SUP-1", "SUP-2", "SUP-3"],
      issues: [issue({ identifier: "SUP-1" }), issue({ identifier: "SUP-2" }), issue({ identifier: "SUP-3" })],
    });
    const applications = new Map<string, IssueMoveApplication>([
      ["SUP-1", { output: ["updated"], status: "landed" }],
      ["SUP-2", { diagnostics: ["door refused"], exitCode: 3, output: [], status: "failed" }],
      ["SUP-3", { status: "not attempted" }],
    ]);
    expect(moveIssuesTextLines({ applications, plan: planned }).slice(4)).toEqual([
      "landed   SUP-1",
      "failed   SUP-2 (linear issue exited 3): door refused",
      "not attempted SUP-3",
      "a fields-only write cannot read back its fields: re-run without --apply to see what stands now",
    ]);
  });
});

describe("moveIssuesJson", () => {
  it("is one document carrying the plan and each row's application", () => {
    const planned = plan({ identifiers: ["SUP-1"], issues: [issue({ identifier: "SUP-1" })] });
    const applications = new Map<string, IssueMoveApplication>([["SUP-1", { output: ["updated"], status: "landed" }]]);

    expect(JSON.parse(moveIssuesJson({ applications, plan: planned }))).toEqual({
      applied: true,
      destination: { id: SOPS.team.id, key: "SOPS", name: "SOPS" },
      moveCount: 1,
      refusalCount: 0,
      rows: [
        {
          application: { output: ["updated"], status: "landed" },
          cycleId: null,
          destinationStateId: "sops-todo",
          identifier: "SUP-1",
          issueId: "id-SUP-1",
          kind: "move",
          stateName: "Todo",
          title: "title SUP-1",
        },
      ],
    });
  });
});
