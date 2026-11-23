import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  branchPushRulesVia,
  PUSH_RULE_PAGE,
  updatePushRestrictionVia,
  userNodeIdVia,
} from "../../../../corpus/github/pushRestriction.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { unwrap } from "../../../../lib/result.js";

/** A write context whose transport is a plain fake `fetch` recording each GraphQL body it is sent. */
function recordingCtx({ sent, data }: { sent: { query: string; variables: unknown }[]; data: unknown }): WriteCtx {
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const body = init?.body;
    if (typeof body !== "string") {
      throw new Error("Octokit sent a GraphQL request without a JSON string body");
    }
    sent.push(JSON.parse(body) as { query: string; variables: unknown });
    return new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" }, status: 200 });
  };
  return { client: new Octokit({ auth: "test-token", request: { fetch } }), scopeId: "push-restriction-test" };
}

describe("updatePushRestrictionVia", () => {
  it("sends the rule id, the restriction flag and the actor ids, and nothing else", async () => {
    const sent: { query: string; variables: unknown }[] = [];

    const result = await updatePushRestrictionVia({
      ctx: recordingCtx({ data: { updateBranchProtectionRule: { branchProtectionRule: { id: "R_1" } } }, sent }),
      input: { actorIds: ["U_1"], restrictsPushes: true, ruleId: "R_1" },
    });

    expect(result.isOk()).toBe(true);
    expect(sent.length).toBe(1);
    expect(sent[0]!.variables).toEqual({ actorIds: ["U_1"], restrictsPushes: true, ruleId: "R_1" });
    expect(sent[0]!.query).toContain(
      "input: { branchProtectionRuleId: $ruleId, restrictsPushes: $restrictsPushes, pushActorIds: $actorIds }",
    );
  });
});

describe("branchPushRulesVia", () => {
  it("asks for a full page of rules and returns the payload raw", async () => {
    const sent: { query: string; variables: unknown }[] = [];
    const data = { repository: { branchProtectionRules: { nodes: [], totalCount: 0 } } };

    const result = await branchPushRulesVia({ ctx: recordingCtx({ data, sent }), input: { owner: "o", repo: "r" } });

    expect(unwrap(result)).toEqual(data);
    expect(sent[0]!.variables).toEqual({ name: "r", owner: "o", page: PUSH_RULE_PAGE });
  });
});

describe("userNodeIdVia", () => {
  it("looks the login up by name", async () => {
    const sent: { query: string; variables: unknown }[] = [];

    const result = await userNodeIdVia({
      ctx: recordingCtx({ data: { user: { id: "U_1", login: "a" } }, sent }),
      input: { login: "a" },
    });

    expect(unwrap(result)).toEqual({ user: { id: "U_1", login: "a" } });
    expect(sent[0]!.variables).toEqual({ login: "a" });
  });
});
