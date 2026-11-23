/**
 * The remote-ref TRANSPORT (`src/corpus/github/refs.ts` through `src/outbound/github/refs.ts`), measured at
 * the wire against a local server over the real global `fetch`.
 *
 * The unit tests drive the two verbs over a plain fake of `GithubRefsApi`, so they cannot see what this file
 * pins: which method and path each seam sends, that a 404 on a ref READ means "absent" while every other
 * status surfaces, that an annotated tag is peeled to its commit, and that a write is sent exactly once
 * against a server that fails it.
 *
 * Local sockets only. Nothing here reaches GitHub, so it needs no token, no cassette and no cleanup.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tagCommitVia } from "../../corpus/github/refs.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import { formatIngestError } from "../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { makeGithubRefsApi } from "../../outbound/github/refs.js";
import { NO_TERMS_GITHUB_PRIVACY } from "../githubWritePrivacyFixture.js";
import { activePolly } from "../setup-polly.js";

const TIP = "a".repeat(40);
const ANNOTATION = "e".repeat(40);

/** One request the server saw. */
interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

/** A canned answer, keyed by `METHOD decoded-path`. */
interface Answer {
  readonly status: number;
  readonly body: unknown;
}

let server: Server;
let baseUrl = "";
let seen: Seen[] = [];
let routes = new Map<string, Answer>();

function handle(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    // Routed on the DECODED path so a test states the ref once; `seen` keeps it decoded too, and the encoding
    // itself is asserted separately against `rawPaths`.
    const path = decodeURIComponent(req.url!.split("?")[0]!);
    rawPaths.push(req.url!);
    seen.push({ body: Buffer.concat(chunks).toString("utf8"), method: req.method!, path });
    const answer = routes.get(`${req.method!} ${path}`);
    if (answer === undefined) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Not Found" }));
      return;
    }
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(answer.status === 204 ? "" : JSON.stringify(answer.body));
  });
}

