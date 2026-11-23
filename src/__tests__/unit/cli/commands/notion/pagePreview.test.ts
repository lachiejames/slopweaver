/**
 * The `notion page` dry-run previews' absent-field words. The cases that name a destination, the intent and
 * the body stay in `pageCore.test.ts`, where they were written; these pin what an unset field prints.
 */
import { describe, expect, it } from "vitest";

import type { NotionPageArgs } from "../../../../../cli/commands/notion/pageCore.js";
import { notionMoveDryRunLines, notionPageDryRunLines } from "../../../../../cli/commands/notion/pagePreview.js";

const UPDATE: NotionPageArgs = {
  adopt: false,
  bodySource: "b.md",
  dryRun: true,
  home: undefined,
  icon: undefined,
  json: false,
  mediaBase: undefined,
  overwriteExternalEdit: undefined,
  page: "https://www.notion.so/typed-address",
  parent: undefined,
  title: undefined,
  to: undefined,
  verb: "update",
};

describe("notionPageDryRunLines — unset fields", () => {
  it("names the update's page as typed, keeps the title, and sends no icon", () => {
    const lines = notionPageDryRunLines({ args: UPDATE, body: "x", parentPageId: undefined });
    expect(lines.slice(0, 4)).toEqual([
      "action:    update",
      "page:      https://www.notion.so/typed-address",
      "title:     (unchanged)",
      "icon:      (none)",
    ]);
  });

  it("prints a given title and icon verbatim", () => {
    const lines = notionPageDryRunLines({
      args: { ...UPDATE, icon: "🧭", title: "T" },
      body: "x",
      parentPageId: undefined,
    });
    expect(lines.slice(2, 4)).toEqual(["title:     T", "icon:      🧭"]);
  });

  it("says a create's parent is unresolved when its address did not resolve", () => {
    const lines = notionPageDryRunLines({
      args: { ...UPDATE, page: undefined, parent: "not-a-page", title: "T", verb: "create" },
      body: "x",
      parentPageId: undefined,
    });
    expect(lines[1]).toBe("parent:    (unresolved)");
    expect(lines[4]).toBe("intent:    (not computed — the parent address did not resolve)");
  });

  it("says an update's page is unresolved when no address was given at all", () => {
    const lines = notionPageDryRunLines({ args: { ...UPDATE, page: undefined }, body: "x", parentPageId: undefined });
    expect(lines[1]).toBe("page:      (unresolved)");
  });
});

describe("notionMoveDryRunLines — unset addresses", () => {
  it("says both addresses are unresolved when neither resolved nor was typed", () => {
    const lines = notionMoveDryRunLines({
      args: { ...UPDATE, page: undefined, to: undefined, verb: "move" },
      pageId: undefined,
      parentPageId: undefined,
    });
    expect(lines.slice(1, 3)).toEqual(["page:      (unresolved)", "to:        (unresolved)"]);
  });
});
