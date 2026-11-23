/**
 * The human report `atlas notion settings` prints for one observation of the settings modal.
 *
 * The verb itself drives the owner's Chrome, so only the pure `settingsLines` is exercised, each case
 * asserting the whole line list.
 */
import { describe, expect, it } from "vitest";

import type { NotionSettingsObservation } from "../../../../../browser/notionSettings.js";
import { settingsLines } from "../../../../../cli/commands/notionAtlas/settingsRun.js";

/** An open modal with one selected and one unselected entry, no refusal and no dialog error. */
function openModal(): NotionSettingsObservation {
  return {
    clicked: "button Settings",
    controlMatches: 1,
    dialogError: null,
    dialogLabel: "Settings",
    dialogOpen: true,
    entries: [
      { name: "Members", role: "tab", selected: true },
      { name: "Security", role: "tab", selected: false },
    ],
    finalUrl: "https://www.notion.so/workspace",
    offered: [],
    overlays: [],
    refused: null,
    roles: ["dialog=1", "tab=2"],
    screenshotError: null,
    screenshotPath: null,
    selectedTabs: ["Members"],
    tabMatches: 1,
    title: "Notion",
  };
}

describe("settingsLines", () => {
  it("reports a refusal with the count and names of the controls the sidebar offered, ignoring the entries", () => {
    const observed: NotionSettingsObservation = {
      ...openModal(),
      offered: ["Home", "Inbox"],
      refused: "no sidebar control matched Settings",
    };
    expect(settingsLines({ observed, tab: "members" })).toEqual([
      "notion settings — REFUSED: no sidebar control matched Settings",
      "  the sidebar offered 2 named control(s):",
      "    Home",
      "    Inbox",
    ]);
  });

  it("reports an open modal with the asked tab, what was selected, and a starred row only for the selected entry", () => {
    expect(settingsLines({ observed: openModal(), tab: "members" })).toEqual([
      "notion settings — modal open, asked for members, selected Members, 2 entry(s)",
      "  * Members                            tab",
      "    Security                           tab",
    ]);
  });

  it("reports a modal that did not open with the dialog error and the role census, observing only", () => {
    const observed: NotionSettingsObservation = {
      ...openModal(),
      dialogError: "no dialog appeared after the click",
      dialogOpen: false,
      entries: [],
      roles: ["button=12", "link=4"],
      selectedTabs: [],
    };
    expect(settingsLines({ observed, tab: null })).toEqual([
      "notion settings — modal NOT OPEN, observed only, nothing marked selected, 0 entry(s)",
      "  could not act: no dialog appeared after the click",
      "  roles on the page after the click: button=12 link=4",
    ]);
  });
});
