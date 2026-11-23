/**
 * The offboarding evidence view over synthetic held entities: what each run is evidence of, how a person's
 * findings fold across workflows, which leavers without a run are named and which only counted, and how the inputs
 * reconcile.
 */
import { describe, expect, it } from "vitest";

import { trelicaOffboardingReport } from "../../../../atlas/trelica/offboardingEvidence.js";
import { trelicaIdentityAccountState, trelicaRunVerdict } from "../../../../atlas/trelica/offboardingVerdicts.js";
import { trelicaOffboardingWorkflowEvidence } from "../../../../atlas/trelica/offboardingWorkflows.js";

import { configuredStep, identityAccount, person, run, step, workflow } from "./offboardingFixtures.js";

const AS_OF = "2026-10-15T00:00:00.000Z";
const LEAVER_FLOW = workflow({ id: "wf-leave", name: "Offboard employee" });

describe("trelicaRunVerdict", () => {
  const cases: readonly {
    uiStatus: string;
    status?: string;
    steps?: Parameters<typeof run>[0]["steps"];
    want: string;
  }[] = [
    { uiStatus: "Terminated", want: "run-aborted" },
    { uiStatus: "Failed", want: "run-failed" },
    { uiStatus: "WaitingForUser", want: "run-stuck" },
    { uiStatus: "NeedsInput", want: "run-stuck" },
    { status: "Blocked", uiStatus: "Completed", want: "run-stuck" },
    { uiStatus: "Completed", want: "run-clean" },
    {
      steps: [step({ name: "Suspend user", status: "SkippedWithError" })],
      uiStatus: "Completed",
      want: "run-completed-with-errors",
    },
    {
      steps: [step({ name: "Suspend user", status: "Blocked" })],
      uiStatus: "Completed",
      want: "run-completed-with-errors",
    },
    { uiStatus: "CompletedWithErrors", want: "run-completed-with-errors" },
    { steps: null, uiStatus: "Completed", want: "unknown" },
    { steps: null, uiStatus: "CompletedWithErrors", want: "run-completed-with-errors" },
    { uiStatus: "Active", want: "unknown" },
  ];

  it.each(cases)("reads uiStatus $uiStatus (status $status) as $want", ({ uiStatus, status, steps, want }) => {
    const subject = run({
      createdAt: AS_OF,
      id: "r1",
      personId: "p1",
      uiStatus,
      workflowId: "wf",
      ...(status === undefined ? {} : { status }),
      ...(steps === undefined ? {} : { steps }),
    });

    expect(trelicaRunVerdict({ run: subject })).toBe(want);
  });
});

describe("trelicaIdentityAccountState", () => {
  it("calls an account live only when the platform says outright it is neither suspended nor deleted", () => {
    const subject = person({
      accounts: [
        identityAccount({ deleted: false, source: "Live", suspended: false }),
        identityAccount({ deleted: false, source: "Unset", suspended: null }),
        identityAccount({ deleted: false, source: "Suspended", suspended: true }),
        identityAccount({ deleted: true, source: "Deleted", suspended: null }),
      ],
      id: "p1",
      name: "Ada",
    });

    expect(trelicaIdentityAccountState({ person: subject })).toEqual({ live: ["Live"], unknown: ["Unset"] });
  });

  it("reads nothing for a person who is not Terminated", () => {
    const subject = person({
      accounts: [identityAccount({ deleted: false, suspended: false })],
      id: "p1",
      name: "Ada",
      status: "Active",
    });

    expect(trelicaIdentityAccountState({ person: subject })).toEqual({ live: [], unknown: [] });
  });
});

