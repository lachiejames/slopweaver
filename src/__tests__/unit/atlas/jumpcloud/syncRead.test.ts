/**
 * The walk's two disagreements with its own registry, exercised over a fetch seam rather than a network.
 *
 * The paging-refusal half is here because it is what kept the whole JumpCloud atlas unpublishable: two
 * operations answered HTTP 500 to any query parameter while a bare request answered 200, and a 500 is
 * blocking by design, so three consecutive full syncs refused to publish on them.
 */
import { describe, expect, it } from "vitest";

import type { JumpcloudFetch } from "../../../../atlas/jumpcloud/client.js";
import { planJumpcloudKind } from "../../../../atlas/jumpcloud/plan.js";
import { admitJumpcloudPage } from "../../../../atlas/jumpcloud/responseRegistry.js";
import { actionForFailedPage, readJumpcloudOperation } from "../../../../atlas/jumpcloud/syncRead.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { admitAnyCarrier } from "../../../jumpcloudCarrierAdmit.js";

/** This run's instant, which only a windowed operation's pinned contract reads. */
const NOW = "2026-09-15T00:00:00.000Z";

/** A fetch seam that refuses any URL carrying a query, and answers a bare one. */
function refusesAQuery({ status, seen }: { status: number; seen: string[] }): JumpcloudFetch {
  return async ({ url }) => {
    seen.push(url);
    if (new URL(url).search.length > 0) {
      return { headers: {}, status, text: "{}" };
    }
    return { headers: {}, status: 200, text: '{"results":[],"totalCount":0}' };
  };
}

/** The `approvalflows` root, which the registry declares as `limit-skip`. */
function approvalFlowsRoot(): ReturnType<typeof planJumpcloudKind>["roots"][number] {
  return planJumpcloudKind({ kind: "approvalflows" }).roots[0]!;
}

const deps = ({ fetch }: { fetch: JumpcloudFetch }) => ({ apiKey: "k", fetch, orgId: null });

/** The `limit` a request asked for. A request naming none asks for no page size, so no cap can refuse it. */
function askedLimit({ url }: { url: string }): number {
  const limit = new URL(url).searchParams.get("limit");
  if (limit === null) {
    return 0;
  }
  return Number(limit);
}

/** A fetch seam that refuses any `limit` over `cap`, the way the live provider does, and serves below it. */
function capsTheLimit({ cap, seen }: { cap: number; seen: string[] }): JumpcloudFetch {
  return async ({ url }) => {
    seen.push(url);
    const asked = askedLimit({ url });
    if (asked > cap) {
      return { headers: {}, status: 400, text: `{"message":"invalid limit (max ${String(cap)})"}` };
    }
    return { headers: {}, status: 200, text: '{"results":[{"_id":"a"}],"totalCount":1}' };
  };
}

describe("a provider that caps the limit it will accept", () => {
  it("halves down to a cap of 100 and reads the family, rather than publishing it empty", async () => {
    const seen: string[] = [];

    const read = unwrap(
      await readJumpcloudOperation({
        admit: admitAnyCarrier,
        bindings: {},
        deps: deps({ fetch: capsTheLimit({ cap: 100, seen }) }),
        now: NOW,
        operation: approvalFlowsRoot(),
      }),
    );

    expect(read.records).toEqual([{ _id: "a" }]);
    expect(read.complete).toBe(true);
    expect(read.pagingRefused).toBe(false);
    // Two calls at 1,000 because the pinned sort is the narrower suspicion and is dropped first.
    expect(seen.map((url) => new URL(url).searchParams.get("limit"))).toEqual([
      "1000",
      "1000",
      "500",
      "250",
      "125",
      "100",
    ]);
  });

  it("stops at the first limit the provider accepts, so a cap of 500 costs one extra call", async () => {
    const seen: string[] = [];

    unwrap(
      await readJumpcloudOperation({
        admit: admitAnyCarrier,
        bindings: {},
        deps: deps({ fetch: capsTheLimit({ cap: 500, seen }) }),
        now: NOW,
        operation: approvalFlowsRoot(),
      }),
    );

    expect(seen.map((url) => new URL(url).searchParams.get("limit"))).toEqual(["1000", "1000", "500"]);
  });

  it("never steps below the floor, and falls through to the bare read instead of halving forever", async () => {
    const seen: string[] = [];

    const read = unwrap(
      await readJumpcloudOperation({
        admit: admitAnyCarrier,
        bindings: {},
        deps: deps({ fetch: refusesAQuery({ seen, status: 400 }) }),
        now: NOW,
        operation: approvalFlowsRoot(),
      }),
    );

    expect(read.pagingRefused).toBe(true);
    const limits = seen.map((url) => new URL(url).searchParams.get("limit"));
    expect(limits).toEqual(["1000", "1000", "500", "250", "125", "100", null]);
  });
});

