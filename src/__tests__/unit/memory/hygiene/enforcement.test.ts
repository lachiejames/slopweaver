/**
 * CHECK 5 — which memories restate something already enforced.
 *
 * ## Why every case here pads the enforcer list
 *
 * Rarity is measured across the ENFORCERS, so `indexSources`' ceiling is a share of however many were passed.
 * Two enforcers give a ceiling of 0.2, under which a token present in either one is "too common" and nothing can
 * ever match — so a fixture of two enforcers would test a degenerate index rather than the matcher. Padding to a
 * realistic count is what makes document frequency mean anything, and the live repository passes dozens.
 *
 * ## The property under test is the SHARE, not the count
 *
 * An absolute shared-token threshold nominated 12 of 19 live memories, because an always-on doc is thousands of
 * words. So the partial-overlap case is the one that matters most here: two shared rare tokens out of five is a
 * match a count-based implementation would claim and this one refuses.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import {
  ENFORCEMENT_COVERAGE_SHARE,
  type Enforcer,
  findEnforcedMemories,
} from "../../../../memory/hygiene/enforcement.js";
import type { MemoryLeaf } from "../../../../memory/types.js";

/** How many filler enforcers pad each fixture — see this file's header for why padding is required. */
const FILLER_ENFORCERS = 30;

/** A leaf carrying only the two fields this check reads. */
function leafOf({ stem, description }: { stem: string; description: string }): MemoryLeaf {
  return {
    amendsCanon: null,
    correctionSubject: null,
    declaredModified: null,
    declaredName: null,
    declaredType: "feedback",
    description,
    file: `${stem}.md`,
    mtimeMs: null,
    overlaps: [],
    ownerDirective: null,
    schemaFindings: [],
    stem,
    text: "",
    wikilinks: [],
  };
}

/** Filler enforcers, each with vocabulary no other source shares, so only the ceiling changes. */
function fillers(): readonly Enforcer[] {
  return Array.from({ length: FILLER_ENFORCERS }, (_unused, position) => ({
    id: `filler-${String(position)}`,
    kind: "always-on-doc" as const,
    text: `fillerword${String(position)} unrelatedvocabulary${String(position)}`,
  }));
}

/** The named enforcers this fixture is about, padded out to a realistic corpus. */
function enforcersWith({ named }: { named: readonly Enforcer[] }): readonly Enforcer[] {
  return [...named, ...fillers()];
}

const AGENTS: Enforcer = {
  id: "AGENTS.md",
  kind: "always-on-doc",
  text: "always batch a pelican before you migrate it, chronological ordering, batching throughout",
};

