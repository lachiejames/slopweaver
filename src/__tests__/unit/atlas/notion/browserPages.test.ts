import { describe, expect, it } from "vitest";

import {
  isPageSegment,
  NOTION_BROWSER_PAGES,
  NOTION_WEB_ORIGIN,
  type NotionBrowserPage,
  notionPageUrl,
  workspaceRootFromFinalUrl,
} from "../../../../atlas/notion/browserPages.js";

/** The workspace root a signed-in client was MEASURED to land on, with a synthetic workspace name. */
const WORKSPACE_ROOT = "https://app.notion.com/p/acme";

/** A declared page, overridable field by field, so each test states only what it is about. */
const page = (over: Partial<NotionBrowserPage> = {}): NotionBrowserPage => ({
  description: "a page",
  path: "settings",
  query: {},
  root: "workspace",
  surface: "a-surface",
  ...over,
});

describe("isPageSegment", () => {
  it("reads a bare 32-hex id as a page address", () => {
    expect(isPageSegment({ segment: "0123456789abcdef0123456789abcdef" })).toBe(true);
  });

  it("reads a dashed title ending in a page id as a page address", () => {
    expect(isPageSegment({ segment: "Some-Title-0123456789abcdef0123456789abcdef" })).toBe(true);
  });

  it("reads an ordinary word as a workspace name", () => {
    expect(isPageSegment({ segment: "acme" })).toBe(false);
  });

  it("reads a hyphenated workspace name as a workspace name", () => {
    expect(isPageSegment({ segment: "acme-corp" })).toBe(false);
  });

  it("does not read a 31-character hex run as an id", () => {
    expect(isPageSegment({ segment: "0123456789abcdef0123456789abcde" })).toBe(false);
  });

  it("reads an upper-case id as a page address, because Notion writes both", () => {
    expect(isPageSegment({ segment: "0123456789ABCDEF0123456789ABCDEF" })).toBe(true);
  });
});

describe("workspaceRootFromFinalUrl", () => {
  it("takes the workspace segment beneath the client's own document prefix", () => {
    expect(
      workspaceRootFromFinalUrl({
        finalUrl: "https://app.notion.com/p/acme/Notes-0123456789abcdef0123456789abcdef",
      }),
    ).toBe(WORKSPACE_ROOT);
  });

  it("reports null when the client landed on the origin it MIGRATED FROM, which is the shape the first walk hit", () => {
    expect(
      workspaceRootFromFinalUrl({ finalUrl: "https://www.notion.so/p/acme/Notes-0123456789abcdef0123456789abcdef" }),
    ).toBeNull();
  });

  it("reports null when the segment before the workspace is not the document prefix", () => {
    expect(workspaceRootFromFinalUrl({ finalUrl: "https://app.notion.com/space/my-account" })).toBeNull();
  });

  it("reports null when the segment after the prefix is itself a page, which is a space with no workspace name", () => {
    expect(
      workspaceRootFromFinalUrl({ finalUrl: "https://app.notion.com/p/0123456789abcdef0123456789abcdef" }),
    ).toBeNull();
  });

  it("reports null for a landing on the marketing site, which is where an absent route goes", () => {
    expect(workspaceRootFromFinalUrl({ finalUrl: "https://www.notion.com/templates" })).toBeNull();
  });

  it("reports null for the bare origin, which carries no segment to read", () => {
    expect(workspaceRootFromFinalUrl({ finalUrl: "https://app.notion.com/" })).toBeNull();
  });

  it("reports null for a string that is not a URL at all", () => {
    expect(workspaceRootFromFinalUrl({ finalUrl: "not a url" })).toBeNull();
  });

  it("ignores a query string when reading the segment", () => {
    expect(
      workspaceRootFromFinalUrl({
        finalUrl: "https://app.notion.com/p/acme/Notes-0123456789abcdef0123456789abcdef?v=1",
      }),
    ).toBe(WORKSPACE_ROOT);
  });
});

describe("notionPageUrl", () => {
  it("hangs an origin-rooted page off the origin, ignoring the workspace root", () => {
    expect(notionPageUrl({ page: page({ path: "home", root: "origin" }), workspaceRoot: WORKSPACE_ROOT })).toBe(
      "https://app.notion.com/home",
    );
  });

  it("hangs a space-rooted page off the space prefix, which is where settings was measured to live", () => {
    expect(notionPageUrl({ page: page({ path: "my-account", root: "space" }), workspaceRoot: WORKSPACE_ROOT })).toBe(
      "https://app.notion.com/space/my-account",
    );
  });

  it("hangs a workspace-rooted page off the workspace root", () => {
    expect(notionPageUrl({ page: page({ path: "settings" }), workspaceRoot: WORKSPACE_ROOT })).toBe(
      "https://app.notion.com/p/acme/settings",
    );
  });

  it("refuses a workspace-rooted page when there is no workspace root to hang it off", () => {
    expect(notionPageUrl({ page: page({ path: "settings" }), workspaceRoot: null })).toBeNull();
  });

  it("still addresses a space-rooted page when there is no workspace root, because it needs none", () => {
    expect(notionPageUrl({ page: page({ path: "my-account", root: "space" }), workspaceRoot: null })).toBe(
      "https://app.notion.com/space/my-account",
    );
  });

  it("writes the declared query state into the URL", () => {
    expect(
      notionPageUrl({ page: page({ path: "members", query: { page: "1" }, root: "space" }), workspaceRoot: null }),
    ).toBe("https://app.notion.com/space/members?page=1");
  });
});

describe("NOTION_BROWSER_PAGES", () => {
  it("has at least one entry in NOTION_BROWSER_PAGES, so the guards below are not vacuously green", () => {
    expect(NOTION_BROWSER_PAGES.length).toBeGreaterThan(0);
  });

  it("names every surface exactly once, so a coverage row cannot be overwritten by a sibling", () => {
    const surfaces = NOTION_BROWSER_PAGES.map((declared) => declared.surface);
    expect(surfaces.length).toBe(new Set(surfaces).size);
  });

  it("declares no path with a leading slash, because each is joined onto a root", () => {
    expect(NOTION_BROWSER_PAGES.filter((declared) => declared.path.startsWith("/"))).toEqual([]);
  });

  it("declares no route that acts — nothing that signs out, deletes, exports or starts a purchase", () => {
    const acting = ["logout", "signout", "sign-out", "delete", "export", "duplicate", "upgrade", "checkout"];
    const offenders = NOTION_BROWSER_PAGES.filter((declared) => acting.some((word) => declared.path.includes(word)));
    expect(offenders.map((declared) => declared.surface)).toEqual([]);
  });

  it("gives every declared page a description, because a route with no stated purpose cannot be reviewed", () => {
    expect(NOTION_BROWSER_PAGES.filter((declared) => declared.description.length === 0)).toEqual([]);
  });

  it("addresses every page under Notion's own origin", () => {
    const urls = NOTION_BROWSER_PAGES.map((declared) =>
      notionPageUrl({ page: declared, workspaceRoot: WORKSPACE_ROOT }),
    );
    expect(urls.filter((url) => url === null || !url.startsWith(NOTION_WEB_ORIGIN))).toEqual([]);
  });
});