/** The walk state the decision reads, with only the fields that decide anything. */
const walkState = () =>
  ({
    askLimit: 1000,
    pages: 0,
    pagingRefused: false,
    unsorted: false,
  }) as Parameters<typeof actionForFailedPage>[0]["state"];

describe("what a refused page means for the walk", () => {
  const paged = { limit: "1000", skip: "0" };

  it("steps the limit down on a 500, because THIS provider signals a limit cap with one", () => {
    const action = actionForFailedPage({
      error: { code: "TRANSPORT_FAILED", message: "m", surface: "s" },
      query: paged,
      state: walkState(),
    });

    expect(action).toBe("halve-limit");
  });

  it("steps down on a 400 too, which is how the same cap arrives from a different endpoint", () => {
    const action = actionForFailedPage({
      error: { code: "OPERATION_UNUSABLE", detail: "HTTP 400", message: "m", surface: "s" },
      query: paged,
      state: walkState(),
    });

    expect(action).toBe("halve-limit");
  });

  it("drops the pinned sort FIRST, so the narrowest suspicion is tried before the wider ones", () => {
    const action = actionForFailedPage({
      error: { code: "OPERATION_UNUSABLE", detail: "HTTP 400", message: "m", surface: "s" },
      query: { ...paged, sort: "_id" },
      state: walkState(),
    });

    expect(action).toBe("drop-sort");
  });

  it("drops the paging query once the limit is at the floor and there is nothing left to halve", () => {
    const action = actionForFailedPage({
      error: { code: "TRANSPORT_FAILED", message: "m", surface: "s" },
      query: { limit: "100", skip: "0" },
      state: { ...walkState(), askLimit: 100 },
    });

    expect(action).toBe("drop-paging");
  });

  it("still steps down PAST the first page, because an offset walk's skip is exact at any limit", () => {
    const action = actionForFailedPage({
      error: { code: "TRANSPORT_FAILED", message: "m", surface: "s" },
      query: paged,
      state: { ...walkState(), pages: 7 },
    });

    expect(action).toBe("halve-limit");
  });

  it("refuses to drop the paging query past the first page, which would re-read from the start", () => {
    const action = actionForFailedPage({
      error: { code: "TRANSPORT_FAILED", message: "m", surface: "s" },
      query: { limit: "100", skip: "700" },
      state: { ...walkState(), askLimit: 100, pages: 7 },
    });

    expect(action).toBe("give-up");
  });

  it("gives up on a failure that is the operation's own answer rather than a refused parameter", () => {
    const action = actionForFailedPage({
      error: { code: "PERMISSION_REFUSED", message: "m", status: 403, surface: "s" },
      query: paged,
      state: walkState(),
    });

    expect(action).toBe("give-up");
  });
});

describe("a provider that refuses the paging parameters themselves", () => {
  it("reads the collection bare once the step-down is spent, and calls it a complete answer", async () => {
    const seen: string[] = [];

    const read = unwrap(
      await readJumpcloudOperation({
        admit: admitAnyCarrier,
        bindings: {},
        deps: deps({ fetch: refusesAQuery({ seen, status: 400 }) }),
        now: NOW,
        operation: approvalFlowsRoot(),
      }),
    );

    expect(read.pagingRefused).toBe(true);
    expect(read.complete).toBe(true);
    expect(read.incompleteIsClearable).toBe(false);
    expect(read.records).toEqual([]);
    expect(read.reason).toContain("the provider refused this operation's paging parameters");
    expect(new URL(seen[seen.length - 1]!).search).toBe("");
  });

  it("returns the failure when the bare read is refused too, so the escape hatch invents no answer", async () => {
    const alwaysRefuses: JumpcloudFetch = async () => ({ headers: {}, status: 400, text: "{}" });

    const failed = await readJumpcloudOperation({
      admit: admitAnyCarrier,
      bindings: {},
      deps: deps({ fetch: alwaysRefuses }),
      now: NOW,
      operation: approvalFlowsRoot(),
    });

    expect(unwrapErr(failed).code).toBe("OPERATION_UNUSABLE");
  });

  it("leaves a walk that answered its paged request alone, so nothing drops paging on a working operation", async () => {
    const paged: JumpcloudFetch = async () => ({
      headers: {},
      status: 200,
      text: '{"results":[{"_id":"a"}],"totalCount":1}',
    });

    const read = unwrap(
      await readJumpcloudOperation({
        admit: admitAnyCarrier,
        bindings: {},
        deps: deps({ fetch: paged }),
        now: NOW,
        operation: approvalFlowsRoot(),
      }),
    );

    expect(read.pagingRefused).toBe(false);
    expect(read.records).toEqual([{ _id: "a" }]);
  });
});

