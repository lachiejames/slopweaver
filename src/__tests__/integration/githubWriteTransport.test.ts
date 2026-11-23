/**
 * The GitHub write TRANSPORT, measured at the wire against a local server over the real global `fetch`.
 *
 * This file exists because the recorded cassette in `./githubWrite.test.ts` structurally cannot prove two
 * things, and an adversarial review pass caught the second one being falsely claimed there.
 *
 * **1. What the request actually carried — narrowed, not closed, by cassette request-body fidelity.** Polly
 * matched with `body: false` AND blanked the persisted request body, so a replay never saw what was sent. The
 * cassette's `expect(pr.draft).toBe(true)` therefore proved nothing: the test authored `draft: true`, the
 * recording echoed it back, and a transport rewritten to send `draft: false` would have replayed the same
 * recorded response and passed. That assertion is gone from the cassette file.
 *
 * `cassetteRequestBody.ts` now persists a projection of every request body and holds a replayed request to
 * it, so a re-recorded cassette DOES catch a flipped `draft`. Two reasons this file still carries the
 * property rather than handing it over. The GitHub write cassette is one of the 19 still on the fidelity
 * DEBT (`cassetteBodyDebt.ts`): its two entries were recorded while bodies were blanked, so until it is
 * re-recorded there is nothing there to be held to. And a projection is deliberately lossy — it keeps
 * booleans, numbers and enums, never free text — so `title` and `body` can only ever be proven here, against
 * the bytes the server received.
 *
 * **2. How many times an irreversible POST is sent.** A cassette replays one recorded exchange; it cannot
 * count attempts. `pulls.create` must be at-most-once, so the count is measured here against a server that
 * deliberately misbehaves.
 *
 * Local sockets only. Nothing here reaches GitHub, so it needs no token, no cassette and no cleanup.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import { formatIngestError } from "../../lib/ingestError.js";
import { NO_TERMS_GITHUB_PRIVACY } from "../githubWritePrivacyFixture.js";
import { parseOwnJson } from "../parseOwnJson.js";
import { activePolly } from "../setup-polly.js";

/** One request the server saw: enough to assert what the transport actually sent. */
interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

/** How the server should misbehave for the current case. */
type Mode = "ok" | "redirect" | "server-error" | "misdirected" | "hangup";

let server: Server;
let baseUrl = "";
let seen: Seen[] = [];
let mode: Mode = "ok";

/** A pull-request payload shaped enough for the transport to narrow, including `toWrittenPr`'s required fields. */
function prPayload(): string {
  return JSON.stringify({
    base: { ref: "main", repo: { full_name: "o/r" } },
    body: "b",
    draft: true,
    head: { label: "o:h", ref: "h", repo: { full_name: "o/r" }, sha: "headsha" },
    html_url: "https://example.invalid/pr/1",
    node_id: "PR_local",
    number: 1,
    state: "open",
    title: "t",
    updated_at: "2026-08-03T00:00:00Z",
    user: { id: 42 },
  });
}

/** A native-stack payload shaped enough for `toGithubStack` to narrow. */
function stackPayload(): string {
  return JSON.stringify({
    id: 900,
    number: 5,
    open: true,
    pull_requests: [
      { base: { ref: "main" }, head: { ref: "bottom" }, merged_at: null, number: 10, state: "open" },
      { base: { ref: "bottom" }, head: { ref: "top" }, merged_at: null, number: 11, state: "open" },
    ],
  });
}

/** An accepted asynchronous merge request, shaped as GitHub's `merge-async` endpoint documents it. */
function asyncMergePayload(): string {
  return JSON.stringify({
    details: {
      expected_head_sha: "headsha",
      merge_action: "merge_queue",
      merge_method: "default",
      message: "Merge request accepted",
      uuid: "1f0c2b3a",
    },
    status: "pending",
  });
}

/** Answer one successful local request after the common transport-failure cases. */
function answerOk({ req, res }: { req: IncomingMessage; res: ServerResponse }): void {
  if (req.url === "/user") {
    res.end(JSON.stringify({ id: 42 }));
    return;
  }
  if (req.url?.includes("/merge-async") === true) {
    res.end(asyncMergePayload());
    return;
  }
  if (req.url?.includes("/stacks") === true) {
    res.end(stackPayload());
    return;
  }
  if (req.url === "/graphql") {
    answerGraphql({ res });
    return;
  }
  res.end(req.method === "GET" ? `[${prPayload()}]` : prPayload());
}

