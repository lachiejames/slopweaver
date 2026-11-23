/** `linear move-issues`'s shell: what a preview, a refused plan and an `--apply` call, in which order. */
import { describe, expect, it } from "vitest";

import {
  type IssueMoveInvocationResult,
  type LinearMoveIssuesDeps,
  moveIssueArgv,
  runLinearMoveIssues,
} from "../../../../../cli/commands/linear/moveIssuesRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../../live/linear/errors.js";
import type { LinearIssueMoveInputs } from "../../../../../live/linear/issueMoveRead.js";
import type { LinearIssueRow } from "../../../../../live/linear/issues.js";
import type { LinearStatesDocument } from "../../../../../live/linear/states.js";

/** A team with one Todo state. */
function team({ key }: { key: string }): LinearStatesDocument {
  return {
    members: [],
    readAtIso: "2026-10-24T09:00:00.000Z",
    source: "linear",
    states: [{ id: `${key}-todo`, name: "Todo", position: 0, type: "unstarted" }],
    team: { id: `team-${key}`, key, name: key },
    workspace: "acme",
  };
}

/** One movable SUP issue. */
function issue({ identifier }: { identifier: string }): LinearIssueRow {
  return {
    addedToProjectAt: null,
    archivedAt: null,
    assigneeId: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    creatorId: "me",
    cycleId: null,
    id: `id-${identifier}`,
    identifier,
    labelIds: [],
    parentId: null,
    projectId: null,
    stateId: "SUP-todo",
    teamId: "team-SUP",
    teamKey: "SUP",
    title: `title ${identifier}`,
    url: `https://linear.app/acme/issue/${identifier}`,
  };
}

/** What Linear holds: SUP-1..3 exist, anything else does not. */
const INPUTS: LinearIssueMoveInputs = {
  children: [],
  destination: team({ key: "SOPS" }),
  issues: [issue({ identifier: "SUP-1" }), issue({ identifier: "SUP-2" }), issue({ identifier: "SUP-3" })],
  sources: [team({ key: "SUP" })],
  viewer: { id: "me", name: "Me", url: "https://linear.app/me" },
};

