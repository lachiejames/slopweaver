/*
 * captureFrom takes only what the snippet actually reported: a malformed response is dropped, a missing field reads
 * as absent rather than invented, and the observed instant is the caller's own.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { captureFrom } from "../../../../browser/playwrightCli.js";
import { unwrap } from "../../../../lib/result.js";
import { clientStdout, NOTION_LEASE } from "./harness.js";

describe("captureFrom takes only what the snippet actually reported", () => {
  const screenshotPath = join(tmpdir(), "capture-from-no-such-shot.png");
  const url = "https://app.notion.com/settings/members";

  function capturedWith({ snippet }: { snippet: Record<string, unknown> }): ReturnType<typeof captureFrom> {
    return captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: clientStdout({
        accounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
        finalUrl: url,
        links: [],
        linksError: null,
        responses: [],
        screenshotWritten: false,
        statusCode: 200,
        title: "Members",
        ...snippet,
      }),
      url,
    });
  }

  it("drops a response whose url, method or statusCode is not the type it must be", () => {
    const captured = capturedWith({
      snippet: {
        responses: [
          { body: {}, method: "GET", statusCode: "200", url: `${url}/api` },
          { body: {}, method: 7, statusCode: 200, url: `${url}/api` },
          { body: {}, method: "GET", statusCode: 200, url: 7 },
          { body: {}, method: "GET", statusCode: 200, url: `${url}/api/good` },
        ],
      },
    });
    expect(unwrap(captured).responses.map((response) => response.url)).toEqual([`${url}/api/good`]);
  });

  it("drops an entry that is not a record", () => {
    const captured = capturedWith({ snippet: { responses: ["not a response"] } });
    expect(unwrap(captured).responses).toEqual([]);
  });

  it("answers with no responses when the snippet reported no list", () => {
    expect(unwrap(capturedWith({ snippet: { responses: null } })).responses).toEqual([]);
  });

  // Only the REQUEST document says which fields a GraphQL call actually selected.
  it("carries a request body through when the snippet captured one", () => {
    const captured = capturedWith({
      snippet: {
        responses: [{ body: {}, method: "POST", requestBody: "query Q { id }", statusCode: 200, url: `${url}/api` }],
      },
    });
    expect(unwrap(captured).responses[0]!.requestBody).toBe("query Q { id }");
  });

  it("omits the request body entirely when the snippet captured none, rather than inventing an empty one", () => {
    const captured = capturedWith({
      snippet: { responses: [{ body: {}, method: "GET", statusCode: 200, url: `${url}/api` }] },
    });
    expect("requestBody" in unwrap(captured).responses[0]!).toBe(false);
  });

  it("claims an accounting of nothing when the snippet reported none", () => {
    expect(unwrap(capturedWith({ snippet: { accounting: null } })).responseAccounting).toEqual({
      bodyFailed: 0,
      bodySucceeded: 0,
      eligible: 0,
      seen: 0,
    });
  });

  it("never takes a negative count off the denominator, whatever the snippet reported", () => {
    const captured = capturedWith({
      snippet: {
        accounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 1 },
        responses: [{ body: {}, method: "GET", statusCode: 200, url: "https://analytics.example.invalid/x" }],
      },
    });
    expect(unwrap(captured).responseAccounting).toEqual({
      bodyFailed: 0,
      bodySucceeded: 0,
      eligible: 0,
      seen: 1,
    });
  });

  it("reports no status code rather than a made-up one when the snippet named none", () => {
    expect(unwrap(capturedWith({ snippet: { statusCode: null } })).statusCode).toBe(null);
  });

  it("reports an empty title rather than a made-up one when the snippet named none", () => {
    expect(unwrap(capturedWith({ snippet: { title: null } })).title).toBe("");
  });

  it("settles on the requested URL when the snippet named no final one", () => {
    expect(unwrap(capturedWith({ snippet: { finalUrl: null } })).finalUrl).toBe(url);
  });

  it("stamps the caller's own instant rather than reading a clock", () => {
    expect(unwrap(capturedWith({ snippet: {} })).observedAt).toBe("2026-09-07T10:00:00.000Z");
  });
});
