/**
 * The `workflow-run` read over a fake client that answers by path and logs every path it was asked for: the run
 * list, each definition version read once however many runs ran it, each run's detail, and the refusals — a list
 * page the provider flagged as truncated, and an id this atlas will not place in a path.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { trelicaBoundaryRefusal } from "../../../../atlas/trelica/admission.js";
import { trelicaAiUsageCallId } from "../../../../atlas/trelica/aiUsage.js";
import type { TrelicaClient } from "../../../../atlas/trelica/client.js";
import { trelicaRunDetailCall, trelicaWorkflowVersionCall } from "../../../../atlas/trelica/entityInventory.js";
import { unreadTrelicaKind } from "../../../../atlas/trelica/entityList.js";
import { TrelicaAtlasErrors } from "../../../../atlas/trelica/errors.js";
import type { TrelicaCall } from "../../../../atlas/trelica/inventory.js";
import { TRELICA_PROVIDER_TEXT_WITHHELD } from "../../../../atlas/trelica/providerText.js";
import { readTrelicaRuns, reheldSteps } from "../../../../atlas/trelica/runSteps.js";
import { trelicaAtlasPaths } from "../../../../atlas/trelica/store.js";
import type { TrelicaBoundary } from "../../../../atlas/trelica/trelicaBoundary.js";
import { trelicaStepSchema } from "../../../../atlas/trelica/workflowStepSchemas.js";
import { err, ok } from "../../../../lib/result.js";

const AT = "2026-10-15T00:00:00.000Z";
const FLOW = "bbbbbbbbbbbbbbbbbbbbbbbb";
const RUN_A = "aaaaaaaaaaaaaaaaaaaaaaa1";
const RUN_B = "aaaaaaaaaaaaaaaaaaaaaaa2";
const RUN_PATH = "/FlowApi/FlowItem/FilterItems";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh home with no generation in it. */
function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "trelica-runs-"));
  homes.push(home);
  return home;
}

/** One run row, as the run list answers it. */
function runRow({ id, flowId }: { id: string; flowId: string }): unknown {
  return {
    baseScope: { person: { email: "p1@example.test", id: "p1", name: "Ada Leaver" } },
    createdByUser: { name: "Trelica" },
    createdDtm: "2026-10-01T00:00:00Z",
    currentStateName: "End",
    errorCount: 0,
    failedAndContinuedCount: 0,
    firedErrors: [],
    flowId,
    flowName: "Leaver flow",
    flowVersion: 3,
    id,
    lastModifiedDtm: "2026-10-01T00:02:00Z",
    manuallyTriggered: false,
    status: "Completed",
    uiStatus: "Completed",
  };
}

/** A client answering the run list with `runs`, every version and detail path it knows, and logging each path. */
function fakeClient({ runs, truncated = false }: { runs: readonly unknown[]; truncated?: boolean }): {
  client: TrelicaClient;
  asked: string[];
} {
  const asked: string[] = [];
  const answers = new Map<string, unknown>([
    [RUN_PATH, { items: runs, resultsTruncated: truncated, total: runs.length }],
    [
      `/FlowApi/Flow/${FLOW}/3`,
      { activities: [{ activityType: "SuspendUser", id: "s1" }], id: { id: FLOW, version: 3 }, name: "Leaver flow" },
    ],
    [
      `/FlowApi/FlowItem/${RUN_A}`,
      { flowId: FLOW, flowVersion: 3, id: RUN_A, states: [{ activityId: "s1", failureCount: 0, status: "Completed" }] },
    ],
    [
      `/FlowApi/FlowItem/${RUN_B}`,
      { flowId: FLOW, flowVersion: 3, id: RUN_B, states: [{ activityId: "s1", failureCount: 0, status: "Skipped" }] },
    ],
  ]);
  const refused = ({ callId }: { callId: string }) => TrelicaAtlasErrors.callRefused({ callId, statusCode: 403 });
  /** Answer one path's page through the row's boundary, the way the real client admits it. */
  const admitted = <T>({ call, boundary }: { call: TrelicaCall; boundary: TrelicaBoundary<T> }) => {
    asked.push(call.path);
    const answer = answers.get(call.path);
    if (answer === undefined) {
      return err(refused({ callId: call.id }));
    }
    const parsed = boundary.parse({ value: answer });
    if (parsed.isErr()) {
      return err(trelicaBoundaryRefusal({ callId: call.id, error: parsed.error }));
    }
    return ok({
      callId: call.id,
      httpMethod: call.httpMethod,
      pages: [parsed.value],
      path: call.path,
      statusCode: 200,
    });
  };
  return {
    asked,
    client: {
      call: async ({ call }) => err(refused({ callId: call.id })),
      list: async ({ call, boundary }) => admitted({ boundary, call }),
      one: async ({ call, boundary }) => admitted({ boundary, call }),
      usage: async ({ dimension }) => err(refused({ callId: trelicaAiUsageCallId({ dimension }) })),
    },
  };
}

