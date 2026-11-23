/**
 * The test-merge reads and the reopen behind `slopweaver github cycle` (`src/corpus/github/prCycle.ts`),
 * measured at the wire against a local server over the real global `fetch`.
 *
 * The unit tests drive the verb over a plain fake of `GithubCycleApi`, so they cannot see what this file pins:
 * which method and path each seam sends, how `mergeable`, `merge_commit_sha` and `auto_merge` are narrowed, that
 * an absent merge ref is "none" rather than a failure, that parents keep their order, that a merge-queue entry
 * travels by GraphQL variables and a missing pull request fails rather than reading unqueued, and that the reopen is sent
 * exactly once against a server that fails it.
 *
 * Local sockets only. Nothing here reaches GitHub, so it needs no token, no cassette and no cleanup.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  commitParentsVia,
  mergeQueuedVia,
  mergeRefVia,
  pullMergeStateVia,
  reopenVia,
} from "../../corpus/github/prCycle.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import { formatIngestError } from "../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { NO_TERMS_GITHUB_PRIVACY } from "../githubWritePrivacyFixture.js";
import { activePolly } from "../setup-polly.js";

const BASE = "a".repeat(40);
const HEAD = "c".repeat(40);
const MERGE = "d".repeat(40);

/** One request the server saw. */
interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

/** A canned answer, keyed by `METHOD path`. */
interface Answer {
  readonly status: number;
  readonly body: unknown;
}

let server: Server;
let baseUrl = "";
let seen: Seen[] = [];
let routes = new Map<string, Answer>();
// The rate scope is derived from the token, and the write class is paced per scope, so a token per test keeps
// one test's write from waiting out the previous test's interval.
let token = "";
let tokenSerial = 0;

function handle(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const path = req.url!.split("?")[0]!;
    seen.push({ body: Buffer.concat(chunks).toString("utf8"), method: req.method!, path });
    const answer = routes.get(`${req.method!} ${path}`);
    if (answer === undefined) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Not Found" }));
      return;
    }
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.body));
  });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${String(port)}`;
});

/** Let ONLY the local server through Polly; every other host stays intercepted. */
beforeEach(() => {
  activePolly()?.server.any(`${baseUrl}/*`).passthrough();
  seen = [];
  routes = new Map();
  tokenSerial += 1;
  token = `local-token-${String(tokenSerial)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A pull-request payload as GitHub sends it, with `over` replacing any field. */
function rawPull(over: Record<string, unknown>): Record<string, unknown> {
  return {
    auto_merge: null,
    base: { ref: "staging", repo: { full_name: "o/r" }, sha: BASE },
    body: null,
    commits: 1,
    draft: false,
    head: { label: "o:feature", ref: "feature", repo: { full_name: "o/r" }, sha: HEAD },
    html_url: "https://github.com/o/r/pull/9",
    merge_commit_sha: MERGE,
    mergeable: true,
    merged_at: null,
    node_id: "PR_node",
    number: 9,
    state: "open",
    title: "t",
    updated_at: "2026-10-02T07:00:00Z",
    user: { id: 1 },
    ...over,
  };
}

