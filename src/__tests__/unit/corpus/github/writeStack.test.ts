/**
 * Native GitHub stack operations through a real Octokit whose transport is a plain fake `fetch` recording each
 * request: the four stack routes and their projections (a 204 unstack reading as dissolved), and the open
 * pull-request walk whose sentinel sixth page decides truncation — 499 and exactly 500 read complete, 501
 * reads truncated — with the "authored by me" filter riding it.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import {
  addToStackVia,
  createStackVia,
  getStackVia,
  listOpenPrsAuthoredByMeVia,
  listOpenPrsVia,
  unstackVia,
} from "../../../../corpus/github/writeStack.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One request as the fake transport saw it. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** What the fake transport answers one request with; `data` undefined sends no body at all. */
interface FakeReply {
  readonly status: number;
  readonly data: unknown;
}

/** Decides the fake transport's reply to one recorded request. */
type Responder = (request: SentRequest) => FakeReply;

/** Contexts minted so far — each gets its own rate scope, so one test's paced write never delays the next. */
let contextsMinted = 0;

/** A write context whose transport records every request and answers it through `respond`. */
function routedCtx({ sent, respond }: { sent: SentRequest[]; respond: Responder }): WriteCtx {
  contextsMinted += 1;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const body = init?.body;
    const request: SentRequest = {
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      method: String(init?.method),
      url: url instanceof Request ? url.url : url.toString(),
    };
    sent.push(request);
    const reply = respond(request);
    if (reply.data === undefined) {
      return new Response(null, { status: reply.status });
    }
    return new Response(JSON.stringify(reply.data), {
      headers: { "content-type": "application/json" },
      status: reply.status,
    });
  };
  return {
    client: new Octokit({ auth: "test-token", request: { fetch } }),
    scopeId: `stack-${String(contextsMinted)}`,
  };
}

/** The page number a list request asked for. */
function pageOf({ request }: { request: SentRequest }): number {
  return Number(new URL(request.url).searchParams.get("page"));
}

/** A compact raw pull request, as `pulls.list` sends one. */
function rawPr({ number, authorId }: { number: number; authorId: number }): Record<string, unknown> {
  return {
    base: { ref: "main", repo: { full_name: "acme/widgets" } },
    body: null,
    draft: false,
    head: {
      label: `acme:b${String(number)}`,
      ref: `b${String(number)}`,
      repo: { full_name: "acme/widgets" },
      sha: "s",
    },
    html_url: `https://github.com/acme/widgets/pull/${String(number)}`,
    node_id: `PR_${String(number)}`,
    number,
    state: "open",
    title: `pr ${String(number)}`,
    updated_at: "2026-10-01T00:00:00Z",
    user: { id: authorId },
  };
}

/**
 * A responder for a repository holding `total` open pull requests numbered from 1, every one by `authorId`,
 * answering the viewer read with `viewer` (a 403 when undefined).
 */
function repoOf({ total, viewer }: { total: number; viewer: number | undefined }): Responder {
  return (request) => {
    if (request.url.endsWith("/user")) {
      return viewer === undefined
        ? { data: { message: "Forbidden" }, status: 403 }
        : { data: { id: viewer }, status: 200 };
    }
    const first = (pageOf({ request }) - 1) * 100 + 1;
    const count = Math.max(0, Math.min(100, total - first + 1));
    return {
      data: Array.from({ length: count }, (_unused, index) => rawPr({ authorId: 77, number: first + index })),
      status: 200,
    };
  };
}

/** The list pages requested, in order. */
function listPages({ sent }: { sent: readonly SentRequest[] }): number[] {
  return sent.filter((request) => request.url.includes("/pulls?")).map((request) => pageOf({ request }));
}

const REPO = { owner: "acme", repo: "widgets" };
const STACKS_URL = "https://api.github.com/repos/acme/widgets/stacks";
const RAW_STACK = {
  id: 5,
  number: 9,
  open: true,
  pull_requests: [
    { base: { ref: "main" }, head: { ref: "a" }, merged_at: null, number: 1, state: "open" },
    { base: { ref: "a" }, head: { ref: "b" }, merged_at: "2026-10-01T00:00:00Z", number: 2, state: "closed" },
  ],
};
const STACK = {
  entries: [
    { baseRef: "main", headRef: "a", mergedAtIso: undefined, number: 1, state: "open" },
    { baseRef: "a", headRef: "b", mergedAtIso: "2026-10-01T00:00:00Z", number: 2, state: "closed" },
  ],
  id: 5,
  number: 9,
  open: true,
};

describe("createStackVia", () => {
  it("POSTs the pull requests once to the stacks route and projects the created stack", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: () => ({ data: RAW_STACK, status: 201 }), sent });

    expect(unwrap(await createStackVia({ ctx, input: { ...REPO, pullRequests: [1, 2] } }))).toEqual(STACK);
    expect(sent).toEqual([{ body: { pull_requests: [1, 2] }, method: "POST", url: STACKS_URL }]);
  });
});

