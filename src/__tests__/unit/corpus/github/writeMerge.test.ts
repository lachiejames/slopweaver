/**
 * The admin-merge lane's three seams, through a real Octokit whose transport is a plain fake `fetch` recording
 * each request: admin permission is `true` only for an explicit `admin: true`, a 404 on branch protection is
 * the `unprotected` state while any other refusal stays a failure, and the squash merge is one SHA-pinned PUT
 * that sends a commit title but never a commit message, and is never retried.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { branchProtectionVia, canAdminVia, mergeVia } from "../../../../corpus/github/writeMerge.js";
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

const REPO = { owner: "acme", repo: "widgets" };
const REPO_URL = "https://api.github.com/repos/acme/widgets";

describe("canAdminVia", () => {
  it("GETs the repository and answers true for an explicit admin permission", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { permissions: { admin: true, push: true } },
      scopeId: "merge-admin",
      sent,
      status: 200,
    });

    expect(unwrap(await canAdminVia({ ctx, input: REPO }))).toBe(true);
    expect(sent).toEqual([{ body: undefined, method: "GET", url: REPO_URL }]);
  });

  it("answers false when admin is false, and false when GitHub reports no permissions at all", async () => {
    const denied = recordingCtx({
      data: { permissions: { admin: false, push: true } },
      scopeId: "merge-admin-false",
      sent: [],
      status: 200,
    });
    const absent = recordingCtx({ data: { name: "widgets" }, scopeId: "merge-admin-absent", sent: [], status: 200 });

    expect(unwrap(await canAdminVia({ ctx: denied, input: REPO }))).toBe(false);
    expect(unwrap(await canAdminVia({ ctx: absent, input: REPO }))).toBe(false);
  });
});

describe("branchProtectionVia", () => {
  const BRANCH = { ...REPO, branch: "main" };
  const PROTECTION_URL = `${REPO_URL}/branches/main/protection`;

  it("reads a protected branch that enforces protection on admins", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { enforce_admins: { enabled: true } }, scopeId: "protect-on", sent, status: 200 });

    expect(unwrap(await branchProtectionVia({ ctx, input: BRANCH }))).toEqual({
      enforceAdmins: true,
      kind: "protected",
    });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: PROTECTION_URL }]);
  });

  it("reads a protected branch whose payload carries no enforce_admins as not enforcing it", async () => {
    const ctx = recordingCtx({ data: { url: PROTECTION_URL }, scopeId: "protect-absent", sent: [], status: 200 });

    expect(unwrap(await branchProtectionVia({ ctx, input: BRANCH }))).toEqual({
      enforceAdmins: false,
      kind: "protected",
    });
  });

  it("translates a 404 into exactly the unprotected state, after one request", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { message: "Branch not protected" }, scopeId: "protect-404", sent, status: 404 });

    expect(unwrap(await branchProtectionVia({ ctx, input: BRANCH }))).toEqual({ kind: "unprotected" });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: PROTECTION_URL }]);
  });

  it("translates the plan-gated 403 into exactly the plan-unavailable state, after one request", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: {
        documentation_url: "https://docs.github.com/rest/branches/branch-protection#get-branch-protection",
        message: "Upgrade to GitHub Pro or make this repository public to enable this feature.",
      },
      scopeId: "protect-403-plan",
      sent,
      status: 403,
    });

    expect(unwrap(await branchProtectionVia({ ctx, input: BRANCH }))).toEqual({ kind: "plan-unavailable" });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: PROTECTION_URL }]);
  });

  it("keeps any other 403 a typed permission denial rather than reading it as unprotected", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { message: "Forbidden" }, scopeId: "protect-403", sent, status: 403 });

    const error = unwrapErr(await branchProtectionVia({ ctx, input: BRANCH }));

    expect(error.code).toBe("PROTECTION_PERMISSION_DENIED");
    expect(error.branch).toBe("main");
    expect(error.cause.status).toBe(403);
    expect(error.cause.operation).toBe("github.repos.getBranchProtection");
    expect(error.message).toContain("GitHub denied this token permission to read main's branch protection");
    expect(sent).toEqual([{ body: undefined, method: "GET", url: PROTECTION_URL }]);
  });

  it("keeps any other refusal a read failure, never a state", async () => {
    const ctx = recordingCtx({ data: { message: "Unprocessable" }, scopeId: "protect-422", sent: [], status: 422 });

    const error = unwrapErr(await branchProtectionVia({ ctx, input: BRANCH }));

    expect(error.code).toBe("PROTECTION_READ_FAILED");
    expect(error.cause.status).toBe(422);
    expect(error.message).toBe("could not read main's branch protection: Unprocessable");
  });
});

describe("mergeVia", () => {
  const MERGE = { ...REPO, commitTitle: "feat: land it (#42)", number: 42, sha: "abc123" };
  const MERGE_URL = `${REPO_URL}/pulls/42/merge`;

  it("sends one SHA-pinned squash PUT with a commit title and no commit_message key", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { merged: true, sha: "def456" }, scopeId: "merge-ok", sent, status: 200 });

    expect(unwrap(await mergeVia({ ctx, input: MERGE }))).toEqual({ merged: true, sha: "def456" });
    expect(sent).toEqual([
      {
        body: { commit_title: "feat: land it (#42)", merge_method: "squash", sha: "abc123" },
        method: "PUT",
        url: MERGE_URL,
      },
    ]);
  });

  it("reports merged false when GitHub's answer does not say true", async () => {
    const ctx = recordingCtx({ data: { sha: "def456" }, scopeId: "merge-unsaid", sent: [], status: 200 });

    expect(unwrap(await mergeVia({ ctx, input: MERGE }))).toEqual({ merged: false, sha: "def456" });
  });

  it("fails after exactly one request when GitHub refuses the merge with 422", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { message: "Head branch was modified" },
      scopeId: "merge-422",
      sent,
      status: 422,
    });

    const error = unwrapErr(await mergeVia({ ctx, input: MERGE }));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(422);
    expect(error.operation).toBe("github.pulls.merge");
    expect(sent.length).toBe(1);
  });

  it("never retries even a 500 a repeatable read would retry — one request, then the failure", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: { message: "Server Error" }, scopeId: "merge-500", sent, status: 500 });

    const error = unwrapErr(await mergeVia({ ctx, input: MERGE }));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
    expect(sent.length).toBe(1);
  });
});
