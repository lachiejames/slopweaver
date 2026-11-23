import { describe, expect, it } from "vitest";

import {
  accountTabGap,
  NOTION_SETTINGS_ACCOUNT_SCOPE,
  settingsTabGaps,
  settingsTabRechecks,
} from "../../../../atlas/notion/settingsGaps.js";
import type { NotionSettingsTabObservation } from "../../../../atlas/notion/settingsWalk.js";

const AT = "2026-09-30T00:00:00.000Z";

/** A tab shown and photographed, so a test states only what it is about. */
function tab(over: Partial<NotionSettingsTabObservation> = {}): NotionSettingsTabObservation {
  return {
    artifacts: [
      {
        byteLength: 4,
        kind: "page-png",
        mediaType: "image/png",
        relativePath: `artifacts/pages/${"a".repeat(64)}.png`,
        sha256: "a".repeat(64),
      },
    ],
    attempted: true,
    dialogOpen: true,
    group: "workspace",
    names: ["Members"],
    notRenderedBecause: null,
    observedAt: AT,
    screenshotMissingBecause: null,
    selectionVerified: true,
    surface: "settings/members",
    tabId: "members",
    tabMatches: 1,
    ...over,
  };
}

describe("settingsTabGaps", () => {
  it("raises nothing for a tab shown and photographed", () => {
    expect(settingsTabGaps({ at: AT, tabs: [tab()] })).toEqual([]);
  });

  it("files a tab that did not render under its own condition, not a route's", () => {
    const gaps = settingsTabGaps({ at: AT, tabs: [tab({ notRenderedBecause: "the settings modal did not open" })] });
    expect(gaps.map((gap) => gap.condition)).toEqual(["settings-tab-not-rendered"]);
  });

  it("carries the walk's own reason on a not-rendered gap", () => {
    const gaps = settingsTabGaps({ at: AT, tabs: [tab({ notRenderedBecause: "the settings modal did not open" })] });
    expect(gaps[0]!.reason).toBe("the settings modal did not open");
  });

  it("scopes each gap to the tab's own settings surface", () => {
    const gaps = settingsTabGaps({ at: AT, tabs: [tab({ notRenderedBecause: "x" })] });
    expect(gaps[0]!.scope).toBe("settings/members");
  });

  it("files a tab the walk never asked for as not attempted, over its not-rendered reason", () => {
    const gaps = settingsTabGaps({ at: AT, tabs: [tab({ attempted: false, notRenderedBecause: "session lost" })] });
    expect(gaps.map((gap) => gap.condition)).toEqual(["settings-tab-not-attempted"]);
  });

  it("files a shown tab with no held picture as screenshot-missing", () => {
    const gaps = settingsTabGaps({
      at: AT,
      tabs: [tab({ artifacts: [], screenshotMissingBecause: "the disk is full" })],
    });
    expect(gaps.map((gap) => [gap.condition, gap.reason])).toEqual([
      ["settings-tab-screenshot-missing", "the disk is full"],
    ]);
  });

  it("files a shown tab carrying no artifact as screenshot-missing even with no reason", () => {
    const gaps = settingsTabGaps({ at: AT, tabs: [tab({ artifacts: [] })] });
    expect(gaps.map((gap) => [gap.condition, gap.reason])).toEqual([
      ["settings-tab-screenshot-missing", "the tab has no proof screenshot"],
    ]);
  });
});

describe("accountTabGap", () => {
  it("files the per-install Account tab under its own standing condition", () => {
    expect(accountTabGap({ at: AT }).condition).toBe("settings-tab-undeclared-per-install");
  });

  it("scopes it to a settings surface, so no route recheck can close it", () => {
    expect(accountTabGap({ at: AT }).scope).toBe(NOTION_SETTINGS_ACCOUNT_SCOPE);
  });
});

describe("settingsTabRechecks", () => {
  it("rechecks every tab condition for an attempted tab, resolving each it did not raise", () => {
    expect(settingsTabRechecks({ tabs: [tab({ notRenderedBecause: "x" })] })).toEqual([
      { condition: "settings-tab-not-rendered", resolved: false, scope: "settings/members" },
      { condition: "settings-tab-not-attempted", resolved: true, scope: "settings/members" },
      { condition: "settings-tab-screenshot-missing", resolved: true, scope: "settings/members" },
    ]);
  });

  it("rechecks nothing for a tab the walk never asked for", () => {
    expect(settingsTabRechecks({ tabs: [tab({ attempted: false })] })).toEqual([]);
  });

  it("never rechecks a route scope, so the route gaps survive a settings walk", () => {
    const scopes = settingsTabRechecks({ tabs: [tab()] }).map((recheck) => recheck.scope);
    expect(scopes.filter((scope) => !scope.startsWith("settings/"))).toEqual([]);
    expect(scopes.length).toBe(3);
  });
});