let rawPaths: string[] = [];
// The rate scope is derived from the token, and the write class is paced per scope: one shared token made every
// write test wait out the previous test's write interval (9s each, measured). A token per test is a scope per test.
let token = "";
let tokenSerial = 0;

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
  rawPaths = [];
  routes = new Map();
  tokenSerial += 1;
  token = `local-token-${String(tokenSerial)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function api(): ReturnType<typeof makeGithubRefsApi> {
  return makeGithubRefsApi({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });
}

describe("ref reads", () => {
  it("reads a slash-named branch's tip, and a 404 as absent", async () => {
    routes.set("GET /repos/o/r/git/ref/heads/old/work", {
      body: { object: { sha: TIP, type: "commit" }, ref: "refs/heads/old/work" },
      status: 200,
    });

    expect(unwrap(await api().branchTip({ branch: "old/work", owner: "o", repo: "r" }))).toBe(TIP);
    expect(unwrap(await api().branchTip({ branch: "gone", owner: "o", repo: "r" }))).toBe(undefined);
    expect(rawPaths).toEqual(["/repos/o/r/git/ref/heads%2Fold%2Fwork", "/repos/o/r/git/ref/heads%2Fgone"]);
  });

  it("surfaces a non-404 failure instead of calling the branch absent", async () => {
    routes.set("GET /repos/o/r/git/ref/heads/old", { body: { message: "Forbidden" }, status: 403 });

    const error = unwrapErr(await api().branchTip({ branch: "old", owner: "o", repo: "r" }));
    expect(formatIngestError({ error })).toContain("403");
  });

  it("peels an annotated tag to its commit, and reads a missing tag as absent", async () => {
    routes.set("GET /repos/o/r/git/ref/tags/retired/x", {
      body: { object: { sha: ANNOTATION, type: "tag" }, ref: "refs/tags/retired/x" },
      status: 200,
    });
    routes.set(`GET /repos/o/r/git/tags/${ANNOTATION}`, {
      body: { object: { sha: TIP, type: "commit" }, sha: ANNOTATION },
      status: 200,
    });

    expect(unwrap(await api().tagCommit({ owner: "o", repo: "r", tag: "retired/x" }))).toBe(TIP);
    expect(unwrap(await api().tagCommit({ owner: "o", repo: "r", tag: "absent" }))).toBe(undefined);
  });

  it("does not read a failed annotation lookup as an absent tag", async () => {
    routes.set("GET /repos/o/r/git/ref/tags/t", {
      body: { object: { sha: ANNOTATION, type: "tag" }, ref: "refs/tags/t" },
      status: 200,
    });

    const error = unwrapErr(await api().tagCommit({ owner: "o", repo: "r", tag: "t" }));
    expect(formatIngestError({ error })).toContain("404");
  });

  it("refuses an annotation chain that loops, rather than following it forever", async () => {
    routes.set("GET /repos/o/r/git/ref/tags/loop", {
      body: { object: { sha: ANNOTATION, type: "tag" }, ref: "refs/tags/loop" },
      status: 200,
    });
    routes.set(`GET /repos/o/r/git/tags/${ANNOTATION}`, {
      body: { object: { sha: ANNOTATION, type: "tag" }, sha: ANNOTATION },
      status: 200,
    });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    const error = unwrapErr(await tagCommitVia({ ctx, input: { owner: "o", repo: "r", tag: "loop" } }));

    expect(formatIngestError({ error })).toContain("tag loop is annotated more than 8 levels deep");
    expect(seen.filter((s) => s.path === `/repos/o/r/git/tags/${ANNOTATION}`)).toHaveLength(8);
  });

  it("answers a missing commit as false, and finds open pull requests on both sides of the branch", async () => {
    routes.set(`GET /repos/o/r/git/commits/${TIP}`, { body: { sha: TIP }, status: 200 });
    routes.set("GET /repos/o/r/pulls", { body: [{ number: 7 }], status: 200 });

    expect(unwrap(await api().commitExists({ owner: "o", repo: "r", sha: TIP }))).toBe(true);
    expect(unwrap(await api().commitExists({ owner: "o", repo: "r", sha: ANNOTATION }))).toBe(false);
    expect(unwrap(await api().openPrsOnBranch({ branch: "old", owner: "o", repo: "r" }))).toEqual([7]);
    const pullQueries = rawPaths.filter((path) => path.startsWith("/repos/o/r/pulls")).toSorted();
    expect(pullQueries).toEqual([
      "/repos/o/r/pulls?base=old&per_page=100&state=open",
      "/repos/o/r/pulls?head=o%3Aold&per_page=100&state=open",
    ]);
  });
});

describe("ref writes", () => {
  it("creates an annotated tag as an annotation object, then a ref at that object", async () => {
    routes.set("POST /repos/o/r/git/tags", { body: { sha: ANNOTATION }, status: 201 });
    routes.set("POST /repos/o/r/git/refs", { body: { ref: "refs/tags/retired/x" }, status: 201 });

    const annotation = unwrap(
      await api().createTag({ message: "archive", owner: "o", repo: "r", sha: TIP, tag: "retired/x" }),
    );

    expect(annotation).toBe(ANNOTATION);

    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /repos/o/r/git/tags", "POST /repos/o/r/git/refs"]);
    expect(JSON.parse(seen[0]!.body)).toEqual({ message: "archive", object: TIP, tag: "retired/x", type: "commit" });
    expect(JSON.parse(seen[1]!.body)).toEqual({ ref: "refs/tags/retired/x", sha: ANNOTATION });
  });

  it("creates a lightweight tag as one ref write at the commit", async () => {
    routes.set("POST /repos/o/r/git/refs", { body: { ref: "refs/tags/t" }, status: 201 });

    const annotation = unwrap(await api().createTag({ message: undefined, owner: "o", repo: "r", sha: TIP, tag: "t" }));

    expect(annotation).toBeUndefined();

    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /repos/o/r/git/refs"]);
    expect(JSON.parse(seen[0]!.body)).toEqual({ ref: "refs/tags/t", sha: TIP });
  });

  it("names a possible orphan when the annotation write itself fails, and writes no ref", async () => {
    routes.set("POST /repos/o/r/git/tags", { body: { message: "Internal Server Error" }, status: 500 });

    const error = unwrapErr(await api().createTag({ message: "m", owner: "o", repo: "r", sha: TIP, tag: "t" }));

    expect(formatIngestError({ error })).toContain(
      "an unreachable annotation object for t may exist; no tag ref was written",
    );
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /repos/o/r/git/tags"]);
  });

  it("names the orphaned annotation object when the ref write fails, sending it once", async () => {
    routes.set("POST /repos/o/r/git/tags", { body: { sha: ANNOTATION }, status: 201 });
    routes.set("POST /repos/o/r/git/refs", { body: { message: "Internal Server Error" }, status: 500 });

    const error = unwrapErr(await api().createTag({ message: "m", owner: "o", repo: "r", sha: TIP, tag: "t" }));

    expect(formatIngestError({ error })).toContain(
      `annotation object ${ANNOTATION} was created; the tag ref write then failed, or its answer was lost`,
    );
    expect(seen.filter((s) => s.path === "/repos/o/r/git/refs")).toHaveLength(1);
  });

  it("deletes at the expected tip and creates the keep-tag in ONE updateRefs call", async () => {
    routes.set("GET /repos/o/r", { body: { default_branch: "main", node_id: "R_local" }, status: 200 });
    routes.set("POST /graphql", { body: { data: { updateRefs: { clientMutationId: null } } }, status: 200 });

    unwrap(
      await api().deleteBranchAtTip({
        branch: "old/work",
        createTag: "archive/old",
        holdTag: undefined,
        owner: "o",
        repo: "r",
        tip: TIP,
      }),
    );

    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /repos/o/r", "POST /graphql"]);
    const request = JSON.parse(seen[1]!.body) as { query: string; variables: unknown };
    expect(request.query).toContain("updateRefs(input: $input)");
    expect(request.variables).toEqual({
      input: {
        refUpdates: [
          { afterOid: TIP, beforeOid: "0".repeat(40), name: "refs/tags/archive/old" },
          { afterOid: "0".repeat(40), beforeOid: TIP, name: "refs/heads/old/work" },
        ],
        repositoryId: "R_local",
      },
    });
  });

  it("holds an existing annotated keep-tag at its own ref oid in the same updateRefs call", async () => {
    routes.set("GET /repos/o/r", { body: { default_branch: "main", node_id: "R_local" }, status: 200 });
    routes.set("GET /repos/o/r/git/ref/tags/archive/old", {
      body: { object: { sha: ANNOTATION, type: "tag" }, ref: "refs/tags/archive/old" },
      status: 200,
    });
    routes.set(`GET /repos/o/r/git/tags/${ANNOTATION}`, {
      body: { object: { sha: TIP, type: "commit" }, sha: ANNOTATION },
      status: 200,
    });
    routes.set("POST /graphql", { body: { data: { updateRefs: { clientMutationId: null } } }, status: 200 });

    unwrap(
      await api().deleteBranchAtTip({
        branch: "old",
        createTag: undefined,
        holdTag: "archive/old",
        owner: "o",
        repo: "r",
        tip: TIP,
      }),
    );

    const request = JSON.parse(seen.find((s) => s.path === "/graphql")!.body) as {
      variables: { input: { refUpdates: unknown[] } };
    };
    expect(request.variables.input.refUpdates).toEqual([
      { afterOid: ANNOTATION, beforeOid: ANNOTATION, name: "refs/tags/archive/old" },
      { afterOid: "0".repeat(40), beforeOid: TIP, name: "refs/heads/old" },
    ]);
  });

  it("sends no update when the keep-tag to hold no longer peels to the tip", async () => {
    routes.set("GET /repos/o/r", { body: { default_branch: "main", node_id: "R_local" }, status: 200 });
    routes.set("GET /repos/o/r/git/ref/tags/archive/old", {
      body: { object: { sha: "b".repeat(40), type: "commit" }, ref: "refs/tags/archive/old" },
      status: 200,
    });

    const error = unwrapErr(
      await api().deleteBranchAtTip({
        branch: "old",
        createTag: undefined,
        holdTag: "archive/old",
        owner: "o",
        repo: "r",
        tip: TIP,
      }),
    );

    expect(formatIngestError({ error })).toContain(
      `tag archive/old peels to ${"b".repeat(40)}, not ${TIP}; nothing was written`,
    );
    expect(seen.filter((s) => s.path === "/graphql")).toHaveLength(0);
  });

  it("never reads an unfollowed redirect on a tag ref write as a write that landed", async () => {
    routes.set("POST /repos/o/r/git/refs", { body: {}, status: 307 });

    const error = unwrapErr(
      await api().createTag({ message: undefined, owner: "o", repo: "r", sha: TIP, tag: "archive/old" }),
    );

    expect(formatIngestError({ error })).toContain(
      "GitHub answered 307 to the tag ref write for archive/old, not 201 Created; nothing is assumed written",
    );
    expect(seen.filter((s) => s.path === "/repos/o/r/git/refs")).toHaveLength(1);
  });

  it("never reads an updateRefs answer without its payload as an applied update", async () => {
    routes.set("GET /repos/o/r", { body: { default_branch: "main", node_id: "R_local" }, status: 200 });
    routes.set("POST /graphql", { body: { data: { updateRefs: null } }, status: 200 });

    const error = unwrapErr(
      await api().deleteBranchAtTip({
        branch: "old",
        createTag: undefined,
        holdTag: undefined,
        owner: "o",
        repo: "r",
        tip: TIP,
      }),
    );

    expect(formatIngestError({ error })).toContain("carried no updateRefs payload; nothing is assumed written");
  });

  it("sends a rejected update once and surfaces GitHub's reason", async () => {
    routes.set("GET /repos/o/r", { body: { default_branch: "main", node_id: "R_local" }, status: 200 });
    routes.set("POST /graphql", {
      body: { data: null, errors: [{ message: "A ref update was rejected: refs/heads/old moved" }] },
      status: 200,
    });

    const error = unwrapErr(
      await api().deleteBranchAtTip({
        branch: "old",
        createTag: undefined,
        holdTag: undefined,
        owner: "o",
        repo: "r",
        tip: TIP,
      }),
    );

    expect(formatIngestError({ error })).toContain("refs/heads/old moved");
    expect(seen.filter((s) => s.path === "/graphql")).toHaveLength(1);
    const request = JSON.parse(seen[1]!.body) as { variables: { input: { refUpdates: unknown[] } } };
    expect(request.variables.input.refUpdates).toEqual([
      { afterOid: "0".repeat(40), beforeOid: TIP, name: "refs/heads/old" },
    ]);
  });
});
