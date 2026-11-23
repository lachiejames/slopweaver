/**
 * A repository's lifecycle reads and writes through a real Octokit whose transport is a plain fake `fetch`
 * recording each request: a create sends exactly its name and privacy once to the right endpoint, a refused
 * create is one request and never a retry, and a read missing `visibility` is an error rather than a default.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  createRepoVia,
  getAuthenticatedAccountVia,
  getRepoLifecycleVia,
  setRepoPublicVia,
} from "../../../../corpus/github/repoLifecycle.js";
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
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" }, status });
  };
  return {
    client: new Octokit({ auth: "test-token", request: { fetch } }),
    scopeId: `repo-lifecycle-${String(scopeCount)}`,
  };
}

const REPO_PAYLOAD = {
  archived: false,
  full_name: "acme/widget",
  html_url: "https://github.com/acme/widget",
  id: 101,
  name: "widget",
  owner: { login: "acme", type: "User" },
  private: true,
  visibility: "private",
};

describe("getRepoLifecycleVia", () => {
  it("maps the repository's identity, owner type and visibility", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: REPO_PAYLOAD, sent, status: 200 });

    const result = await getRepoLifecycleVia({ ctx, input: { owner: "acme", repo: "widget" } });

    expect(unwrap(result)).toStrictEqual({
      archived: false,
      fullName: "acme/widget",
      htmlUrl: "https://github.com/acme/widget",
      id: 101,
      name: "widget",
      ownerLogin: "acme",
      ownerType: "User",
      private: true,
      visibility: "private",
    });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: "https://api.github.com/repos/acme/widget" }]);
  });

  it("refuses a body carrying no visibility rather than guessing one", async () => {
    const { visibility: _dropped, ...withoutVisibility } = REPO_PAYLOAD;
    const ctx = recordingCtx({ data: withoutVisibility, sent: [], status: 200 });

    const result = await getRepoLifecycleVia({ ctx, input: { owner: "acme", repo: "widget" } });

    expect(unwrapErr(result).message).toContain("carried no visibility, so whether it is public is unknown");
  });

  it("answers a 404 as an http failure, which a create reads as the address being free", async () => {
    const ctx = recordingCtx({ data: { message: "Not Found" }, sent: [], status: 404 });

    const error = unwrapErr(await getRepoLifecycleVia({ ctx, input: { owner: "acme", repo: "widget" } }));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(404);
  });
});

describe("getAuthenticatedAccountVia", () => {
  it("reads the token's own account", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { id: 10, login: "acme", type: "User" }, sent, status: 200 });

    expect(unwrap(await getAuthenticatedAccountVia({ ctx }))).toStrictEqual({ id: 10, login: "acme", type: "User" });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: "https://api.github.com/user" }]);
  });
});

describe("createRepoVia", () => {
  it("creates on the token's own account with exactly the name and privacy", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { ...REPO_PAYLOAD, id: 555 }, sent, status: 201 });

    const result = await createRepoVia({ ctx, input: { name: "widget", org: undefined, private: true } });

    expect(unwrap(result)).toStrictEqual({ id: 555 });
    expect(sent).toEqual([
      { body: { name: "widget", private: true }, method: "POST", url: "https://api.github.com/user/repos" },
    ]);
  });

  it("creates in an organisation through the organisation's endpoint", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { ...REPO_PAYLOAD, id: 556 }, sent, status: 201 });

    await createRepoVia({ ctx, input: { name: "widget", org: "acme-labs", private: false } });

    expect(sent).toEqual([
      { body: { name: "widget", private: false }, method: "POST", url: "https://api.github.com/orgs/acme-labs/repos" },
    ]);
  });

  it("sends a refused create once and never retries it", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { message: "Server Error" }, sent, status: 500 });

    const error = unwrapErr(await createRepoVia({ ctx, input: { name: "widget", org: undefined, private: true } }));

    expect(error.status).toBe(500);
    expect(sent.length).toBe(1);
  });
});

describe("setRepoPublicVia", () => {
  it("PATCHes visibility public, once", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: REPO_PAYLOAD, sent, status: 200 });

    await setRepoPublicVia({ ctx, input: { owner: "acme", repo: "widget" } });

    expect(sent).toEqual([
      { body: { visibility: "public" }, method: "PATCH", url: "https://api.github.com/repos/acme/widget" },
    ]);
  });
});
