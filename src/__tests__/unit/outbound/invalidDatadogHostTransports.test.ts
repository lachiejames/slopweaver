/**
 * The dead-Datadog-host refusal at each write transport: a payload carrying the shape of host the bot actually
 * posted is refused before a byte leaves, and a read or a clean write goes through.
 *
 * Every transport is exercised through its real construction. The Slack and GitHub refusals throw before the SDK
 * reaches the network, so neither needs a server; Linear and Vanta take a plain injected function that counts
 * its calls — a seam, not a mock.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Stream } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  vantaDeadHostRefusal,
  vantaDraftEditDeadHostRefusal,
  vantaPolicyUploadDeadHostRefusal,
} from "../../../atlas/vanta/deadHostRefusal.js";
import { vantaTransportFailureLines } from "../../../atlas/vanta/httpErrors.js";
import { createVantaTransport, type VantaFetchLike, type VantaSleepLike } from "../../../atlas/vanta/transport.js";
import { githubWritePayload, makeGithubWriteCtx } from "../../../corpus/github/writeCtx.js";
import { makeLinearSendContext, makeLinearWriteApi } from "../../../corpus/linear/write.js";
import { parsedMutateVia } from "../../../corpus/linear/writeGraphql.js";
import { GuardedWebClient, refuseUploadAddressedToDeadHost } from "../../../corpus/slack/guardedWebClient.js";
import { isGraphqlMutation } from "../../../lib/graphqlOperation.js";
import { logger } from "../../../lib/logger.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { InvalidDatadogHostRefusedError } from "../../../outbound/invalidDatadogHost.js";
import { NO_TERMS_GITHUB_PRIVACY } from "../../githubWritePrivacyFixture.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../../linearWritePrivacyFixture.js";
import { NO_TERMS_SLACK_PRIVACY } from "../../slackWritePrivacyFixture.js";

/** The link the bot actually posted, but on the synthetic `ap1` site rather than the install's own. */
const OFFENDING_URL = "https://app.ap1.datadoghq.com/monitors/1000001";

/** The same monitor on that site's real console host, still on the synthetic `ap1` site. */
const CORRECT_URL = "https://ap1.datadoghq.com/monitors/1000001";

/** A Stream that is not a Readable: it serves its body once through read(), as the SDK's file contract allows. */
class LegacyStream extends Stream {
  #body: Buffer | null;

  constructor({ body }: { body: Buffer }) {
    super();
    this.#body = body;
  }

  read(): Buffer | null {
    const served = this.#body;
    this.#body = null;
    return served;
  }
}

