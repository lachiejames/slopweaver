/**
 * The group membership write surface: what it refuses before spending a request, how it reconciles a
 * per-person response against the people that were actually sent, and what the two legs put on the wire.
 */
import { describe, expect, it } from "vitest";

import type { VantaGroupMembershipUpdate } from "../../../../atlas/vanta/groupApiSchemas.js";
import {
  checkVantaGroupMembershipPlan,
  createVantaGroupWriteClient,
  groupAddPeoplePath,
  groupLegPath,
  groupRemovePeoplePath,
  reconcileVantaGroupLeg,
  VANTA_GROUP_WRITE_BOUNDARIES,
  vantaGroupMembershipFullySucceeded,
} from "../../../../atlas/vanta/groupWriteClient.js";
import type { VantaTokenProvider } from "../../../../atlas/vanta/oauth.js";
import type { VantaRawResponse, VantaRequestInit, VantaTransport } from "../../../../atlas/vanta/transport.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";

const people = ({ ids }: { ids: readonly string[] }): readonly VantaGroupMembershipUpdate[] =>
  ids.map((id) => ({ id }));

/** A token provider that mints one fixed token — no network, no cache, no clock. */
const fixedToken: VantaTokenProvider = { getToken: async () => ok("tok") };

/** A transport that records every request it is given and answers each with the same canned body. */
function recordingTransport({ body }: { body: string }): {
  readonly transport: VantaTransport;
  readonly sent: VantaRequestInit[];
} {
  const sent: VantaRequestInit[] = [];
  const transport: VantaTransport = {
    request: async (init): Promise<Result<VantaRawResponse>> => {
      sent.push(init);
      return ok({ body, headers: {}, status: 200 });
    },
  };
  return { sent, transport };
}

describe("group leg paths", () => {
  it("address Vanta's two bulk routes", () => {
    expect(groupAddPeoplePath({ groupId: "g1" })).toBe("/v1/groups/g1/add-people");
    expect(groupRemovePeoplePath({ groupId: "g1" })).toBe("/v1/groups/g1/remove-people");
  });

  it("encode a group id rather than letting it change the route", () => {
    expect(groupAddPeoplePath({ groupId: "a/b?c" })).toBe("/v1/groups/a%2Fb%3Fc/add-people");
  });

  it("are chosen in one place, so the preview and the client cannot disagree", () => {
    expect(groupLegPath({ direction: "add", groupId: "g1" })).toBe(groupAddPeoplePath({ groupId: "g1" }));
    expect(groupLegPath({ direction: "remove", groupId: "g1" })).toBe(groupRemovePeoplePath({ groupId: "g1" }));
  });
});

describe("checkVantaGroupMembershipPlan", () => {
  it("passes an add-only plan", () => {
    const plan = { add: people({ ids: ["p1", "p2"] }), groupId: "g1", remove: [] };
    const result = checkVantaGroupMembershipPlan({ plan });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).add.length).toBe(2);
  });

  it("passes a remove-only plan", () => {
    const plan = { add: [], groupId: "g1", remove: people({ ids: ["p1"] }) };
    expect(checkVantaGroupMembershipPlan({ plan }).isOk()).toBe(true);
  });

  it("passes a plan that moves people both ways", () => {
    const plan = { add: people({ ids: ["p1"] }), groupId: "g1", remove: people({ ids: ["p2"] }) };
    expect(checkVantaGroupMembershipPlan({ plan }).isOk()).toBe(true);
  });

  it("refuses a plan that moves nobody rather than sending two empty calls", () => {
    const result = checkVantaGroupMembershipPlan({ plan: { add: [], groupId: "g1", remove: [] } });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()).toEqual(["this plan moves nobody — pass at least one --add or one --remove"]);
  });

  it("refuses a plan naming no group", () => {
    const plan = { add: people({ ids: ["p1"] }), groupId: "   ", remove: [] };
    const result = checkVantaGroupMembershipPlan({ plan });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()[0]).toContain("--group named no group");
  });

  it("accepts a leg of exactly Vanta's own batch maximum", () => {
    const ids = Array.from({ length: 100 }, (_value, index) => `p${String(index)}`);
    expect(checkVantaGroupMembershipPlan({ plan: { add: people({ ids }), groupId: "g1", remove: [] } }).isOk()).toBe(
      true,
    );
  });

  it("refuses a leg one past it, naming the direction that overflowed", () => {
    const ids = Array.from({ length: 101 }, (_value, index) => `p${String(index)}`);
    const result = checkVantaGroupMembershipPlan({ plan: { add: [], groupId: "g1", remove: people({ ids }) } });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()[0]).toContain(
      "--remove names 101 people, more than Vanta's own batch maximum of 100",
    );
  });

  it("refuses a duplicate inside one direction, because a per-person answer cannot say which it answered", () => {
    const plan = { add: people({ ids: ["p1", "p1"] }), groupId: "g1", remove: [] };
    const result = checkVantaGroupMembershipPlan({ plan });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()).toEqual([
      "p1 appears twice in --add — Vanta answers per person, so a duplicate is ambiguous",
    ]);
  });

  it("refuses the same person on both sides, because the two legs are separate calls", () => {
    const plan = { add: people({ ids: ["p1"] }), groupId: "g1", remove: people({ ids: ["p1"] }) };
    const result = checkVantaGroupMembershipPlan({ plan });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()[0]).toContain("p1 is in both --add and --remove");
  });

  it("reports every problem at once rather than the first", () => {
    const plan = { add: people({ ids: ["p1", "p1"] }), groupId: "", remove: [] };
    const result = checkVantaGroupMembershipPlan({ plan });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr().length).toBe(2);
  });
});

