import { client, type v2 } from "@datadog/datadog-api-client";
import { describe, expect, it } from "vitest";

import type { ErrorTrackingState } from "../../../datadog/errorTracking.js";
import {
  issuesNotAt,
  moveIssues,
  planTriage,
  readIssueStates,
  type TriageApi,
  validateIssueIds,
} from "../../../datadog/errorTrackingTriage.js";
import {
  DatadogTriageErrors,
  isDatadogRefusal,
  movedBeforeOf,
  uncertainOf,
} from "../../../datadog/errorTrackingTriageErrors.js";
import { type ErrorTrackingIssueOps, sdkTriageApi } from "../../../datadog/errorTrackingTriageSdk.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DUPLICATE = "6d6d6d6d-4444-4444-8444-444444444444";
const GRAPHQL = "cbcbcbcb-5555-4555-a555-555555555555";
const INVALID_URL = "1a1a1a1a-6666-4666-b666-666666666666";

/**
 * A fake Error Tracking whose issue states are a map: `get` answers from it, `setState` writes it. `refuse`
 * names an issue whose move throws a 403, `sticky` one whose move is accepted and changes nothing, and
 * `unreadable` one whose lookup throws a 500, and `lost` one whose move is APPLIED and then throws, the way a
 * timed-out answer looks. An id absent from `states` answers 404. `onGet` runs before each lookup answers, so
 * a test can move an issue under the run the way another triager would, or fail one particular read.
 */
function fakeApi({
  states,
  refuse = [],
  sticky = [],
  unreadable = [],
  lost = [],
  onGet = () => undefined,
}: {
  states: Readonly<Record<string, ErrorTrackingState>>;
  refuse?: readonly string[];
  sticky?: readonly string[];
  unreadable?: readonly string[];
  lost?: readonly string[];
  onGet?: (request: { id: string; live: Map<string, ErrorTrackingState>; reads: number }) => void;
}): { api: TriageApi; moved: string[] } {
  const live = new Map(Object.entries(states));
  const moved: string[] = [];
  let reads = 0;
  return {
    api: {
      get: ({ id }) => {
        reads += 1;
        onGet({ id, live, reads });
        if (unreadable.includes(id)) {
          return Promise.reject(new client.ApiException(500, { errors: ["Internal"] }));
        }
        const state = live.get(id);
        if (state === undefined) {
          return Promise.resolve({ found: false });
        }
        return Promise.resolve({ found: true, state });
      },
      setState: ({ id, state }) => {
        if (refuse.includes(id)) {
          return Promise.reject(new client.ApiException(403, { errors: ["Forbidden"] }));
        }
        moved.push(id);
        if (!sticky.includes(id)) {
          live.set(id, state);
        }
        if (lost.includes(id)) {
          return Promise.reject(new Error("socket hang up"));
        }
        return Promise.resolve();
      },
    },
    moved,
  };
}

describe("validateIssueIds", () => {
  it("keeps every UUID, lower-cased, repeats dropped in the order given", () => {
    const ids = validateIssueIds({ ids: [DUPLICATE, GRAPHQL.toUpperCase(), DUPLICATE] });
    expect(unwrap(ids)).toEqual([DUPLICATE, GRAPHQL]);
  });

  it("refuses every id that is not a UUID, naming each", () => {
    const error = unwrapErr(validateIssueIds({ ids: [DUPLICATE, "6d6d6d6d", "../monitor/1"] }));
    expect(error).toEqual(DatadogTriageErrors.issueIdInvalid({ ids: ["6d6d6d6d", "../monitor/1"] }));
  });
});

describe("planTriage", () => {
  it("moves what is elsewhere and leaves what is already in the target state alone", () => {
    const plan = planTriage({
      rows: [
        { id: DUPLICATE, state: "OPEN" },
        { id: GRAPHQL, state: "ACKNOWLEDGED" },
        { id: INVALID_URL, state: "IGNORED" },
      ],
      target: "ACKNOWLEDGED",
    });
    expect(plan).toEqual({
      alreadyThere: [GRAPHQL],
      target: "ACKNOWLEDGED",
      toMove: [
        { id: DUPLICATE, state: "OPEN" },
        { id: INVALID_URL, state: "IGNORED" },
      ],
    });
  });

  it("plans nothing for an empty list", () => {
    expect(planTriage({ rows: [], target: "IGNORED" })).toEqual({ alreadyThere: [], target: "IGNORED", toMove: [] });
  });
});

