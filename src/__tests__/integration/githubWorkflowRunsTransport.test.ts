/**
 * The workflow-run TRANSPORT behind `slopweaver github rerun` (`src/corpus/github/workflowRuns.ts`), measured at
 * the wire against a local server over the real global `fetch`.
 *
 * The unit tests drive the verb over a plain fake of `GithubRerunApi`, so they cannot see what this file pins:
 * which method and path each seam sends, how a run payload is narrowed, that a commit's run list reports a
 * truncated page, and that the re-run is sent exactly once against a server that fails it.
 *
 * Local sockets only. Nothing here reaches GitHub, so it needs no token, no cassette and no cleanup.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rerunFailedJobsVia, runsForHeadVia, workflowRunVia } from "../../corpus/github/workflowRuns.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import { formatIngestError } from "../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { NO_TERMS_GITHUB_PRIVACY } from "../githubWritePrivacyFixture.js";
import { activePolly } from "../setup-polly.js";

const HEAD = "c".repeat(40);

/** One request the server saw. */
interface Seen {
  readonly method: string;
  readonly path: string;
}

/** A canned answer, keyed by `METHOD path`. */
interface Answer {
  readonly status: number;
  readonly body: unknown;
}

let server: Server;
let baseUrl = "";
let seen: Seen[] = [];
let rawPaths: string[] = [];
let routes = new Map<string, Answer>();
// The rate scope is derived from the token, and the write class is paced per scope, so a token per test keeps
// one test's write from waiting out the previous test's interval.
let token = "";
let tokenSerial = 0;

function handle(req: IncomingMessage, res: ServerResponse): void {
  req.resume();
  req.on("end", () => {
    const path = req.url!.split("?")[0]!;
    rawPaths.push(req.url!);
    seen.push({ method: req.method!, path });
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
  rawPaths = [];
  routes = new Map();
  tokenSerial += 1;
  token = `local-token-${String(tokenSerial)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A run payload as GitHub sends it, with `over` replacing any field. */
function rawRun(over: Record<string, unknown>): Record<string, unknown> {
  return {
    conclusion: "failure",
    event: "pull_request",
    head_sha: HEAD,
    html_url: "https://github.com/o/r/actions/runs/7",
    id: 7,
    name: "ci",
    run_attempt: 1,
    status: "completed",
    workflow_id: 42,
    ...over,
  };
}

describe("run reads", () => {
  it("reads one run, narrowed, with its attempt", async () => {
    routes.set("GET /repos/o/r/actions/runs/7", { body: rawRun({ run_attempt: 2 }), status: 200 });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    expect(unwrap(await workflowRunVia({ ctx, input: { owner: "o", repo: "r", runId: 7 } }))).toEqual({
      conclusion: "failure",
      event: "pull_request",
      headSha: HEAD,
      htmlUrl: "https://github.com/o/r/actions/runs/7",
      id: 7,
      name: "ci",
      runAttempt: 2,
      status: "completed",
      workflowId: 42,
    });
  });

  it("names a nameless run by its id", async () => {
    routes.set("GET /repos/o/r/actions/runs/7", { body: rawRun({ name: null }), status: 200 });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    expect(unwrap(await workflowRunVia({ ctx, input: { owner: "o", repo: "r", runId: 7 } })).name).toBe("run 7");
  });

  it("lists a commit's runs in one page, and reports the page complete", async () => {
    routes.set("GET /repos/o/r/actions/runs", {
      body: { total_count: 2, workflow_runs: [rawRun({ id: 7 }), rawRun({ conclusion: "success", id: 8 })] },
      status: 200,
    });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    const listed = unwrap(await runsForHeadVia({ ctx, input: { headSha: HEAD, owner: "o", repo: "r" } }));

    expect(listed.runs.map((run) => [run.id, run.conclusion])).toEqual([
      [7, "failure"],
      [8, "success"],
    ]);
    expect(listed.truncated).toBe(false);
    expect(rawPaths).toEqual([`/repos/o/r/actions/runs?head_sha=${HEAD}&per_page=100`]);
  });

  it("reports a list GitHub counts longer than the page it sent as truncated", async () => {
    routes.set("GET /repos/o/r/actions/runs", { body: { total_count: 101, workflow_runs: [rawRun({})] }, status: 200 });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    expect(unwrap(await runsForHeadVia({ ctx, input: { headSha: HEAD, owner: "o", repo: "r" } })).truncated).toBe(true);
  });
});

describe("the re-run write", () => {
  it("posts to the failed-jobs endpoint once", async () => {
    routes.set("POST /repos/o/r/actions/runs/7/rerun-failed-jobs", { body: {}, status: 201 });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    unwrap(await rerunFailedJobsVia({ ctx, input: { owner: "o", repo: "r", runId: 7 } }));

    expect(seen).toEqual([{ method: "POST", path: "/repos/o/r/actions/runs/7/rerun-failed-jobs" }]);
  });

  it("surfaces a failed re-run and never sends it twice", async () => {
    routes.set("POST /repos/o/r/actions/runs/7/rerun-failed-jobs", {
      body: { message: "Internal Server Error" },
      status: 500,
    });
    const ctx = makeGithubWriteCtx({ baseUrl, privacy: NO_TERMS_GITHUB_PRIVACY, token });

    const error = unwrapErr(await rerunFailedJobsVia({ ctx, input: { owner: "o", repo: "r", runId: 7 } }));

    expect(formatIngestError({ error })).toContain("500");
    expect(seen).toHaveLength(1);
  });
});
