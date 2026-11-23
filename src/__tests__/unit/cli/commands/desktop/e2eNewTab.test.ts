import { describe, expect, it } from "vitest";

import { stripTabOf } from "../../../../../cli/commands/desktop/e2eNewTab.js";

describe("stripTabOf — a tab as the strip's DOM read gave it, in the judge's shape", () => {
  it("keeps a tab that draws its icon and id as it drew them", () => {
    expect(stripTabOf({ icon: "⇄", id: "tab-3", selected: true })).toEqual({
      icon: "⇄",
      id: "tab-3",
      selected: true,
    });
  });

  it("reads a null icon text and a null id attribute as no icon and no id", () => {
    expect(stripTabOf({ icon: null, id: null, selected: false })).toEqual({
      icon: undefined,
      id: undefined,
      selected: false,
    });
  });

  it("reads a tab with no icon element at all as no icon, its id kept", () => {
    expect(stripTabOf({ icon: undefined, id: "tab-1", selected: false })).toEqual({
      icon: undefined,
      id: "tab-1",
      selected: false,
    });
  });

  it("keeps an empty icon text as drawn, so a blank icon is never read as a missing one", () => {
    expect(stripTabOf({ icon: "", id: "tab-2", selected: false }).icon).toBe("");
  });
});
