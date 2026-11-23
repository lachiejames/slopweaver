/**
 * The code-scanning default-setup TRANSPORT, measured at the wire against a local server over the real global
 * `fetch` — the same harness as `./githubWriteTransport.test.ts`, for the same two reasons: a cassette cannot
 * show what the PATCH carried, and it cannot count how many times it was sent.
 *
 * It also pins the one distinction the verb's enforcement decision rests on: the configuration read's 204
 * ("none attached") is `undefined`, while a 404 is an ERROR, never absence.
 *
 * Local sockets only. Nothing here reaches GitHub, so it needs no token, no cassette and no cleanup.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeGithubDefaultSetupApi } from "../../corpus/github/defaultSetup.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { NO_TERMS_GITHUB_PRIVACY } from "../githubWritePrivacyFixture.js";
import { activePolly } from "../setup-polly.js";

let apiCount = 0;

/**
 * A fresh API per case. Writes are paced per token scope, so a shared token would pace the second PATCH ~9s
 * behind the first and prove nothing about the transport; a distinct token per case keeps each case's wire
 * its own.
 */
function freshApi(): ReturnType<typeof makeGithubDefaultSetupApi> {
  apiCount += 1;
  return makeGithubDefaultSetupApi({
    baseUrl,
    privacy: NO_TERMS_GITHUB_PRIVACY,
    token: `local-test-token-${String(apiCount)}`,
  });
}

/** One request the server saw. */
interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

/** How the server answers the current case. */
type Mode =
  "ok" | "never-configured" | "none-attached" | "not-found" | "queued" | "org-controlled" | "private-free-plan";

let server: Server;
let baseUrl = "";
let seen: Seen[] = [];
let mode: Mode = "ok";

const SETUP = JSON.stringify({
  languages: ["actions", "javascript-typescript"],
  query_suite: "default",
  schedule: "weekly",
  state: "configured",
  updated_at: "2026-08-26T18:32:23Z",
});

/** A repository where default setup was never configured: GitHub sends `null` for its schedule and update time. */
const NEVER_CONFIGURED_SETUP = JSON.stringify({
  languages: [],
  query_suite: "default",
  schedule: null,
  state: "not-configured",
  updated_at: null,
});

const CONFIGURATION = JSON.stringify({
  configuration: {
    code_scanning_default_setup: "enabled",
    enforcement: "enforced",
    html_url: "https://github.com/organizations/o/settings/security_products/configurations/view/7",
    id: 7,
    name: "Org baseline",
    target_type: "organization",
  },
  status: "enforced",
});

/** The one request a disable sends, body included. */
const PATCH_DISABLE: Seen = {
  body: JSON.stringify({ state: "not-configured" }),
  method: "PATCH",
  url: "/repos/o/r/code-scanning/default-setup",
};

/** The one request an enable sends: the state alone, no query suite and no language list. */
const PATCH_ENABLE: Seen = {
  body: JSON.stringify({ state: "configured" }),
  method: "PATCH",
  url: "/repos/o/r/code-scanning/default-setup",
};

/** The repository read an enable binds its digest to, trimmed to what the projection reads. */
const REPOSITORY = JSON.stringify({
  archived: false,
  full_name: "o/r",
  html_url: "https://github.com/o/r",
  id: 4242,
  name: "r",
  owner: { login: "o" },
});

/**
 * GitHub's answer to a code-scanning read on a private repository without Advanced Security, as measured with
 * `slopweaver github code-scanning enable --repo lachiejames/slopweaver` (a preview; it sends nothing).
 */
const PRIVATE_FREE_PLAN_MESSAGE =
  "Code scanning is not enabled for this repository. Please enable code scanning in the repository settings.";

/** Answer the configuration read according to `mode`. */
function answerConfiguration({ res }: { res: ServerResponse }): void {
  if (mode === "none-attached") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (mode === "not-found") {
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "Not Found" }));
    return;
  }
  res.end(CONFIGURATION);
}

/** Answer a default-setup PATCH according to `mode`. */
function answerPatch({ res }: { res: ServerResponse }): void {
  if (mode === "org-controlled") {
    res.statusCode = 422;
    res.end(JSON.stringify({ message: "Code scanning default setup cannot be modified." }));
    return;
  }
  if (mode === "queued") {
    res.statusCode = 202;
    res.end(JSON.stringify({ run_id: 9, run_url: "https://api.github.com/repos/o/r/actions/runs/9" }));
    return;
  }
  res.end("{}");
}

/** Answer one request according to `mode`. */
function answer({ req, res }: { req: IncomingMessage; res: ServerResponse }): void {
  res.setHeader("content-type", "application/json");
  if (req.url === "/repos/o/r") {
    res.end(REPOSITORY);
    return;
  }
  if (mode === "private-free-plan") {
    res.statusCode = 403;
    res.end(JSON.stringify({ message: PRIVATE_FREE_PLAN_MESSAGE }));
    return;
  }
  if (req.url === "/repos/o/r/code-security-configuration") {
    answerConfiguration({ res });
    return;
  }
  if (req.method === "PATCH") {
    answerPatch({ res });
    return;
  }
  res.end(mode === "never-configured" ? NEVER_CONFIGURED_SETUP : SETUP);
}

