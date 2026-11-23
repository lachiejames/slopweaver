/**
 * The request-body fidelity projection + comparison (`cassetteRequestBody.ts`) — the pure core of what a
 * cassette can prove about the bytes that went OUT. Every case here is the falsifiable half of a claim the
 * module's header makes: a wrong boolean, a wrong number, a dropped field and a swapped field name each fail,
 * while the three things that legitimately differ between a record run and a replay run each pass.
 */
import { describe, expect, it } from "vitest";

import { CASSETTE_CONFIGS } from "../cassetteRedactConfig.js";
import {
  compareRequestBody,
  projectRequestBody,
  REDACTED_BODY,
  REDACTED_CURSOR,
  REDACTED_ID,
  REDACTED_KEY,
  type RequestBodyVerdict,
} from "../cassetteRequestBody.js";

const SLACK = CASSETTE_CONFIGS["slack"];
const GITHUB = CASSETTE_CONFIGS["github"];
const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

/** Project a Slack form post, the shape the Slack Web API client actually sends. */
function slackForm({ body }: { body: string }): string {
  return projectRequestBody({
    body,
    config: SLACK,
    contentType: "application/x-www-form-urlencoded; charset=utf-8",
    knownValues: [],
    url: "https://slack.com/api/chat.postMessage",
  });
}

/** Project a GitHub REST JSON post. */
function githubJson({ body }: { body: string }): string {
  return projectRequestBody({
    body,
    config: GITHUB,
    contentType: "application/json; charset=utf-8",
    knownValues: [],
    url: "https://api.github.com/repos/o/r/pulls",
  });
}

/** Compare two GitHub REST projections, the lane whose stale cassette motivated the whole change. */
function githubVerdict({ recorded, live }: { recorded: string | undefined; live: string }): RequestBodyVerdict {
  return compareRequestBody({
    config: GITHUB,
    live,
    method: "POST",
    postData: recorded === undefined ? {} : { text: recorded },
    url: "https://api.github.com/repos/o/r/pulls",
  });
}

/** Compare against an entry whose recording carries NO `postData` at all — a request that sent no body. */
function noBodyVerdict({ live }: { live: string }): RequestBodyVerdict {
  return compareRequestBody({
    config: GITHUB,
    live,
    method: "POST",
    postData: undefined,
    url: "https://api.github.com/repos/o/r/pulls",
  });
}

/**
 * A mismatch's message, or a throw. Narrowing inside the assertion would let the test pass silently on the
 * wrong branch, so the branch is resolved here and loudly (`testing.md` § No conditionals).
 */
function mismatchMessage({ verdict }: { verdict: RequestBodyVerdict }): string {
  if (verdict.kind !== "mismatch") {
    throw new Error(`expected a mismatch, got ${verdict.kind}`);
  }
  return verdict.message;
}

