import { describe, expect, it } from "vitest";

import { UNRENDERED_SCREENSHOT_BECAUSE } from "../../../../atlas/kit/browserWalk.js";
import type { NotionArtifactWriter } from "../../../../atlas/notion/browserWalk.js";
import { NOTION_SETTINGS_TABS, type NotionSettingsTab } from "../../../../atlas/notion/settingsTabs.js";
import {
  isSettingsTabHeld,
  isSettingsTabProviderId,
  markIndistinguishableTabs,
  type NotionSettingsTabObservation,
  type NotionShotReader,
  settingsTabOutcome,
  settingsTabSurface,
  walkNotionSettingsTabs,
} from "../../../../atlas/notion/settingsWalk.js";
import type { NotionSettingsObservation, NotionSettingsTransport } from "../../../../browser/notionSettings.js";
import { type BrowserTransportError, BrowserTransportErrors } from "../../../../browser/pageTransport.js";
import { err, ok, type Result } from "../../../../lib/result.js";
import { renderedPng, unrenderedPng } from "../../../pngFixture.js";

const PREFERENCES = NOTION_SETTINGS_TABS[0]!;
const MEMBERS = NOTION_SETTINGS_TABS.find((tab) => tab.id === "members")!;

/** What the tab arm reports when it opened the modal and selected exactly the tab it was asked for. */
function shown({
  tab,
  over = {},
}: {
  tab: NotionSettingsTab;
  over?: Partial<NotionSettingsObservation>;
}): NotionSettingsObservation {
  return {
    clicked: `tab — ${tab.names[0]!}`,
    controlMatches: 1,
    dialogError: null,
    dialogLabel: null,
    dialogOpen: true,
    entries: [],
    finalUrl: "https://app.notion.com/acme",
    offered: [],
    overlays: [],
    refused: null,
    roles: [],
    screenshotError: null,
    screenshotPath: `shot/${tab.id}.png`,
    selectedTabs: [tab.names[0]!],
    tabMatches: 1,
    title: "Notion",
    ...over,
  };
}

/** A transport answering each tab by its first name, with a per-tab override or failure. */
function fakeSettings({
  overrides = {},
  failures = {},
}: {
  overrides?: Readonly<Record<string, Partial<NotionSettingsObservation>>>;
  failures?: Readonly<Record<string, BrowserTransportError>>;
} = {}): { transport: NotionSettingsTransport; asked: string[] } {
  const asked: string[] = [];
  const transport: NotionSettingsTransport = {
    lease: () => Promise.resolve(ok(null)),
    observe: () => err(BrowserTransportErrors.unavailable({ reason: "the settings walk never observes" })),
    readTab: ({ tabNames }): Result<NotionSettingsObservation, BrowserTransportError> => {
      const tab = NOTION_SETTINGS_TABS.find((declared) => declared.names[0] === tabNames[0])!;
      asked.push(tab.id);
      const failure = failures[tab.id];
      if (failure !== undefined) {
        return err(failure);
      }
      return ok({ ...shown({ tab }), ...overrides[tab.id] });
    },
    release: () => undefined,
  };
  return { asked, transport };
}

/** A scratch reader serving a distinct rendered picture per tab, recording every path it was asked for. */
function fakeShots({
  pictures = {},
  unreadable = [],
}: { pictures?: Readonly<Record<string, Uint8Array>>; unreadable?: readonly string[] } = {}): {
  read: NotionShotReader;
  reads: string[];
} {
  const reads: string[] = [];
  return {
    read: ({ path }) => {
      reads.push(path);
      const id = path.replace("shot/", "").replace(".png", "");
      if (unreadable.includes(id)) {
        return err(["the scratch file is gone"]);
      }
      const picture = pictures[id];
      if (picture !== undefined) {
        return ok(picture);
      }
      return ok(renderedPng({ seed: NOTION_SETTINGS_TABS.findIndex((tab) => tab.id === id) + 1 }));
    },
    reads,
  };
}

function recordingWriter(): { write: NotionArtifactWriter; stored: string[] } {
  const stored: string[] = [];
  return {
    stored,
    write: ({ relativePath }) => {
      stored.push(relativePath);
      return ok(null);
    },
  };
}

function walk({
  settings = fakeSettings(),
  shots = fakeShots(),
  writer = recordingWriter(),
}: {
  settings?: ReturnType<typeof fakeSettings>;
  shots?: ReturnType<typeof fakeShots>;
  writer?: ReturnType<typeof recordingWriter>;
} = {}): ReturnType<typeof walkNotionSettingsTabs> {
  return walkNotionSettingsTabs({
    now: () => "2026-09-30T00:00:00.000Z",
    readShot: shots.read,
    transport: settings.transport,
    writeArtifact: writer.write,
  });
}