describe("trelicaOffboardingReport — findings", () => {
  it("keeps a stuck run of one workflow when another workflow's later run came back clean", () => {
    const other = workflow({ flowType: "Custom", id: "wf-other", name: "Revoke apps" });
    const report = trelicaOffboardingReport({
      asOf: AS_OF,
      input: {
        people: [person({ id: "p1", name: "Ada" })],
        runs: [
          run({
            createdAt: "2026-10-01T00:00:00Z",
            id: "r-stuck",
            personId: "p1",
            uiStatus: "WaitingForUser",
            workflowId: "wf-leave",
          }),
          run({ createdAt: "2026-10-02T00:00:00Z", id: "r-clean", personId: "p1", workflowId: "wf-other" }),
        ],
        unreadable: 0,
        workflows: [LEAVER_FLOW, other],
      },
    });

    expect(report.people.map((p) => [p.name, p.verdict, p.findings.map((f) => [f.runId, f.verdict])])).toEqual([
      [
        "Ada",
        "run-stuck",
        [
          ["r-clean", "run-clean"],
          ["r-stuck", "run-stuck"],
        ],
      ],
    ]);
  });

  it("keeps an older run still open behind a newer run of the same workflow, marked superseded", () => {
    const report = trelicaOffboardingReport({
      asOf: AS_OF,
      input: {
        people: [person({ id: "p1", name: "Ada" })],
        runs: [
          run({
            createdAt: "2026-10-01T00:00:00Z",
            id: "r-open",
            personId: "p1",
            uiStatus: "NeedsInput",
            workflowId: "wf-leave",
          }),
          run({ createdAt: "2026-10-03T00:00:00Z", id: "r-new", personId: "p1", workflowId: "wf-leave" }),
        ],
        unreadable: 0,
        workflows: [LEAVER_FLOW],
      },
    });

    expect(report.people[0]!.verdict).toBe("run-stuck");
    expect(report.people[0]!.findings.map((f) => [f.runId, f.superseded])).toEqual([
      ["r-new", false],
      ["r-open", true],
    ]);
  });

  it("lets a clean re-run of the same workflow supersede an earlier failure", () => {
    const report = trelicaOffboardingReport({
      asOf: AS_OF,
      input: {
        people: [person({ id: "p1", name: "Ada" })],
        runs: [
          run({
            createdAt: "2026-10-01T00:00:00Z",
            id: "r-fail",
            personId: "p1",
            uiStatus: "Failed",
            workflowId: "wf-leave",
          }),
          run({ createdAt: "2026-10-02T00:00:00Z", id: "r-ok", personId: "p1", workflowId: "wf-leave" }),
        ],
        unreadable: 0,
        workflows: [LEAVER_FLOW],
      },
    });

    expect(report.people.map((p) => [p.verdict, p.runs, p.findings.map((f) => f.runId)])).toEqual([
      ["run-clean", 2, ["r-ok"]],
    ]);
  });

  it("names each adverse step with its status and message, the trigger by name", () => {
    const report = trelicaOffboardingReport({
      asOf: AS_OF,
      input: {
        people: [person({ id: "p1", name: "Ada" })],
        runs: [
          run({
            createdAt: "2026-10-01T00:00:00Z",
            id: "r1",
            personId: "p1",
            steps: [
              step({ name: null, status: "Completed" }),
              step({ failureMessage: "flow_general_error", name: "Suspend user", status: "Failed" }),
              step({ name: "Remove from groups", status: "Skipped" }),
            ],
            uiStatus: "CompletedWithErrors",
            workflowId: "wf-leave",
          }),
        ],
        unreadable: 0,
        workflows: [LEAVER_FLOW],
      },
    });

    expect(report.people[0]!.findings[0]!.adverseSteps).toEqual([
      { message: "flow_general_error", status: "Failed", step: "Suspend user" },
    ]);
  });
});

describe("trelicaOffboardingReport — leavers without a run", () => {
  const firstRun = run({ createdAt: "2026-06-01T00:00:00Z", id: "r0", personId: "p0", workflowId: "wf-leave" });
  const report = trelicaOffboardingReport({
    asOf: AS_OF,
    input: {
      people: [
        person({ id: "p0", name: "Ran" }),
        person({ id: "p1", name: "In window", removedDate: "2026-07-01T00:00:00" }),
        person({ id: "p2", name: "No date" }),
        person({ id: "p3", leavingDate: "2026-01-01T00:00:00", name: "Before first run" }),
        person({ id: "p4", leaver: true, leavingDate: "2026-12-01T00:00:00", name: "Future", status: "Active" }),
        person({ accounts: [identityAccount({ deleted: false, suspended: false })], id: "p5", name: "Residue" }),
        person({ id: "p6", name: "Staying", status: "Active" }),
      ],
      runs: [firstRun],
      unreadable: 0,
      workflows: [LEAVER_FLOW],
    },
  });

  it("names one whose removal fell inside the window, and one still holding a live Identity account", () => {
    expect(report.people.map((p) => [p.name, p.verdict, p.identity.live])).toEqual([
      ["In window", "no-observed-run", []],
      ["Residue", "no-observed-run", ["Google Workspace"]],
      ["Ran", "run-clean", []],
    ]);
  });

  it("counts, without naming, one with no date and one who left before the first run; a future leaver is neither", () => {
    expect(report.reconciliation).toEqual({
      leaversBeforeFirstRun: 1,
      leaversWithoutDate: 1,
      runsNamingUnknownPeople: 0,
      runsWithoutPerson: 0,
      runsWithoutSteps: 0,
    });
  });

  it("counts every verdict, zero included", () => {
    expect(report.verdictCounts).toEqual({
      "no-observed-run": 2,
      "run-aborted": 0,
      "run-clean": 1,
      "run-completed-with-errors": 0,
      "run-failed": 0,
      "run-stuck": 0,
      unknown: 0,
    });
  });
});