describe("the test-merge reads", () => {
  it("reads a pull request with its merge fields", async () => {
    routes.set("GET /repos/o/r/pulls/9", { body: rawPull({}), status: 200 });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    const state = unwrap(await pullMergeStateVia({ ctx, input: { number: 9, owner: "o", repo: "r" } }));

    expect([state.mergeable, state.mergeCommitSha, state.autoMerge]).toEqual([true, MERGE, false]);
    expect([state.pr.baseRef, state.pr.head.sha, state.pr.state]).toEqual(["staging", HEAD, "open"]);
  });

  it("keeps GitHub's null mergeable and reports auto-merge on", async () => {
    routes.set("GET /repos/o/r/pulls/9", {
      body: rawPull({ auto_merge: { merge_method: "squash" }, merge_commit_sha: null, mergeable: null }),
      status: 200,
    });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    const state = unwrap(await pullMergeStateVia({ ctx, input: { number: 9, owner: "o", repo: "r" } }));

    expect([state.mergeable, state.mergeCommitSha, state.autoMerge]).toEqual([null, null, true]);
  });

  // Octokit percent-encodes the ref's slashes, exactly as it does for `branchTipVia`'s `heads/<branch>`.
  it("reads refs/pull/N/merge", async () => {
    routes.set("GET /repos/o/r/git/ref/pull%2F9%2Fmerge", {
      body: { object: { sha: MERGE, type: "commit" }, ref: "refs/pull/9/merge" },
      status: 200,
    });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    expect(unwrap(await mergeRefVia({ ctx, input: { number: 9, owner: "o", repo: "r" } }))).toBe(MERGE);
  });

  it("answers an absent merge ref as none rather than a failure", async () => {
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    expect(unwrap(await mergeRefVia({ ctx, input: { number: 9, owner: "o", repo: "r" } }))).toBeUndefined();
    expect(seen.map((each) => each.path)).toEqual(["/repos/o/r/git/ref/pull%2F9%2Fmerge"]);
  });

  it("reads a commit's parents in order", async () => {
    routes.set(`GET /repos/o/r/git/commits/${MERGE}`, {
      body: { parents: [{ sha: BASE }, { sha: HEAD }], sha: MERGE },
      status: 200,
    });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    expect(unwrap(await commitParentsVia({ ctx, input: { owner: "o", repo: "r", sha: MERGE } }))).toEqual([BASE, HEAD]);
  });
});

describe("the merge-queue read", () => {
  it("asks GraphQL for the entry by variables and reads one as queued", async () => {
    routes.set("POST /graphql", {
      body: { data: { repository: { pullRequest: { mergeQueueEntry: { state: "QUEUED" } } } } },
      status: 200,
    });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    expect(unwrap(await mergeQueuedVia({ ctx, input: { number: 9, owner: "o", repo: "r" } }))).toBe(true);
    expect(JSON.parse(seen[0]!.body).variables).toEqual({ number: 9, owner: "o", repo: "r" });
  });

  it("reads a null entry as not queued", async () => {
    routes.set("POST /graphql", {
      body: { data: { repository: { pullRequest: { mergeQueueEntry: null } } } },
      status: 200,
    });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    expect(unwrap(await mergeQueuedVia({ ctx, input: { number: 9, owner: "o", repo: "r" } }))).toBe(false);
  });

  it("fails rather than reading a missing pull request as not queued", async () => {
    routes.set("POST /graphql", { body: { data: { repository: { pullRequest: null } } }, status: 200 });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    const error = unwrapErr(await mergeQueuedVia({ ctx, input: { number: 9, owner: "o", repo: "r" } }));

    expect(formatIngestError({ error })).toContain("GitHub returned no pull request o/r#9 for its queue entry");
  });
});

describe("the reopen write", () => {
  it("patches the pull request open once", async () => {
    routes.set("PATCH /repos/o/r/pulls/9", { body: rawPull({}), status: 200 });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    expect(unwrap(await reopenVia({ ctx, input: { number: 9, owner: "o", repo: "r" } })).state).toBe("open");
    expect(seen.map((each) => [each.method, each.path, JSON.parse(each.body)])).toEqual([
      ["PATCH", "/repos/o/r/pulls/9", { state: "open" }],
    ]);
  });

  it("surfaces a failed reopen and never sends it twice", async () => {
    routes.set("PATCH /repos/o/r/pulls/9", { body: { message: "Internal Server Error" }, status: 500 });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    const error = unwrapErr(await reopenVia({ ctx, input: { number: 9, owner: "o", repo: "r" } }));

    expect(formatIngestError({ error })).toContain("500");
    expect(seen).toHaveLength(1);
  });
});