describe("Slack — GuardedWebClient", () => {
  it("refuses a chat.postMessage carrying the dead host, before the SDK sends", async () => {
    const client = new GuardedWebClient({ privacy: NO_TERMS_SLACK_PRIVACY, token: "xoxb-not-a-real-token" });
    await expect(
      client.chat.postMessage({ channel: "C0SYN000000000", text: `the monitor: ${OFFENDING_URL}` }),
    ).rejects.toThrow(InvalidDatadogHostRefusedError);
  });

  it("names the method and the correct host in the refusal", async () => {
    const client = new GuardedWebClient({ privacy: NO_TERMS_SLACK_PRIVACY, token: "xoxb-not-a-real-token" });
    await expect(client.chat.update({ channel: "C0SYN000000000", text: OFFENDING_URL, ts: "1.2" })).rejects.toThrow(
      /^slack chat\.update blocked because .*app\.ap1\.datadoghq\.com is not a Datadog console; use ap1\.datadoghq\.com — found at text\)/u,
    );
  });
  it("refuses an upload whose file bytes carry the dead host, before the SDK asks Slack for an upload URL", async () => {
    const client = new GuardedWebClient({ privacy: NO_TERMS_SLACK_PRIVACY, token: "xoxb-not-a-real-token" });
    await expect(
      client.files.uploadV2({ file: Buffer.from(`report ${OFFENDING_URL}`), filename: "report.txt" }),
    ).rejects.toThrow(/^slack files\.uploadV2 blocked because .*use ap1\.datadoghq\.com — found at file\)/u);
  });

  it("reads a Blob file, which the synchronous walk cannot, and refuses the dead host inside it", async () => {
    const client = new GuardedWebClient({ privacy: NO_TERMS_SLACK_PRIVACY, token: "xoxb-not-a-real-token" });
    const upload: Record<string, unknown> = { file: new Blob([OFFENDING_URL]), filename: "report.txt" };
    await expect(client.filesUploadV2(upload as never)).rejects.toThrow(/use ap1\.datadoghq\.com — found at file\)/u);
  });

  it("reads a path and a stream into the bytes it judges, refusing the dead host in either", async () => {
    const client = new GuardedWebClient({ privacy: NO_TERMS_SLACK_PRIVACY, token: "xoxb-not-a-real-token" });
    const dir = mkdtempSync(join(tmpdir(), "dead-host-upload-"));
    const path = join(dir, "report.txt");
    writeFileSync(path, `report ${OFFENDING_URL}`);
    try {
      await expect(client.files.uploadV2({ file: path, filename: "report.txt" })).rejects.toThrow(
        /use ap1\.datadoghq\.com — found at file\)/u,
      );
      await expect(
        client.files.uploadV2({ file: Readable.from([Buffer.from(OFFENDING_URL)]), filename: "report.txt" }),
      ).rejects.toThrow(/use ap1\.datadoghq\.com — found at file\)/u);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("drains a plain Stream the way the SDK does, refusing the dead host inside it", async () => {
    const client = new GuardedWebClient({ privacy: NO_TERMS_SLACK_PRIVACY, token: "xoxb-not-a-real-token" });
    const legacy = new LegacyStream({ body: Buffer.from(OFFENDING_URL) });
    const upload = client.files.uploadV2({ file: legacy, filename: "report.txt" });
    setImmediate(() => {
      legacy.emit("readable");
      legacy.emit("end");
    });
    await expect(upload).rejects.toThrow(/use ap1\.datadoghq\.com — found at file\)/u);
  });

  it("refuses an upload address Slack hands back on the dead host, before the bytes are posted to it", () => {
    const answer = { file_id: "F1", ok: true, upload_url: `${OFFENDING_URL}/upload` };
    expect(() => refuseUploadAddressedToDeadHost({ method: "files.getUploadURLExternal", result: answer })).toThrow(
      /^slack files\.uploadV2 blocked because .*use ap1\.datadoghq\.com — found at upload_url\)/u,
    );
  });

  it("passes a clean upload address, and every other method's answer, untouched", () => {
    const clean = { file_id: "F1", ok: true, upload_url: "https://files.slack.com/upload/v1/abc" };
    const history = { ok: true, text: OFFENDING_URL };
    expect(refuseUploadAddressedToDeadHost({ method: "files.getUploadURLExternal", result: clean })).toBeUndefined();
    expect(refuseUploadAddressedToDeadHost({ method: "conversations.history", result: history })).toBeUndefined();
  });
});

describe("GitHub — the write lane's request hook", () => {
  it("refuses a comment carrying the dead host, before fetch runs", async () => {
    const { client } = makeGithubWriteCtx({ privacy: NO_TERMS_GITHUB_PRIVACY, token: "ghp_not_a_real_token" });
    await expect(
      client.rest.issues.createComment({ body: `see ${OFFENDING_URL}`, issue_number: 1, owner: "o", repo: "r" }),
    ).rejects.toThrow("use ap1.datadoghq.com");
  });

  it("judges a REST write's fields, less the transport options", () => {
    expect(
      githubWritePayload({ options: { body: OFFENDING_URL, method: "POST", request: { fetch: 1 }, url: "/x" } }),
    ).toEqual({ body: OFFENDING_URL, method: "POST", url: "/x" });
  });

  it("waves a REST read through", () => {
    expect(githubWritePayload({ options: { method: "GET", q: OFFENDING_URL, url: "/search/issues" } })).toBe(undefined);
  });

  it("waves a GraphQL query through and judges a GraphQL mutation", () => {
    const query = { method: "POST", query: "query { viewer { login } }", url: "/graphql" };
    const mutation = { body: OFFENDING_URL, method: "POST", query: "mutation { addComment }", url: "/graphql" };
    expect(githubWritePayload({ options: query })).toBe(undefined);
    expect(githubWritePayload({ options: mutation })).toEqual(mutation);
  });
});