describe("issuesNotAt", () => {
  it("names only the rows the read-back finds outside the target state", () => {
    const rows = [
      { id: DUPLICATE, state: "IGNORED" as const },
      { id: GRAPHQL, state: "OPEN" as const },
    ];
    expect(issuesNotAt({ rows, target: "IGNORED" })).toEqual([{ id: GRAPHQL, state: "OPEN" }]);
  });
});

describe("readIssueStates", () => {
  it("reads every issue in the order named", async () => {
    const { api } = fakeApi({ states: { [DUPLICATE]: "OPEN", [GRAPHQL]: "RESOLVED" } });
    const rows = await readIssueStates({ api, ids: [GRAPHQL, DUPLICATE], movedBefore: [] });
    expect(unwrap(rows)).toEqual([
      { id: GRAPHQL, state: "RESOLVED" },
      { id: DUPLICATE, state: "OPEN" },
    ]);
  });

  it("refuses an id Datadog answers 404 for, as an unknown issue", async () => {
    const { api } = fakeApi({ states: { [DUPLICATE]: "OPEN" } });
    const error = unwrapErr(await readIssueStates({ api, ids: [DUPLICATE, GRAPHQL], movedBefore: [] }));
    expect(error).toEqual(DatadogTriageErrors.issueUnknown({ id: GRAPHQL, movedBefore: [] }));
    expect(error.message).toBe(
      `Datadog has no Error Tracking issue ${GRAPHQL} on this site — 0 earlier move(s) were accepted and read back ` +
        "in the target state",
    );
  });

  it("refuses a lookup that answers neither found nor absent, naming the issue and the status", async () => {
    const { api } = fakeApi({ states: { [DUPLICATE]: "OPEN" }, unreadable: [DUPLICATE] });
    const error = unwrapErr(await readIssueStates({ api, ids: [DUPLICATE], movedBefore: [] }));
    expect(error.code).toBe("READ_FAILED");
    expect(error.message).toContain(`issue ${DUPLICATE}: HTTP 500`);
  });

  it("a failed read-back carries what the run had already moved, as the receipt", async () => {
    const { api } = fakeApi({ states: { [DUPLICATE]: "ACKNOWLEDGED" }, unreadable: [DUPLICATE] });
    const error = unwrapErr(await readIssueStates({ api, ids: [DUPLICATE], movedBefore: [DUPLICATE] }));
    expect(error.code).toBe("READ_FAILED");
    expect(movedBeforeOf({ error })).toEqual([DUPLICATE]);
    expect(error.message).toContain(
      `its state is unknown, and 1 earlier move(s) were accepted and read back in the target state (${DUPLICATE})`,
    );
  });
});

