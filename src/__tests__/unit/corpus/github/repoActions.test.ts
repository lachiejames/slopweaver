/**
 * A repository's Actions switch, read and switched off through a real Octokit whose transport is a plain fake
 * `fetch` recording each request. The switch-off sends exactly `{ enabled: false }` once — a 500 on it is the
 * caller's error after one request, never a retry.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import { disableRepoActionsVia, getRepoActionsVia } from "../../../../corpus/github/repoActions.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One request as the fake transport saw it. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** A write context whose transport answers every request with one status and body, recording each. */
function recordingCtx({
  sent,
  status,
  data,
  scopeId,
}: {
  sent: SentRequest[];
  status: number;
  data: unknown;
  scopeId: string;
}): WriteCtx {
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const body = init?.body;
    sent.push({
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      method: String(init?.method),
      url: url instanceof Request ? url.url : url.toString(),
    });
    if (status === 204) {
      return new Response(null, { status });
    }
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" }, status });
  };
  return { client: new Octokit({ auth: "test-token", request: { fetch } }), scopeId };
}

const PERMISSIONS_URL = "https://api.github.com/repos/acme/widgets/actions/permissions";

describe("getRepoActionsVia", () => {
  it("GETs the repository's Actions permissions and answers the switch and the allowed actions", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { allowed_actions: "selected", enabled: true },
      scopeId: "repo-actions-get",
      sent,
      status: 200,
    });

    const result = await getRepoActionsVia({ ctx, input: { owner: "acme", repo: "widgets" } });

    expect(unwrap(result)).toStrictEqual({ allowedActions: "selected", enabled: true });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: PERMISSIONS_URL }]);
  });

  it("reads an absent allowed_actions as undefined", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { enabled: false }, scopeId: "repo-actions-get-off", sent, status: 200 });

    const result = await getRepoActionsVia({ ctx, input: { owner: "acme", repo: "widgets" } });

    expect(unwrap(result)).toStrictEqual({ allowedActions: undefined, enabled: false });
  });

  it("refuses a body with no boolean enabled rather than reading it as switched off", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: {}, scopeId: "repo-actions-get-malformed", sent, status: 200 });

    const result = await getRepoActionsVia({ ctx, input: { owner: "acme", repo: "widgets" } });

    expect(unwrapErr(result).message).toContain("no boolean `enabled`");
  });

  it("fails as an http error naming the operation when GitHub answers 403", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { message: "Resource not accessible by integration" },
      scopeId: "repo-actions-get-403",
      sent,
      status: 403,
    });

    const result = await getRepoActionsVia({ ctx, input: { owner: "acme", repo: "widgets" } });

    const error = unwrapErr(result);
    expect(error.status).toBe(403);
    expect(error.operation).toBe("github.actions.getGithubActionsPermissionsRepository");
  });
});

describe("disableRepoActionsVia", () => {
  it("PUTs exactly enabled false to the repository's Actions permissions", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: undefined, scopeId: "repo-actions-put", sent, status: 204 });

    const result = await disableRepoActionsVia({ ctx, input: { owner: "acme", repo: "widgets" } });

    expect(result.isOk()).toBe(true);
    expect(sent).toEqual([{ body: { enabled: false }, method: "PUT", url: PERMISSIONS_URL }]);
  });

  it("fails as an http error after exactly one request when GitHub answers 500", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { message: "Server Error" },
      scopeId: "repo-actions-put-500",
      sent,
      status: 500,
    });

    const result = await disableRepoActionsVia({ ctx, input: { owner: "acme", repo: "widgets" } });

    const error = unwrapErr(result);
    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
    expect(error.operation).toBe("github.actions.setGithubActionsPermissionsRepository");
    expect(sent.length).toBe(1);
  });
});