/** Record the request, then answer it. */
function handle(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    seen.push({ body: Buffer.concat(chunks).toString("utf8"), method: req.method!, url: req.url! });
    answer({ req, res });
  });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${String(port)}`;
});

/** Pass through this ONE local host; every other host stays intercepted by the lane's Polly. */
beforeEach(() => {
  activePolly()?.server.any(`${baseUrl}/*`).passthrough();
  seen = [];
  mode = "ok";
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("makeGithubDefaultSetupApi", () => {
  it("reads default setup and projects GitHub's fields", async () => {
    const api = freshApi();
    const setup = unwrap(await api.defaultSetup({ owner: "o", repo: "r" }));

    expect(setup).toEqual({
      languages: ["actions", "javascript-typescript"],
      querySuite: "default",
      schedule: "weekly",
      state: "configured",
      updatedAt: "2026-08-26T18:32:23Z",
    });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET /repos/o/r/code-scanning/default-setup"]);
  });

  it("reads GitHub's null schedule and update time as absent fields, each key still present", async () => {
    mode = "never-configured";
    const api = freshApi();
    const setup = unwrap(await api.defaultSetup({ owner: "o", repo: "r" }));

    expect(setup).toStrictEqual({
      languages: [],
      querySuite: "default",
      schedule: undefined,
      state: "not-configured",
      updatedAt: undefined,
    });
    expect(Object.keys(setup)).toEqual(["languages", "querySuite", "schedule", "state", "updatedAt"]);
  });

  it("reads an attached configuration with both enforcement signals", async () => {
    const api = freshApi();
    const configuration = unwrap(await api.securityConfiguration({ owner: "o", repo: "r" }));

    expect(configuration).toEqual({
      codeScanningDefaultSetup: "enabled",
      enforcement: "enforced",
      htmlUrl: "https://github.com/organizations/o/settings/security_products/configurations/view/7",
      id: 7,
      name: "Org baseline",
      status: "enforced",
      targetType: "organization",
    });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET /repos/o/r/code-security-configuration"]);
  });

  it("reads a 204 as no configuration attached", async () => {
    mode = "none-attached";
    const api = freshApi();
    const configuration = unwrap(await api.securityConfiguration({ owner: "o", repo: "r" }));

    expect(configuration).toBeUndefined();
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET /repos/o/r/code-security-configuration"]);
  });

  it("keeps a 404 as an error, never as absence", async () => {
    mode = "not-found";
    const api = freshApi();
    const error = unwrapErr(await api.securityConfiguration({ owner: "o", repo: "r" }));

    expect(error.status).toBe(404);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET /repos/o/r/code-security-configuration"]);
  });

  it("sends exactly state not-configured, once, and keeps a 200 as an acknowledgement", async () => {
    const api = freshApi();
    const acknowledgement = unwrap(await api.disableDefaultSetup({ owner: "o", repo: "r" }));

    expect(acknowledgement).toEqual({ runUrl: undefined, status: 200 });
    expect(seen).toEqual([PATCH_DISABLE]);
  });

  it("carries a 202's run URL", async () => {
    mode = "queued";
    const api = freshApi();
    const acknowledgement = unwrap(await api.disableDefaultSetup({ owner: "o", repo: "r" }));

    expect(acknowledgement).toEqual({ runUrl: "https://api.github.com/repos/o/r/actions/runs/9", status: 202 });
    expect(seen).toEqual([PATCH_DISABLE]);
  });

  it("sends a refused PATCH once and surfaces GitHub's 422", async () => {
    mode = "org-controlled";
    const api = freshApi();
    const error = unwrapErr(await api.disableDefaultSetup({ owner: "o", repo: "r" }));

    expect(error.status).toBe(422);
    expect(seen).toEqual([PATCH_DISABLE]);
  });

  it("enable sends exactly state configured, once, and keeps a 200 as an acknowledgement", async () => {
    const api = freshApi();
    const acknowledgement = unwrap(await api.enableDefaultSetup({ owner: "o", repo: "r" }));

    expect(acknowledgement).toEqual({ runUrl: undefined, status: 200 });
    expect(seen).toEqual([PATCH_ENABLE]);
  });

  it("enable carries a 202's run URL", async () => {
    mode = "queued";
    const api = freshApi();
    const acknowledgement = unwrap(await api.enableDefaultSetup({ owner: "o", repo: "r" }));

    expect(acknowledgement).toEqual({ runUrl: "https://api.github.com/repos/o/r/actions/runs/9", status: 202 });
    expect(seen).toEqual([PATCH_ENABLE]);
  });

  it("enable sends a refused PATCH once and surfaces GitHub's 422", async () => {
    mode = "org-controlled";
    const api = freshApi();
    const error = unwrapErr(await api.enableDefaultSetup({ owner: "o", repo: "r" }));

    expect(error.status).toBe(422);
    expect(seen).toEqual([PATCH_ENABLE]);
  });

  it("reads the repository identity an enable's digest binds", async () => {
    const api = freshApi();
    const repository = unwrap(await api.repository({ owner: "o", repo: "r" }));

    expect(repository).toEqual({
      archived: false,
      fullName: "o/r",
      htmlUrl: "https://github.com/o/r",
      id: 4242,
      name: "r",
      ownerLogin: "o",
    });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET /repos/o/r"]);
  });

  it("keeps a private free-plan repository's 403 as an error carrying GitHub's message", async () => {
    mode = "private-free-plan";
    const api = freshApi();
    const error = unwrapErr(await api.defaultSetup({ owner: "o", repo: "r" }));

    expect(error.status).toBe(403);
    expect(error.message).toContain(PRIVATE_FREE_PLAN_MESSAGE);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET /repos/o/r/code-scanning/default-setup"]);
  });
});
