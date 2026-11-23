/**
 * A repository's description, read and written through a real Octokit whose transport is a plain fake
 * `fetch` recording each request. A GitHub `null` description reads back as absent, and an update is sent
 * exactly once — a 500 on it is the caller's error after one request, never a retry.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import { getRepoDescriptionVia, setRepoDescriptionVia } from "../../../../corpus/github/repoDescription.js";
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

describe("getRepoDescriptionVia", () => {
  it("GETs the repository and answers its description and URL", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { description: "Widgets, made well", html_url: "https://github.com/acme/widgets" },
      scopeId: "repo-description-get",
      sent,
      status: 200,
    });

    const result = await getRepoDescriptionVia({ ctx, input: { owner: "acme", repo: "widgets" } });

    expect(unwrap(result)).toStrictEqual({
      description: "Widgets, made well",
      htmlUrl: "https://github.com/acme/widgets",
    });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: "https://api.github.com/repos/acme/widgets" }]);
  });

  it("reads a null description as absent", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { description: null, html_url: "https://github.com/acme/bare" },
      scopeId: "repo-description-get-null",
      sent,
      status: 200,
    });

    const result = await getRepoDescriptionVia({ ctx, input: { owner: "acme", repo: "bare" } });

    expect(unwrap(result)).toStrictEqual({ description: undefined, htmlUrl: "https://github.com/acme/bare" });
  });
});

describe("setRepoDescriptionVia", () => {
  it("PATCHes the repository with only the new description, answering what GitHub stored", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { description: "New words", html_url: "https://github.com/acme/widgets" },
      scopeId: "repo-description-set",
      sent,
      status: 200,
    });

    const result = await setRepoDescriptionVia({
      ctx,
      input: { description: "New words", owner: "acme", repo: "widgets" },
    });

    expect(unwrap(result)).toStrictEqual({ description: "New words", htmlUrl: "https://github.com/acme/widgets" });
    expect(sent).toEqual([
      { body: { description: "New words" }, method: "PATCH", url: "https://api.github.com/repos/acme/widgets" },
    ]);
  });

  it("fails as an http error after exactly one request when GitHub answers 500", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { message: "Server Error" },
      scopeId: "repo-description-set-500",
      sent,
      status: 500,
    });

    const result = await setRepoDescriptionVia({
      ctx,
      input: { description: "New words", owner: "acme", repo: "widgets" },
    });

    expect(result.isErr()).toBe(true);
    const error = unwrapErr(result);
    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
    expect(error.operation).toBe("github.repos.update");
    expect(sent.length).toBe(1);
  });
});