describe("a page admitted through its surface's measured boundary", () => {
  /** A fetch seam that answers every request with one body, counting the requests. */
  function answers({ text, seen }: { text: string; seen: string[] }): JumpcloudFetch {
    return async ({ url }) => {
      seen.push(url);
      return { headers: {}, status: 200, text };
    };
  }

  it("reads an answer in the measured carrier, an empty collection included, to the end", async () => {
    const seen: string[] = [];
    const read = unwrap(
      await readJumpcloudOperation({
        admit: admitJumpcloudPage,
        bindings: {},
        deps: deps({ fetch: answers({ seen, text: '{"results":[],"totalCount":0}' }) }),
        now: NOW,
        operation: approvalFlowsRoot(),
      }),
    );
    expect(read.empty).toBe(true);
    expect(read.complete).toBe(true);
    expect(seen.length).toBe(1);
  });

  it("ends the walk on a record the surface was never measured with, absorbing nothing and asking no retry", async () => {
    const seen: string[] = [];
    const error = unwrapErr(
      await readJumpcloudOperation({
        admit: admitJumpcloudPage,
        bindings: {},
        deps: deps({ fetch: answers({ seen, text: '{"results":[{"_id":"a"}],"totalCount":1}' }) }),
        now: NOW,
        operation: approvalFlowsRoot(),
      }),
    );
    expect(error.code).toBe("BODY_SHAPE_CHANGED");
    // A surface no answer measured declares a key no record can carry, so ANY record is refused, naming its keys.
    expect(error.message).toBe(
      'v2-access-workflow-api-get-all-access-work-flows answered a shape this version does not read, so nothing it answered is held: new field "results[0]._id"; field "results[0].noRecordWasEverMeasuredHere" is missing',
    );
    expect(seen.length).toBe(1);
  });

  it("refuses an answer in another carrier rather than re-reading it as one it was not", async () => {
    const error = unwrapErr(
      await readJumpcloudOperation({
        admit: admitJumpcloudPage,
        bindings: {},
        deps: deps({ fetch: answers({ seen: [], text: "[]" }) }),
        now: NOW,
        operation: approvalFlowsRoot(),
      }),
    );
    expect(error.code).toBe("BODY_SHAPE_CHANGED");
    expect(error.message).toBe(
      'v2-access-workflow-api-get-all-access-work-flows answered a shape this version does not read, so nothing it answered is held: field "(body)" changed: Invalid input: expected object, received array',
    );
  });
});

describe("a graph association list, which the provider serves one target at a time", () => {
  /** The live refusal shape: more than one `targets` value is refused; one is served with that target's row. */
  function oneTargetPerCall({ seen }: { seen: string[] }): JumpcloudFetch {
    return async ({ url }) => {
      const targets = new URL(url).searchParams.getAll("targets");
      seen.push(targets.join(","));
      if (targets.length !== 1) {
        return {
          headers: {},
          status: 400,
          text: `{"message":"must provide exactly 1 target, got ${String(targets.length)}","status":"INVALID_ARGUMENT"}`,
        };
      }
      return {
        headers: {},
        status: 200,
        text: JSON.stringify([{ to: { id: `id-${targets[0]!}`, type: targets[0] } }]),
      };
    };
  }

  const associations = planJumpcloudKind({ kind: "systems" }).fanouts.find(
    (operation) => operation.row.name === "v2-graph-system-associations-list",
  )!;

  it("asks once per target and returns every target's associations as one read", async () => {
    const seen: string[] = [];

    const read = unwrap(
      await readJumpcloudOperation({
        admit: admitAnyCarrier,
        bindings: { system_id: "sys-1" },
        deps: deps({ fetch: oneTargetPerCall({ seen }) }),
        now: NOW,
        operation: associations,
      }),
    );

    expect(seen).toEqual(["command", "policy", "policy_group", "user", "user_group"]);
    expect(read.records).toEqual([
      { to: { id: "id-command", type: "command" } },
      { to: { id: "id-policy", type: "policy" } },
      { to: { id: "id-policy_group", type: "policy_group" } },
      { to: { id: "id-user", type: "user" } },
      { to: { id: "id-user_group", type: "user_group" } },
    ]);
    expect(read.complete).toBe(true);
  });

  it("fails the whole read when one target fails, because an association list missing one is not the answer", async () => {
    const failsOnPolicy: JumpcloudFetch = async (input) => {
      if (new URL(input.url).searchParams.get("targets") === "policy") {
        return { headers: {}, status: 302, text: "" };
      }
      return oneTargetPerCall({ seen: [] })(input);
    };

    const error = unwrapErr(
      await readJumpcloudOperation({
        admit: admitAnyCarrier,
        bindings: { system_id: "sys-1" },
        deps: deps({ fetch: failsOnPolicy }),
        now: NOW,
        operation: associations,
      }),
    );

    expect(error.code).toBe("REDIRECT_REFUSED");
  });
});
