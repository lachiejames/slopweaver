/*
 * `unresolvedOwnerRefusal`: silent on the happy path, and otherwise naming the person, the valid key kinds and the
 * break-glass, one line per unresolved owner.
 */
import { describe, expect, it } from "vitest";

import { unresolvedOwnerRefusal } from "../../../../../../cli/commands/slack/core.js";

describe("unresolvedOwnerRefusal", () => {
  it("is empty when every owner resolved, so the happy path adds no noise", () => {
    expect(unresolvedOwnerRefusal({ unresolvedOwners: [] })).toEqual([]);
  });

  it("names the person and what the card WOULD have said, rather than only 'unresolved'", () => {
    const lines = unresolvedOwnerRefusal({ unresolvedOwners: ["Ada Lovelace"] }).join("\n");

    expect(lines).toContain('owner "Ada Lovelace" is not an exact match');
    expect(lines).toContain('"Ada Lovelace (unresolved)"');
  });

  it("states the valid key kinds, and that a display name and an email local part are NOT among them", () => {
    const lines = unresolvedOwnerRefusal({ unresolvedOwners: ["Ada Lovelace"] }).join("\n");

    expect(lines).toContain("A display name is deliberately never a key");
    expect(lines).toContain("neither is the local part of an email");
  });

  it("names the break-glass, so the refusal is escapable without reading the source", () => {
    expect(unresolvedOwnerRefusal({ unresolvedOwners: ["x"] }).join("\n")).toContain("--allow-unresolved-owner");
  });

  it("reports one line per unresolved owner plus the two explanation lines", () => {
    expect(unresolvedOwnerRefusal({ unresolvedOwners: ["a", "b", "c"] }).length).toBe(5);
  });
});
