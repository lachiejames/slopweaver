/**
 * The pull-request CRUD lane through a real Octokit whose transport is a plain fake `fetch` recording each
 * request. The projection `toWrittenPr` is reached through the wrappers, over both a full detail payload and a
 * list-shaped one carrying a deleted author, a deleted head fork and a malformed stack; each wrapper's exact
 * method, route and body (or query) is pinned beside it.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  authenticatedUserIdVia,
  canPushVia,
  closeVia,
  createVia,
  findOpenPrByHeadVia,
  getVia,
  listPrsVia,
  listRunsVia,
  markDraftVia,
  markReadyVia,
  updateVia,
} from "../../../../corpus/github/writeCrud.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { isRecord } from "../../../../lib/parsers.js";
import { unwrap } from "../../../../lib/result.js";

/** One request as the fake transport saw it. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** Contexts minted so far — each gets its own rate scope, so one test's paced write never delays the next. */
let contextsMinted = 0;

/** A write context whose transport answers every request 200 with one JSON body, recording each. */
function recordingCtx({ sent, data }: { sent: SentRequest[]; data: unknown }): WriteCtx {
  contextsMinted += 1;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const body = init?.body;
    sent.push({
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      method: String(init?.method),
      url: url instanceof Request ? url.url : url.toString(),
    });
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" }, status: 200 });
  };
  return { client: new Octokit({ auth: "test-token", request: { fetch } }), scopeId: `crud-${String(contextsMinted)}` };
}

/** The GraphQL variables one recorded request carried. */
function variablesOf({ request }: { request: SentRequest }): unknown {
  return isRecord(request.body) ? request.body["variables"] : undefined;
}

const REPO = { owner: "acme", repo: "widgets" };
const PULLS_URL = "https://api.github.com/repos/acme/widgets/pulls";

/** A detail payload (`pulls.get`/`create`/`update`) carrying every field the projection reads. */
const DETAIL = {
  base: { ref: "main", repo: { full_name: "acme/widgets" } },
  body: "The description.",
  commits: 3,
  draft: true,
  head: { label: "acme:feat", ref: "feat", repo: { full_name: "acme/widgets" }, sha: "abc123" },
  html_url: "https://github.com/acme/widgets/pull/42",
  merged_at: "2026-10-02T00:00:00Z",
  node_id: "PR_9",
  number: 42,
  stack: { id: 929317, number: 16958, position: 1, size: 3 },
  state: "closed",
  title: "feat: a thing",
  updated_at: "2026-10-02T00:00:01Z",
  user: { id: 77 },
};

/** The projection of {@link DETAIL}. */
const DETAIL_PROJECTED = {
  authorId: 77,
  baseRef: "main",
  baseRepoFullName: "acme/widgets",
  body: "The description.",
  commits: 3,
  draft: true,
  head: { label: "acme:feat", ref: "feat", repoFullName: "acme/widgets", sha: "abc123" },
  htmlUrl: "https://github.com/acme/widgets/pull/42",
  mergedAtIso: "2026-10-02T00:00:00Z",
  nodeId: "PR_9",
  number: 42,
  stack: { id: 929317, number: 16958, position: 1, size: 3 },
  state: "closed",
  title: "feat: a thing",
  updatedAtIso: "2026-10-02T00:00:01Z",
};

/** A list-shaped payload: no commits or merged_at, a deleted author, a deleted head fork, a malformed stack. */
const LIST_ITEM = {
  base: { ref: "main", repo: { full_name: "acme/widgets" } },
  body: null,
  head: { label: "ghost:feat", ref: "feat", repo: null, sha: "def456" },
  html_url: "https://github.com/acme/widgets/pull/43",
  node_id: "PR_10",
  number: 43,
  stack: { id: 1, number: 2, size: 3 },
  state: "open",
  title: "fix: another",
  updated_at: "2026-10-03T00:00:00Z",
  user: null,
};

describe("getVia", () => {
  it("GETs the pull request and projects every field of a detail payload, its stack membership included", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: DETAIL, sent });

    expect(unwrap(await getVia({ ctx, input: { ...REPO, number: 42 } }))).toEqual(DETAIL_PROJECTED);
    expect(sent).toEqual([{ body: undefined, method: "GET", url: `${PULLS_URL}/42` }]);
  });
});

describe("listPrsVia", () => {
  it("asks for every state at per_page 2, and projects a list item's absent fields as undefined", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: [LIST_ITEM], sent });

    expect(unwrap(await listPrsVia({ ctx, input: { ...REPO, base: "main", head: "acme:feat" } }))).toEqual([
      {
        authorId: undefined,
        baseRef: "main",
        baseRepoFullName: "acme/widgets",
        body: undefined,
        commits: undefined,
        draft: false,
        head: { label: "ghost:feat", ref: "feat", repoFullName: undefined, sha: "def456" },
        htmlUrl: "https://github.com/acme/widgets/pull/43",
        mergedAtIso: undefined,
        nodeId: "PR_10",
        number: 43,
        stack: undefined,
        state: "open",
        title: "fix: another",
        updatedAtIso: "2026-10-03T00:00:00Z",
      },
    ]);
    expect(sent).toEqual([
      { body: undefined, method: "GET", url: `${PULLS_URL}?base=main&head=acme%3Afeat&per_page=2&state=all` },
    ]);
  });
});