describe("findEnforcedMemories", () => {
  it("nominates a memory whose distinctive vocabulary is already in an always-on doc", () => {
    const leaves = [leafOf({ description: "pelican migrate chronological batching", stem: "pelican-batching" })];
    const matches = findEnforcedMemories({ enforcers: enforcersWith({ named: [AGENTS] }), leaves });
    expect(matches.length).toBe(1);
    expect(matches[0]!.file).toBe("pelican-batching.md");
    expect(matches[0]!.coverage).toBe(1);
    expect(matches[0]!.enforcers.map((enforcer) => enforcer.id)).toEqual(["AGENTS.md"]);
    expect(matches[0]!.sharedTokens).toEqual(["batching", "chronological", "migrate", "pelican"]);
  });

  it("nominates nothing when a memory shares no rare vocabulary with any enforcer", () => {
    const leaves = [leafOf({ description: "quokka tolerates interrupt sequencing", stem: "quokka-tolerance" })];
    expect(findEnforcedMemories({ enforcers: enforcersWith({ named: [AGENTS] }), leaves })).toEqual([]);
  });

  it("refuses a PARTIAL overlap that a shared-token count would have claimed", () => {
    // Five distinctive tokens, two of them the doc's — two shared rare tokens, which is exactly the absolute
    // threshold that nominated 12 of 19 live memories, and a coverage of 0.4 which is under the share.
    const leaves = [leafOf({ description: "pelican migrate quokka tolerates sequencing", stem: "quokka-sequencing" })];
    expect(findEnforcedMemories({ enforcers: enforcersWith({ named: [AGENTS] }), leaves })).toEqual([]);
    const relaxed = findEnforcedMemories({ enforcers: enforcersWith({ named: [AGENTS] }), leaves, share: 0.4 });
    expect(relaxed.map((match) => match.coverage)).toEqual([0.4]);
  });

  it("orders several matching enforcers strongest first, and reports the strongest one's tokens", () => {
    const skill: Enforcer = {
      id: "skills/pelican",
      kind: "skill",
      text: "migrate a pelican in chronological order",
    };
    const leaves = [leafOf({ description: "pelican migrate chronological batching", stem: "pelican-batching" })];
    const matches = findEnforcedMemories({ enforcers: enforcersWith({ named: [skill, AGENTS] }), leaves });
    expect(matches.length).toBe(1);
    expect(matches[0]!.enforcers.map((enforcer) => enforcer.id)).toEqual(["AGENTS.md", "skills/pelican"]);
    expect(matches[0]!.coverage).toBe(1);
    expect(matches[0]!.sharedTokens).toEqual(["batching", "chronological", "migrate", "pelican"]);
  });

  it("never nominates a memory with too few distinctive tokens to measure a share over", () => {
    const leaves = [leafOf({ description: "", stem: "pelican" })];
    expect(findEnforcedMemories({ enforcers: enforcersWith({ named: [AGENTS] }), leaves })).toEqual([]);
  });

  it("returns nothing for an empty corpus and for a memory with no enforcers to match against", () => {
    expect(findEnforcedMemories({ enforcers: enforcersWith({ named: [AGENTS] }), leaves: [] })).toEqual([]);
    const leaves = [leafOf({ description: "pelican migrate chronological batching", stem: "pelican-batching" })];
    expect(findEnforcedMemories({ enforcers: [], leaves })).toEqual([]);
  });

  it("takes the share as a parameter, so the measured default is a value rather than a hidden rule", () => {
    expect(ENFORCEMENT_COVERAGE_SHARE).toBe(0.6);
    const leaves = [leafOf({ description: "pelican migrate quokka tolerates sequencing", stem: "quokka-sequencing" })];
    expect(findEnforcedMemories({ enforcers: enforcersWith({ named: [AGENTS] }), leaves, share: 1 })).toEqual([]);
  });

  it("breaks a coverage TIE on the enforcer id, so the array's own order stops deciding the best match", () => {
    const shared = "kestrel marlinspike zephyr";
    const leaves = [leafOf({ description: shared, stem: "kestrel-marlinspike" })];
    const zuluFirst = findEnforcedMemories({
      enforcers: enforcersWith({
        named: [
          { id: "zulu-gate", kind: "lint-gate", text: shared },
          { id: "alpha-gate", kind: "lint-gate", text: shared },
        ],
      }),
      leaves,
    });
    expect(zuluFirst.length).toBe(1);
    expect(zuluFirst[0]!.enforcers.map((enforcer) => enforcer.id)).toEqual(["alpha-gate", "zulu-gate"]);
  });

  it("answers the same when the two tied enforcers arrive the other way round", () => {
    const shared = "kestrel marlinspike zephyr";
    const leaves = [leafOf({ description: shared, stem: "kestrel-marlinspike" })];
    const alphaFirst = findEnforcedMemories({
      enforcers: enforcersWith({
        named: [
          { id: "alpha-gate", kind: "lint-gate", text: shared },
          { id: "zulu-gate", kind: "lint-gate", text: shared },
        ],
      }),
      leaves,
    });
    expect(alphaFirst[0]!.enforcers.map((enforcer) => enforcer.id)).toEqual(["alpha-gate", "zulu-gate"]);
  });
});