function byId({
  tabs,
  id,
}: {
  tabs: readonly NotionSettingsTabObservation[];
  id: string;
}): NotionSettingsTabObservation {
  return tabs.find((tab) => tab.tabId === id)!;
}

describe("settingsTabSurface", () => {
  it("files a tab under the settings prefix", () => {
    expect(settingsTabSurface({ id: "members" })).toBe("settings/members");
  });

  it("is recognised as a tab by the provider-id partition", () => {
    expect(isSettingsTabProviderId({ providerId: settingsTabSurface({ id: "members" }) })).toBe(true);
  });

  it("never claims a declared route as a tab", () => {
    expect(isSettingsTabProviderId({ providerId: "account-profile" })).toBe(false);
  });
});

describe("settingsTabOutcome", () => {
  it("grades a tab the client marked selected as shown", () => {
    expect(settingsTabOutcome({ observed: shown({ tab: PREFERENCES }), tab: PREFERENCES })).toBe(null);
  });

  it("accepts the asked-for tab among several the client marked selected", () => {
    const observed = shown({ over: { selectedTabs: ["Members", "Members 186"] }, tab: MEMBERS });
    expect(settingsTabOutcome({ observed, tab: MEMBERS })).toBe(null);
  });

  it("quotes the snippet's own refusal, having clicked nothing", () => {
    const observed = shown({ over: { refused: "the modal offered no tab rail" }, tab: PREFERENCES });
    expect(settingsTabOutcome({ observed, tab: PREFERENCES })).toBe(
      "nothing was clicked: the modal offered no tab rail",
    );
  });

  it("says the modal did not open", () => {
    const observed = shown({ over: { dialogOpen: false }, tab: PREFERENCES });
    expect(settingsTabOutcome({ observed, tab: PREFERENCES })).toBe(
      "the settings modal did not open, so no tab could be selected",
    );
  });

  it("says no rail appeared when the match count is unknown", () => {
    const observed = shown({ over: { tabMatches: null }, tab: PREFERENCES });
    expect(settingsTabOutcome({ observed, tab: PREFERENCES })).toBe(
      "the settings modal opened but no tab rail appeared in it",
    );
  });

  it("points a renamed tab at the verb that re-measures the rail", () => {
    const observed = shown({ over: { tabMatches: 0 }, tab: PREFERENCES });
    expect(settingsTabOutcome({ observed, tab: PREFERENCES })).toBe(
      "no tab in the settings rail goes by Preferences — Notion may have renamed it; re-measure the rail with `slopweaver atlas notion settings`",
    );
  });

  it("refuses to pick between two tabs of one name", () => {
    const observed = shown({ over: { tabMatches: 2 }, tab: PREFERENCES });
    expect(settingsTabOutcome({ observed, tab: PREFERENCES })).toBe(
      "2 tabs in the settings rail go by Preferences, so none was picked",
    );
  });

  it("never quotes the transport's own click error", () => {
    const observed = shown({ over: { dialogError: "timeout on https://app.notion.com/acme" }, tab: PREFERENCES });
    expect(settingsTabOutcome({ observed, tab: PREFERENCES })).toBe(
      "the tab was found in the rail but the click on it did not complete",
    );
  });

  it("counts, and never names, what the client marked selected instead", () => {
    const observed = shown({ over: { selectedTabs: ["A Person's Name"] }, tab: MEMBERS });
    expect(settingsTabOutcome({ observed, tab: MEMBERS })).toBe(
      "the tab was clicked but the client did not mark it selected (it marked 1 other entry(s))",
    );
  });
});