/** Answer either GraphQL operation from the request already captured in `seen`. */
function answerGraphql({ res }: { res: ServerResponse }): void {
  const request: unknown = JSON.parse(seen.at(-1)!.body);
  const query =
    typeof request === "object" && request !== null && "query" in request && typeof request.query === "string"
      ? request.query
      : "";
  if (query.includes("SlopweaverReviewThreads")) {
    res.end(
      JSON.stringify({
        data: {
          node: {
            reviewThreads: {
              nodes: [
                { comments: { nodes: [{ id: "C1" }] }, id: "T1", isResolved: false },
                { comments: { nodes: [{ id: "C2" }] }, id: "T2", isResolved: false },
              ],
            },
          },
        },
      }),
    );
    return;
  }
  res.end(
    JSON.stringify({
      data: {
        resolve0: { thread: { id: "OLD", isResolved: true } },
        review: { pullRequestReview: { comments: { nodes: [{ id: "C1" }, { id: "C2" }] }, id: "R1" } },
      },
    }),
  );
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    // `!` rather than `?? ""`: node always populates both on a server request, and coalescing would turn a
    // missing method into a silent empty string that no assertion below could distinguish from a real one.
    seen.push({ body: Buffer.concat(chunks).toString("utf8"), method: req.method!, url: req.url! });
    if (mode === "redirect" && req.url !== "/landed") {
      res.writeHead(307, { Location: `${baseUrl}/landed` });
      res.end();
      return;
    }
    if (mode === "hangup") {
      // The far side closes the connection instead of answering. This is what a keep-alive socket GitHub had
      // already hung up on looks like from here, and it is the exact shape that took six `github enqueue`
      // presses on a pull request with `other side closed` as their entire output.
      res.socket?.destroy();
      return;
    }
    if (mode === "misdirected") {
      res.writeHead(421, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Misdirected Request" }));
      return;
    }
    if (mode === "server-error") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Internal Server Error" }));
      return;
    }
    res.writeHead(201, { "content-type": "application/json" });
    answerOk({ req, res });
  });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${String(port)}`;
});

/**
 * Let the local server through Polly.
 *
 * The integration lane installs Polly for every test, and its fetch adapter would otherwise intercept these
 * localhost calls and fail them against a cassette that does not exist. `activePolly()` is exported for a
 * test to adjust its own interception, and passing through ONE host is the narrowest possible use of it —
 * every other host stays intercepted, so this file cannot accidentally reach the network.
 */
beforeEach(() => {
  activePolly()?.server.any(`${baseUrl}/*`).passthrough();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let apiCount = 0;

/**
 * A write api pointed at the local server, with a token of its own. `github:write` is paced per token scope
 * (`PACED_CLASSES`, `src/lib/providerCall.ts`) at ~9 s, so one shared token spent 135 s of this file waiting:
 * fifteen cases at 9.0 s each, MEASURED on CI and locally — reproduce with
 * `yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/githubWriteTransport.test.ts`.
 * Nothing here asserts spacing, so a distinct token per case keeps each case's wire its own.
 */
function localApi(): ReturnType<typeof makeGithubWriteApi> {
  apiCount += 1;
  return makeGithubWriteApi({
    baseUrl,
    privacy: NO_TERMS_GITHUB_PRIVACY,
    token: `local-test-token-${String(apiCount)}`,
  });
}