describe("trelicaOffboardingReport — who counts as a leaver", () => {
  const ranFor = ({ personId }: { personId: string }): ReturnType<typeof run> =>
    run({
      createdAt: "2026-10-01T00:00:00Z",
      id: `r-${personId}`,
      personId,
      uiStatus: "Terminated",
      workflowId: "wf-leave",
    });
  const report = trelicaOffboardingReport({
    asOf: AS_OF,
    input: {
      people: [
        person({ id: "p1", name: "Gone" }),
        person({ id: "p2", leaver: true, leavingDate: "2026-09-30T00:00:00", name: "Left on date", status: "Active" }),
        person({ id: "p3", name: "Rehired", status: "Active" }),
        person({ id: "p4", leaver: true, name: "Flagged, no date", status: "Active" }),
        person({ id: "p5", leaver: true, leavingDate: "2026-12-01T00:00:00", name: "Leaving later", status: "Active" }),
      ],
      runs: ["p1", "p2", "p3", "p4", "p5"].map((personId) => ranFor({ personId })),
      unreadable: 0,
      workflows: [LEAVER_FLOW],
    },
  });

  it("counts a person a run names as a leaver only when their own record says Terminated or a due date", () => {
    expect(report.people.map((p) => [p.name, p.standing])).toEqual([
      ["Gone", "terminated"],
      ["Left on date", "leaving-date-due"],
    ]);
  });

  it("lists everyone else a run names apart, with what their record says instead", () => {
    expect(report.notLeaving.map((p) => [p.name, p.standing, p.verdict])).toEqual([
      ["Flagged, no date", "leaver-without-date", "run-aborted"],
      ["Leaving later", "leaving-date-not-due", "run-aborted"],
      ["Rehired", "not-a-leaver", "run-aborted"],
    ]);
    expect(report.verdictCounts["run-aborted"]).toBe(2);
  });
});

describe("trelicaOffboardingReport — reconciliation and selection", () => {
  it("never re-joins a run on a name: an unknown id keeps the run's own name and a null status", () => {
    const report = trelicaOffboardingReport({
      asOf: AS_OF,
      input: {
        people: [person({ id: "p1", name: "Ada" })],
        runs: [
          run({ createdAt: "2026-10-01T00:00:00Z", id: "r1", personId: "ghost", workflowId: "wf-leave" }),
          run({ createdAt: "2026-10-01T00:00:00Z", id: "r2", personId: null, workflowId: "wf-leave" }),
          run({ createdAt: "2026-10-01T00:00:00Z", id: "r3", personId: "p1", steps: null, workflowId: "wf-leave" }),
        ],
        unreadable: 2,
        workflows: [LEAVER_FLOW],
      },
    });

    expect(report.people.map((p) => [p.name, p.status, p.verdict])).toEqual([["Ada", "Terminated", "unknown"]]);
    expect(report.notLeaving.map((p) => [p.name, p.status, p.standing])).toEqual([
      ["Run named ghost", null, "no-current-record"],
    ]);
    expect([report.reconciliation.runsNamingUnknownPeople, report.reconciliation.runsWithoutPerson]).toEqual([1, 1]);
    expect([report.reconciliation.runsWithoutSteps, report.unreadable]).toEqual([1, 2]);
  });

  it("selects by flowType or a leaver trigger, never by name, and keeps a never-run workflow", () => {
    const report = trelicaOffboardingReport({
      asOf: AS_OF,
      input: {
        people: [],
        runs: [],
        unreadable: 0,
        workflows: [
          LEAVER_FLOW,
          workflow({ flowType: "Custom", id: "wf-c", name: "Custom leaver" }),
          workflow({
            flowType: "Onboarding",
            id: "wf-on",
            name: "Offboard (misnamed onboarding)",
            trigger: "PersonJoinsTrigger",
          }),
        ],
      },
    });

    expect(report.workflows.map((w) => [w.name, w.runs, w.lastRun])).toEqual([
      ["Custom leaver", 0, null],
      ["Offboard employee", 0, null],
    ]);
  });
});