describe("addToStackVia", () => {
  it("POSTs the added pull requests to the stack's add route", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: () => ({ data: RAW_STACK, status: 200 }), sent });

    expect(unwrap(await addToStackVia({ ctx, input: { ...REPO, pullRequests: [3], stackNumber: 9 } }))).toEqual(STACK);
    expect(sent).toEqual([{ body: { pull_requests: [3] }, method: "POST", url: `${STACKS_URL}/9/add` }]);
  });
});

describe("unstackVia", () => {
  it("reads a 204 with no body as dissolved, and a 200 stack body as the surviving stack", async () => {
    const dissolvedSent: SentRequest[] = [];
    const dissolved = routedCtx({ respond: () => ({ data: undefined, status: 204 }), sent: dissolvedSent });
    const surviving = routedCtx({ respond: () => ({ data: RAW_STACK, status: 200 }), sent: [] });

    expect(unwrap(await unstackVia({ ctx: dissolved, input: { ...REPO, stackNumber: 9 } }))).toBeUndefined();
    expect(unwrap(await unstackVia({ ctx: surviving, input: { ...REPO, stackNumber: 9 } }))).toEqual(STACK);
    expect(dissolvedSent.map((request) => [request.method, request.url])).toEqual([
      ["POST", `${STACKS_URL}/9/unstack`],
    ]);
  });
});

describe("getStackVia", () => {
  it("GETs one stack by number and projects it", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: () => ({ data: RAW_STACK, status: 200 }), sent });

    expect(unwrap(await getStackVia({ ctx, input: { ...REPO, stackNumber: 9 } }))).toEqual(STACK);
    expect(sent).toEqual([{ body: undefined, method: "GET", url: `${STACKS_URL}/9` }]);
  });
});

describe("listOpenPrsVia", () => {
  it("reads 499 open pull requests in five pages as complete, asking no sentinel page", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: repoOf({ total: 499, viewer: 77 }), sent });

    const listed = unwrap(await listOpenPrsVia({ ctx, input: REPO }));

    expect(listed.prs.map((pr) => pr.number)).toEqual(Array.from({ length: 499 }, (_u, index) => index + 1));
    expect(listed.truncated).toBe(false);
    expect(listed.viewerId).toBe(77);
    expect(listPages({ sent })).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads exactly 500 as complete once the sixth sentinel page comes back empty", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: repoOf({ total: 500, viewer: 77 }), sent });

    const listed = unwrap(await listOpenPrsVia({ ctx, input: REPO }));

    expect(listed.prs.map((pr) => pr.number)).toEqual(Array.from({ length: 500 }, (_u, index) => index + 1));
    expect(listed.truncated).toBe(false);
    expect(listPages({ sent })).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reads 501 as truncated, never collecting the sentinel page's pull request", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: repoOf({ total: 501, viewer: 77 }), sent });

    const listed = unwrap(await listOpenPrsVia({ ctx, input: REPO }));

    expect(listed.prs.map((pr) => pr.number)).toEqual(Array.from({ length: 500 }, (_u, index) => index + 1));
    expect(listed.truncated).toBe(true);
    expect(listPages({ sent })).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("still lists every pull request when the viewer read is refused, with the viewer undefined", async () => {
    const ctx = routedCtx({ respond: repoOf({ total: 2, viewer: undefined }), sent: [] });

    const listed = unwrap(await listOpenPrsVia({ ctx, input: REPO }));

    expect(listed.prs.map((pr) => pr.number)).toEqual([1, 2]);
    expect(listed.viewerId).toBeUndefined();
    expect(listed.truncated).toBe(false);
  });
});

describe("listOpenPrsAuthoredByMeVia", () => {
  it("filters a mixed-author list down to the viewer's own pull requests, in order", async () => {
    const respond: Responder = (request) => {
      if (request.url.endsWith("/user")) {
        return { data: { id: 77 }, status: 200 };
      }
      return {
        data: [
          rawPr({ authorId: 77, number: 1 }),
          rawPr({ authorId: 88, number: 2 }),
          rawPr({ authorId: 77, number: 3 }),
        ],
        status: 200,
      };
    };
    const ctx = routedCtx({ respond, sent: [] });

    const mine = unwrap(await listOpenPrsAuthoredByMeVia({ ctx, input: REPO }));

    expect(mine.prs.map((pr) => [pr.number, pr.authorId])).toEqual([
      [1, 77],
      [3, 77],
    ]);
    expect(mine.truncated).toBe(false);
  });

  it("carries a truncated walk's flag onto the filtered answer", async () => {
    const ctx = routedCtx({ respond: repoOf({ total: 501, viewer: 77 }), sent: [] });

    const mine = unwrap(await listOpenPrsAuthoredByMeVia({ ctx, input: REPO }));

    expect(mine.prs.length).toBe(500);
    expect(mine.truncated).toBe(true);
  });

  it("fails rather than answering when the viewer cannot be read", async () => {
    const ctx = routedCtx({ respond: repoOf({ total: 2, viewer: undefined }), sent: [] });

    const error = unwrapErr(await listOpenPrsAuthoredByMeVia({ ctx, input: REPO }));

    expect(error.message).toBe("could not read the authenticated user, so 'authored by me' cannot be decided");
    expect(error.operation).toBe("github.pulls.list");
  });
});