describe("what the create request actually carries", () => {
  it("forwards draft, title, base and head as the caller gave them", async () => {
    seen = [];
    mode = "ok";
    await localApi().createPr({
      base: "main",
      body: "THE RENDERED BODY",
      draft: true,
      head: "a-branch",
      owner: "o",
      repo: "r",
      title: "THE TITLE",
    });

    expect(seen).toHaveLength(1);
    const sent: unknown = JSON.parse(seen[0]!.body);
    // The assertion the cassette could not make. A transport that dropped or inverted `draft` would replay
    // the recorded `draft: true` and pass there; here the server saw what was really sent.
    expect(sent).toStrictEqual({
      base: "main",
      body: "THE RENDERED BODY",
      draft: true,
      head: "a-branch",
      title: "THE TITLE",
    });
  });

  it("forwards draft FALSE when the caller asks for a non-draft, rather than always sending true", async () => {
    seen = [];
    mode = "ok";
    await localApi().createPr({
      base: "main",
      body: "b",
      draft: false,
      head: "h",
      owner: "o",
      repo: "r",
      title: "t",
    });
    const sent = parseOwnJson<{ draft: boolean }>({ text: seen[0]!.body });
    expect(sent.draft).toBe(false);
  });

  it("sends NO body at all for an update that names neither title nor body", async () => {
    // Measured, and stronger than the `{}` this originally asserted: Octokit sends nothing whatsoever when
    // every remaining argument is a path parameter. A field cannot be blanked by a request that does not
    // mention it, so "omitted" here is a wire fact rather than a hopeful one.
    seen = [];
    mode = "ok";
    await localApi().updatePr({ number: 1, owner: "o", repo: "r" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("PATCH");
    expect(seen[0]!.body).toBe("");
  });

  it("sends ONLY the body when an update names only the body", async () => {
    seen = [];
    mode = "ok";
    await localApi().updatePr({ body: "ONLY THE BODY", number: 1, owner: "o", repo: "r" });
    expect(JSON.parse(seen[0]!.body)).toStrictEqual({ body: "ONLY THE BODY" });
  });
});

describe("how many times an irreversible create is actually sent", () => {
  /**
   * A 307 preserves method and body by specification, so following one re-POSTs. Measured before the fix:
   * the shipped read client sent 2, and disabling Octokit's retries alone still sent 2, because the redirect
   * is followed below the SDK. `redirect: "manual"` in the write lane's fetch is what makes it 1.
   */
  it("does not re-POST when the server answers 307", async () => {
    seen = [];
    mode = "redirect";
    await localApi().createPr({ base: "main", body: "b", draft: true, head: "h", owner: "o", repo: "r", title: "t" });
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  /**
   * The read client in `corpus/github/githubClient.ts` sends 4 POSTs here, because its retry plugin treats a 5xx as
   * retryable. `retryMode: "never"` plus `retries: 0` is what holds this at one.
   */
  it("does not re-POST when the server answers 500", async () => {
    seen = [];
    mode = "server-error";
    await localApi().createPr({ base: "main", body: "b", draft: true, head: "h", owner: "o", repo: "r", title: "t" });
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  /**
   * The one case that is NOT at-most-once, pinned rather than left unsaid.
   *
   * undici re-dispatches a 421 below `fetch`, so no Octokit option and no wrapper in this lane can stop it;
   * only pinning a custom dispatcher could, which is a bigger change than this lane justifies. It is also
   * the one repeat that is safe by specification — 421 asserts the server was NOT authoritative and did not
   * handle the request — so the second send cannot duplicate a committed create.
   *
   * This asserts TWO, which is the truth. An adversarial review pass pointed out that the suite claimed
   * at-most-once while testing only the cases where that holds; a test that quietly skips the exception is
   * how the exception gets forgotten. If someone later pins a dispatcher and makes this one, the test goes
   * red and they update it deliberately.
   */
  it("DOES re-POST once when the server answers 421, which no option in this lane can prevent", async () => {
    seen = [];
    mode = "misdirected";
    await localApi().createPr({ base: "main", body: "b", draft: true, head: "h", owner: "o", repo: "r", title: "t" });
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(2);
  });
});

describe("inline self-review GraphQL transport", () => {
  it("sends one submitted COMMENT review before the exact prior-thread resolution", async () => {
    seen = [];
    mode = "ok";
    const result = await localApi().submitReviewRound({
      comments: [
        { body: "First walkthrough.", line: 4, path: "src/a.ts" },
        { body: "Second walkthrough.", line: 9, path: "src/b.ts" },
      ],
      commitOid: "abc123",
      pullRequestId: "PR1",
      resolveThreadIds: ["OLD"],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toBe("/graphql");
    const sent: unknown = JSON.parse(seen[0]!.body);
    expect(sent).toEqual({
      query:
        "mutation SlopweaverReplaceSelfReview($review: AddPullRequestReviewInput!, $thread0: ID!) {\n" +
        "          review: addPullRequestReview(input: $review) {\n" +
        "            pullRequestReview { id comments(first: 100) { nodes { id } } }\n" +
        "          }\n" +
        "          resolve0: resolveReviewThread(input: { threadId: $thread0 }) { thread { id isResolved } }\n" +
        "        }",
      variables: {
        review: {
          commitOID: "abc123",
          event: "COMMENT",
          pullRequestId: "PR1",
          threads: [
            { body: "First walkthrough.", line: 4, path: "src/a.ts", side: "RIGHT" },
            { body: "Second walkthrough.", line: 9, path: "src/b.ts", side: "RIGHT" },
          ],
        },
        thread0: "OLD",
      },
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ commentIds: ["C1", "C2"], reviewId: "R1" });
  });

  it("maps the bounded newest-thread readback without dropping comment ids", async () => {
    seen = [];
    mode = "ok";
    const result = await localApi().reviewThreads({ pullRequestId: "PR1" });
    expect(seen).toHaveLength(1);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([
      { commentIds: ["C1"], id: "T1", isResolved: false },
      { commentIds: ["C2"], id: "T2", isResolved: false },
    ]);
  });

  it("does not retry the irreversible composite mutation after a server error", async () => {
    seen = [];
    mode = "server-error";
    await localApi().submitReviewRound({
      comments: [{ body: "Walkthrough.", line: 4, path: "src/a.ts" }],
      commitOid: "abc123",
      pullRequestId: "PR1",
      resolveThreadIds: [],
    });
    expect(seen.filter((request) => request.method === "POST")).toHaveLength(1);
  });
});

describe("the native-stack REST endpoints, added for github-stack-verbs Phase 2", () => {
  it("findOpenPrByHead sends the owner-qualified head filter and narrows the first match", async () => {
    seen = [];
    mode = "ok";
    const result = await localApi().findOpenPrByHead({ head: "a-branch", owner: "o", repo: "r" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("GET");
    expect(seen[0]!.url).toContain("head=o%3Aa-branch");
    expect(seen[0]!.url).toContain("state=open");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()!.number).toBe(1);
  });

  it("createStack POSTs the ordered pull-request numbers and narrows the returned stack", async () => {
    seen = [];
    mode = "ok";
    const result = await localApi().createStack({ owner: "o", pullRequests: [10, 11], repo: "r" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toContain("/repos/o/r/stacks");
    expect(JSON.parse(seen[0]!.body)).toStrictEqual({ pull_requests: [10, 11] });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      entries: [
        { baseRef: "main", headRef: "bottom", mergedAtIso: undefined, number: 10, state: "open" },
        { baseRef: "bottom", headRef: "top", mergedAtIso: undefined, number: 11, state: "open" },
      ],
      id: 900,
      number: 5,
      open: true,
    });
  });

  it("getStack GETs the named stack and narrows its full entries", async () => {
    seen = [];
    mode = "ok";
    const result = await localApi().getStack({ owner: "o", repo: "r", stackNumber: 5 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("GET");
    expect(seen[0]!.url).toBe("/repos/o/r/stacks/5");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().entries.map((entry) => entry.number)).toEqual([10, 11]);
  });

  it("listOpenPrsAuthoredByMe pages open PRs and keeps only the viewer's own", async () => {
    seen = [];
    mode = "ok";
    const result = await localApi().listOpenPrsAuthoredByMe({ owner: "o", repo: "r" });
    // The fixed `prPayload()` always reports author id 42 (see its `user` field) and the local server
    // always answers `getAuthenticated` and `pulls.list` with the same fixtures — this proves the two
    // calls compose (identity read, then a filtered page), not that a REAL mismatch gets filtered out.
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().prs).toHaveLength(1);
    // A short first page ends the walk, so the sentinel page past the bound is never asked for and the
    // answer is complete rather than cut short. The flag exists because the interface doc claimed truncation
    // was reported while the return type carried no field for it, and every caller read a cap as the end.
    expect(result._unsafeUnwrap().truncated).toBe(false);
    expect(seen.filter((request) => request.url.includes("/pulls?"))).toHaveLength(1);
  });

  it("addToStack POSTs to the named stack's /add route with the extending pull requests", async () => {
    seen = [];
    mode = "ok";
    const result = await localApi().addToStack({ owner: "o", pullRequests: [12], repo: "r", stackNumber: 5 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toContain("/repos/o/r/stacks/5/add");
    expect(JSON.parse(seen[0]!.body)).toStrictEqual({ pull_requests: [12] });
    expect(result.isOk()).toBe(true);
  });

  it("unstack POSTs to the named stack's /unstack route and narrows a surviving 200 body", async () => {
    seen = [];
    mode = "ok";
    const result = await localApi().unstack({ owner: "o", repo: "r", stackNumber: 5 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toContain("/repos/o/r/stacks/5/unstack");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.entries.map((entry) => entry.number)).toEqual([10, 11]);
  });
});

/**
 * The asynchronous stack-merge request, at the wire.
 *
 * This is the file that can prove the REST body, and the only one: a unit test over the projection sees the
 * response and never the request, and the cassette lane matches with `body: false` so a replay cannot see
 * one either. The two properties that matter are the SHA pin — without it a force-push mid-flight is queued
 * unseen — and the absence of `merge_method`, which the queue owns and this verb must not override.
 */
describe("the asynchronous stack-merge request, added because GraphQL refuses a native-stack member", () => {
  it("PUTs the documented route with exactly the SHA pin and the merge_queue action", async () => {
    seen = [];
    mode = "ok";

    const result = await localApi().enqueueStackPr({
      expectedHeadOid: "headsha",
      number: 16_378,
      owner: "o",
      repo: "r",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("PUT");
    expect(seen[0]!.url).toBe("/repos/o/r/pulls/16378/merge-async");
    // EXACTLY these two fields. `merge_method` is absent on purpose — naming one here would silently
    // override the queue's own configured method — and so are `commit_title`/`commit_message`.
    expect(JSON.parse(seen[0]!.body)).toStrictEqual({ merge_action: "merge_queue", sha: "headsha" });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toStrictEqual({
      message: "Merge request accepted",
      status: "pending",
      uuid: "1f0c2b3a",
    });
  });

  it("does not re-send the request when the server answers 500", async () => {
    seen = [];
    mode = "server-error";
    const result = await localApi().enqueueStackPr({ expectedHeadOid: "h", number: 1, owner: "o", repo: "r" });
    expect(seen.filter((request) => request.method === "PUT")).toHaveLength(1);
    expect(result.isErr()).toBe(true);
  });

  it("does not follow a 307 into a second request, which would start a second merge job", async () => {
    seen = [];
    mode = "redirect";
    await localApi().enqueueStackPr({ expectedHeadOid: "h", number: 1, owner: "o", repo: "r" });
    expect(seen.filter((request) => request.method === "PUT")).toHaveLength(1);
  });
});

/**
 * The class that took the verb off the air: no HTTP response at all.
 *
 * Asserted here rather than in a unit test because the whole finding is what THREE libraries do to one
 * error on the way up — undici raises `SocketError: other side closed` with `code: UND_ERR_SOCKET`,
 * `fetch` wraps it in `TypeError: fetch failed`, and `@octokit/request` replaces the message with the
 * cause's and stamps a SYNTHETIC `status: 500` on a request that was never answered. A hand-built fixture
 * can restate that chain; only a real socket can prove it is still the chain.
 */
describe("a connection the far side closes without answering", () => {
  it("reports the undici transport code, no status, and does not re-send the enqueue", async () => {
    seen = [];
    mode = "hangup";

    const result = await localApi().enqueuePr({ expectedHeadOid: "headsha", nodeId: "PR_kwlocal" });

    // The input CARRIES the thing the assertions below call absent: the mutation really was sent, and the
    // server really did receive it before hanging up. Without this, "no status" would also be true of a
    // request that never left.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/graphql");
    expect(JSON.parse(seen[0]!.body)).toMatchObject({
      variables: { expectedHeadOid: "headsha", pullRequestId: "PR_kwlocal" },
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.kind).toBe("network");
    expect(error.code).toBe("UND_ERR_SOCKET");
    expect(error.message).toBe("other side closed");
    // Octokit's invented 500 is gone: nothing answered, so there is no status to report.
    expect(error.status).toBeUndefined();
    expect(formatIngestError({ error })).toBe("github github.enqueuePullRequest UND_ERR_SOCKET: other side closed");
  });
});
