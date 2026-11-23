/**
 * Graduated autonomy for Linear (an owner steer): an obvious edit on Acme work is TAKEN under
 * `--unasked` and recorded in the autonomy ledger, a weak ticket a person filed is rewritten under
 * `--rewrite-filed` conditional on the instant it was read at, and a closure, an assignee change or a mention
 * — anything that reaches a person — is refused before the write.
 *
 * Pure functions are tested directly; the verb is driven end-to-end through plain injected functions. No mocks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";
import { dryRunLines, type LinearIssueArgs } from "../../../../../cli/commands/linear/core.js";
import { createInputFor, updateInputFor } from "../../../../../cli/commands/linear/issueInput.js";
import { journalUnasked } from "../../../../../cli/commands/linear/issueJournal.js";
import { issueStepUpArgsOf } from "../../../../../cli/commands/linear/issueStepUpArgs.js";
import { inputFor, updatePrecheck, type WriteContext } from "../../../../../cli/commands/linear/issueWrite.js";
import { runLinearIssue } from "../../../../../cli/commands/linear/run.js";
import {
  LINEAR_ROLLBACK,
  unaskedActionId,
  unaskedKind,
  unaskedNoteRefusal,
  unaskedRefusals,
} from "../../../../../cli/commands/linear/unasked.js";
import type { LinearWriteDeps } from "../../../../../cli/commands/linear/writeDeps.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearWriteApi, ReadIssue } from "../../../../../corpus/linear/write.js";
import type { AssigneeResolution } from "../../../../../outbound/linear/assigneeIndex.js";
import type { StateCatalog } from "../../../../../outbound/linear/stateCatalog.js";
import type { LinearIssueFields, LinearIssueForm } from "../../../../../outbound/linear/types.js";
import { heldAutonomyRecords, memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
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
  const home = mkdtempSync(join(tmpdir(), "slopweaver-step-up-"));
  homes.push(home);
  return home;
}

/** A ticket a colleague filed by hand: slopweaver has no record of it. */
const FILED_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const READ_AT = "2026-10-01T09:00:00.000Z";

const READ: ReadIssue = {
  description: "do the thing",
  id: FILED_ID,
  identifier: "FFFF-7313",
  title: "thing",
  updatedAt: READ_AT,
  url: "https://linear.test/FFFF-7313",
};

const CATALOG: StateCatalog = {
  members: [],
  readAtIso: "2026-10-01T08:00:00.000Z",
  states: [
    { id: "state-progress", name: "In Progress", type: "started" },
    { id: "state-done", name: "Done", type: "completed" },
    { id: "state-cancelled", name: "Canceled", type: "canceled" },
    { id: "state-duplicate", name: "Duplicate", type: "duplicate" },
  ],
  teamId: "00000000-0000-4000-8000-000000000001",
  teamKey: "FFFF",
};

const FIELDS: LinearIssueFields = { teamId: CATALOG.teamId, title: "Rebuild the staging pool alert" };

const NOTE = {
  bySession: "graduated-autonomy-294-46",
  said: "Moved the staging pool ticket to In Progress, because you are working on it now.",
  why: "Linear showed it in the backlog while the branch was open",
};

function formText({ fields }: { fields: Readonly<Record<string, unknown>> }): string {
  return JSON.stringify({
    artifact: {
      aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
      kind: "structured",
      problem: [{ kind: "para", text: "It is broken." }],
      solution: [{ kind: "para", text: "Unbreak it." }],
    },
    fields: { teamId: "00000000-0000-4000-8000-000000000001", title: "Rebuild the staging pool alert", ...fields },
  } satisfies { artifact: LinearIssueForm["artifact"]; fields: Readonly<Record<string, unknown>> });
}

const EMPTY_RESOLUTION: AssigneeResolution = {
  held: false,
  roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
  target: undefined,
};

const NOT_THIS_LANE = (): never => {
  throw new Error("linear issue never calls the project/milestone/comment lane");
};

