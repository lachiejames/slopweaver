import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NOTION_BROWSER_PAGES } from "../../../../atlas/notion/browserPages.js";
import { publishNotionBrowserWalk } from "../../../../atlas/notion/browserSurface.js";
import type { NotionPageObservation } from "../../../../atlas/notion/browserWalk.js";
import type { NotionAtlasKindFile } from "../../../../atlas/notion/model.js";
import { publishNotionSettingsTabs } from "../../../../atlas/notion/settingsSurface.js";
import { NOTION_SETTINGS_TABS } from "../../../../atlas/notion/settingsTabs.js";
import { type NotionSettingsTabObservation, settingsTabSurface } from "../../../../atlas/notion/settingsWalk.js";
import { type NotionAtlasPaths, notionAtlasPaths, readNotionKindFile } from "../../../../atlas/notion/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-30T00:00:00.000Z";
const LATER = "2026-10-01T00:00:00.000Z";

let home: string;
let paths: NotionAtlasPaths;

const SHOT_BYTES = new Uint8Array([137, 80, 78, 71]);
const SHOT_SHA = createHash("sha256").update(SHOT_BYTES).digest("hex");
const SHOT = {
  byteLength: SHOT_BYTES.byteLength,
  kind: "page-png" as const,
  mediaType: "image/png",
  relativePath: `artifacts/pages/${SHOT_SHA}.png`,
  sha256: SHOT_SHA,
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-notion-settings-"));
  paths = notionAtlasPaths({ home });
  mkdirSync(paths.pageArtifacts, { recursive: true });
  writeFileSync(join(paths.directory, SHOT.relativePath), SHOT_BYTES);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Every declared tab shown and photographed, with one tab's fields overridden. */
function everyTab({
  over = {},
  id = "",
}: { over?: Partial<NotionSettingsTabObservation>; id?: string } = {}): readonly NotionSettingsTabObservation[] {
  return NOTION_SETTINGS_TABS.map((tab): NotionSettingsTabObservation => ({
    artifacts: [SHOT],
    attempted: true,
    dialogOpen: true,
    group: tab.group,
    names: tab.names,
    notRenderedBecause: null,
    observedAt: AT,
    screenshotMissingBecause: null,
    selectionVerified: true,
    surface: settingsTabSurface({ id: tab.id }),
    tabId: tab.id,
    tabMatches: 1,
    ...(tab.id === id ? over : {}),
  }));
}

/** Every declared route unreachable — the shape the live walk measured. */
function everyRouteUnreachable(): readonly NotionPageObservation[] {
  return NOTION_BROWSER_PAGES.map((page): NotionPageObservation => ({
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://app.notion.com/",
    observedAt: AT,
    redirected: true,
    requestedUrl: "https://app.notion.com/",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: "the page was not reached, so nothing was photographed",
    statusCode: 200,
    surface: page.surface,
    title: "Notion",
    unreachableBecause: "the client rendered its not-found shell",
  }));
}

function pageFile(): NotionAtlasKindFile {
  return unwrap(readNotionKindFile({ kind: "page", paths }))!;
}

function tabCell(): NotionAtlasKindFile["coverage"][number] {
  return pageFile().coverage.find((cell) => cell.scope === "declared-settings-tabs")!;
}

describe("publishNotionSettingsTabs", () => {
  it("publishes one page entity per declared tab", () => {
    unwrap(publishNotionSettingsTabs({ at: AT, paths, walk: { sessionLost: false, tabs: everyTab() } }));
    expect(
      pageFile()
        .entities.map((entity) => entity.providerId)
        .toSorted(),
    ).toEqual(NOTION_SETTINGS_TABS.map((tab) => settingsTabSurface({ id: tab.id })).toSorted());
  });

  it("grades the tab cell synced under browser-walk when every declared tab is held", () => {
    unwrap(publishNotionSettingsTabs({ at: AT, paths, walk: { sessionLost: false, tabs: everyTab() } }));
    expect([tabCell().surface, tabCell().state]).toEqual(["browser-walk", "synced"]);
  });

  it("defers the tab cell, with the shortfall as a number, when one tab did not render", () => {
    const tabs = everyTab({ id: "members", over: { notRenderedBecause: "the settings modal did not open" } });
    unwrap(publishNotionSettingsTabs({ at: AT, paths, walk: { sessionLost: false, tabs } }));
    expect([tabCell().state, tabCell().reason]).toEqual([
      "deferred",
      `${String(NOTION_SETTINGS_TABS.length - 1)} of ${String(NOTION_SETTINGS_TABS.length)} declared settings tab(s) shown and photographed`,
    ]);
  });

  it("defers the tab cell when a screenshot reference has no bytes behind it", () => {
    const fabricated = { ...SHOT, relativePath: `artifacts/pages/${"b".repeat(64)}.png`, sha256: "b".repeat(64) };
    const tabs = everyTab({ id: "members", over: { artifacts: [fabricated] } });
    unwrap(publishNotionSettingsTabs({ at: AT, paths, walk: { sessionLost: false, tabs } }));
    expect(tabCell().state).toBe("deferred");
  });

  it("opens the standing per-install gap for the Account tab it cannot declare", () => {
    unwrap(publishNotionSettingsTabs({ at: AT, paths, walk: { sessionLost: false, tabs: everyTab() } }));
    expect(pageFile().gaps.map((gap) => gap.condition)).toContain("settings-tab-undeclared-per-install");
  });

  it("closes a tab's not-rendered gap when a later walk shows it", () => {
    const failed = everyTab({ id: "members", over: { notRenderedBecause: "the settings modal did not open" } });
    unwrap(publishNotionSettingsTabs({ at: AT, paths, walk: { sessionLost: false, tabs: failed } }));
    unwrap(publishNotionSettingsTabs({ at: LATER, paths, walk: { sessionLost: false, tabs: everyTab() } }));
    const gap = pageFile().gaps.find((row) => row.condition === "settings-tab-not-rendered")!;
    expect(gap.status).toBe("closed");
  });

  it("REFUSES a walk short of the declared tab list, publishing nothing", () => {
    const refused = publishNotionSettingsTabs({
      at: AT,
      paths,
      walk: { sessionLost: false, tabs: everyTab().slice(1) },
    });
    expect(unwrapErr(refused)[1]).toBe(
      "nothing was published — a publisher that graded this against its own array would report full coverage over whatever it was handed",
    );
  });
});

describe("the two browser publishers share the page kind", () => {
  it("keeps every route entity when the tabs are published after the routes", () => {
    unwrap(
      publishNotionBrowserWalk({
        at: AT,
        paths,
        walk: { pages: everyRouteUnreachable(), sessionLost: false, workspaceRootFound: true },
      }),
    );
    unwrap(publishNotionSettingsTabs({ at: LATER, paths, walk: { sessionLost: false, tabs: everyTab() } }));
    expect(pageFile().entities.length).toBe(NOTION_BROWSER_PAGES.length + NOTION_SETTINGS_TABS.length);
  });

  it("leaves every route gap open as measured evidence when the tabs are published", () => {
    unwrap(
      publishNotionBrowserWalk({
        at: AT,
        paths,
        walk: { pages: everyRouteUnreachable(), sessionLost: false, workspaceRootFound: true },
      }),
    );
    const before = pageFile()
      .gaps.filter((gap) => gap.status === "open")
      .map((gap) => gap.id);
    unwrap(publishNotionSettingsTabs({ at: LATER, paths, walk: { sessionLost: false, tabs: everyTab() } }));
    const open = new Set(
      pageFile()
        .gaps.filter((gap) => gap.status === "open")
        .map((gap) => gap.id),
    );
    expect(before.length).toBeGreaterThan(0);
    expect(before.filter((id) => !open.has(id))).toEqual([]);
  });

  it("keeps the tab entities observed when a later route walk publishes", () => {
    unwrap(publishNotionSettingsTabs({ at: AT, paths, walk: { sessionLost: false, tabs: everyTab() } }));
    unwrap(
      publishNotionBrowserWalk({
        at: LATER,
        paths,
        walk: { pages: everyRouteUnreachable(), sessionLost: false, workspaceRootFound: true },
      }),
    );
    const tabs = pageFile().entities.filter((entity) => entity.providerId.startsWith("settings/"));
    expect(tabs.length).toBe(NOTION_SETTINGS_TABS.length);
    expect(tabs.filter((entity) => entity.channels.browser === null)).toEqual([]);
  });

  it("keeps the tab cell when a later route walk replaces its own", () => {
    unwrap(publishNotionSettingsTabs({ at: AT, paths, walk: { sessionLost: false, tabs: everyTab() } }));
    unwrap(
      publishNotionBrowserWalk({
        at: LATER,
        paths,
        walk: { pages: everyRouteUnreachable(), sessionLost: false, workspaceRootFound: true },
      }),
    );
    const scopes = pageFile()
      .coverage.filter((cell) => cell.surface === "browser-walk")
      .map((cell) => cell.scope)
      .toSorted();
    expect(scopes).toEqual(["declared-pages", "declared-settings-tabs"]);
    expect(tabCell().state).toBe("synced");
  });
});
