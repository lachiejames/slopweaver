/**
 * The workflow-run projection over answers the real boundaries admit, each carrying a canary in a key the
 * boundary declares and never reads — a run variable, a step's request log and outputs, a step definition's
 * credentials. Each case asserts both halves: the parsed input carries the canary, and the held detail does not.
 */
import { describe, expect, it } from "vitest";

import {
  heldTrelicaProviderText,
  heldTrelicaState,
  reheldTrelicaEntity,
  TRELICA_PROVIDER_TEXT_WITHHELD,
  TRELICA_STATE_UNRECOGNISED,
} from "../../../../atlas/trelica/providerText.js";
import {
  trelicaRunDetailBoundary,
  trelicaWorkflowRunsBoundary,
  trelicaWorkflowVersionBoundary,
} from "../../../../atlas/trelica/workflowBoundaries.js";
import {
  trelicaRunSteps,
  trelicaVersionStepNames,
  trelicaWorkflowRunDetail,
} from "../../../../atlas/trelica/workflowProjection.js";
import { unwrap } from "../../../../lib/result.js";

const PASSWORD_CANARY = "canary-run-variable-password";
const REQUEST_LOG_CANARY = "canary-step-request-log";
const OUTPUTS_CANARY = "canary-step-outputs";
const CREDENTIAL_CANARY = "canary-step-credentials";

/** One historical definition version: a named suspend step carrying a credential it never shows. */
const version = unwrap(
  trelicaWorkflowVersionBoundary.parse({
    value: {
      activities: [
        { activityType: "SuspendUser", credentials: CREDENTIAL_CANARY, customName: "Suspend user", id: "a1" },
        { activityType: "RemoveFromGroups", fixedPassword: CREDENTIAL_CANARY, id: "a2", name: "Remove groups" },
      ],
      id: { id: "w1", version: 3 },
      name: "Leaver flow",
    },
  }),
);

/** One run's detail: a failed step whose message echoes a bearer token, and a trigger state named by nothing. */
const detail = unwrap(
  trelicaRunDetailBoundary.parse({
    value: {
      baseScope: { variables: { p1_password: PASSWORD_CANARY } },
      flowId: "w1",
      flowVersion: 3,
      id: "r1",
      states: [
        { activityId: "trigger", failureCount: 0, status: "Completed" },
        {
          activityId: "a1",
          apiRequestLog: [{ request: REQUEST_LOG_CANARY }],
          failureCount: 1,
          outputs: { value: OUTPUTS_CANARY },
          result: {
            failureMessage: "  401 from upstream: Bearer abcdefghijklmnopqrstuvwxyz  ",
            resultDtm: "2026-10-01T00:01:00Z",
            type: "Failure",
          },
          status: "Failed",
        },
      ],
    },
  }),
);

/** One run row from the run list, carrying a password variable in its scope. */
const row = unwrap(
  trelicaWorkflowRunsBoundary.parse({
    value: {
      items: [
        {
          baseScope: {
            person: { email: "p1@example.test", id: "p1", leavingDate: "2026-09-30", name: "Ada Leaver" },
            variables: { p1_password: PASSWORD_CANARY },
          },
          createdByUser: { email: "system@example.test", name: "Trelica" },
          createdDtm: "2026-10-01T00:00:00Z",
          currentStateName: "End",
          errorCount: 1,
          failedAndContinuedCount: 0,
          firedErrors: [{ activityId: "a1", firedAt: "2026-10-01T00:01:00Z", message: "flow_general_error" }],
          flowId: "w1",
          flowName: "Leaver flow",
          flowVersion: 3,
          id: "r1",
          lastModifiedDtm: "2026-10-01T00:02:00Z",
          manuallyTriggered: false,
          status: "Completed",
          uiStatus: "CompletedWithErrors",
        },
      ],
      resultsTruncated: false,
      total: 1,
    },
  }),
).items[0]!;

describe("trelicaRunSteps", () => {
  it("names each step from its own version, withholds a failure message of no known shape, and holds no request material", () => {
    const steps = trelicaRunSteps({ detail, stepNames: trelicaVersionStepNames({ version }) });

    expect(JSON.stringify(detail)).toContain(REQUEST_LOG_CANARY);
    expect(JSON.stringify(detail)).toContain(OUTPUTS_CANARY);
    expect(JSON.stringify(detail)).toContain(PASSWORD_CANARY);
    expect(steps).toEqual([
      { failureCount: 0, failureMessage: null, name: null, resultAt: null, status: "Completed", stepId: "trigger" },
      {
        failureCount: 1,
        failureMessage: TRELICA_PROVIDER_TEXT_WITHHELD,
        name: "Suspend user",
        resultAt: "2026-10-01T00:01:00Z",
        status: "Failed",
        stepId: "a1",
      },
    ]);
  });

  it("names a version step by its own name when it has no custom name, and holds no step credential", () => {
    const names = trelicaVersionStepNames({ version });

    expect(JSON.stringify(version)).toContain(CREDENTIAL_CANARY);
    expect([...names]).toEqual([
      ["a1", "Suspend user"],
      ["a2", "Remove groups"],
    ]);
  });
});