describe("Linear — sendGraphql", () => {
  /** A write API over a transport that counts its calls. */
  function apiCounting() {
    const calls: string[] = [];
    const api = makeLinearWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: ({ query }) => {
        calls.push(query);
        return Promise.resolve({ issueCreate: { issue: { id: "uuid-1" }, success: true } });
      },
      scheduler: (task) => task(),
      token: "lin_api_fake",
    });
    return { api, calls };
  }

  it("refuses a mutation whose DOCUMENT carries the dead host inline, sending nothing", async () => {
    const calls: string[] = [];
    const ctx = makeLinearSendContext({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      request: ({ query }) => {
        calls.push(query);
        return Promise.resolve({});
      },
      scheduler: (task) => task(),
      token: "lin_api_fake",
    });
    const result = await parsedMutateVia({
      ctx,
      field: "issueCreate",
      operation: "linear.issueCreate",
      parse: () => ok(true),
      query: `mutation { issueCreate(input: { title: "${OFFENDING_URL}", teamId: "t1" }) { success } }`,
      variables: {},
    });
    expect(unwrapErr(result).message).toContain("use ap1.datadoghq.com — found at document");
    expect(calls).toEqual([]);
  });

  it("refuses a mutation whose variables carry the dead host, sending nothing", async () => {
    const { api, calls } = apiCounting();
    const result = await api.createIssue({
      id: "uuid-1",
      input: { description: OFFENDING_URL, teamId: "t1", title: "x" },
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("use ap1.datadoghq.com");
    expect(calls).toEqual([]);
  });

  it("sends the same mutation linking the real console", async () => {
    const { api, calls } = apiCounting();
    const result = await api.createIssue({
      id: "uuid-1",
      input: { description: CORRECT_URL, teamId: "t1", title: "x" },
    });
    expect(result._unsafeUnwrap()).toEqual({ id: "uuid-1" });
    expect(calls.length).toBe(1);
  });
});

describe("Vanta — the Manage transport", () => {
  const noSleep: VantaSleepLike = async () => undefined;

  /** A transport over a fetch that counts its calls. */
  function transportCounting() {
    const urls: string[] = [];
    const fetchImpl: VantaFetchLike = async (url) => {
      urls.push(url);
      return { headers: {}, status: 200, text: async () => "{}" };
    };
    return { transport: createVantaTransport({ fetchImpl, logger, sleep: noSleep }), urls };
  }

  it("refuses a write whose body carries the dead host, fetching nothing", async () => {
    const { transport, urls } = transportCounting();
    const result = await transport.request({
      body: JSON.stringify({ description: OFFENDING_URL }),
      headers: {},
      method: "POST",
      path: "/v1/documents",
    });
    // A policy refusal is the printed-only lines arm, never a typed HTTP fact.
    const [first] = vantaTransportFailureLines({ error: unwrapErr(result) });
    expect(first).toMatch(/^vanta POST \/v1\/documents blocked because /u);
    expect(first).toContain("(app.ap1.datadoghq.com is not a Datadog console; use ap1.datadoghq.com — found at body).");
    expect(urls).toEqual([]);
  });

  it("lets a read through, whatever its path carries", async () => {
    const { transport, urls } = transportCounting();
    const result = await transport.request({ headers: {}, method: "GET", path: `/v1/documents?q=${OFFENDING_URL}` });
    expect(unwrap(result).status).toBe(200);
    expect(urls.length).toBe(1);
  });
});