describe("projectRequestBody", () => {
  it("keeps a boolean verbatim — the exact field githubWriteTransport.test.ts had to exist to prove", () => {
    expect(githubJson({ body: JSON.stringify({ draft: true, title: "ship it" }) })).toBe(
      '{"draft":true,"title":"[REDACTED]"}',
    );
  });

  it("keeps a number verbatim", () => {
    expect(githubJson({ body: JSON.stringify({ issue_number: 2884 }) })).toBe('{"issue_number":2884}');
  });

  it("keeps null verbatim", () => {
    expect(githubJson({ body: JSON.stringify({ base: null }) })).toBe('{"base":null}');
  });

  it("collapses an identifier to a single placeholder — a record run's id and a replay run's cannot agree", () => {
    const recordRun = slackForm({ body: new URLSearchParams({ channel: "D0SYN123ABCD" }).toString() });
    const replayRun = slackForm({ body: new URLSearchParams({ channel: "D0SYN00REPLAY" }).toString() });
    expect(recordRun).toBe(`[["channel","${REDACTED_ID}"]]`);
    expect(replayRun).toBe(recordRun);
  });

  it("collapses a paging bookmark, whose value differs between the two runs by construction", () => {
    expect(slackForm({ body: new URLSearchParams({ cursor: "dXNlcjpVMDYxTkZUVDI=" }).toString() })).toBe(
      `[["cursor","${REDACTED_CURSOR}"]]`,
    );
  });

  it("blanks free prose, which a committed cassette never carries", () => {
    expect(slackForm({ body: new URLSearchParams({ text: "the staging pool exhausted at 14:02" }).toString() })).toBe(
      '[["text","[REDACTED]"]]',
    );
  });

  it("keeps a provider keepKey's enum, so a card's block TYPE sequence is evidence", () => {
    const blocks = JSON.stringify([{ type: "context" }, { type: "divider" }, { type: "rich_text" }]);
    expect(slackForm({ body: new URLSearchParams({ blocks }).toString() })).toBe(
      '[["blocks",[{"type":"context"},{"type":"divider"},{"type":"rich_text"}]]]',
    );
  });

  it("sorts form fields, so a client reordering its own payload is not a mismatch", () => {
    const one = slackForm({ body: new URLSearchParams({ channel: "D0SYN123ABCD", text: "hi" }).toString() });
    const other = slackForm({ body: new URLSearchParams({ text: "hi", channel: "D0SYN123ABCD" }).toString() });
    expect(one).toBe(other);
  });

  it("sorts JSON object keys for the same reason", () => {
    expect(githubJson({ body: JSON.stringify({ draft: true, base: null }) })).toBe('{"base":null,"draft":true}');
  });

  it("redacts a form FIELD NAME that is not a field name, the same class as an object key", () => {
    const channelId = `D${"0001AB0"}`;
    expect(slackForm({ body: new URLSearchParams({ [channelId]: "x" }).toString() })).toBe(
      `[["${REDACTED_KEY}","[REDACTED]"]]`,
    );
  });

  it("redacts an object KEY that is not a field name — an identifier can ride in the key position", () => {
    const channelId = `D${"0001AB0"}`;
    expect(githubJson({ body: JSON.stringify({ shares: { [channelId]: 1 } }) })).toBe(
      `{"shares":{"${REDACTED_KEY}":1}}`,
    );
  });

  it("answers the empty string for an absent body, which is what an entry with nothing to prove carries", () => {
    expect(
      projectRequestBody({ body: undefined, config: SLACK, contentType: undefined, knownValues: [], url: undefined }),
    ).toBe("");
  });

  it("answers REDACTED_BODY for a host no provider config covers", () => {
    expect(
      projectRequestBody({
        body: '{"anything":1}',
        config: undefined,
        contentType: "application/json",
        knownValues: [],
        url: "https://example.invalid/x",
      }),
    ).toBe(REDACTED_BODY);
  });

  it("answers REDACTED_BODY for a body it cannot reason about, distinguishing it from one never recorded", () => {
    expect(githubJson({ body: "--boundary\r\nContent-Disposition: form-data\r\n\r\nbytes" })).toBe(REDACTED_BODY);
  });

  it("keeps the GraphQL lane's own shape, so none of the 93 committed entries moves", () => {
    const body = JSON.stringify({ query: "query Q { viewer { id } }", variables: { first: 5, id: "abc" } });
    expect(
      projectRequestBody({
        body,
        config: CASSETTE_CONFIGS["linear"],
        contentType: "application/json",
        knownValues: [],
        url: LINEAR_GRAPHQL,
      }),
    ).toBe('{"operationName":null,"query":"query Q { viewer { id } }","variables":{"first":5,"id":"[REDACTED]"}}');
  });

  it("is idempotent over its own output", () => {
    const once = githubJson({ body: JSON.stringify({ draft: true, title: "ship it" }) });
    expect(githubJson({ body: once })).toBe(once);
  });

  it("strips a known-sensitive literal from a kept value", () => {
    const projected = projectRequestBody({
      body: JSON.stringify({ state: "acme-internal" }),
      config: GITHUB,
      contentType: "application/json",
      knownValues: ["acme"],
      url: "https://api.github.com/repos/o/r/pulls",
    });
    expect(projected).toBe('{"state":"[REDACTED]-internal"}');
  });
});