describe("readTrelicaRuns", () => {
  it("reads each run's detail and its version's step names once, and names every step", async () => {
    const { client, asked } = fakeClient({
      runs: [runRow({ flowId: FLOW, id: RUN_A }), runRow({ flowId: FLOW, id: RUN_B })],
    });
    const { outcome, steps } = await readTrelicaRuns({
      at: AT,
      client,
      paths: trelicaAtlasPaths({ home: emptyHome() }),
    });

    expect(steps).toEqual({ firstFailure: null, read: 2, reused: 0, unread: 0 });
    expect(asked.toSorted()).toEqual([
      `/FlowApi/Flow/${FLOW}/3`,
      RUN_PATH,
      `/FlowApi/FlowItem/${RUN_A}`,
      `/FlowApi/FlowItem/${RUN_B}`,
    ]);
    expect(outcome.read.held).toBe(true);
    expect(JSON.stringify(outcome.read)).toContain(
      '"name":"SuspendUser","resultAt":null,"status":"Skipped","stepId":"s1"',
    );
    expect(outcome.read.reason).toBe(
      "2 run(s) of every workflow, with step-by-step outcomes for 2 (0 unchanged since the last sync)",
    );
  });

  it("keeps a run whose workflow id is not a record id, with no steps, and never reads a path for it", async () => {
    const { client, asked } = fakeClient({ runs: [runRow({ flowId: "../Flow/other", id: RUN_A })] });
    const { outcome, steps } = await readTrelicaRuns({
      at: AT,
      client,
      paths: trelicaAtlasPaths({ home: emptyHome() }),
    });

    expect(steps).toEqual({
      firstFailure: "workflow id ../Flow/other at version 3 is not a pair this atlas will place in a path",
      read: 0,
      reused: 0,
      unread: 1,
    });
    expect(asked).toEqual([RUN_PATH]);
    expect(outcome.read.reason).toBe(
      "1 run(s) of every workflow, with step-by-step outcomes for 0 (0 unchanged since the last sync)",
    );
  });

  it("refuses a run list the provider flagged as truncated, reading no detail", async () => {
    const { client, asked } = fakeClient({ runs: [runRow({ flowId: FLOW, id: RUN_A })], truncated: true });
    const { outcome } = await readTrelicaRuns({ at: AT, client, paths: trelicaAtlasPaths({ home: emptyHome() }) });

    expect(outcome).toEqual(
      unreadTrelicaKind({
        kind: "workflow-run",
        reasons: [`${RUN_PATH} flagged a page as truncated, so the list it answered is not the whole of it`],
      }),
    );
    expect(asked).toEqual([RUN_PATH]);
  });
});

describe("reheldSteps", () => {
  it("withholds a message an older generation held, and keeps a closed value as it stands", () => {
    const step = { failureCount: 1, name: "Suspend user", resultAt: null, status: "Failed", stepId: "a1" };
    const steps = [
      { ...step, failureMessage: "login failed for hunter2" },
      { ...step, failureMessage: "flow_general_error" },
      { ...step, failureMessage: null },
    ];

    expect(steps[0]!.failureMessage).toContain("hunter2");
    expect(reheldSteps({ steps }).map((held) => held.failureMessage)).toEqual([
      TRELICA_PROVIDER_TEXT_WITHHELD,
      "flow_general_error",
      null,
    ]);
  });
});

describe("the path-param reads", () => {
  it("place only a 24-hex record id and a whole version, a draft's negative one included, in a path", () => {
    expect(trelicaRunDetailCall({ runId: RUN_A })!.path).toBe(`/FlowApi/FlowItem/${RUN_A}`);
    expect(trelicaRunDetailCall({ runId: "../Flow/GetMany" })).toBe(null);
    expect(trelicaWorkflowVersionCall({ version: 3, workflowId: FLOW })!.path).toBe(`/FlowApi/Flow/${FLOW}/3`);
    expect(trelicaWorkflowVersionCall({ version: -1, workflowId: FLOW })!.path).toBe(`/FlowApi/Flow/${FLOW}/-1`);
    expect(trelicaWorkflowVersionCall({ version: 1.5, workflowId: FLOW })).toBe(null);
    expect(trelicaWorkflowVersionCall({ version: 3, workflowId: FLOW.toUpperCase() })).toBe(null);
  });
});

describe("trelicaStepSchema", () => {
  it("admits a declared secret-bearing key and refuses an undeclared one by name", () => {
    const step = { activityCategory: "Action", activityType: "Http", continueOnError: false, id: "s1" };

    expect(trelicaStepSchema.safeParse({ ...step, headers: { authorization: "x" } }).success).toBe(true);
    expect(trelicaStepSchema.safeParse({ ...step, newSetting: 1 }).error!.issues.map((issue) => issue.code)).toEqual([
      "unrecognized_keys",
    ]);
  });
});
