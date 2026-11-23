/**
 * The Settings modal's address: `#settings/<section>` opens it on that section, `#settings/<section>/<item>` on one
 * item inside it, any other hash leaves it closed, and the page's own hash rides after `&page=` so closing gives it
 * back. And its left column: groups in order, and the "Search settings" filter.
 */
import { describe, expect, it } from "vitest";

import {
  pageHashOf,
  SETTINGS_GROUPS,
  SETTINGS_SECTION_LABELS,
  SETTINGS_SECTIONS,
  settingsEntrySection,
  settingsHash,
  settingsItemOf,
  settingsSectionOf,
  settingsSectionsMatching,
} from "../../lib/settingsModal";

describe("settingsEntrySection", () => {
  it("opens Models while no plan is connected, and Integrations once one is or before the list is read", () => {
    expect([
      settingsEntrySection({ noPlanConnected: true }),
      settingsEntrySection({ noPlanConnected: false }),
      settingsEntrySection({ noPlanConnected: undefined }),
    ]).toEqual(["models", "integrations", "integrations"]);
  });
});

describe("SETTINGS_SECTIONS", () => {
  it("are Integrations, Models, Theme, Presence and The call, in that order", () => {
    expect(SETTINGS_SECTIONS.map((section) => `${section}:${SETTINGS_SECTION_LABELS[section]}`)).toEqual([
      "integrations:Integrations",
      "models:Models",
      "theme:Theme",
      "presence:Presence",
      "call:The call",
    ]);
  });

  it("are grouped Connect then Preferences, each section in exactly one group, in the column's order", () => {
    expect(SETTINGS_GROUPS.map((group) => `${group.label}:${group.sections.join(",")}`)).toEqual([
      "Connect:integrations,models",
      "Preferences:theme,presence,call",
    ]);
    expect(SETTINGS_GROUPS.flatMap((group) => group.sections)).toEqual([...SETTINGS_SECTIONS]);
  });
});

describe("settingsSectionsMatching", () => {
  it("keeps every section for an empty or blank query", () => {
    expect(settingsSectionsMatching({ query: "" })).toEqual([...SETTINGS_SECTIONS]);
    expect(settingsSectionsMatching({ query: "   " })).toEqual([...SETTINGS_SECTIONS]);
  });

  it("finds a section by its label or a keyword, case-insensitively", () => {
    expect(settingsSectionsMatching({ query: "THEME" })).toEqual(["theme"]);
    expect(settingsSectionsMatching({ query: "connectors" })).toEqual(["integrations"]);
    expect(settingsSectionsMatching({ query: "plans" })).toEqual(["models"]);
    expect(settingsSectionsMatching({ query: "orb" })).toEqual(["presence"]);
  });

  it("needs every word of the query, and keeps nothing for a query no section carries", () => {
    expect(settingsSectionsMatching({ query: "usage limit" })).toEqual(["models"]);
    expect(settingsSectionsMatching({ query: "usage orb" })).toEqual([]);
    expect(settingsSectionsMatching({ query: "billing" })).toEqual([]);
  });
});

describe("settingsSectionOf", () => {
  it("opens each section its own hash names", () => {
    expect(settingsSectionOf({ hash: "#settings/integrations" })).toBe("integrations");
    expect(settingsSectionOf({ hash: "#settings/models" })).toBe("models");
    expect(settingsSectionOf({ hash: "#settings/theme" })).toBe("theme");
    expect(settingsSectionOf({ hash: "#settings/presence" })).toBe("presence");
    expect(settingsSectionOf({ hash: "#settings/call" })).toBe("call");
  });

  it("opens Integrations for a bare #settings, a trailing slash, or a section it does not draw", () => {
    expect(settingsSectionOf({ hash: "#settings" })).toBe("integrations");
    expect(settingsSectionOf({ hash: "#settings/" })).toBe("integrations");
    expect(settingsSectionOf({ hash: "#settings/general" })).toBe("integrations");
    expect(settingsSectionOf({ hash: "#settings/appearance" })).toBe("integrations");
  });

  it("reads a hash without its leading #", () => {
    expect(settingsSectionOf({ hash: "settings/call" })).toBe("call");
  });

  it("reads the section past an item and past a page hash carried after it", () => {
    expect(settingsSectionOf({ hash: "#settings/integrations/datadog" })).toBe("integrations");
    expect(settingsSectionOf({ hash: "#settings/presence&page=candidates" })).toBe("presence");
    expect(settingsSectionOf({ hash: "#settings&page=candidates" })).toBe("integrations");
  });

  it("leaves the modal closed for no hash and for a hash that is not its own", () => {
    expect(settingsSectionOf({ hash: "" })).toBe(undefined);
    expect(settingsSectionOf({ hash: "#" })).toBe(undefined);
    expect(settingsSectionOf({ hash: "#cards" })).toBe(undefined);
    expect(settingsSectionOf({ hash: "#settingsx/call" })).toBe(undefined);
    expect(settingsSectionOf({ hash: "#call/settings" })).toBe(undefined);
  });
});

