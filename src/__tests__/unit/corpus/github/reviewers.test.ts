/**
 * A pull request's requested reviewers, read and added through a real Octokit whose transport is a plain fake
 * `fetch` recording each request: a read keeps only the non-empty logins and team slugs GitHub listed, a
 * write sends exactly the users and teams it was handed in one POST, an absent response list reads as empty,
 * and a 500 on the write is the caller's error after one request, never a retry.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import { requestedReviewersVia, requestReviewersVia } from "../../../../corpus/github/reviewers.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One request as the fake transport saw it. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** A write context whose transport answers every request with one status and JSON body, recording each. */
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
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" }, status });
  };
  return { client: new Octokit({ auth: "test-token", request: { fetch } }), scopeId };
}

const PR = { number: 42, owner: "acme", repo: "widgets" };

describe("requestedReviewersVia", () => {
  it("GETs the requested reviewers and keeps only non-empty logins and team slugs, in order", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: {
        teams: [{ slug: "platform" }, { slug: "" }, { name: "no slug" }, "core", { slug: "data" }],
        users: [{ login: "ada" }, { login: 7 }, null, { login: "" }, { login: "grace" }],
      },
      scopeId: "reviewers-read",
      sent,
      status: 200,
    });

    const result = await requestedReviewersVia({ ctx, input: PR });

    expect(unwrap(result)).toEqual({ teams: ["platform", "data"], users: ["ada", "grace"] });
    expect(sent).toEqual([
      {
        body: undefined,
        method: "GET",
        url: "https://api.github.com/repos/acme/widgets/pulls/42/requested_reviewers",
      },
    ]);
  });
});

describe("requestReviewersVia", () => {
  it("POSTs exactly the users and teams it was handed, answering what GitHub reports requested", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: {
        requested_reviewers: [{ login: "ada" }, { login: "grace" }],
        requested_teams: [{ slug: "platform" }],
      },
      scopeId: "reviewers-write",
      sent,
      status: 201,
    });

    const result = await requestReviewersVia({
      ctx,
      input: { ...PR, reviewers: ["ada", "ada", "grace"], teamReviewers: ["platform"] },
    });

    expect(unwrap(result)).toEqual({ teams: ["platform"], users: ["ada", "grace"] });
    expect(sent).toEqual([
      {
        body: { reviewers: ["ada", "ada", "grace"], team_reviewers: ["platform"] },
        method: "POST",
        url: "https://api.github.com/repos/acme/widgets/pulls/42/requested_reviewers",
      },
    ]);
  });

  it("reads a response carrying neither requested list as no reviewers at all", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { number: 42 }, scopeId: "reviewers-write-absent", sent, status: 201 });

    const result = await requestReviewersVia({ ctx, input: { ...PR, reviewers: ["ada"], teamReviewers: [] } });

    expect(unwrap(result)).toEqual({ teams: [], users: [] });
  });

  it("reads a null list as no reviewers of that kind, beside a present list of the other kind", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { number: 42, requested_reviewers: [{ login: "ada" }], requested_teams: null },
      scopeId: "reviewers-write-null",
      sent,
      status: 201,
    });

    const result = await requestReviewersVia({ ctx, input: { ...PR, reviewers: ["ada"], teamReviewers: [] } });

    expect(unwrap(result)).toEqual({ teams: [], users: ["ada"] });
  });

  it("fails as an http error after exactly one request when GitHub answers 500", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { message: "Server Error" }, scopeId: "reviewers-write-500", sent, status: 500 });

    const error = unwrapErr(
      await requestReviewersVia({ ctx, input: { ...PR, reviewers: ["ada"], teamReviewers: [] } }),
    );

    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
    expect(error.operation).toBe("github.pulls.requestReviewers");
    expect(sent).toEqual([
      {
        body: { reviewers: ["ada"], team_reviewers: [] },
        method: "POST",
        url: "https://api.github.com/repos/acme/widgets/pulls/42/requested_reviewers",
      },
    ]);
  });
});