/** Recording fakes; `exits` answers each issue invocation in turn, and an invocation past its end lands. */
function harness({ exits = [] }: { exits?: number[] } = {}) {
  const calls: string[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: LinearMoveIssuesDeps = {
    invokeIssue: ({ form, home, issueId }) => {
      calls.push(`issue:${issueId}:${form.fields.teamId}:${String(home)}`);
      const exitCode = exits.length > 0 ? exits.shift()! : EXIT_OK;
      const result: IssueMoveInvocationResult = {
        diagnostics: exitCode === EXIT_OK ? [] : ["door refused"],
        exitCode,
        output: ["inner line"],
      };
      return Promise.resolve(result);
    },
    readInputs: ({ destinationTeamKey, identifiers, home }) => {
      calls.push(`read:${destinationTeamKey}:${identifiers.join(",")}:${String(home)}`);
      return Promise.resolve(ok(INPUTS));
    },
    recordDestination: ({ document, home }) => {
      calls.push(`record:${document.team.key}:${String(home)}`);
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { calls, deps, diagnostics, out };
}

describe("runLinearMoveIssues", () => {
  it("previews with one read and nothing else", async () => {
    const h = harness();
    const code = await runLinearMoveIssues({ deps: h.deps, rest: ["--to", "SOPS", "--identifier", "SUP-1,SUP-2"] });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual(["read:SOPS:SUP-1,SUP-2:undefined"]);
    expect(h.out.at(-1)).toBe("preview only: re-run with --apply to move them");
  });

  it("applies nothing from a partial plan, not even the catalog", async () => {
    const h = harness();
    const code = await runLinearMoveIssues({
      deps: h.deps,
      rest: ["--to", "SOPS", "--identifier", "SUP-1,SUP-404", "--apply"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toEqual(["read:SOPS:SUP-1,SUP-404:undefined"]);
  });

  it("exits 3 when nothing would move", async () => {
    const h = harness();
    const code = await runLinearMoveIssues({
      deps: h.deps,
      rest: ["--to", "SOPS", "--identifier", "SUP-404", "--apply"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).toEqual(["read:SOPS:SUP-404:undefined"]);
  });

  it("records the destination once, then writes each move in order with --home carried through", async () => {
    const h = harness();
    const code = await runLinearMoveIssues({
      deps: h.deps,
      rest: ["--to", "SOPS", "--identifier", "SUP-2,SUP-1", "--apply", "--home", "/h"],
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual([
      "read:SOPS:SUP-2,SUP-1:/h",
      "record:SOPS:/h",
      "issue:id-SUP-2:team-SOPS:/h",
      "issue:id-SUP-1:team-SOPS:/h",
    ]);
  });

  it("stops at the first failed write and reports landed, failed and not attempted", async () => {
    const h = harness({ exits: [EXIT_OK, EXIT_EXPECTED_EMPTY] });
    const code = await runLinearMoveIssues({
      deps: h.deps,
      rest: ["--to", "SOPS", "--identifier", "SUP-1,SUP-2,SUP-3", "--apply"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls.filter((call) => call.startsWith("issue:"))).toEqual([
      "issue:id-SUP-1:team-SOPS:undefined",
      "issue:id-SUP-2:team-SOPS:undefined",
    ]);
    expect(h.out.slice(4, 7)).toEqual([
      "landed   SUP-1",
      "failed   SUP-2 (linear issue exited 3): door refused",
      "not attempted SUP-3",
    ]);
  });

  it("reports a write that throws as failed, says it may have landed, and attempts nothing after it", async () => {
    const h = harness();
    const deps: LinearMoveIssuesDeps = {
      ...h.deps,
      invokeIssue: (args) => {
        if (args.issueId === "id-SUP-2") {
          h.calls.push("issue:id-SUP-2:threw");
          return Promise.reject(new Error("issue ledger unwritable"));
        }
        return h.deps.invokeIssue(args);
      },
    };
    const code = await runLinearMoveIssues({
      deps,
      rest: ["--to", "SOPS", "--identifier", "SUP-1,SUP-2,SUP-3", "--apply"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls.filter((call) => call.startsWith("issue:"))).toEqual([
      "issue:id-SUP-1:team-SOPS:undefined",
      "issue:id-SUP-2:threw",
    ]);
    expect(h.out.slice(4, 7)).toEqual([
      "landed   SUP-1",
      "failed   SUP-2 (linear issue exited 1): the write threw (issue ledger unwritable); it may have landed, so re-read the issue before re-running",
      "not attempted SUP-3",
    ]);
  });

  it("still reports when the thrown value cannot be printed", async () => {
    const h = harness();
    const unprintable = new Error("never read");
    Object.defineProperty(unprintable, "message", {
      get: () => {
        throw new Error("message getter throws");
      },
    });
    const deps: LinearMoveIssuesDeps = { ...h.deps, invokeIssue: () => Promise.reject(unprintable) };
    const code = await runLinearMoveIssues({ deps, rest: ["--to", "SOPS", "--identifier", "SUP-1,SUP-2", "--apply"] });

    expect(code).toBe(EXIT_ERROR);
    expect(h.out.slice(3, 5)).toEqual([
      "failed   SUP-1 (linear issue exited 1): the write threw (a thrown value that could not be printed); it may have landed, so re-read the issue before re-running",
      "not attempted SUP-2",
    ]);
  });

  it("keeps --json one parseable document with the inner output inside it", async () => {
    const h = harness();
    await runLinearMoveIssues({ deps: h.deps, rest: ["--to", "SOPS", "--identifier", "SUP-1", "--apply", "--json"] });

    expect(h.out).toHaveLength(1);
    const document = JSON.parse(h.out[0]!) as { rows: { application: unknown }[] };
    expect(document.rows[0]!.application).toEqual({ output: ["inner line"], status: "landed" });
  });

  it("refuses bad arguments before any read", async () => {
    const h = harness();
    const code = await runLinearMoveIssues({ deps: h.deps, rest: ["--to", "SOPS"] });

    expect(code).toBe(EXIT_USAGE);
    expect(h.calls).toEqual([]);
    expect(h.diagnostics[0]).toBe("name the issues with --identifier <KEY-1,KEY-2,...>");
  });

  it("reports a failed live read and writes nothing", async () => {
    const h = harness();
    const deps: LinearMoveIssuesDeps = {
      ...h.deps,
      readInputs: () => Promise.resolve(err(LinearLiveErrors.readFailed({ message: "transport down" }))),
    };
    const code = await runLinearMoveIssues({ deps, rest: ["--to", "SOPS", "--identifier", "SUP-1", "--apply"] });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toEqual([]);
    expect(h.diagnostics).toEqual(["transport down"]);
  });
});

describe("moveIssueArgv", () => {
  it("is the full-length fields-only team move, the form on stdin", () => {
    expect(moveIssueArgv({ home: "/h", issueId: "id-1" })).toEqual([
      "node",
      "slopweaver",
      "linear",
      "issue",
      "update",
      "--issue-id",
      "id-1",
      "--fields-only",
      "--move-team",
      "--form",
      "-",
      "--home",
      "/h",
    ]);
  });
});