describe("settingsItemOf", () => {
  it("reads the item a section has open, past a page hash too", () => {
    expect(settingsItemOf({ hash: "#settings/integrations/datadog" })).toBe("datadog");
    expect(settingsItemOf({ hash: "settings/integrations/slack&page=candidates" })).toBe("slack");
  });

  it("finds no item on a section's own list, an empty third segment, or a closed modal", () => {
    expect(settingsItemOf({ hash: "#settings/integrations" })).toBe(undefined);
    expect(settingsItemOf({ hash: "#settings/integrations/" })).toBe(undefined);
    expect(settingsItemOf({ hash: "#settings" })).toBe(undefined);
    expect(settingsItemOf({ hash: "#cards/integrations/datadog" })).toBe(undefined);
  });

  it("finds no item under a section the hash does not name, since that section opened by fallback", () => {
    expect(settingsItemOf({ hash: "#settings/nope/datadog" })).toBe(undefined);
  });
});

describe("settingsHash", () => {
  it("writes the hash each section is read back from", () => {
    expect(SETTINGS_SECTIONS.length).toBeGreaterThan(0);
    expect(
      SETTINGS_SECTIONS.map((section) => settingsSectionOf({ hash: settingsHash({ pageHash: "", section }) })),
    ).toEqual([...SETTINGS_SECTIONS]);
    expect(SETTINGS_SECTIONS.map((section) => settingsHash({ pageHash: "", section }))).toEqual([
      "#settings/integrations",
      "#settings/models",
      "#settings/theme",
      "#settings/presence",
      "#settings/call",
    ]);
  });

  it("writes an item after its section, and reads both back with the page hash it carries", () => {
    const opened = settingsHash({ item: "datadog", pageHash: "#candidates", section: "integrations" });
    expect(opened).toBe("#settings/integrations/datadog&page=candidates");
    expect(settingsSectionOf({ hash: opened })).toBe("integrations");
    expect(settingsItemOf({ hash: opened })).toBe("datadog");
    expect(pageHashOf({ hash: opened })).toBe("#candidates");
  });

  it("reads back an item carrying a slash whole", () => {
    const opened = settingsHash({ item: "a/b", pageHash: "#candidates", section: "integrations" });
    expect(settingsItemOf({ hash: opened })).toBe("a/b");
  });

  it("carries the page's own hash after the section, with or without its #", () => {
    expect(settingsHash({ pageHash: "#candidates", section: "theme" })).toBe("#settings/theme&page=candidates");
    expect(settingsHash({ pageHash: "candidates", section: "presence" })).toBe("#settings/presence&page=candidates");
  });
});

describe("pageHashOf", () => {
  it("reads the page's own hash while Settings is closed", () => {
    expect(pageHashOf({ hash: "#candidates" })).toBe("#candidates");
    expect(pageHashOf({ hash: "" })).toBe("");
  });

  it("reads the page hash Settings carries while open, as a reload or a restored tab finds it", () => {
    expect(pageHashOf({ hash: "#settings/theme&page=candidates" })).toBe("#candidates");
  });

  it("gives back a page hash that itself carries &page= whole", () => {
    const opened = settingsHash({ pageHash: "#a&page=b", section: "call" });
    expect(opened).toBe("#settings/call&page=a&page=b");
    expect(settingsSectionOf({ hash: opened })).toBe("call");
    expect(pageHashOf({ hash: opened })).toBe("#a&page=b");
  });

  it("finds no page hash when Settings carries none", () => {
    expect(pageHashOf({ hash: "#settings/call" })).toBe("");
    expect(pageHashOf({ hash: "#settings/call&page=" })).toBe("");
  });

  it("gives back what opening carried, through a section switch", () => {
    const opened = settingsHash({ pageHash: pageHashOf({ hash: "#candidates" }), section: "theme" });
    const switched = settingsHash({ pageHash: pageHashOf({ hash: opened }), section: "presence" });
    expect(switched).toBe("#settings/presence&page=candidates");
    expect(pageHashOf({ hash: switched })).toBe("#candidates");
  });
});
