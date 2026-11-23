import { describe, expect, it } from "vitest";

import {
  slackClientApiOriginFromStructures,
  slackClientRootsFromStructures,
} from "../../../../atlas/slackApi/clientRoots.js";
import {
  SLACK_LATER_SURFACE_PAGE,
  SLACK_SURFACE_PAGES,
  SLACK_SURFACE_ROOT_IDS,
  SLACK_SURFACE_ROOTS,
  type SlackSurfacePage,
  surfacePageKey,
  surfacePageUrl,
  workspaceRootsFromStructures,
} from "../../../../atlas/slackApi/surfacePages.js";
import type { StructureBronzeRow } from "../../../../corpus/structures/types.js";

import { TEST_ROOTS } from "./slackAtlasFixtures.js";

/** One structure row, overridable field by field. */
function orgRow(over: Partial<StructureBronzeRow> = {}): StructureBronzeRow {
  return {
    attrs: {},
    fetchedAtIso: "2026-08-06T03:48:40.462Z",
    identity: { nativeId: "T0SYN1ABCDEFGH", slug: "example-workspace", url: "https://example-workspace.slack.com" },
    kind: "org",
    provenance: ["slack.team.info"],
    raw: {},
    relations: [],
    source: "slack",
    sourceId: "T0SYN1ABCDEFGH",
    version: 1,
    warnings: [],
    ...over,
  };
}

/** One declared page, overridable field by field. */
function page(over: Partial<SlackSurfacePage> = {}): SlackSurfacePage {
  return {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/account/settings",
    purpose: "account settings",
    root: "workspace",
    screenshot: "required",
    ...over,
  };
}

describe("SLACK_SURFACE_ROOTS", () => {
  it("carries a row for every declared root id, so no page resolves through a missing one", () => {
    expect(SLACK_SURFACE_ROOTS.map((root) => root.id).toSorted()).toEqual([...SLACK_SURFACE_ROOT_IDS].toSorted());
  });

  it("commits no workspace origin — that value is the organisation's own name, resolved at runtime", () => {
    expect(SLACK_SURFACE_ROOTS.find((root) => root.id === "workspace")!.template).toBe("{origin}");
  });
});

describe("surfacePageKey", () => {
  it("keeps the client key shape the store already published, so a page merges rather than doubling", () => {
    expect(surfacePageKey({ page: page({ path: "/today", root: "client" }) })).toBe("/client/<team>/today");
  });

  it("placeholders the workspace subdomain, which is a private identifier", () => {
    expect(surfacePageKey({ page: page() })).toBe("/<workspace>/account/settings");
  });

  it("placeholders both ids the organisation console takes", () => {
    expect(surfacePageKey({ page: page({ path: "/analytics", root: "manage" }) })).toBe(
      "/manage/<org>/<team>/analytics",
    );
  });
});

describe("surfacePageUrl", () => {
  it("addresses the client with the id the client settles on — the enterprise org on a grid", () => {
    expect(surfacePageUrl({ page: page({ path: "/today", root: "client" }), roots: TEST_ROOTS })).toBe(
      "https://app.slack.com/client/E0SYN1ABCDEFGH/today",
    );
  });

  it("addresses the app-management console with the TEAM, which is not the same id", () => {
    expect(surfacePageUrl({ page: page({ path: "/integrations/installed", root: "apps" }), roots: TEST_ROOTS })).toBe(
      "https://app.slack.com/apps-manage/T0SYN1ABCDEFGH/integrations/installed",
    );
  });

  it("addresses the organisation console with both ids, org first", () => {
    expect(surfacePageUrl({ page: page({ path: "/analytics", root: "manage" }), roots: TEST_ROOTS })).toBe(
      "https://app.slack.com/manage/E0SYN1ABCDEFGH/T0SYN1ABCDEFGH/analytics",
    );
  });

  it("addresses a workspace page off the resolved origin", () => {
    expect(surfacePageUrl({ page: page(), roots: TEST_ROOTS })).toBe(
      "https://example-workspace.slack.com/account/settings",
    );
  });
});