describe("findOpenPrByHeadVia", () => {
  it("prefixes the head with the owner, asks for one open pull request, and answers undefined for none", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: [], sent });

    expect(unwrap(await findOpenPrByHeadVia({ ctx, input: { ...REPO, head: "feat" } }))).toBeUndefined();
    expect(sent).toEqual([
      { body: undefined, method: "GET", url: `${PULLS_URL}?head=acme%3Afeat&per_page=1&state=open` },
    ]);
  });

  it("projects the first match", async () => {
    const ctx = recordingCtx({ data: [DETAIL], sent: [] });

    expect(unwrap(await findOpenPrByHeadVia({ ctx, input: { ...REPO, head: "feat" } }))).toEqual(DETAIL_PROJECTED);
  });
});

describe("createVia", () => {
  it("POSTs exactly the named fields and projects the created pull request", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ data: DETAIL, sent });
    const input = {
      ...REPO,
      base: "main",
      body: "The description.",
      draft: true,
      head: "feat",
      title: "feat: a thing",
    };

    expect(unwrap(await createVia({ ctx, input }))).toEqual(DETAIL_PROJECTED);
    expect(sent).toEqual([
      {
        body: { base: "main", body: "The description.", draft: true, head: "feat", title: "feat: a thing" },
        method: "POST",
        url: PULLS_URL,
      },
    ]);
  });
});

describe("updateVia", () => {
  it("PATCHes only the fields supplied", async () => {
    const titleSent: SentRequest[] = [];
    const baseSent: SentRequest[] = [];

    unwrap(
      await updateVia({
        ctx: recordingCtx({ data: DETAIL, sent: titleSent }),
        input: { ...REPO, number: 42, title: "t" },
      }),
    );
    unwrap(
      await updateVia({
        ctx: recordingCtx({ data: DETAIL, sent: baseSent }),
        input: { ...REPO, base: "dev", number: 42 },
      }),
    );

    expect(titleSent).toEqual([{ body: { title: "t" }, method: "PATCH", url: `${PULLS_URL}/42` }]);
    expect(baseSent).toEqual([{ body: { base: "dev" }, method: "PATCH", url: `${PULLS_URL}/42` }]);
  });
});

describe("closeVia", () => {
  it("PATCHes the literal closed state", async () => {
    const sent: SentRequest[] = [];

    expect(
      unwrap(await closeVia({ ctx: recordingCtx({ data: DETAIL, sent }), input: { ...REPO, number: 42 } })),
    ).toEqual(DETAIL_PROJECTED);
    expect(sent).toEqual([{ body: { state: "closed" }, method: "PATCH", url: `${PULLS_URL}/42` }]);
  });
});

describe("markReadyVia and markDraftVia", () => {
  it("each send one GraphQL mutation carrying the node id as pullRequestId", async () => {
    const readySent: SentRequest[] = [];
    const draftSent: SentRequest[] = [];
    const answer = { data: { pullRequest: { id: "PR_9" } } };

    expect(
      unwrap(await markReadyVia({ ctx: recordingCtx({ data: answer, sent: readySent }), input: { nodeId: "PR_9" } })),
    ).toBeUndefined();
    expect(
      unwrap(await markDraftVia({ ctx: recordingCtx({ data: answer, sent: draftSent }), input: { nodeId: "PR_9" } })),
    ).toBeUndefined();

    expect(readySent.map((request) => variablesOf({ request }))).toEqual([{ pullRequestId: "PR_9" }]);
    expect(draftSent.map((request) => variablesOf({ request }))).toEqual([{ pullRequestId: "PR_9" }]);
  });
});

describe("canPushVia", () => {
  it("answers true only for an explicit push permission, false for false and for none reported", async () => {
    const allowed = recordingCtx({ data: { permissions: { push: true } }, sent: [] });
    const denied = recordingCtx({ data: { permissions: { push: false } }, sent: [] });
    const absent = recordingCtx({ data: { name: "widgets" }, sent: [] });

    expect(unwrap(await canPushVia({ ctx: allowed, input: REPO }))).toBe(true);
    expect(unwrap(await canPushVia({ ctx: denied, input: REPO }))).toBe(false);
    expect(unwrap(await canPushVia({ ctx: absent, input: REPO }))).toBe(false);
  });
});

describe("listRunsVia", () => {
  it("asks for the branch's pull_request runs and projects each to its id, URL and creation time", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      data: { workflow_runs: [{ created_at: "2026-10-01T00:00:00Z", html_url: "https://x/run/5", id: 5 }] },
      sent,
    });

    expect(unwrap(await listRunsVia({ ctx, input: { ...REPO, branch: "feat" } }))).toEqual([
      { createdAt: "2026-10-01T00:00:00Z", htmlUrl: "https://x/run/5", id: 5 },
    ]);
    expect(sent.map((request) => request.url)).toEqual([
      "https://api.github.com/repos/acme/widgets/actions/runs?branch=feat&event=pull_request&per_page=100",
    ]);
  });
});

describe("authenticatedUserIdVia", () => {
  it("GETs the authenticated user and returns its numeric id", async () => {
    const sent: SentRequest[] = [];

    expect(unwrap(await authenticatedUserIdVia({ ctx: recordingCtx({ data: { id: 77, login: "me" }, sent }) }))).toBe(
      77,
    );
    expect(sent).toEqual([{ body: undefined, method: "GET", url: "https://api.github.com/user" }]);
  });
});
