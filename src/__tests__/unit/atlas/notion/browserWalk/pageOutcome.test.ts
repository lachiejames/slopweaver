/*
 * How `notionPageOutcome` judges where one page settled: held where it was asked, refused when sent elsewhere
 * or answered with the client's not-found page, and never quoting a path that can carry the workspace slug.
 */
import { describe, expect, it } from "vitest";

import {
  NOTION_MARKETING_ORIGIN,
  NOTION_NOT_FOUND_TITLE,
  NOTION_WEB_ORIGIN,
} from "../../../../../atlas/notion/browserPages.js";
import { notionPageOutcome } from "../../../../../atlas/notion/browserWalk.js";

import { capture } from "../../../../walkTransportFake.js";

describe("notionPageOutcome", () => {
  it("holds a page that settled exactly where it was asked", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/my-account`;
    expect(notionPageOutcome({ capture: capture({ over: {}, url }), requestedUrl: url }).unreachableBecause).toBeNull();
  });

  it("holds a page whose only difference is the query state the client restored", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/members`;
    const settled = capture({ over: { finalUrl: `${url}?page=2` }, url });
    expect(notionPageOutcome({ capture: settled, requestedUrl: url }).redirected).toBe(false);
  });

  it("refuses a page that landed on the public marketing site, which answers 200 with a real title", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/templates`;
    const settled = capture({ over: { finalUrl: `${NOTION_MARKETING_ORIGIN}/templates` }, url });
    expect(notionPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).toContain("marketing site");
  });

  it("names the origin a page was sent to, because an origin carries no workspace slug", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/audit-log`;
    const settled = capture({ over: { finalUrl: "https://accounts.example.com/signin" }, url });
    expect(notionPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).toContain(
      "https://accounts.example.com",
    );
  });

  it("never quotes the settled PATH, which can carry the workspace slug", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/settings`;
    const settled = capture({
      over: { finalUrl: `${NOTION_WEB_ORIGIN}/p/acme/Secret-Plan-0123456789abcdef0123456789abcdef` },
      url,
    });
    const outcome = notionPageOutcome({ capture: settled, requestedUrl: url });
    expect(outcome.unreachableBecause!.includes("acme")).toBe(false);
  });

  it("refuses a page that kept its origin and changed its path", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/settings`;
    const settled = capture({ over: { finalUrl: `${NOTION_WEB_ORIGIN}/space/home` }, url });
    expect(notionPageOutcome({ capture: settled, requestedUrl: url }).redirected).toBe(true);
  });

  it("treats a trailing slash as the same address", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/trash`;
    const settled = capture({ over: { finalUrl: `${url}/` }, url });
    expect(notionPageOutcome({ capture: settled, requestedUrl: url }).redirected).toBe(false);
  });

  it("refuses a route the client kept the address for and answered with its not-found page", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/security`;
    const settled = capture({ over: { title: NOTION_NOT_FOUND_TITLE }, url });
    expect(notionPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).toContain("no such route");
  });

  it("does not call that a redirect, because the client kept the address it was given", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/security`;
    const settled = capture({ over: { title: NOTION_NOT_FOUND_TITLE }, url });
    expect(notionPageOutcome({ capture: settled, requestedUrl: url }).redirected).toBe(false);
  });

  it("holds a page whose title carries its own name before the product suffix", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/members`;
    const settled = capture({ over: { title: "Members | Notion" }, url });
    expect(notionPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).toBeNull();
  });

  it("refuses a settled address it cannot read at all", () => {
    const url = `${NOTION_WEB_ORIGIN}/space/trash`;
    const settled = capture({ over: { finalUrl: "not a url" }, url });
    expect(notionPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).toContain("cannot read");
  });
});