describe("workspaceRootsFromStructures", () => {
  it("reads the origin and the team id off the org row", () => {
    expect(workspaceRootsFromStructures({ rows: [orgRow()] })).toEqual({
      teamId: "T0SYN1ABCDEFGH",
      workspaceOrigin: "https://example-workspace.slack.com",
    });
  });

  it("takes the NEWEST row, matching the structure store's accumulate-and-measure doctrine", () => {
    const older = orgRow({ identity: { nativeId: "T0SYN0OLDOLDOLD", url: "https://old-workspace.slack.com" } });
    const newer = orgRow({ fetchedAtIso: "2026-09-06T00:00:00.000Z" });
    expect(workspaceRootsFromStructures({ rows: [newer, older] })!.teamId).toBe("T0SYN1ABCDEFGH");
  });

  it("strips a trailing slash, so a page address is not built with two", () => {
    const trailing = orgRow({ identity: { nativeId: "T0SYN1ABCDEFGH", url: "https://example-workspace.slack.com/" } });
    expect(workspaceRootsFromStructures({ rows: [trailing] })!.workspaceOrigin).toBe(
      "https://example-workspace.slack.com",
    );
  });

  it("answers null rather than guessing when no row carries a URL", () => {
    expect(workspaceRootsFromStructures({ rows: [orgRow({ identity: { nativeId: "T0SYN1ABCDEFGH" } })] })).toBe(null);
  });

  it("ignores a channel row, which carries a URL of an entirely different kind", () => {
    expect(workspaceRootsFromStructures({ rows: [orgRow({ kind: "channel" })] })).toBe(null);
  });
});

describe("slackClientRootsFromStructures", () => {
  it("addresses the client with the enterprise id on a grid, read off the same row as the team", () => {
    expect(slackClientRootsFromStructures({ rows: [orgRow({ attrs: { enterpriseId: "E0SYN1ABCDEFGH" } })] })).toEqual({
      clientWorkspaceId: "E0SYN1ABCDEFGH",
      teamId: "T0SYN1ABCDEFGH",
      workspaceOrigin: "https://example-workspace.slack.com",
    });
  });

  it("falls to the team id off a grid, where the client routes by team", () => {
    expect(slackClientRootsFromStructures({ rows: [orgRow()] })!.clientWorkspaceId).toBe("T0SYN1ABCDEFGH");
  });

  it("takes every root from the NEWEST row, never the enterprise id of an older one", () => {
    const older = orgRow({ attrs: { enterpriseId: "E0SYN0OLDOLDOLD" }, fetchedAtIso: "2026-01-01T00:00:00.000Z" });
    const newer = orgRow({ attrs: { enterpriseId: "E0SYN1ABCDEFGH" }, fetchedAtIso: "2026-09-06T00:00:00.000Z" });
    expect(slackClientRootsFromStructures({ rows: [older, newer] })!.clientWorkspaceId).toBe("E0SYN1ABCDEFGH");
  });

  it("refuses an enterprise id that is not a Slack id, which would steer the route off /client", () => {
    const crafted = orgRow({ attrs: { enterpriseId: "../../../account/reset?" } });
    expect(slackClientRootsFromStructures({ rows: [crafted] })).toBe(null);
  });

  it("refuses a team id that is not a Slack id", () => {
    const crafted = orgRow({ identity: { nativeId: "../x", url: "https://example-workspace.slack.com" } });
    expect(slackClientRootsFromStructures({ rows: [crafted] })).toBe(null);
  });

  it("answers null when no row carries a URL", () => {
    expect(slackClientRootsFromStructures({ rows: [orgRow({ identity: { nativeId: "T0SYN1ABCDEFGH" } })] })).toBe(null);
  });
});