describe("compareRequestBody", () => {
  it("matches an identical projection", () => {
    expect(githubVerdict({ live: '{"draft":true}', recorded: '{"draft":true}' })).toEqual({ kind: "match" });
  });

  it("FAILS a flipped boolean — the exact rewrite that used to replay the same cassette and pass", () => {
    const verdict = githubVerdict({ live: '{"draft":false}', recorded: '{"draft":true}' });
    expect(verdict.kind).toBe("mismatch");
  });

  it("names both sides in the failure, so the diff is readable without re-running", () => {
    expect(
      mismatchMessage({ verdict: githubVerdict({ live: '{"draft":false}', recorded: '{"draft":true}' }) }),
    ).toContain('recorded: {"draft":true}');
  });

  it("FAILS a dropped field", () => {
    expect(githubVerdict({ live: '{"draft":true}', recorded: '{"base":null,"draft":true}' }).kind).toBe("mismatch");
  });

  it("FAILS a renamed field", () => {
    expect(githubVerdict({ live: '{"drafts":true}', recorded: '{"draft":true}' }).kind).toBe("mismatch");
  });

  it("FAILS a changed number", () => {
    expect(githubVerdict({ live: '{"number":2885}', recorded: '{"number":2884}' }).kind).toBe("mismatch");
  });

  it("reports `unrecorded` for an entry recorded while non-GraphQL bodies were blanked", () => {
    expect(githubVerdict({ live: '{"draft":true}', recorded: "" })).toEqual({ kind: "unrecorded" });
  });

  it("matches when both sides genuinely sent nothing", () => {
    expect(githubVerdict({ live: "", recorded: "" })).toEqual({ kind: "match" });
  });

  // `postData` ABSENT is a recorded fact, not a gap: the persister writes it if and only if the request had a
  // body. Reading `.text` alone made this indistinguishable from the blanked case above and passed it.
  it("FAILS a request that gained a body where the recording carries none at all", () => {
    expect(noBodyVerdict({ live: '{"draft":true}' }).kind).toBe("mismatch");
  });

  it("matches a body-less request against a recording that carries no body", () => {
    expect(noBodyVerdict({ live: "" })).toEqual({ kind: "match" });
  });

  it("reports `unrecorded` for a recorded NON-STRING body, which the persister writes no text for", () => {
    expect(githubVerdict({ live: '{"draft":true}', recorded: undefined })).toEqual({ kind: "unrecorded" });
  });

  it("matches a GraphQL body persisted before the query was normalised — two spellings of one operation", () => {
    const verdict = compareRequestBody({
      config: CASSETTE_CONFIGS["linear"],
      live: '{"operationName":null,"query":"query Q { viewer { id } }","variables":{}}',
      method: "POST",
      postData: { text: '{"query":"\\nquery Q {\\n  viewer {\\n    id\\n  }\\n}","variables":{}}' },
      url: LINEAR_GRAPHQL,
    });
    expect(verdict).toEqual({ kind: "match" });
  });

  it("matches across two runs' cursors, whose identity configureCursorMatching proves instead", () => {
    const verdict = compareRequestBody({
      config: CASSETTE_CONFIGS["linear"],
      live: '{"operationName":null,"query":"query Q { x }","variables":{"after":"[REDACTED]"}}',
      method: "POST",
      postData: { text: '{"operationName":null,"query":"query Q { x }","variables":{"after":"<uuid:1>"}}' },
      url: LINEAR_GRAPHQL,
    });
    expect(verdict).toEqual({ kind: "match" });
  });

  it("still FAILS a non-cursor variable that differs, so the cursor rule narrows nothing else", () => {
    const verdict = compareRequestBody({
      config: CASSETTE_CONFIGS["linear"],
      live: '{"operationName":null,"query":"query Q { x }","variables":{"after":"[REDACTED]","first":10}}',
      method: "POST",
      postData: { text: '{"operationName":null,"query":"query Q { x }","variables":{"after":"<uuid:1>","first":5}}' },
      url: LINEAR_GRAPHQL,
    });
    expect(verdict.kind).toBe("mismatch");
  });
});
