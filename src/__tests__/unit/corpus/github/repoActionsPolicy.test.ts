/**
 * The Actions policy's reads and writes through a real Octokit whose transport is a plain fake `fetch`: each write
 * sends exactly the fields the policy names, once; the fork-approval read refuses a body naming no known policy;
 * and the runner count is GitHub's `total_count`, never the length of one page.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  countSelfHostedRunnersVia,
  getForkApprovalPolicyVia,
  getWorkflowTokenPolicyVia,
  isForkApprovalPolicy,
  setForkApprovalForAllOutsidersVia,
  setReadOnlyWorkflowTokenVia,
  setRepoActionsEnabledVia,
} from "../../../../corpus/github/repoActionsPolicy.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One request as the fake transport saw it. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** Each context's own rate-limit scope, so one case's write is never paced behind another's. */
let scopeCount = 0;

/** A write context whose transport answers every request with one status and body, recording each. */
function recordingCtx({ sent, status, data }: { sent: SentRequest[]; status: number; data: unknown }): WriteCtx {
  scopeCount += 1;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const body = init?.body;
    sent.push({
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      method: String(init?.method),
      url: url instanceof Request ? url.url : url.toString(),
    });
    const text = status === 204 ? null : JSON.stringify(data);
    return new Response(text, { headers: { "content-type": "application/json" }, status });
  };
  return {
    client: new Octokit({ auth: "test-token", request: { fetch } }),
    scopeId: `actions-policy-${String(scopeCount)}`,
  };
}

const BASE = "https://api.github.com/repos/acme/widget/actions";
const INPUT = { owner: "acme", repo: "widget" };

describe("isForkApprovalPolicy", () => {
  it("accepts GitHub's three policies and nothing else", () => {
    expect(isForkApprovalPolicy("all_external_contributors")).toBe(true);
    expect(isForkApprovalPolicy("first_time_contributors")).toBe(true);
    expect(isForkApprovalPolicy("first_time_contributors_new_to_github")).toBe(true);
    expect(isForkApprovalPolicy("everyone")).toBe(false);
    expect(isForkApprovalPolicy(undefined)).toBe(false);
  });
});

describe("workflow token policy", () => {
  it("reads the default permissions and whether the token may approve a pull request", async () => {
    const ctx = recordingCtx({
      data: { can_approve_pull_request_reviews: true, default_workflow_permissions: "write" },
      sent: [],
      status: 200,
    });

    expect(unwrap(await getWorkflowTokenPolicyVia({ ctx, input: INPUT }))).toStrictEqual({
      canApprovePullRequestReviews: true,
      defaultWorkflowPermissions: "write",
    });
  });

  it("refuses a body omitting whether the token may approve, rather than reading it as unable to", async () => {
    const ctx = recordingCtx({ data: { default_workflow_permissions: "read" }, sent: [], status: 200 });

    expect(unwrapErr(await getWorkflowTokenPolicyVia({ ctx, input: INPUT })).message).toContain(
      "omitted a field, so it is unknown",
    );
  });

  it("sets it read-only and unable to approve, once", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: undefined, sent, status: 204 });

    await setReadOnlyWorkflowTokenVia({ ctx, input: INPUT });

    expect(sent).toEqual([
      {
        body: { can_approve_pull_request_reviews: false, default_workflow_permissions: "read" },
        method: "PUT",
        url: `${BASE}/permissions/workflow`,
      },
    ]);
  });
});

describe("fork pull request approval policy", () => {
  it("reads a known policy", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { approval_policy: "first_time_contributors" }, sent, status: 200 });

    expect(unwrap(await getForkApprovalPolicyVia({ ctx, input: INPUT }))).toBe("first_time_contributors");
    expect(sent).toEqual([{ body: undefined, method: "GET", url: `${BASE}/permissions/fork-pr-contributor-approval` }]);
  });

  it("refuses a body naming no known policy rather than reading it as the safe one", async () => {
    const ctx = recordingCtx({ data: { approval_policy: "someone_new" }, sent: [], status: 200 });

    expect(unwrapErr(await getForkApprovalPolicyVia({ ctx, input: INPUT })).message).toContain(
      "named no known policy, so it is unknown",
    );
  });

  it("requires approval for every outside contributor, once", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: undefined, sent, status: 204 });

    await setForkApprovalForAllOutsidersVia({ ctx, input: INPUT });

    expect(sent).toEqual([
      {
        body: { approval_policy: "all_external_contributors" },
        method: "PUT",
        url: `${BASE}/permissions/fork-pr-contributor-approval`,
      },
    ]);
  });
});

describe("countSelfHostedRunnersVia", () => {
  it("answers GitHub's total count from a one-runner page", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { runners: [{ id: 1 }], total_count: 3 }, sent, status: 200 });

    expect(unwrap(await countSelfHostedRunnersVia({ ctx, input: INPUT }))).toBe(3);
    expect(sent).toEqual([{ body: undefined, method: "GET", url: `${BASE}/runners?per_page=1` }]);
  });

  it.each([-1, 0.5, "0"])("refuses %j as a count rather than reading it as no runners", async (count) => {
    const ctx = recordingCtx({ data: { runners: [], total_count: count }, sent: [], status: 200 });

    expect(unwrapErr(await countSelfHostedRunnersVia({ ctx, input: INPUT })).message).toContain(
      "was not a whole number of zero or more, so it is unknown",
    );
  });
});

describe("setRepoActionsEnabledVia", () => {
  it("sends the switch position alone, once, and a refusal is one request", async () => {
    const sent: SentRequest[] = [];
    const refused: SentRequest[] = [];
    const ctx = recordingCtx({ data: undefined, sent, status: 204 });
    const refusing = recordingCtx({ data: { message: "Server Error" }, sent: refused, status: 500 });

    await setRepoActionsEnabledVia({ ctx, input: { ...INPUT, enabled: true } });
    const error = unwrapErr(await setRepoActionsEnabledVia({ ctx: refusing, input: { ...INPUT, enabled: true } }));

    expect(sent).toEqual([{ body: { enabled: true }, method: "PUT", url: `${BASE}/permissions` }]);
    expect(error.status).toBe(500);
    expect(refused.length).toBe(1);
  });
});
