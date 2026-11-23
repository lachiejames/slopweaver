import { err as errResult } from "neverthrow";
import { describe, expect, it } from "vitest";
import { runLinearIssue } from "../../../../../../cli/commands/linear/run.js";
import type { LinearWriteDeps } from "../../../../../../cli/commands/linear/writeDeps.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { AssigneeResolution } from "../../../../../../outbound/linear/assigneeIndex.js";
import { listIssueIds } from "../../../../../../outbound/linear/issueLedger.js";
import type { StateCatalog } from "../../../../../../outbound/linear/stateCatalog.js";
import { IdentityRosterErrors } from "../../../../../../silver/identityRosterErrors.js";
import { argv, harness, tempHome, useTempHomeCleanup } from "./harness.js";

const STORE_DOWN = IdentityRosterErrors.storeUnavailable({ doing: "read the roster", reason: "disk full" });

useTempHomeCleanup();

/**
 * The two DESTINATION gates: who the ticket is assigned to, and which workflow state it is filed into.
 *
 * Both run BEFORE the door, so what these pin is that a refusal costs no audit record, no reservation and no
 * mutation — a gate that fires after the write has already gone out is not a gate.
 */
describe("runLinearIssue destination gates", () => {
  const ASSIGNED_FORM = JSON.stringify({
    artifact: {
      aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
      kind: "structured",
      problem: [{ kind: "para", text: "It is broken." }],
      solution: [{ kind: "para", text: "Unbreak it." }],
    },
    fields: { assignee: "ada", teamId: "00000000-0000-4000-8000-000000000001", title: "A title" },
  });

  const STATED_FORM = JSON.stringify({
    artifact: {
      aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
      kind: "structured",
      problem: [{ kind: "para", text: "It is broken." }],
      solution: [{ kind: "para", text: "Unbreak it." }],
    },
    fields: { stateId: "s-todo", teamId: "00000000-0000-4000-8000-000000000001", title: "A title" },
  });

  const RESOLVED: AssigneeResolution = {
    held: false,
    roster: {
      addressableKeys: 4,
      collisions: [],
      derivedPeople: 1,
      freshness: { kind: "fresh" },
      heldPeople: 0,
    },
    target: { linearId: "L-ada", origin: "derived" },
  };

  const CATALOG: StateCatalog = {
    members: [{ displayName: "ada", id: "L-ada" }],
    readAtIso: "2026-08-26T09:00:00.000Z",
    states: [{ id: "s-todo", name: "Todo", type: "unstarted" }],
    teamId: "00000000-0000-4000-8000-000000000001",
    teamKey: "ENG",
  };

  it("sends the RESOLVED Linear user id, never the roster key the form named", async () => {
    const home = tempHome();
    const h = harness({ catalog: CATALOG, form: ASSIGNED_FORM, home, resolution: RESOLVED });

    expect(
      await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps }),
    ).toBe(EXIT_OK);
    expect(h.sentAssignee()).toBe("L-ada");
  });

  it("REFUSES an unresolvable assignee before the door, so nothing is reserved and nothing is sent", async () => {
    const home = tempHome();
    const h = harness({ form: ASSIGNED_FORM, home });

    expect(
      await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).toEqual(["token:same-home"]);
    expect(h.err.join("\n")).toContain('cannot assign "ada"');
    expect(listIssueIds({ home })).toEqual([]);
  });

  it("REFUSES the write, and names the store, when the identity roster cannot say who the assignee is", async () => {
    const home = tempHome();
    const h = harness({ catalog: CATALOG, form: ASSIGNED_FORM, home });
    const deps: LinearWriteDeps = { ...h.deps, resolveAssignee: async () => errResult(STORE_DOWN) };

    expect(await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(h.calls).toEqual(["token:same-home"]);
    expect(h.err).toEqual([STORE_DOWN.message]);
    expect(listIssueIds({ home })).toEqual([]);
  });

  it("exits ERROR on a dry run, printing nothing else, when the roster store cannot answer", async () => {
    const home = tempHome();
    const h = harness({ form: ASSIGNED_FORM, home });
    const deps: LinearWriteDeps = { ...h.deps, previewAssignee: async () => errResult(STORE_DOWN) };

    expect(
      await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }), deps }),
    ).toBe(EXIT_ERROR);
    expect(h.err).toEqual([STORE_DOWN.message]);
    expect(h.calls).toEqual([]);
  });

  it("REFUSES a stateId no read of that team has ever produced — the corpus is not a source", async () => {
    const home = tempHome();
    const h = harness({ form: STATED_FORM, home });

    expect(
      await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).toEqual(["token:same-home"]);
    expect(h.err.join("\n")).toContain("slopweaver linear states --team");
    expect(listIssueIds({ home })).toEqual([]);
  });

  it("accepts a stateId the catalog carries", async () => {
    const home = tempHome();
    const h = harness({ catalog: CATALOG, form: STATED_FORM, home });

    expect(
      await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps }),
    ).toBe(EXIT_OK);
  });

  it("reports BOTH refusals at once rather than sending the operator round twice", async () => {
    const home = tempHome();
    const both = JSON.stringify({
      artifact: {
        aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
        kind: "structured",
        problem: [{ kind: "para", text: "It is broken." }],
        solution: [{ kind: "para", text: "Unbreak it." }],
      },
      fields: { assignee: "nobody", stateId: "s-mangled", teamId: CATALOG.teamId, title: "A title" },
    });
    const h = harness({ catalog: CATALOG, form: both, home });

    expect(
      await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.length).toBe(2);
  });

  it("REFUSES an assignee the destination team cannot take", async () => {
    const home = tempHome();
    const h = harness({
      catalog: { ...CATALOG, members: [{ displayName: "grace", id: "L-grace" }] },
      form: ASSIGNED_FORM,
      home,
      resolution: RESOLVED,
    });

    expect(
      await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain("assignee L-ada is not among the 1 members read from team ENG");
  });

  it("a dry run previews the resolution and still performs no effect", async () => {
    const home = tempHome();
    const h = harness({ catalog: CATALOG, form: ASSIGNED_FORM, home, resolution: RESOLVED });

    expect(
      await runLinearIssue({
        argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
        deps: h.deps,
      }),
    ).toBe(EXIT_OK);
    expect(h.calls).toEqual([]);
    expect(h.out.join("\n")).toContain("assignee:  ada → L-ada");
  });

  it("a dry run says an unresolved key does not resolve YET, because the live run refreshes first", async () => {
    const home = tempHome();
    const h = harness({ form: ASSIGNED_FORM, home });

    await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });

    expect(h.out.join("\n")).toContain("ada → does not resolve YET");
  });
});