describe("slackClientApiOriginFromStructures", () => {
  it("names the enterprise host on a grid, which is where the client's own /api/ calls land", () => {
    const grid = orgRow({ raw: { team: { enterprise_domain: "example-org", id: "T0SYN1ABCDEFGH" } } });
    expect(slackClientApiOriginFromStructures({ rows: [grid] })).toBe("https://example-org.enterprise.slack.com");
  });

  it("names the workspace origin off a grid, without a trailing slash", () => {
    const plain = orgRow({ identity: { nativeId: "T0SYN1ABCDEFGH", url: "https://example-workspace.slack.com/" } });
    expect(slackClientApiOriginFromStructures({ rows: [plain] })).toBe("https://example-workspace.slack.com");
  });

  it("refuses an enterprise domain that is not a bare label, rather than lease an origin built from it", () => {
    const crafted = orgRow({ raw: { team: { enterprise_domain: "evil.example/#" } } });
    expect(slackClientApiOriginFromStructures({ rows: [crafted] })).toBe(null);
  });

  it("refuses a workspace URL off Slack's own hosts, rather than lease it", () => {
    const crafted = orgRow({ identity: { nativeId: "T0SYN1ABCDEFGH", url: "https://attacker.example" } });
    expect(slackClientApiOriginFromStructures({ rows: [crafted] })).toBe(null);
  });

  it("treats an empty enterprise domain as no grid", () => {
    const empty = orgRow({ raw: { team: { enterprise_domain: "" } } });
    expect(slackClientApiOriginFromStructures({ rows: [empty] })).toBe("https://example-workspace.slack.com");
  });

  it("answers null when no row carries a URL", () => {
    expect(slackClientApiOriginFromStructures({ rows: [orgRow({ kind: "channel" })] })).toBe(null);
  });
});

describe("SLACK_LATER_SURFACE_PAGE", () => {
  it("is the one /later row the atlas walks, so the verb and the atlas cannot address two pages", () => {
    expect(SLACK_SURFACE_PAGES.filter((one) => one.path === "/later")).toEqual([SLACK_LATER_SURFACE_PAGE]);
  });

  it("refuses a picture, because the list renders the owner's saved messages", () => {
    expect(SLACK_LATER_SURFACE_PAGE.screenshot).toBe("refused");
  });
});

describe("SLACK_SURFACE_PAGES", () => {
  it("carries the three settings pages the owner named, each required to be photographed", () => {
    const named = new Set(["/account/settings", "/account/notifications", "/account/profile"]);
    const settings = SLACK_SURFACE_PAGES.filter((row) => row.root === "workspace" && named.has(row.path));
    expect(settings.map((row) => row.screenshot)).toEqual(["required", "required", "required"]);
  });

  it("carries the integrations page itself and no row per installed app", () => {
    const apps = SLACK_SURFACE_PAGES.filter((row) => row.root === "apps");
    expect(apps.map((row) => row.path)).toEqual(["/integrations/installed", "/integrations/resolution/"]);
  });

  it("refuses a picture of every page that renders the workspace's own messages", () => {
    const conversational = SLACK_SURFACE_PAGES.filter((row) => row.root === "client" && row.path === "/dms");
    expect(conversational.map((row) => row.screenshot)).toEqual(["refused"]);
  });

  it("names the corpus as the holder wherever it records existence and not contents", () => {
    const today = SLACK_SURFACE_PAGES.find((row) => row.path === "/today")!;
    expect(today.contentsHeldBy).toContain("slopweaver refresh --source slack");
    expect(today.screenshot).toBe("permitted");
  });

  it("declares the admin pages a member without an admin role cannot open rather than omitting them", () => {
    expect(SLACK_SURFACE_PAGES.filter((row) => row.needsAdmin).map((row) => row.path)).toEqual([
      "/settings",
      "/apps/manage/deactivated",
      "/admin",
    ]);
  });

  it("gives every un-navigable row a reason, because a bare boolean tells a reader nothing", () => {
    const blocked = SLACK_SURFACE_PAGES.filter((row) => row.notNavigableBecause !== null);
    expect(blocked.every((row) => row.notNavigableBecause!.length > 20)).toBe(true);
    expect(blocked.map((row) => row.path)).toContain("/account/reset");
  });

  it("holds no duplicate provider key, which would merge two surfaces onto one entity", () => {
    const keys = SLACK_SURFACE_PAGES.map((row) => surfacePageKey({ page: row }));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