/** Drive the real verb, capturing the exact input bag the update mutation was handed. */
function harness({ form }: { form: string }): {
  deps: LinearWriteDeps;
  updates: Readonly<Record<string, unknown>>[];
  out: string[];
  err: string[];
} {
  const updates: Readonly<Record<string, unknown>>[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const api: LinearWriteApi = {
    createComment: NOT_THIS_LANE,
    createIssue: NOT_THIS_LANE,
    createMilestone: NOT_THIS_LANE,
    createProject: NOT_THIS_LANE,
    createProjectUpdate: NOT_THIS_LANE,
    createRelation: NOT_THIS_LANE,
    deleteComment: NOT_THIS_LANE,
    deleteIssue: NOT_THIS_LANE,
    deleteMilestone: NOT_THIS_LANE,
    deleteProject: NOT_THIS_LANE,
    deleteProjectUpdate: NOT_THIS_LANE,
    deleteRelation: NOT_THIS_LANE,
    readComment: NOT_THIS_LANE,
    readIssue: () => okAsync(READ),
    readMilestone: NOT_THIS_LANE,
    readProject: NOT_THIS_LANE,
    readProjectUpdate: NOT_THIS_LANE,
    readRelation: NOT_THIS_LANE,
    updateIssue: ({ id, input }) => {
      updates.push(input);
      return okAsync({ id });
    },
    updateProject: NOT_THIS_LANE,
  };
  return {
    deps: {
      autonomy: memoryAutonomyLedgerPort(),
      bareRefContext: () => ({ repos: [] }),
      doorLedger: memoryDoorLedger().port,
      env: () => undefined,
      err: (line) => err.push(line),
      makeApi: () => api,
      nowIso: () => "2026-10-01T10:00:00.000Z",
      out: (line) => out.push(line),
      previewAssignee: async () => ok(EMPTY_RESOLUTION),
      previewMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      readForm: () => form,
      resolveAssignee: async () => ok(EMPTY_RESOLUTION),
      resolveMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      resolveToken: () => "lin_api_fake",
      stateCatalog: () => CATALOG,
    },
    err,
    out,
    updates,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "issue", ...rest];
}

const UNASKED_FLAGS = ["--unasked", "--why", NOTE.why, "--said", NOTE.said, "--by-session", NOTE.bySession];

describe("issueStepUpArgsOf", () => {
  it("carries all three accounts and the read instant when every flag stands", () => {
    const parsed = issueStepUpArgsOf({
      fieldsOnly: false,
      values: {
        "by-session": "s",
        "expect-updated-at": READ_AT,
        "move-team": true,
        "rewrite-filed": true,
        said: "said",
        unasked: true,
        why: "why",
      },
      verb: "update",
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.args).toEqual({
      moveTeam: true,
      rewriteFiled: { expectUpdatedAt: READ_AT },
      unasked: { bySession: "s", said: "said", why: "why" },
    });
  });

  it("refuses --move-team on a create", () => {
    const parsed = issueStepUpArgsOf({ fieldsOnly: false, values: { "move-team": true }, verb: "create" });

    expect(parsed.errors).toEqual([
      "--rewrite-filed and --move-team act on an existing issue, so they are update-only",
    ]);
  });

  it("refuses --rewrite-filed beside --fields-only, which sends no body to rewrite", () => {
    const parsed = issueStepUpArgsOf({
      fieldsOnly: true,
      values: { "expect-updated-at": READ_AT, "rewrite-filed": true },
      verb: "update",
    });

    expect(parsed.errors).toEqual(["--rewrite-filed replaces the body and --fields-only sends none; pick one"]);
  });

  it("refuses --rewrite-filed without the instant it is conditional on", () => {
    const parsed = issueStepUpArgsOf({ fieldsOnly: false, values: { "rewrite-filed": true }, verb: "update" });

    expect(parsed.errors.length).toBe(1);
    expect(parsed.errors[0]).toContain("--rewrite-filed needs --expect-updated-at <iso>");
    expect(parsed.args.rewriteFiled).toBe(undefined);
  });

  it("refuses --expect-updated-at with no --rewrite-filed to condition", () => {
    const parsed = issueStepUpArgsOf({ fieldsOnly: false, values: { "expect-updated-at": READ_AT }, verb: "update" });

    expect(parsed.errors).toEqual(["--expect-updated-at only conditions a --rewrite-filed write"]);
  });

  it("refuses --unasked missing one of its three accounts", () => {
    const parsed = issueStepUpArgsOf({
      fieldsOnly: true,
      values: { said: "said", unasked: true, why: "why" },
      verb: "update",
    });

    expect(parsed.errors).toEqual([
      "--unasked journals the act to the autonomy ledger, so --why, --said and --by-session are all required with it",
    ]);
    expect(parsed.args.unasked).toBe(undefined);
  });

  it("refuses an account given without --unasked, since nothing would journal it", () => {
    const parsed = issueStepUpArgsOf({ fieldsOnly: true, values: { why: "why" }, verb: "update" });

    expect(parsed.errors).toEqual([
      "--why, --said and --by-session are the accounts of an --unasked act; without --unasked nothing is journalled",
    ]);
  });
});

describe("unaskedRefusals", () => {
  it("lets a move to a started state through", () => {
    expect(
      unaskedRefusals({ catalog: CATALOG, fields: { ...FIELDS, stateId: "state-progress" }, mentionKeys: [] }),
    ).toEqual([]);
  });

  it("refuses a completed state, because a closure waits on the owner's word", () => {
    const refusals = unaskedRefusals({
      catalog: CATALOG,
      fields: { ...FIELDS, stateId: "state-done" },
      mentionKeys: [],
    });

    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain('state "Done" is completed, and a closure waits on their word');
  });

  it("refuses a canceled state the same way", () => {
    const refusals = unaskedRefusals({
      catalog: CATALOG,
      fields: { ...FIELDS, stateId: "state-cancelled" },
      mentionKeys: [],
    });

    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain('state "Canceled" is canceled');
  });

  it("refuses marking a duplicate, which closes the issue too", () => {
    const refusals = unaskedRefusals({
      catalog: CATALOG,
      fields: { ...FIELDS, stateId: "state-duplicate" },
      mentionKeys: [],
    });

    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain('state "Duplicate" is duplicate');
  });

  it("leaves an uncatalogued state to the state gate rather than judging it here", () => {
    expect(
      unaskedRefusals({ catalog: undefined, fields: { ...FIELDS, stateId: "state-done" }, mentionKeys: [] }),
    ).toEqual([]);
  });

  it("refuses setting an assignee, which notifies the new one", () => {
    expect(unaskedRefusals({ catalog: CATALOG, fields: { ...FIELDS, assignee: "ari" }, mentionKeys: [] })).toEqual([
      "--unasked refused: an assignee change reaches a person, the old assignee or the new, so it waits on their word.",
    ]);
  });

  it("refuses clearing an assignee, which notifies the old one", () => {
    expect(unaskedRefusals({ catalog: CATALOG, fields: { ...FIELDS, assignee: null }, mentionKeys: [] }).length).toBe(
      1,
    );
  });

  it("refuses a body that mentions someone", () => {
    expect(unaskedRefusals({ catalog: CATALOG, fields: FIELDS, mentionKeys: ["ari"] })).toEqual([
      "--unasked refused: the body mentions ari, which notifies a person; it waits on their word.",
    ]);
  });
});

describe("unaskedKind", () => {
  it("names each act for what it was", () => {
    expect(unaskedKind({ fieldsOnly: false, rewriteFiled: false, verb: "create" })).toBe("linear-issue-create");
    expect(unaskedKind({ fieldsOnly: true, rewriteFiled: false, verb: "update" })).toBe("linear-fields-update");
    expect(unaskedKind({ fieldsOnly: false, rewriteFiled: true, verb: "update" })).toBe("linear-body-rewrite");
    expect(unaskedKind({ fieldsOnly: false, rewriteFiled: false, verb: "update" })).toBe("linear-issue-update");
  });
});

describe("unaskedActionId", () => {
  const base = { doneIso: "2026-10-01T10:00:00.000Z", id: FILED_ID, identifier: "FFFF-7313", input: { stateId: "s" } };

  it("is the identifier lowercased plus a twelve-hex digest, stable for one act", () => {
    const id = unaskedActionId(base);

    expect(id).toMatch(/^linear-ffff-7313-[0-9a-f]{12}$/u);
    expect(unaskedActionId(base)).toBe(id);
  });

  it("is a different act when the same input is sent again later", () => {
    expect(unaskedActionId({ ...base, doneIso: "2026-10-01T11:00:00.000Z" })).not.toBe(unaskedActionId(base));
  });

  it("is a different act when the input differs", () => {
    expect(unaskedActionId({ ...base, input: { stateId: "t" } })).not.toBe(unaskedActionId(base));
  });
});

describe("unaskedNoteRefusal", () => {
  it("passes accounts the ledger will record", () => {
    expect(unaskedNoteRefusal({ doneIso: "2026-10-01T10:00:00.000Z", kind: "linear-fields-update", note: NOTE })).toBe(
      undefined,
    );
  });

  it("refuses, before the write, a said the ledger would refuse after it", () => {
    const refusal = unaskedNoteRefusal({
      doneIso: "2026-10-01T10:00:00.000Z",
      kind: "linear-fields-update",
      note: { ...NOTE, said: "word ".repeat(100) },
    });

    expect(refusal).toContain("--unasked refused before writing:");
  });
});

describe("the issue input carries the parent and the team move", () => {
  it("sends a parent id when the form sets one", () => {
    const input = updateInputFor({
      assigneeId: undefined,
      description: "b",
      fields: { ...FIELDS, parentId: "parent-1" },
      fieldsOnly: true,
    });

    expect(input["parentId"]).toBe("parent-1");
  });

  it("sends null to detach the issue from its parent", () => {
    const input = updateInputFor({
      assigneeId: undefined,
      description: "b",
      fields: { ...FIELDS, parentId: null },
      fieldsOnly: true,
    });

    expect(input["parentId"]).toBe(null);
  });

  it("omits the parent entirely when the form says nothing", () => {
    const input = updateInputFor({ assigneeId: undefined, description: "b", fields: FIELDS, fieldsOnly: true });

    expect(Object.keys(input)).not.toContain("parentId");
  });

  it("sends the team only under --move-team", () => {
    const moved = updateInputFor({
      assigneeId: undefined,
      description: "b",
      fields: FIELDS,
      fieldsOnly: true,
      moveTeam: true,
    });
    const kept = updateInputFor({ assigneeId: undefined, description: "b", fields: FIELDS, fieldsOnly: true });

    expect(moved["teamId"]).toBe("00000000-0000-4000-8000-000000000001");
    expect(Object.keys(kept)).not.toContain("teamId");
  });

  it("files a new issue under its parent", () => {
    const input = createInputFor({
      assigneeId: undefined,
      description: "b",
      fields: { ...FIELDS, parentId: "parent-1" },
    });

    expect(input["parentId"]).toBe("parent-1");
  });
});

describe("dryRunLines shows the parent and the team move", () => {
  const form = JSON.parse(formText({ fields: { parentId: null } })) as LinearIssueForm;

  it("says a null parent detaches the issue, and a move names itself", () => {
    const lines = dryRunLines({ assigneeId: undefined, fieldsOnly: true, form, id: FILED_ID, moveTeam: true });

    expect(lines).toContain("team:      00000000-0000-4000-8000-000000000001  (MOVED here — --move-team)");
    expect(lines).toContain("parent:    (DETACHED — this write takes the issue out from under its parent)");
  });

  it("says an absent parent is left alone", () => {
    const plain = JSON.parse(formText({ fields: {} })) as LinearIssueForm;
    const lines = dryRunLines({ assigneeId: undefined, fieldsOnly: true, form: plain, id: FILED_ID });

    expect(lines).toContain("team:      00000000-0000-4000-8000-000000000001");
    expect(lines).toContain("parent:    (unchanged)");
  });
});

describe("an --unasked write is journalled", () => {
  it("records a fields-only state move on a filed ticket, naming the activity history as its rollback", async () => {
    const home = tempHome();
    const h = harness({ form: formText({ fields: { stateId: "state-progress" } }) });

    const code = await runLinearIssue({
      argv: argv({
        rest: ["update", "--form", "-", "--issue-id", FILED_ID, "--fields-only", "--home", home, ...UNASKED_FLAGS],
      }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.updates.length).toBe(1);
    const rows = await heldAutonomyRecords({ port: h.deps.autonomy });
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      bySession: NOTE.bySession,
      doneIso: "2026-10-01T10:00:00.000Z",
      kind: "linear-fields-update",
      said: NOTE.said,
      subject: "https://linear.test/FFFF-7313",
      why: NOTE.why,
    });
    expect(row.actionId).toMatch(/^linear-ffff-7313-[0-9a-f]{12}$/u);
    expect((row as { witness: string }).witness).toBe(
      `slopweaver linear issue -> updated FFFF-7313; fields sent: stateId; ${LINEAR_ROLLBACK}`,
    );
    expect(h.out).toContain(`autonomy: ${row.actionId} recorded (linear-fields-update)`);
  });

  it("refuses an unasked closure before anything is sent, and records nothing", async () => {
    const home = tempHome();
    const h = harness({ form: formText({ fields: { stateId: "state-done" } }) });

    const code = await runLinearIssue({
      argv: argv({
        rest: ["update", "--form", "-", "--issue-id", FILED_ID, "--fields-only", "--home", home, ...UNASKED_FLAGS],
      }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.updates).toEqual([]);
    expect(h.err.join("\n")).toContain("a closure waits on their word");
    expect(await heldAutonomyRecords({ port: h.deps.autonomy })).toEqual([]);
  });

  it("prints the hand-record command for a create that may have landed but could not be read back", async () => {
    const home = tempHome();
    const h = harness({ form: formText({ fields: {} }) });
    const api = h.deps.makeApi({ home: "/nonexistent-home", token: "lin_api_fake" });
    const deps: LinearWriteDeps = {
      ...h.deps,
      makeApi: () => ({ ...api, createIssue: ({ id }) => okAsync({ id }), readIssue: () => okAsync(undefined) }),
    };

    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home, ...UNASKED_FLAGS] }),
      deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain(
      "record it by hand: slopweaver autonomy record --action-id <id> --kind linear-issue-create-unconfirmed",
    );
    expect(await heldAutonomyRecords({ port: deps.autonomy })).toEqual([]);
  });

  it("refuses --unasked missing an account at parse time", async () => {
    const home = tempHome();
    const h = harness({ form: formText({ fields: { stateId: "state-progress" } }) });

    const code = await runLinearIssue({
      argv: argv({
        rest: ["update", "--form", "-", "--issue-id", FILED_ID, "--fields-only", "--home", home, "--unasked"],
      }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.updates).toEqual([]);
  });
});

describe("--rewrite-filed replaces a filed ticket's body only at the instant it was read", () => {
  it("rewrites the body when updatedAt still matches, and records a body rewrite", async () => {
    const home = tempHome();
    const h = harness({ form: formText({ fields: {} }) });

    const code = await runLinearIssue({
      argv: argv({
        rest: [
          "update",
          "--form",
          "-",
          "--issue-id",
          FILED_ID,
          "--rewrite-filed",
          "--expect-updated-at",
          READ_AT,
          "--home",
          home,
          ...UNASKED_FLAGS,
        ],
      }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.updates.length).toBe(1);
    expect(h.updates[0]!["title"]).toBe("Rebuild the staging pool alert");
    expect((await heldAutonomyRecords({ port: h.deps.autonomy }))[0]).toMatchObject({ kind: "linear-body-rewrite" });
  });

  it("refuses when the ticket moved since it was read", async () => {
    const home = tempHome();
    const h = harness({ form: formText({ fields: {} }) });

    const code = await runLinearIssue({
      argv: argv({
        rest: [
          "update",
          "--form",
          "-",
          "--issue-id",
          FILED_ID,
          "--rewrite-filed",
          "--expect-updated-at",
          "2026-10-01T08:59:00.000Z",
          "--home",
          home,
        ],
      }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.updates).toEqual([]);
    expect(h.err).toEqual([
      `FFFF-7313 changed since you read it: updatedAt is ${READ_AT}, not 2026-10-01T08:59:00.000Z. ` +
        "Re-read it and rebuild the form from what it says now.",
    ]);
  });
});

/** A fields-only update of the filed ticket, as `./run.ts` would hand the effect phase. */
const UPDATE_ARGS: LinearIssueArgs = {
  dryRun: false,
  fieldsOnly: true,
  formSource: "-",
  home: undefined,
  issueId: FILED_ID,
  json: false,
  mentionIds: new Map(),
  moveTeam: false,
  rewriteFiled: undefined,
  unasked: undefined,
  verb: "update",
};

function writeContext({ home, args }: { home: string; args: Partial<LinearIssueArgs> }): {
  ctx: WriteContext;
  out: string[];
  err: string[];
} {
  const h = harness({ form: formText({ fields: {} }) });
  const ctx: WriteContext = {
    api: h.deps.makeApi({ home: "/nonexistent-home", token: "lin_api_fake" }),
    args: { ...UPDATE_ARGS, ...args },
    assigneeId: undefined,
    deps: h.deps,
    description: "do the thing, properly",
    fields: { ...FIELDS, stateId: "state-progress" },
    home,
    id: FILED_ID,
  };
  return { ctx, err: h.err, out: h.out };
}

describe("the effect phase, called directly", () => {
  it("inputFor sends a fields-only update's fields and no body", () => {
    const { ctx } = writeContext({ args: {}, home: tempHome() });

    expect(inputFor({ ctx })).toEqual({ stateId: "state-progress" });
  });

  it("updatePrecheck clears a rewrite-filed update read at the issue's own updatedAt, naming what it read", async () => {
    const { ctx } = writeContext({
      args: { fieldsOnly: false, rewriteFiled: { expectUpdatedAt: READ_AT } },
      home: tempHome(),
    });

    expect(await updatePrecheck({ ctx })).toEqual({ before: READ, kind: "clear" });
  });

  it("journalUnasked records nothing for a create the ledger refused as a duplicate, and says so", async () => {
    const home = tempHome();
    const { ctx, out } = writeContext({ args: { verb: "create" }, home });

    const code = await journalUnasked({
      before: undefined,
      ctx,
      note: NOTE,
      outcome: { kind: "duplicate", reservedIso: "2026-10-01T09:30:00.000Z" },
    });

    expect(code).toBe(undefined);
    expect(out).toEqual(["autonomy: no row written — the duplicate create sent nothing that stands"]);
    expect(await heldAutonomyRecords({ port: ctx.deps.autonomy })).toEqual([]);
  });

  it("journalUnasked records an update whose outcome is unknown under the -unconfirmed kind, naming the read", async () => {
    const home = tempHome();
    const { ctx } = writeContext({ args: {}, home });

    const code = await journalUnasked({
      before: READ,
      ctx,
      note: NOTE,
      outcome: { id: FILED_ID, kind: "unconfirmed" },
    });

    expect(code).toBe(undefined);
    expect((await heldAutonomyRecords({ port: ctx.deps.autonomy }))[0]).toMatchObject({
      kind: "linear-fields-update-unconfirmed",
      subject: READ.url,
    });
  });
});