describe("moveIssues", () => {
  it("moves every planned issue and returns their ids", async () => {
    const { api, moved } = fakeApi({ states: { [DUPLICATE]: "OPEN", [GRAPHQL]: "OPEN" } });
    const plan = planTriage({
      rows: [
        { id: DUPLICATE, state: "OPEN" },
        { id: GRAPHQL, state: "OPEN" },
      ],
      target: "IGNORED",
    });
    expect(unwrap(await moveIssues({ api, plan }))).toEqual([DUPLICATE, GRAPHQL]);
    expect(moved).toEqual([DUPLICATE, GRAPHQL]);
  });

  it("stops at the first refusal and names what had already been moved", async () => {
    const { api, moved } = fakeApi({
      refuse: [GRAPHQL],
      states: { [DUPLICATE]: "OPEN", [GRAPHQL]: "OPEN", [INVALID_URL]: "OPEN" },
    });
    const plan = planTriage({
      rows: [
        { id: DUPLICATE, state: "OPEN" },
        { id: GRAPHQL, state: "OPEN" },
        { id: INVALID_URL, state: "OPEN" },
      ],
      target: "ACKNOWLEDGED",
    });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error.code).toBe("UPDATE_REJECTED");
    expect(error.message).toContain(`move Error Tracking issue ${GRAPHQL}: HTTP 403`);
    expect(error.message).toContain(`1 earlier move(s) were accepted and read back in the target state (${DUPLICATE})`);
    expect(movedBeforeOf({ error })).toEqual([DUPLICATE]);
    expect(moved).toEqual([DUPLICATE]);
  });

  it("leaves an issue that changed outside the run after the plan read it, and names what it had moved", async () => {
    const { api, moved } = fakeApi({
      onGet: ({ id, live }) => {
        if (id === GRAPHQL) {
          live.set(GRAPHQL, "RESOLVED");
        }
      },
      states: { [DUPLICATE]: "OPEN", [GRAPHQL]: "OPEN" },
    });
    const plan = planTriage({
      rows: [
        { id: DUPLICATE, state: "OPEN" },
        { id: GRAPHQL, state: "OPEN" },
      ],
      target: "IGNORED",
    });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error).toEqual(
      DatadogTriageErrors.stateChanged({ found: "RESOLVED", id: GRAPHQL, movedBefore: [DUPLICATE], planned: "OPEN" }),
    );
    expect(error.message).toBe(
      `Error Tracking issue ${GRAPHQL} was For Review when planned and is Resolved now, so it changed outside this run ` +
        `— this run sent it no move, and 1 earlier move(s) were accepted and read back in the target state (${DUPLICATE})`,
    );
    expect(moved).toEqual([DUPLICATE]);
  });

  it("a thrown PUT that applied is uncertain — its own lost answer looks like another's move", async () => {
    const { api } = fakeApi({ lost: [DUPLICATE], states: { [DUPLICATE]: "OPEN" } });
    const plan = planTriage({ rows: [{ id: DUPLICATE, state: "OPEN" }], target: "IGNORED" });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error.message).toBe(
      `the answer to moving Error Tracking issue ${DUPLICATE} was lost (socket hang up), so whether this run's ` +
        "move applied is unknown and it MAY have moved — 0 earlier move(s) were accepted and read back in the " +
        "target state",
    );
    expect(movedBeforeOf({ error })).toEqual([]);
    expect(uncertainOf({ error })).toEqual([DUPLICATE]);
  });

  it("a lost answer stays uncertain even when the issue reads back where the plan left it", async () => {
    const { api } = fakeApi({
      lost: [DUPLICATE],
      // Applied, then another triager puts it back before anything could read it: no read tells those apart.
      onGet: ({ id, live, reads }) => {
        if (reads === 2) {
          live.set(id, "OPEN");
        }
      },
      states: { [DUPLICATE]: "OPEN" },
    });
    const plan = planTriage({ rows: [{ id: DUPLICATE, state: "OPEN" }], target: "IGNORED" });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error.code).toBe("UPDATE_UNCONFIRMED");
    expect(uncertainOf({ error })).toEqual([DUPLICATE]);
  });

  it("Datadog's own 4xx refusal stays a refusal whatever another triager does to the issue", async () => {
    const { api } = fakeApi({
      onGet: ({ id, live, reads }) => {
        if (reads === 2) {
          live.set(id, "IGNORED");
        }
      },
      refuse: [DUPLICATE],
      states: { [DUPLICATE]: "OPEN" },
    });
    const plan = planTriage({ rows: [{ id: DUPLICATE, state: "OPEN" }], target: "IGNORED" });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error.code).toBe("UPDATE_REJECTED");
    expect(uncertainOf({ error })).toEqual([]);
  });

  it("a raced no-op counted moved is named as evidence, never as this run's doing, when a later move fails", async () => {
    const { api } = fakeApi({
      // Reads: DUPLICATE before its move, then its after-read — another triager moves it just before that one.
      onGet: ({ id, live, reads }) => {
        if (reads === 2) {
          live.set(id, "IGNORED");
        }
      },
      refuse: [GRAPHQL],
      states: { [DUPLICATE]: "OPEN", [GRAPHQL]: "OPEN" },
      sticky: [DUPLICATE],
    });
    const plan = planTriage({
      rows: [
        { id: DUPLICATE, state: "OPEN" },
        { id: GRAPHQL, state: "OPEN" },
      ],
      target: "IGNORED",
    });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error.message).toBe(
      `Datadog refused to move Error Tracking issue ${GRAPHQL}: HTTP 403 {"errors":["Forbidden"]} — 1 earlier ` +
        `move(s) were accepted and read back in the target state (${DUPLICATE})`,
    );
    expect(movedBeforeOf({ error })).toEqual([DUPLICATE]);
  });

  it("an accepted PUT read back in the target state counts moved even if another triager raced it — a postcondition", async () => {
    const { api } = fakeApi({
      onGet: ({ id, live, reads }) => {
        if (reads === 2) {
          live.set(id, "IGNORED");
        }
      },
      states: { [DUPLICATE]: "OPEN" },
      sticky: [DUPLICATE],
    });
    const plan = planTriage({ rows: [{ id: DUPLICATE, state: "OPEN" }], target: "IGNORED" });
    expect(unwrap(await moveIssues({ api, plan }))).toEqual([DUPLICATE]);
  });

  it("a lost answer part-way is uncertain, never called refused, and names the earlier move", async () => {
    const { api } = fakeApi({ lost: [GRAPHQL], states: { [DUPLICATE]: "OPEN", [GRAPHQL]: "OPEN" } });
    const plan = planTriage({
      rows: [
        { id: DUPLICATE, state: "OPEN" },
        { id: GRAPHQL, state: "OPEN" },
      ],
      target: "IGNORED",
    });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error).toEqual(
      DatadogTriageErrors.updateUnconfirmed({
        answer: { accepted: false, cause: new Error("socket hang up") },
        id: GRAPHQL,
        movedBefore: [DUPLICATE],
      }),
    );
    expect(error.message).toBe(
      `the answer to moving Error Tracking issue ${GRAPHQL} was lost (socket hang up), so whether this run's move ` +
        "applied is unknown and it MAY have moved — 1 earlier move(s) were accepted and read back in the target " +
        `state (${DUPLICATE})`,
    );
    expect(movedBeforeOf({ error })).toEqual([DUPLICATE]);
    expect(uncertainOf({ error })).toEqual([GRAPHQL]);
  });

  it("counts only Datadog's own 4xx as a refusal — a 408, a 5xx or no HTTP answer may have applied", () => {
    const refusals = [403, 404, 422, 408, 500, 503].map((code) => ({
      code,
      refusal: isDatadogRefusal({ cause: new client.ApiException(code, {}) }),
    }));
    expect(refusals).toEqual([
      { code: 403, refusal: true },
      { code: 404, refusal: true },
      { code: 422, refusal: true },
      { code: 408, refusal: false },
      { code: 500, refusal: false },
      { code: 503, refusal: false },
    ]);
    expect(isDatadogRefusal({ cause: new Error("ETIMEDOUT") })).toBe(false);
  });

  it("an accepted move read back where the plan left it is uncertain, never called a no-op", async () => {
    const { api, moved } = fakeApi({ states: { [DUPLICATE]: "OPEN" }, sticky: [DUPLICATE] });
    const plan = planTriage({ rows: [{ id: DUPLICATE, state: "OPEN" }], target: "ACKNOWLEDGED" });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error.code).toBe("UPDATE_UNCONFIRMED");
    expect(uncertainOf({ error })).toEqual([DUPLICATE]);
    expect(moved).toEqual([DUPLICATE]);
  });

  it("an accepted move that applied and was undone before the read straight after is uncertain", async () => {
    const { api } = fakeApi({
      // Reads: the pre-move read, then the after-read — the move applied, and is put back just before it.
      onGet: ({ id, live, reads }) => {
        if (reads === 2) {
          live.set(id, "OPEN");
        }
      },
      states: { [DUPLICATE]: "OPEN" },
    });
    const plan = planTriage({ rows: [{ id: DUPLICATE, state: "OPEN" }], target: "ACKNOWLEDGED" });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error.code).toBe("UPDATE_UNCONFIRMED");
    expect(uncertainOf({ error })).toEqual([DUPLICATE]);
  });

  it("an accepted move whose after-read fails is uncertain, not counted moved", async () => {
    const { api } = fakeApi({
      // Reads: the pre-move read, then the after-read fails.
      onGet: ({ reads }) => {
        if (reads === 2) {
          throw new Error("ETIMEDOUT");
        }
      },
      states: { [DUPLICATE]: "OPEN" },
    });
    const plan = planTriage({ rows: [{ id: DUPLICATE, state: "OPEN" }], target: "IGNORED" });
    const error = unwrapErr(await moveIssues({ api, plan }));
    expect(error.message).toBe(
      `Datadog accepted moving Error Tracking issue ${DUPLICATE}, but the read straight after did not show it in ` +
        "the target state, so whether this run's move applied is unknown and it MAY have moved — 0 earlier " +
        "move(s) were accepted and read back in the target state",
    );
    expect(movedBeforeOf({ error })).toEqual([]);
    expect(uncertainOf({ error })).toEqual([DUPLICATE]);
  });
});