describe("trelicaOffboardingWorkflowEvidence", () => {
  it("tallies run and step outcomes, newest run last-run, and the commonest failure per step", () => {
    const evidence = trelicaOffboardingWorkflowEvidence({
      runs: [
        run({
          createdAt: "2026-10-01T00:00:00Z",
          id: "r1",
          personId: "p1",
          steps: [step({ failureMessage: "flow_general_error", name: "Suspend user", status: "Failed" })],
          uiStatus: "CompletedWithErrors",
          workflowId: "wf-leave",
        }),
        run({
          createdAt: "2026-10-02T00:00:00Z",
          id: "r2",
          personId: "p2",
          steps: [step({ failureMessage: "flow_general_error", name: "Suspend user", status: "Failed" })],
          uiStatus: "CompletedWithErrors",
          workflowId: "wf-leave",
        }),
        run({ createdAt: "2026-10-03T00:00:00Z", id: "r3", personId: "p1", steps: null, workflowId: "wf-leave" }),
        run({ createdAt: "2026-10-04T00:00:00Z", id: "r-elsewhere", personId: "p9", workflowId: "wf-other" }),
      ],
      workflow: LEAVER_FLOW,
    });

    expect(evidence.runs).toBe(3);
    expect(evidence.lastRun).toEqual({
      createdAt: "2026-10-03T00:00:00Z",
      id: "r3",
      person: "Run named p1",
      uiStatus: "Completed",
    });
    expect(evidence.outcomes).toEqual([
      { count: 2, value: "CompletedWithErrors" },
      { count: 1, value: "Completed" },
    ]);
    expect(evidence.steps.map((s) => [s.name, s.recorded])).toEqual([
      [
        "Suspend user",
        { commonestFailure: { count: 2, value: "flow_general_error" }, outcomes: [{ count: 2, value: "Failed" }] },
      ],
      ["Remove from groups", { commonestFailure: null, outcomes: [] }],
    ]);
    expect(evidence.retiredSteps).toEqual([]);
    expect([evidence.peopleTouched, evidence.runsWithoutSteps]).toEqual([2, 1]);
  });

  it("keeps two configured steps sharing a name apart by id, and a renamed or retired step by its own id", () => {
    const evidence = trelicaOffboardingWorkflowEvidence({
      runs: [
        run({
          createdAt: "2026-10-02T00:00:00Z",
          id: "r-new",
          personId: "p1",
          steps: [
            step({ name: "Send Slack message", status: "Completed", stepId: "s-a" }),
            step({ name: "Send Slack message", status: "Failed", stepId: "s-b" }),
            step({ name: "Archive user", status: "Completed", stepId: "s-old" }),
          ],
          workflowId: "wf-leave",
        }),
        run({
          createdAt: "2026-10-01T00:00:00Z",
          id: "r-old",
          personId: "p2",
          steps: [
            step({ name: "Notify team", status: "Completed", stepId: "s-a" }),
            step({ name: "Delete user", status: "Skipped", stepId: "s-old" }),
          ],
          workflowId: "wf-leave",
        }),
      ],
      workflow: workflow({
        id: "wf-leave",
        name: "Offboard employee",
        steps: [
          configuredStep({ id: "s-a", name: "Send Slack message" }),
          configuredStep({ id: "s-b", name: "Send Slack message" }),
        ],
      }),
    });

    expect(evidence.steps.map((s) => [s.id, s.name, s.recorded.outcomes])).toEqual([
      ["s-a", "Send Slack message", [{ count: 2, value: "Completed" }]],
      ["s-b", "Send Slack message", [{ count: 1, value: "Failed" }]],
    ]);
    expect(evidence.retiredSteps.map((s) => [s.stepId, s.name, s.recorded.outcomes])).toEqual([
      [
        "s-old",
        "Archive user",
        [
          { count: 1, value: "Completed" },
          { count: 1, value: "Skipped" },
        ],
      ],
    ]);
  });
});