describe("reconcileVantaGroupLeg", () => {
  it("reads a wholly successful leg in SEND order, not response order", () => {
    const result = reconcileVantaGroupLeg({
      direction: "add",
      requestedIds: ["p1", "p2", "p3"],
      results: [
        { id: "p3", status: "SUCCESS" },
        { id: "p1", status: "SUCCESS" },
        { id: "p2", status: "SUCCESS" },
      ],
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).succeeded).toEqual(["p1", "p2", "p3"]);
    expect(unwrap(result).attempted).toBe(3);
  });

  it("counts both arms of a partial success and carries Vanta's own message", () => {
    const result = reconcileVantaGroupLeg({
      direction: "remove",
      requestedIds: ["p1", "p2"],
      results: [
        { id: "p1", status: "SUCCESS" },
        { id: "p2", message: "person is not in that group", status: "ERROR" },
      ],
    });
    expect(unwrap(result).succeeded).toEqual(["p1"]);
    expect(unwrap(result).failed).toEqual([{ id: "p2", message: "person is not in that group" }]);
    expect(unwrap(result).direction).toBe("remove");
  });

  it("refuses a response that says nothing about somebody the call sent", () => {
    const result = reconcileVantaGroupLeg({
      direction: "add",
      requestedIds: ["p1", "p2"],
      results: [{ id: "p1", status: "SUCCESS" }],
    });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()).toEqual([
      "Vanta reported nothing about p2, which this call sent — its outcome is UNKNOWN",
    ]);
  });

  it("refuses a response answering twice for one person", () => {
    const result = reconcileVantaGroupLeg({
      direction: "add",
      requestedIds: ["p1"],
      results: [
        { id: "p1", status: "SUCCESS" },
        { id: "p1", message: "already a member", status: "ERROR" },
      ],
    });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()).toEqual(["Vanta reported 2 outcomes for p1, which this call sent once"]);
  });

  it("refuses an outcome for somebody the call never sent", () => {
    const result = reconcileVantaGroupLeg({
      direction: "add",
      requestedIds: ["p1"],
      results: [
        { id: "p1", status: "SUCCESS" },
        { id: "p9", status: "SUCCESS" },
      ],
    });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()).toEqual(["Vanta reported an outcome for p9, which this call never sent"]);
  });

  it("refuses the right NUMBER of the wrong people, which is what a count check would pass", () => {
    const result = reconcileVantaGroupLeg({
      direction: "add",
      requestedIds: ["p1", "p2", "p3"],
      results: [
        { id: "x1", status: "SUCCESS" },
        { id: "x2", status: "SUCCESS" },
        { id: "x3", status: "SUCCESS" },
      ],
    });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr().length).toBe(6);
  });

  it("reads an empty leg as an empty leg", () => {
    const result = reconcileVantaGroupLeg({ direction: "add", requestedIds: [], results: [] });
    expect(unwrap(result).attempted).toBe(0);
    expect(unwrap(result).succeeded).toEqual([]);
  });
});

describe("vantaGroupMembershipFullySucceeded", () => {
  it("is true when every attempted move landed", () => {
    const summary = {
      groupId: "g1",
      legs: [
        { attempted: 2, direction: "add" as const, failed: [], succeeded: ["p1", "p2"] },
        { attempted: 1, direction: "remove" as const, failed: [], succeeded: ["p3"] },
      ],
    };
    expect(vantaGroupMembershipFullySucceeded({ summary })).toBe(true);
  });

  it("is false when one person in one leg was refused", () => {
    const summary = {
      groupId: "g1",
      legs: [
        {
          attempted: 2,
          direction: "add" as const,
          failed: [{ id: "p2", message: "no such person" }],
          succeeded: ["p1"],
        },
      ],
    };
    expect(vantaGroupMembershipFullySucceeded({ summary })).toBe(false);
  });
});

