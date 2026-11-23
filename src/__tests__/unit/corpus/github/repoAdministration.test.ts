/**
 * A repository's identity read, and its rename, transfer and archive, through a real Octokit whose transport is a
 * plain fake `fetch` recording each request. Each write sends exactly its one field once — a 500 on it is the
 * caller's error after one request, never a retry — and a transfer's `202 Accepted` is success of the SEND only.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  archiveRepoVia,
  getRepoAdministrationVia,
  renameRepoVia,
  transferRepoVia,
} from "../../../../corpus/github/repoAdministration.js";
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
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" }, status });
  };
  return { client: new Octokit({ auth: "test-token", request: { fetch } }), scopeId };
}

const REPO_URL = "https://api.github.com/repos/acme/widgets";

/** The repository payload fields the read maps, as GitHub sends them. */
const REPO_PAYLOAD = {
  archived: false,
  full_name: "acme/widgets",
  html_url: "https://github.com/acme/widgets",
  id: 4242,
  name: "widgets",
  owner: { login: "acme" },
};

describe("getRepoAdministrationVia", () => {
  it("GETs the repository and answers its id, address and archive state", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: REPO_PAYLOAD, scopeId: "repo-admin-get", sent, status: 200 });

    const result = await getRepoAdministrationVia({ ctx, input: { owner: "acme", repo: "widgets" } });

    expect(unwrap(result)).toStrictEqual({
      archived: false,
      fullName: "acme/widgets",
      htmlUrl: "https://github.com/acme/widgets",
      id: 4242,
      name: "widgets",
      ownerLogin: "acme",
    });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: REPO_URL }]);
  });

  it("fails as an http 404 naming the operation when nothing lives at the address", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { message: "Not Found" }, scopeId: "repo-admin-get-404", sent, status: 404 });

    const error = unwrapErr(await getRepoAdministrationVia({ ctx, input: { owner: "acme", repo: "widgets" } }));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(404);
    expect(error.operation).toBe("github.repos.get");
  });
});

describe("renameRepoVia", () => {
  it("PATCHes exactly the new name once", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: REPO_PAYLOAD, scopeId: "repo-admin-rename", sent, status: 200 });

    const result = await renameRepoVia({ ctx, input: { newName: "gadgets", owner: "acme", repo: "widgets" } });

    expect(result.isOk()).toBe(true);
    expect(sent).toEqual([{ body: { name: "gadgets" }, method: "PATCH", url: REPO_URL }]);
  });

  it("fails after exactly one request when GitHub answers 500", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { message: "Server Error" },
      scopeId: "repo-admin-rename-500",
      sent,
      status: 500,
    });

    const error = unwrapErr(
      await renameRepoVia({ ctx, input: { newName: "gadgets", owner: "acme", repo: "widgets" } }),
    );

    expect(error.status).toBe(500);
    expect(error.operation).toBe("github.repos.update");
    expect(sent.length).toBe(1);
  });
});

describe("archiveRepoVia", () => {
  it("PATCHes exactly archived true once", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: REPO_PAYLOAD, scopeId: "repo-admin-archive", sent, status: 200 });

    const result = await archiveRepoVia({ ctx, input: { owner: "acme", repo: "widgets" } });

    expect(result.isOk()).toBe(true);
    expect(sent).toEqual([{ body: { archived: true }, method: "PATCH", url: REPO_URL }]);
  });

  it("fails after exactly one request when GitHub answers 500", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { message: "Server Error" },
      scopeId: "repo-admin-archive-500",
      sent,
      status: 500,
    });

    const error = unwrapErr(await archiveRepoVia({ ctx, input: { owner: "acme", repo: "widgets" } }));

    expect(error.status).toBe(500);
    expect(sent.length).toBe(1);
  });
});

describe("transferRepoVia", () => {
  it("POSTs exactly the new owner once and treats 202 Accepted as a sent request", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: REPO_PAYLOAD, scopeId: "repo-admin-transfer", sent, status: 202 });

    const result = await transferRepoVia({ ctx, input: { newOwner: "fixture-owner", owner: "acme", repo: "widgets" } });

    expect(result.isOk()).toBe(true);
    expect(sent).toEqual([{ body: { new_owner: "fixture-owner" }, method: "POST", url: `${REPO_URL}/transfer` }]);
  });

  it("fails after exactly one request when GitHub answers 500", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { message: "Server Error" },
      scopeId: "repo-admin-transfer-500",
      sent,
      status: 500,
    });

    const error = unwrapErr(
      await transferRepoVia({ ctx, input: { newOwner: "fixture-owner", owner: "acme", repo: "widgets" } }),
    );

    expect(error.status).toBe(500);
    expect(error.operation).toBe("github.repos.transfer");
    expect(sent.length).toBe(1);
  });
});