describe("DatadogTriageErrors.notMoved", () => {
  it("names each issue left behind in the console's words, and what the run had moved", () => {
    const error = DatadogTriageErrors.notMoved({
      movedBefore: [DUPLICATE],
      stillElsewhere: [{ id: DUPLICATE, state: "OPEN" }],
      target: "ACKNOWLEDGED",
    });
    expect(error.message).toBe(
      `Datadog accepted every move, and the read-back finds 1 issue(s) not Reviewed: ${DUPLICATE} (For Review) ` +
        `— 1 earlier move(s) were accepted and read back in the target state (${DUPLICATE})`,
    );
  });
});

/** SDK operations as plain functions, recording each request the seam made. */
function fakeOps({ getIssue }: { getIssue: () => Promise<v2.IssueResponse> }): {
  ops: ErrorTrackingIssueOps;
  sent: v2.ErrorTrackingApiUpdateIssueStateRequest[];
} {
  const sent: v2.ErrorTrackingApiUpdateIssueStateRequest[] = [];
  return {
    ops: {
      getIssue,
      updateIssueState: (request) => {
        sent.push(request);
        return getIssue();
      },
    },
    sent,
  };
}

/** An `IssueResponse` carrying one state, built the way the SDK deserialises one. */
function issueResponse({
  state,
  id = DUPLICATE,
  type = "issue",
}: {
  state: string;
  id?: string;
  type?: string;
}): v2.IssueResponse {
  return { data: { attributes: { state }, id, type } } as unknown as v2.IssueResponse;
}

