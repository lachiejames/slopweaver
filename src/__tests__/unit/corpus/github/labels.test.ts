/**
 * An issue's labels, read and added through a real Octokit whose transport is a plain fake `fetch` recording
 * each request: the repository's defined labels are paged 100 at a time and stop after five pages, reporting
 * truncation only when the fifth page came back full; an issue's labels keep named entries and drop empty or
 * nameless ones; and the additive write sends the caller's list once and is never retried.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import { addIssueLabelsVia, issueLabelsVia, repoLabelsVia } from "../../../../corpus/github/labels.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One request as the fake transport saw it. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** One canned answer: an HTTP status and the JSON body sent with it. */
interface CannedResponse {
  readonly status: number;
  readonly data: unknown;
}

/**
 * A write context whose transport answers the Nth request with the Nth canned response (the last one repeats),
 * recording each request.
 */
function recordingCtx({
  sent,
  responses,
  scopeId,
}: {
  sent: SentRequest[];
  responses: readonly CannedResponse[];
  scopeId: string;
}): WriteCtx {
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const body = init?.body;
    sent.push({
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      method: String(init?.method),
      url: url instanceof Request ? url.url : url.toString(),
    });
    const response = responses[Math.min(sent.length, responses.length) - 1]!;
    return new Response(JSON.stringify(response.data), {
      headers: { "content-type": "application/json" },
      status: response.status,
    });
  };
  return { client: new Octokit({ auth: "test-token", request: { fetch } }), scopeId };
}

/** A page of `count` defined labels named `<prefix>-<n>`. */
function labelPage({ prefix, count }: { prefix: string; count: number }): CannedResponse {
  return { data: Array.from({ length: count }, (_, index) => ({ name: `${prefix}-${String(index)}` })), status: 200 };
}

const REPO = { owner: "acme", repo: "widgets" };
const LABELS_URL = "https://api.github.com/repos/acme/widgets/labels";

/** The URL the read asks for on one page. */
function pageUrl({ page }: { page: number }): string {
  return `${LABELS_URL}?page=${String(page)}&per_page=100`;
}

describe("repoLabelsVia", () => {
  it("pages 100 at a time and stops, untruncated, at the first short page", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      responses: [labelPage({ count: 100, prefix: "a" }), { data: [{ name: "bug" }, { name: "docs" }], status: 200 }],
      scopeId: "labels-short",
      sent,
    });

    const result = unwrap(await repoLabelsVia({ ctx, input: REPO }));

    expect(result.truncated).toBe(false);
    expect(result.names).toEqual([...Array.from({ length: 100 }, (_, index) => `a-${String(index)}`), "bug", "docs"]);
    expect(sent).toEqual([
      { body: undefined, method: "GET", url: pageUrl({ page: 1 }) },
      { body: undefined, method: "GET", url: pageUrl({ page: 2 }) },
    ]);
  });

  it("reports truncation after five full pages, and none when the fifth page holds 99", async () => {
    const fullSent: SentRequest[] = [];
    const full = recordingCtx({
      responses: [labelPage({ count: 100, prefix: "x" })],
      scopeId: "labels-full",
      sent: fullSent,
    });
    const shortSent: SentRequest[] = [];
    const short = recordingCtx({
      responses: [
        labelPage({ count: 100, prefix: "y" }),
        labelPage({ count: 100, prefix: "y" }),
        labelPage({ count: 100, prefix: "y" }),
        labelPage({ count: 100, prefix: "y" }),
        labelPage({ count: 99, prefix: "z" }),
      ],
      scopeId: "labels-99",
      sent: shortSent,
    });

    const fullResult = unwrap(await repoLabelsVia({ ctx: full, input: REPO }));
    const shortResult = unwrap(await repoLabelsVia({ ctx: short, input: REPO }));

    expect(fullResult.truncated).toBe(true);
    expect(fullResult.names.length).toBe(500);
    expect(fullSent.map((request) => request.url)).toEqual([
      pageUrl({ page: 1 }),
      pageUrl({ page: 2 }),
      pageUrl({ page: 3 }),
      pageUrl({ page: 4 }),
      pageUrl({ page: 5 }),
    ]);
    expect(shortResult.truncated).toBe(false);
    expect(shortResult.names.length).toBe(499);
    expect(shortSent.length).toBe(5);
  });

  it("answers an empty, untruncated list for a repository that defines no labels", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ responses: [{ data: [], status: 200 }], scopeId: "labels-none", sent });

    expect(unwrap(await repoLabelsVia({ ctx, input: REPO }))).toEqual({ names: [], truncated: false });
    expect(sent.length).toBe(1);
  });
});

describe("issueLabelsVia", () => {
  it("GETs the issue and keeps string and named labels, dropping empty strings and nameless objects", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      responses: [
        {
          data: {
            html_url: "https://github.com/acme/widgets/pull/42",
            labels: ["bug", "", { name: "docs" }, { color: "fff" }, { name: "" }, { name: "ready" }],
          },
          status: 200,
        },
      ],
      scopeId: "issue-labels",
      sent,
    });

    expect(unwrap(await issueLabelsVia({ ctx, input: { ...REPO, number: 42 } }))).toEqual({
      htmlUrl: "https://github.com/acme/widgets/pull/42",
      labels: ["bug", "docs", "ready"],
    });
    expect(sent).toEqual([
      { body: undefined, method: "GET", url: "https://api.github.com/repos/acme/widgets/issues/42" },
    ]);
  });
});

describe("addIssueLabelsVia", () => {
  const ADD_URL = "https://api.github.com/repos/acme/widgets/issues/42/labels";

  it("POSTs exactly the caller's list, duplicates included, and answers GitHub's resulting label names", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      responses: [{ data: [{ name: "bug" }, { name: "ready" }, { color: "000" }], status: 200 }],
      scopeId: "add-labels",
      sent,
    });

    const result = await addIssueLabelsVia({ ctx, input: { ...REPO, labels: ["ready", "ready"], number: 42 } });

    expect(unwrap(result)).toEqual(["bug", "ready"]);
    expect(sent).toEqual([{ body: { labels: ["ready", "ready"] }, method: "POST", url: ADD_URL }]);
  });

  it("fails after exactly one request when GitHub answers 500, never retrying the write", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      responses: [{ data: { message: "Server Error" }, status: 500 }],
      scopeId: "add-500",
      sent,
    });

    const error = unwrapErr(await addIssueLabelsVia({ ctx, input: { ...REPO, labels: ["bug"], number: 42 } }));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
    expect(error.operation).toBe("github.issues.addLabels");
    expect(sent).toEqual([{ body: { labels: ["bug"] }, method: "POST", url: ADD_URL }]);
  });
});