describe("vantaDeadHostRefusal", () => {
  it("judges a write's path as well as its body", async () => {
    const refusal = (await vantaDeadHostRefusal({
      requestInit: { headers: {}, method: "PATCH", path: `/v1/documents?link=${OFFENDING_URL}` },
      safePath: "/v1/documents",
    }))!;
    expect(refusal[0]).toContain("use ap1.datadoghq.com — found at path");
  });

  it("reads a multipart upload's file bytes, the shape an evidence upload takes", async () => {
    const body = new FormData();
    body.set("file", new Blob([new TextEncoder().encode(`report ${OFFENDING_URL}`)]), "report.txt");
    const refusal = (await vantaDeadHostRefusal({
      requestInit: { body, headers: {}, method: "POST", path: "/v1/documents/1/uploads" },
      safePath: "/v1/documents/1/uploads",
    }))!;
    expect(refusal[0]).toContain("use ap1.datadoghq.com — found at files.0");
  });

  it("passes a GET and a clean write", async () => {
    expect([
      await vantaDeadHostRefusal({
        requestInit: { headers: {}, method: "GET", path: `/v1/x?q=${OFFENDING_URL}` },
        safePath: "/v1/x",
      }),
      await vantaDeadHostRefusal({
        requestInit: { body: CORRECT_URL, headers: {}, method: "POST", path: "/v1/x" },
        safePath: "/v1/x",
      }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("isGraphqlMutation", () => {
  it("finds a mutation declared after a fragment, the shape a leading-keyword test waved through", () => {
    const document =
      "fragment Result on AddCommentPayload { clientMutationId } mutation Add($input: AddCommentInput!) { addComment(input: $input) { ...Result } }";
    expect(isGraphqlMutation({ document })).toBe(true);
  });

  it("reads a query aliasing a field as mutation, or naming a $mutation variable, as the read it is", () => {
    expect(
      [
        "query Q($q: String!) { mutation: search(query: $q, type: ISSUE, first: 1) { issueCount } }",
        "query Q($mutation: String!) { search(query: $mutation) { issueCount } }",
      ].map((document) => isGraphqlMutation({ document })),
    ).toEqual([false, false]);
  });

  it("reads a query or fragment legally NAMED mutation as a read, the shape a top-level keyword test judged", () => {
    expect(
      [
        "query mutation($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }",
        "fragment mutation on Issue { id } query Q { node(id: 1) { ...mutation } }",
      ].map((document) => isGraphqlMutation({ document })),
    ).toEqual([false, false]);
  });

  it("judges a document that does not parse as a write, so a malformed one never skips the guard", () => {
    expect(isGraphqlMutation({ document: "query Q { x" })).toBe(true);
  });

  it("ignores the keyword inside a comment or a string", () => {
    expect(isGraphqlMutation({ document: '# a mutation would go here\nquery Q { search(q: "mutation") { x } }' })).toBe(
      false,
    );
  });

  it("reads the first operation keyword past whitespace and comments", () => {
    expect(isGraphqlMutation({ document: "  # leading comment\n  mutation Create { x }" })).toBe(true);
  });

  it("judges a query, an anonymous selection and a subscription as reads", () => {
    expect(
      ["query Q { x }", "{ x }", "subscription S { x }", "query Q { mutations addMutation }"].map((document) =>
        isGraphqlMutation({ document }),
      ),
    ).toEqual([false, false, false, false]);
  });
});

describe("vantaDraftEditDeadHostRefusal", () => {
  it("refuses an unrelated edit that would re-save a dead host already in the draft", () => {
    const refusal = vantaDraftEditDeadHostRefusal({
      plan: { expectedText: `Monitor: ${OFFENDING_URL}\nOwner: Bob`, replace: "Owner: Bob" },
    });
    expect(refusal!.join("\n")).toContain("use ap1.datadoghq.com — found at expectedText");
  });

  it("lets through the edit that removes the dead host", () => {
    expect(
      vantaDraftEditDeadHostRefusal({ plan: { expectedText: `Monitor: ${CORRECT_URL}`, replace: CORRECT_URL } }),
    ).toBeUndefined();
  });
});

describe("vantaPolicyUploadDeadHostRefusal", () => {
  it("refuses a policy id carrying the dead host, since the attached file is named after it", () => {
    const refusal = vantaPolicyUploadDeadHostRefusal({ markdown: "# Policy", policyId: "app.ap1.datadoghq.com" });
    expect(refusal!.join("\n")).toContain("use ap1.datadoghq.com — found at policyId");
  });

  it("refuses markdown carrying the dead host, and lets a clean upload through", () => {
    const refusal = vantaPolicyUploadDeadHostRefusal({
      markdown: `See ${OFFENDING_URL}`,
      policyId: "incident-response",
    });
    expect(refusal!.join("\n")).toContain("use ap1.datadoghq.com — found at markdown");
    expect(
      vantaPolicyUploadDeadHostRefusal({ markdown: `See ${CORRECT_URL}`, policyId: "incident-response" }),
    ).toBeUndefined();
  });
});