describe("trelicaWorkflowRunDetail", () => {
  it("holds the run's person and outcome and none of its scope variables", () => {
    const held = trelicaWorkflowRunDetail({ record: row, steps: null });

    expect(JSON.stringify(row)).toContain(PASSWORD_CANARY);
    expect(JSON.stringify(held)).not.toContain(PASSWORD_CANARY);
    expect(held.person).toEqual({ email: "p1@example.test", id: "p1", leavingDate: "2026-09-30", name: "Ada Leaver" });
    expect(held.firedErrors).toEqual([{ at: "2026-10-01T00:01:00Z", message: "flow_general_error" }]);
    expect(held.uiStatus).toBe("CompletedWithErrors");
    expect(held.steps).toBe(null);
  });

  it("holds a run or step state outside the measured set as unrecognised, never as written", () => {
    const record = { ...row, status: "hunter2", uiStatus: "hunter2" };
    const stepDetail = { ...detail, states: [{ activityId: "a1", failureCount: 0, status: "hunter2" }] };
    const held = trelicaWorkflowRunDetail({
      record,
      steps: trelicaRunSteps({ detail: stepDetail, stepNames: trelicaVersionStepNames({ version }) }),
    });

    expect(JSON.stringify({ record, stepDetail })).toContain("hunter2");
    expect(JSON.stringify(held)).not.toContain("hunter2");
    expect([held.uiStatus, held.status, held.steps![0]!.status]).toEqual([
      TRELICA_STATE_UNRECOGNISED,
      TRELICA_STATE_UNRECOGNISED,
      TRELICA_STATE_UNRECOGNISED,
    ]);
  });
});

describe("reheldTrelicaEntity", () => {
  it("re-holds every provider text in a stored run's detail and an integration's last error, keeping the rest", () => {
    const storedDetail = {
      blockedReason: "File not found: hunter2",
      firedErrors: [{ at: "2026-10-01T00:01:00Z", message: "login failed for hunter2" }],
      label: "Run named p1",
      lastError: "401: Unauthorized - hunter2",
      status: "hunter2",
      steps: [
        { failureMessage: "hunter2", name: "Suspend user", status: "hunter2" },
        { failureMessage: "flow_general_error", status: "Completed" },
      ],
      uiStatus: "hunter2",
    };
    const view = {
      channel: "first-party-api" as const,
      detail: storedDetail,
      firstSeenAt: "2026-10-01T00:00:00Z",
      lastSeenAt: "2026-10-01T00:00:00Z",
      source: null,
      state: "observed" as const,
    };
    const entity = {
      channels: { browser: null, "first-party-api": view, "published-api": null },
      id: "e1",
      kind: "workflow-run" as const,
      providerId: "r1",
    };

    expect(JSON.stringify(entity)).toContain("hunter2");
    expect(reheldTrelicaEntity({ entity }).channels["first-party-api"]!.detail).toEqual({
      blockedReason: TRELICA_PROVIDER_TEXT_WITHHELD,
      firedErrors: [{ at: "2026-10-01T00:01:00Z", message: TRELICA_PROVIDER_TEXT_WITHHELD }],
      label: "Run named p1",
      lastError: "401: Unauthorized",
      status: TRELICA_STATE_UNRECOGNISED,
      steps: [
        { failureMessage: TRELICA_PROVIDER_TEXT_WITHHELD, name: "Suspend user", status: TRELICA_STATE_UNRECOGNISED },
        { failureMessage: "flow_general_error", status: "Completed" },
      ],
      uiStatus: TRELICA_STATE_UNRECOGNISED,
    });
  });

  it("holds a person's status as Trelica sets it, because only a run's status is a run state", () => {
    const view = {
      channel: "first-party-api" as const,
      detail: { name: "Ada Leaver", status: "OnLeave" },
      firstSeenAt: "2026-10-01T00:00:00Z",
      lastSeenAt: "2026-10-01T00:00:00Z",
      source: null,
      state: "observed" as const,
    };
    const entity = {
      channels: { browser: null, "first-party-api": view, "published-api": null },
      id: "e2",
      kind: "person" as const,
      providerId: "p1",
    };

    expect(reheldTrelicaEntity({ entity }).channels["first-party-api"]!.detail).toEqual({
      name: "Ada Leaver",
      status: "OnLeave",
    });
  });
});

describe("heldTrelicaState", () => {
  it("holds each measured state as it stands", () => {
    const states = ["Completed", "CompletedWithErrors", "WaitingForUser", "SkippedWithError", "NotStarted"];

    expect(states.map((state) => heldTrelicaState({ state }))).toEqual(states);
  });

  it("holds a state of no measured value as unrecognised", () => {
    expect(heldTrelicaState({ state: "Completed hunter2" })).toBe(TRELICA_STATE_UNRECOGNISED);
  });
});

describe("heldTrelicaProviderText", () => {
  it("is null for no text and for only whitespace", () => {
    expect(heldTrelicaProviderText({ text: null })).toBe(null);
    expect(heldTrelicaProviderText({ text: "   " })).toBe(null);
  });

  it("holds each measured shape as it stands", () => {
    expect(
      ["flow_general_error", "API call returned 415 Unsupported Media Type", "AwaitingInput", "AwaitingUserInput"].map(
        (text) => heldTrelicaProviderText({ text }),
      ),
    ).toEqual([
      "flow_general_error",
      "API call returned 415 Unsupported Media Type",
      "AwaitingInput",
      "AwaitingUserInput",
    ]);
  });

  it("holds only the status line of an error that echoes its response body", () => {
    const text = '401: Unauthorized - {"password":"hunter2"}';

    expect(text).toContain("hunter2");
    expect(heldTrelicaProviderText({ text })).toBe("401: Unauthorized");
  });

  it("withholds a short secret no scrubber would recognise, even dressed as a code, a state or a status line", () => {
    const texts = [
      "login failed for hunter2",
      "API call returned 500 hunter2",
      "API call returned 500 Hunter",
      "401: Hunter - {}",
      "flow_error_hunter",
      "AwaitingHunter",
    ];

    expect(texts.every((text) => text.toLowerCase().includes("hunter"))).toBe(true);
    expect(texts.map((text) => heldTrelicaProviderText({ text }))).toEqual(
      texts.map(() => TRELICA_PROVIDER_TEXT_WITHHELD),
    );
  });
});
