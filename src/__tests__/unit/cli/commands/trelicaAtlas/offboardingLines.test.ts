/**
 * The human offboarding view's two judgements a reader relies on: who is NAMED (a clean run is named only when a
 * live Identity account says it is not the whole story), and how a workflow nobody runs reads.
 */
import { describe, expect, it } from "vitest";

import type { HeldTrelicaWorkflow } from "../../../../../atlas/trelica/heldDetails.js";
import { trelicaOffboardingReport } from "../../../../../atlas/trelica/offboardingEvidence.js";
import { trelicaOffboardingLines } from "../../../../../cli/commands/trelicaAtlas/offboardingLines.js";
import { configuredStep, identityAccount, person, run, workflow } from "../../../atlas/trelica/offboardingFixtures.js";

const AS_OF = "2026-10-14T00:00:00.000Z";

/**
 * Two leavers each with one clean run, only the second still holding a live Identity account, and an active person
 * an aborted run names.
 */
function lines(): string[] {
  const report = trelicaOffboardingReport({
    asOf: AS_OF,
    input: {
      people: [
        person({ accounts: [identityAccount({ deleted: false, suspended: null })], id: "p1", name: "Ada Leaver" }),
        person({ accounts: [identityAccount({ deleted: false, suspended: false })], id: "p2", name: "Bo Leaver" }),
        person({ id: "p3", name: "Cy Rehired", status: "Active" }),
      ],
      runs: [
        run({ createdAt: "2026-10-01T00:00:00.000Z", id: "r1", personId: "p1", workflowId: "w1" }),
        run({ createdAt: "2026-10-02T00:00:00.000Z", id: "r2", personId: "p2", workflowId: "w1" }),
        run({
          createdAt: "2026-10-03T00:00:00.000Z",
          id: "r3",
          personId: "p3",
          uiStatus: "Terminated",
          workflowId: "w1",
        }),
      ],
      unreadable: 0,
      workflows: [
        workflow({ id: "w1", name: "Leaver flow" }),
        {
          ...workflow({ enabled: false, id: "w2", name: "Old flow" }),
          archived: true,
          trigger: {
            activityType: "PersonLeavesTrigger",
            leavingDateDaysOffset: -1,
            name: "Person leaves",
            personTypes: ["Employee"],
            requireApproval: true,
          },
        },
      ],
    },
  });
  return trelicaOffboardingLines({ inputs: [], report });
}

describe("trelicaOffboardingLines", () => {
  it("names a clean leaver only when a live Identity account remains, never one whose account state is unset", () => {
    const printed = lines();

    expect(printed[0]).toBe(
      `trelica offboarding evidence as of ${AS_OF} — 2 offboarding workflow(s); 2 people: run-stuck 0, run-failed 0, ` +
        "no-observed-run 0, run-aborted 0, run-completed-with-errors 0, unknown 0, run-clean 2",
    );
    expect(printed.slice(-6, -3)).toEqual([
      "evidence needing a look — 1 current leaver(s), Terminated or with a due leaving date (a run's states record " +
        "what the workflow executed, not what a provider now holds):",
      "  run-clean — Bo Leaver <p2@example.test> [Terminated], 1 run(s); live Identity account(s): Google Workspace",
      '      run-clean — "Leaver flow" 2026-10-02T00:00:00.000Z Completed at "End"',
    ]);
  });

  it("lists an active person a run names apart from the leavers, with what their record says", () => {
    expect(lines().slice(-3)).toEqual([
      "not counted as leavers — 1 people an offboarding run names whose current record does not say they have " +
        "left; to interpret, never to remediate:",
      "  run-aborted — Cy Rehired <p3@example.test> [Active, not-a-leaver], 1 run(s)",
      '      run-aborted — "Leaver flow" 2026-10-03T00:00:00.000Z Terminated at "End"',
    ]);
  });

  it("reads a disabled, archived workflow nobody ran as never run, with no outcome lines under it", () => {
    const printed = lines();
    const at = printed.findIndex((line) => line.startsWith('workflow "Old flow"'));

    expect(printed.slice(at, at + 5)).toEqual([
      'workflow "Old flow" — disabled, archived, Offboarding, trigger Person leaves (leaving date -1 days; for ' +
        "Employee; approval: yes), v3; 0 run(s) touching 0 people, never run",
      "  configured in v3, in order, each with what runs recorded under its id:",
      "    1. Suspend user via Google Workspace [continues on error] {action Suspend}: no held run recorded it",
      "    2. Remove from groups via Google Workspace {removes from every group: yes}: no held run recorded it",
      "evidence needing a look — 1 current leaver(s), Terminated or with a due leaving date (a run's states record " +
        "what the workflow executed, not what a provider now holds):",
    ]);
  });
});

/** The printed lines of one workflow nobody ran, from its header to its last configured step. */
function workflowLinesOf({ held }: { held: HeldTrelicaWorkflow }): string[] {
  const report = trelicaOffboardingReport({
    asOf: AS_OF,
    input: { people: [], runs: [], unreadable: 0, workflows: [held] },
  });
  const printed = trelicaOffboardingLines({ inputs: [], report });
  const at = printed.findIndex((line) => line.startsWith("workflow "));
  return printed.slice(at, at + 2 + held.steps.length);
}

describe("trelicaOffboardingLines configured behaviour", () => {
  const base = workflow({ id: "w1", name: "Leaver flow" });

  it("prints two workflows apart that differ only in who the trigger fires for", () => {
    const wider = workflow({ id: "w1", name: "Leaver flow", personTypes: ["Contractor", "Employee"] });
    expect(workflowLinesOf({ held: base })[0]).toContain("(leaving date +0 days; for Employee; approval: no)");
    expect(workflowLinesOf({ held: wider })[0]).toContain(
      "(leaving date +0 days; for Contractor, Employee; approval: no)",
    );
  });

  it("prints two workflows apart that differ only in whether the trigger waits for approval", () => {
    const approved = workflow({ id: "w1", name: "Leaver flow", requireApproval: true });
    expect(workflowLinesOf({ held: base })[0]).toContain("; approval: no)");
    expect(workflowLinesOf({ held: approved })[0]).toContain("; approval: yes)");
  });

  it("prints two group steps apart that differ only in whether they strip every group", () => {
    const groupStep = ({ all }: { all: boolean }) =>
      workflow({
        id: "w1",
        name: "Leaver flow",
        steps: [
          { ...configuredStep({ activityType: "RemoveFromGroup", name: "Remove groups" }), removeAllGroups: all },
        ],
      });
    expect(workflowLinesOf({ held: groupStep({ all: true }) })[2]).toBe(
      "    1. Remove groups via Google Workspace {removes from every group: yes}: no held run recorded it",
    );
    expect(workflowLinesOf({ held: groupStep({ all: false }) })[2]).toBe(
      "    1. Remove groups via Google Workspace {removes from every group: no}: no held run recorded it",
    );
  });
});