describe("sdkTriageApi", () => {
  it("reads the issue's state off the SDK's answer", async () => {
    const { ops } = fakeOps({ getIssue: () => Promise.resolve(issueResponse({ state: "IGNORED" })) });
    expect(await sdkTriageApi({ errorTracking: ops }).get({ id: DUPLICATE })).toEqual({
      found: true,
      state: "IGNORED",
    });
  });

  it("maps a 404 to an absent issue", async () => {
    const { ops } = fakeOps({
      getIssue: () => Promise.reject(new client.ApiException(404, { errors: ["Not found"] })),
    });
    expect(await sdkTriageApi({ errorTracking: ops }).get({ id: DUPLICATE })).toEqual({ found: false });
  });

  it("rethrows a 403 rather than reading it as absent", async () => {
    const { ops } = fakeOps({
      getIssue: () => Promise.reject(new client.ApiException(403, { errors: ["Forbidden"] })),
    });
    await expect(sdkTriageApi({ errorTracking: ops }).get({ id: DUPLICATE })).rejects.toThrow("HTTP-Code: 403");
  });

  it("throws on an answer carrying no recognisable state", async () => {
    const { ops } = fakeOps({ getIssue: () => Promise.resolve(issueResponse({ state: "SNOOZED" })) });
    await expect(sdkTriageApi({ errorTracking: ops }).get({ id: DUPLICATE })).rejects.toThrow(
      `the answer for ${DUPLICATE} is not an issue with a recognisable state`,
    );
  });

  it("throws on an answer that is not an issue resource", async () => {
    const { ops } = fakeOps({
      getIssue: () => Promise.resolve(issueResponse({ state: "OPEN", type: "error_tracking_search_result" })),
    });
    await expect(sdkTriageApi({ errorTracking: ops }).get({ id: DUPLICATE })).rejects.toThrow(
      `the answer for ${DUPLICATE} is not an issue with a recognisable state`,
    );
  });

  it("throws on an answer carrying no id", async () => {
    const idless = { data: { attributes: { state: "OPEN" }, type: "issue" } } as unknown as v2.IssueResponse;
    const { ops } = fakeOps({ getIssue: () => Promise.resolve(idless) });
    await expect(sdkTriageApi({ errorTracking: ops }).get({ id: DUPLICATE })).rejects.toThrow(
      `the answer for ${DUPLICATE} is not an issue with a recognisable state`,
    );
  });

  it("throws on an answer for another issue rather than reading its state as this one's", async () => {
    const { ops } = fakeOps({ getIssue: () => Promise.resolve(issueResponse({ id: GRAPHQL, state: "IGNORED" })) });
    await expect(sdkTriageApi({ errorTracking: ops }).get({ id: DUPLICATE })).rejects.toThrow(
      `the answer for ${DUPLICATE} is issue ${GRAPHQL}`,
    );
  });

  it("sends the PUT body the API documents: the issue id twice and the target state", async () => {
    const { ops, sent } = fakeOps({ getIssue: () => Promise.resolve(issueResponse({ state: "ACKNOWLEDGED" })) });
    await sdkTriageApi({ errorTracking: ops }).setState({ id: DUPLICATE, state: "ACKNOWLEDGED" });
    expect(sent).toEqual([
      {
        body: { data: { attributes: { state: "ACKNOWLEDGED" }, id: DUPLICATE, type: "error_tracking_issue" } },
        issueId: DUPLICATE,
      },
    ]);
  });
});
