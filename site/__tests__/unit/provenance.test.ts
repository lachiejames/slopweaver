/*
 * The provenance mark: three classes read off a row's facts, and what each prints. The team class prints the
 * organisation's own name, the one the context switcher shows, so a card and the switcher never name the team two ways.
 */

import { describe, expect, it } from "vitest";

import { provenanceEntryOf, prProvenanceOf, queueProvenanceOf } from "../../lib/provenance";

describe("provenanceEntryOf", () => {
  it("labels the team class by the organisation's name", () => {
    expect(provenanceEntryOf({ provenance: "team", teamLabel: "Acme" })).toEqual({
      label: "Acme",
      rule: "a card or pull request drawn in the team's workspace",
    });
  });

  it("keeps the bot and self classes' fixed names whatever the organisation is", () => {
    expect(provenanceEntryOf({ provenance: "bot", teamLabel: "Acme" })).toEqual({
      glyph: "CR",
      label: "CodeRabbit",
      rule: "a review bot's thread is waiting on us, or the next act is a bot-review fix",
    });
    expect(provenanceEntryOf({ provenance: "self", teamLabel: "Acme" }).label).toBe("Slopweaver");
  });
});

describe("the classification never reads the organisation's name", () => {
  it("classes a pull request by the bot waiting on it, else by the workspace its placement draws it in", () => {
    const facts = { action: "land", botAwaitingUs: 0 };
    const team = { by: [], kind: "placed", workspace: "team" } as const;
    expect(prProvenanceOf({ facts, placement: team })).toBe("team");
    expect(prProvenanceOf({ facts: { ...facts, botAwaitingUs: 1 }, placement: team })).toBe("bot");
    expect(prProvenanceOf({ facts: { ...facts, action: "spawn-coderabbit" }, placement: team })).toBe("bot");
  });

  it("gives a pull request the self view draws the self mark, the owner's word next or not", () => {
    const facts = { action: "blocked-on", botAwaitingUs: 0 };
    expect(prProvenanceOf({ facts, placement: { by: [], kind: "placed", workspace: "self" } })).toBe("self");
    expect(prProvenanceOf({ facts, placement: { kind: "unplaced", why: "two repositories" } })).toBe("self");
  });

  it("classes any card by the workspace it is drawn in, a finding by the default rule", () => {
    expect(queueProvenanceOf({ placement: { by: [], kind: "placed", workspace: "team" } })).toBe("team");
    expect(queueProvenanceOf({ placement: { by: [], kind: "placed", workspace: "self" } })).toBe("self");
    expect(queueProvenanceOf({ placement: { kind: "unplaced", why: "states nothing" } })).toBe("self");
  });
});
