/**
 * A noun's earlier name dispatches as the noun it now means: `slopweaver recipe due` runs `automation due`.
 */
import { describe, expect, it } from "vitest";

import { canonicalArgv, canonicalNoun, NOUN_ALIASES } from "../../../cli/nounAliases.js";
import { NOUN_GROUPS } from "../../../cli/nounGroups.js";

describe("NOUN_ALIASES", () => {
  it("declares at least one alias, so the guards below are true of something", () => {
    expect(Object.keys(NOUN_ALIASES).length).toBeGreaterThan(0);
  });

  it("points every alias at a noun the CLI declares, and shadows none", () => {
    const declared = Object.keys(NOUN_GROUPS);
    expect(Object.values(NOUN_ALIASES).filter((noun) => !declared.includes(noun))).toEqual([]);
    expect(Object.keys(NOUN_ALIASES).filter((alias) => declared.includes(alias))).toEqual([]);
  });
});

describe("canonicalNoun", () => {
  it("resolves recipe to automation", () => {
    expect(canonicalNoun({ noun: "recipe" })).toBe("automation");
  });

  it("leaves a current noun unchanged", () => {
    expect(canonicalNoun({ noun: "automation" })).toBe("automation");
    expect(canonicalNoun({ noun: "handover" })).toBe("handover");
  });

  it("does not resolve an inherited object key", () => {
    expect(canonicalNoun({ noun: "toString" })).toBe("toString");
  });
});

describe("canonicalArgv", () => {
  it("rewrites the noun position only", () => {
    expect(canonicalArgv({ argv: ["node", "cli", "recipe", "due", "--recipe", "recipe"] })).toEqual([
      "node",
      "cli",
      "automation",
      "due",
      "--recipe",
      "recipe",
    ]);
  });

  it("returns the same argv when the noun is current", () => {
    const argv = ["node", "cli", "automation", "due"];
    expect(canonicalArgv({ argv })).toBe(argv);
  });

  it("returns the same argv when there is no noun", () => {
    const argv = ["node", "cli"];
    expect(canonicalArgv({ argv })).toBe(argv);
  });
});