describe("createVantaGroupWriteClient", () => {
  const okBody = '{"results":[{"id":"p1","status":"SUCCESS"}]}';

  it("posts the add leg to the add route with the compact shared body and never retries it", async () => {
    const { sent, transport } = recordingTransport({ body: okBody });
    const client = createVantaGroupWriteClient({ tokenProvider: fixedToken, transport });
    const result = await client.addPeopleToGroup({ groupId: "g1", updates: people({ ids: ["p1"] }) });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).results).toEqual([{ id: "p1", status: "SUCCESS" }]);
    expect(sent.length).toBe(1);
    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.path).toBe("/v1/groups/g1/add-people");
    expect(sent[0]!.body).toBe('{"updates":[{"id":"p1"}]}');
    expect(sent[0]!.retryPolicy).toBe("never");
    expect(sent[0]!.headers["authorization"]).toBe("Bearer tok");
  });

  it("posts the remove leg to the remove route", async () => {
    const { sent, transport } = recordingTransport({ body: okBody });
    const client = createVantaGroupWriteClient({ tokenProvider: fixedToken, transport });
    await client.removePeopleFromGroup({ groupId: "g1", updates: people({ ids: ["p1"] }) });
    expect(sent[0]!.path).toBe("/v1/groups/g1/remove-people");
    expect(sent[0]!.retryPolicy).toBe("never");
  });

  it("refuses a body it cannot read rather than reporting an empty batch as a clean run", async () => {
    const { transport } = recordingTransport({ body: '{"results":[{"id":"p1","status":"ERROR"}]}' });
    const client = createVantaGroupWriteClient({ tokenProvider: fixedToken, transport });
    const result = await client.addPeopleToGroup({ groupId: "g1", updates: people({ ids: ["p1"] }) });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr().code).toBe("UNREADABLE");
    expect(result._unsafeUnwrapErr().message).toBe(
      'group add-people (POST /v1/groups/{groupId}/add-people) returned a body this package cannot read:;   field "results[0].message" is missing',
    );
  });

  it("names each direction's own endpoint, so a refusal says which leg drifted", () => {
    expect(VANTA_GROUP_WRITE_BOUNDARIES.add.endpoint).toBe("POST /v1/groups/{groupId}/add-people");
    expect(VANTA_GROUP_WRITE_BOUNDARIES.remove.endpoint).toBe("POST /v1/groups/{groupId}/remove-people");
  });

  it("refuses a body that is not JSON at all", async () => {
    const { transport } = recordingTransport({ body: "<html>gateway</html>" });
    const client = createVantaGroupWriteClient({ tokenProvider: fixedToken, transport });
    const result = await client.removePeopleFromGroup({ groupId: "g1", updates: people({ ids: ["p1"] }) });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr().code).toBe("UNREADABLE");
    expect(result._unsafeUnwrapErr().problems).toEqual(["group remove-people returned a body that is not valid JSON"]);
  });
});

describe("a leg the token refresh stopped", () => {
  it("is NOT_DISPATCHED, and no request reaches the transport at all", async () => {
    // The counterexample: a refresh that fails mid-run used to surface as the same error
    // as an unreadable body, and the run then told an auditor to go and read back a group nothing was
    // ever sent to. The recorded requests are the falsifiable half — this asserts the absence against a
    // transport that would have recorded a request had one been made.
    const { sent, transport } = recordingTransport({ body: '{"results":[]}' });
    const refused: VantaTokenProvider = { getToken: async () => err(["vanta token refresh failed with HTTP 503"]) };
    const client = createVantaGroupWriteClient({ tokenProvider: refused, transport });
    const result = await client.removePeopleFromGroup({ groupId: "g1", updates: people({ ids: ["p1"] }) });
    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr().code).toBe("NOT_DISPATCHED");
    expect(result._unsafeUnwrapErr().problems).toEqual(["vanta token refresh failed with HTTP 503"]);
    expect(sent).toEqual([]);
  });

  it("still dispatches once the token resolves, so the witness above is about the refusal", async () => {
    const { sent, transport } = recordingTransport({ body: '{"results":[{"id":"p1","status":"SUCCESS"}]}' });
    const client = createVantaGroupWriteClient({ tokenProvider: fixedToken, transport });
    const result = await client.removePeopleFromGroup({ groupId: "g1", updates: people({ ids: ["p1"] }) });
    expect(result.isOk()).toBe(true);
    expect(sent.map((init) => init.path)).toEqual(["/v1/groups/g1/remove-people"]);
  });
});