describe("walkNotionSettingsTabs", () => {
  it("asks for every declared tab in rail order", () => {
    const settings = fakeSettings();
    walk({ settings });
    expect(settings.asked).toEqual(NOTION_SETTINGS_TABS.map((tab) => tab.id));
  });

  it("holds every tab when each was selected and photographed distinctly", () => {
    const walked = walk();
    expect(walked.tabs.filter((tab) => isSettingsTabHeld({ tab })).length).toBe(NOTION_SETTINGS_TABS.length);
  });

  it("stores one screenshot per held tab", () => {
    const writer = recordingWriter();
    walk({ writer });
    expect(writer.stored.length).toBe(NOTION_SETTINGS_TABS.length);
  });

  it("reads back every scratch screenshot, so none is left behind", () => {
    const shots = fakeShots();
    walk({ shots });
    expect(shots.reads.length).toBe(NOTION_SETTINGS_TABS.length);
  });

  it("still reads — and so removes — the scratch picture of a tab that did not render", () => {
    const shots = fakeShots();
    walk({ settings: fakeSettings({ overrides: { members: { selectedTabs: [] } } }), shots });
    expect(shots.reads.includes("shot/members.png")).toBe(true);
  });

  it("does not hold the picture of a tab the client did not select", () => {
    const walked = walk({ settings: fakeSettings({ overrides: { members: { selectedTabs: [] } } }) });
    const members = byId({ id: "members", tabs: walked.tabs });
    expect(members.artifacts).toEqual([]);
    expect(members.screenshotMissingBecause).toBe(
      "the picture is not held, because it shows something other than this tab",
    );
  });

  it("records a tab with no screenshot as shown but not photographed", () => {
    const walked = walk({ settings: fakeSettings({ overrides: { members: { screenshotPath: null } } }) });
    const members = byId({ id: "members", tabs: walked.tabs });
    expect(members.notRenderedBecause).toBe(null);
    expect(members.screenshotMissingBecause).toBe("the settings modal returned no screenshot for this tab");
  });

  it("records an unreadable scratch picture as not photographed", () => {
    const walked = walk({ shots: fakeShots({ unreadable: ["members"] }) });
    expect(byId({ id: "members", tabs: walked.tabs }).screenshotMissingBecause).toBe(
      "the screenshot could not be read back: the scratch file is gone",
    );
  });

  it("refuses a still-loading picture", () => {
    const walked = walk({ shots: fakeShots({ pictures: { members: unrenderedPng() } }) });
    expect(byId({ id: "members", tabs: walked.tabs }).screenshotMissingBecause).toBe(UNRENDERED_SCREENSHOT_BECAUSE);
  });

  it("records a screenshot that could not be stored as not photographed", () => {
    const walked = walk({ writer: { stored: [], write: () => err(["the disk is full"]) } });
    expect(byId({ id: "members", tabs: walked.tabs }).screenshotMissingBecause).toBe(
      "the screenshot could not be stored: the disk is full",
    );
  });

  it("stops asking after a lost session and marks the rest not attempted", () => {
    const settings = fakeSettings({
      failures: { members: BrowserTransportErrors.sessionLost({ reason: "signed out" }) },
    });
    const walked = walk({ settings });
    expect(walked.sessionLost).toBe(true);
    expect(settings.asked.at(-1)).toBe("members");
    expect(walked.tabs.filter((tab) => !tab.attempted).length).toBe(
      NOTION_SETTINGS_TABS.length - settings.asked.length,
    );
  });

  it("names a lost session in the failed tab's own reason", () => {
    const settings = fakeSettings({
      failures: { members: BrowserTransportErrors.sessionLost({ reason: "signed out" }) },
    });
    expect(byId({ id: "members", tabs: walk({ settings }).tabs }).notRenderedBecause).toBe(
      "the browser session was lost — sign in to Notion in your own Chrome and run the walk again",
    );
  });

  it("keeps walking after a tab that merely failed to open", () => {
    const settings = fakeSettings({
      failures: {
        members: BrowserTransportErrors.navigationFailed({
          because: "the modal timed out",
          reason: "timeout",
          url: "https://app.notion.com/acme",
        }),
      },
    });
    const walked = walk({ settings });
    expect(walked.sessionLost).toBe(false);
    expect(settings.asked.length).toBe(NOTION_SETTINGS_TABS.length);
  });
});

describe("markIndistinguishableTabs", () => {
  it("holds neither of two tabs whose pictures are byte-identical", () => {
    const same = renderedPng({ seed: 99 });
    const walked = walk({ shots: fakeShots({ pictures: { general: same, members: same } }) });
    expect(byId({ id: "members", tabs: walked.tabs }).screenshotMissingBecause).toBe(
      "its screenshot is byte-identical to 1 other declared tab(s) (general), so it evidences no tab of its own",
    );
    expect(isSettingsTabHeld({ tab: byId({ id: "general", tabs: walked.tabs }) })).toBe(false);
  });

  it("leaves a set of distinct pictures untouched", () => {
    const tabs = walk().tabs;
    expect(markIndistinguishableTabs({ tabs })).toEqual(tabs);
  });
});
