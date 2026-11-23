/*
 * captureFrom keeps a capture to the lease's own origins: a page that settled on another platform yields no capture,
 * and a third party's response is dropped and taken off the denominator.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { captureFrom } from "../../../../browser/playwrightCli.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { clientStdout, NOTION_LEASE } from "./harness.js";

describe("captureFrom", () => {
  const screenshotPath = join(tmpdir(), "capture-from-no-such-shot.png");

  it("returns no capture at all when the page settled on another platform", () => {
    const captured = captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: clientStdout({
        accounting: { bodyFailed: 0, bodySucceeded: 107, eligible: 107, seen: 140 },
        finalUrl: "https://linear.app/acme/settings",
        links: [],
        linksError: null,
        responses: [{ body: { id: 1 }, method: "GET", statusCode: 200, url: "https://linear.app/api/graphql" }],
        screenshotWritten: true,
        statusCode: 200,
        title: "Linear",
      }),
      url: "https://app.notion.com/settings/members",
    });
    expect(captured.isErr()).toBe(true);
    expect(unwrapErr(captured).code).toBe("OFF_LEASE_ORIGIN");
    expect(unwrapErr(captured).message).toContain("the notion walk was not asked to go");
  });

  it("drops a third party's response body and takes it off the denominator, not onto bodyFailed", () => {
    const captured = captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: clientStdout({
        accounting: { bodyFailed: 1, bodySucceeded: 3, eligible: 4, seen: 9 },
        finalUrl: "https://app.notion.com/settings/members",
        links: [],
        linksError: null,
        responses: [
          { body: {}, method: "GET", statusCode: 200, url: "https://app.notion.com/api/v3/getSpaces" },
          { body: {}, method: "POST", statusCode: 200, url: "https://app.notion.com/api/v3/getUsers" },
          { body: {}, method: "GET", statusCode: 200, url: "https://analytics.example.invalid/collect" },
        ],
        screenshotWritten: false,
        statusCode: 200,
        title: "Members",
      }),
      url: "https://app.notion.com/settings/members",
    });
    expect(captured.isOk()).toBe(true);
    const capture = unwrap(captured);
    expect(capture.responses.map((response) => response.url)).toEqual([
      "https://app.notion.com/api/v3/getSpaces",
      "https://app.notion.com/api/v3/getUsers",
    ]);
    expect(capture.responseAccounting).toEqual({ bodyFailed: 1, bodySucceeded: 2, eligible: 3, seen: 9 });
  });

  it("keeps every response when they are all on the lease's own origins", () => {
    const captured = captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: clientStdout({
        accounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 3 },
        finalUrl: "https://app.notion.com/settings/members",
        links: [],
        linksError: null,
        responses: [{ body: {}, method: "GET", statusCode: 200, url: "https://app.notion.com/api/v3/getSpaces" }],
        screenshotWritten: false,
        statusCode: 200,
        title: "Members",
      }),
      url: "https://app.notion.com/settings/members",
    });
    expect(captured.isOk()).toBe(true);
    expect(unwrap(captured).responseAccounting).toEqual({
      bodyFailed: 0,
      bodySucceeded: 1,
      eligible: 1,
      seen: 3,
    });
  });
});
