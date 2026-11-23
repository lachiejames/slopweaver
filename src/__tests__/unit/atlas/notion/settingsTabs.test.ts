/**
 * The closed tab set, and the refusal that names it.
 *
 * The property under test is that a tab is chosen from a list written in source — never composed by a
 * caller. Notion's settings modal holds `Delete workspace`, `Remove member` and a billing upgrade, so the
 * difference between "pick an id from this list" and "click the control named X" is the difference between
 * a read and an irreversible act against the workspace.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import {
  NOTION_SETTINGS_TAB_IDS,
  NOTION_SETTINGS_TABS,
  notionSettingsTab,
} from "../../../../atlas/notion/settingsTabs.js";

describe("the declared tab set", () => {
  // Every loop body and every `filter(bad).toEqual([])` below is true of an EMPTY list, so this line is
  // what makes the rest of this block falsifiable at all.
  it("declares at least one tab", () => {
    expect(NOTION_SETTINGS_TABS.length).toBeGreaterThan(0);
  });

  it("gives every tab a unique id", () => {
    expect(new Set(NOTION_SETTINGS_TAB_IDS).size).toBe(NOTION_SETTINGS_TABS.length);
  });

  it("gives every tab at least one name the client is known to render", () => {
    expect(NOTION_SETTINGS_TABS.filter((tab) => tab.names.length === 0)).toEqual([]);
  });

  it("gives every tab a description that is not its own id", () => {
    expect(NOTION_SETTINGS_TABS.filter((tab) => tab.description.trim() === tab.id)).toEqual([]);
  });

  // Two tabs sharing a name would make `everyNameMatches` pick whichever the DOM ordered first, which is a
  // capture nobody could attribute afterwards.
  it("never gives two tabs the same name", () => {
    const names = NOTION_SETTINGS_TABS.flatMap((tab) => tab.names);
    expect(new Set(names).size).toBe(names.length);
  });

  it("lists the ids in the order the tabs are declared", () => {
    expect(NOTION_SETTINGS_TAB_IDS).toEqual(NOTION_SETTINGS_TABS.map((tab) => tab.id));
  });
});

describe("notionSettingsTab resolves only what is declared", () => {
  it("returns the declared tab for an id in the set", () => {
    const first = NOTION_SETTINGS_TABS[0]!;
    expect(unwrap(notionSettingsTab({ id: first.id }))).toEqual(first);
  });

  it("refuses an unknown id and names every id that exists", () => {
    const refused = notionSettingsTab({ id: "delete-workspace" });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)[0]).toContain(NOTION_SETTINGS_TAB_IDS.join(", "));
  });

  it("refuses a bogus id with the whole closed set spelled out, in declaration order", () => {
    expect(unwrapErr(notionSettingsTab({ id: "bogus" }))).toEqual([
      "--tab 'bogus' is not a tab this build knows; the closed set is preferences, notifications, mail-and-calendar, general, members, analytics, import, notion-ai, connections, notion-mcp, verified-pages, public-pages, emoji, developer, notion-credits, explore-plans",
    ]);
  });

  it("refuses an id that is a NAME rather than an id, so a control name is never a route in", () => {
    const name = NOTION_SETTINGS_TABS[0]!.names[0]!;
    const refused = notionSettingsTab({ id: name });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)[0]).toBe(
      `--tab '${name}' is not a tab this build knows; the closed set is ${NOTION_SETTINGS_TAB_IDS.join(", ")}`,
    );
  });
});
