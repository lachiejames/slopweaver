/**
 * `withDerivedAtlasCapabilities` — a registered atlas is routable because it is REGISTERED.
 *
 * The cases below are the ones the measurement produced rather than an exhaustive sweep of
 * the function: 24 of 37 registered platforms had no row, and the twenty `vanta-*-atlas` rows in one
 * install's overlay are why the suppression key is the PLATFORM and not the id. The last group parses every
 * derived row through the real `sourceCapabilitySchema`, because a row this build generates and the schema
 * then refuses would be dropped by `parseCapabilityProfileRows` with nothing said.
 */
import { describe, expect, it } from "vitest";

import {
  derivedAtlasCapability,
  derivedAtlasTerms,
  type RegisteredAtlasSource,
  withDerivedAtlasCapabilities,
} from "../../../route/atlasCapability.js";
import { registeredAtlasSources } from "../../../route/atlasSources.js";
import { type SourceCapability, sourceCapabilitySchema } from "../../../route/profile.js";

const AETHER: RegisteredAtlasSource = { platform: "aether", summary: "The Aether pentest portal atlas" };
const NX_CLOUD: RegisteredAtlasSource = { platform: "nx-cloud", summary: "The Nx Cloud atlas" };

/** A capability row whose only interesting field is the command the platform is read out of. */
function row({ command, id }: { command: readonly string[]; id: string }): SourceCapability {
  return {
    availability: { kind: "available" },
    command,
    coverage: { detail: "a fixture", kind: "bounded" },
    effect: "read",
    freshness: { detail: "a fixture", kind: "cached" },
    id,
    owner: "private-console",
    sourceClass: "atlas",
    terms: ["fixture"],
    truthMode: "current",
    what: "a fixture",
  };
}

describe("derivedAtlasTerms", () => {
  it("takes the platform name as-is when it carries no hyphen", () => {
    expect(derivedAtlasTerms({ platform: "aether" })).toEqual(["aether", "aether atlas"]);
  });

  it("spells a hyphenated platform both ways, so a question written in words still matches", () => {
    expect(derivedAtlasTerms({ platform: "nx-cloud" })).toEqual(["nx-cloud", "nx cloud", "nx cloud atlas"]);
  });
});

describe("derivedAtlasCapability", () => {
  it("is born available carrying its command, because the atlas GRADING is what downgrades it", () => {
    const capability = derivedAtlasCapability({ atlas: AETHER });

    expect(capability.availability).toEqual({ kind: "available" });
    expect(capability.command).toEqual(["slopweaver", "atlas", "aether", "read", "--query", "{question}"]);
  });

  it("carries the atlas's own sentence about itself rather than a paraphrase", () => {
    expect(derivedAtlasCapability({ atlas: AETHER }).what).toBe("The Aether pentest portal atlas");
  });

  it("declares the atlas shape: cached freshness, current truth, the atlas class", () => {
    const capability = derivedAtlasCapability({ atlas: NX_CLOUD });

    expect(capability.freshness.kind).toBe("cached");
    expect(capability.truthMode).toBe("current");
    expect(capability.sourceClass).toBe("atlas");
    expect(capability.id).toBe("nx-cloud-atlas");
  });

  it("points a reader at the platform's own coverage verb rather than claiming completeness", () => {
    expect(derivedAtlasCapability({ atlas: AETHER }).coverage.detail).toContain("slopweaver atlas aether coverage");
  });
});

describe("withDerivedAtlasCapabilities", () => {
  it("appends a row for a platform nothing already reads", () => {
    const result = withDerivedAtlasCapabilities({ atlases: [AETHER], baseCapabilities: [] });

    expect(result.map((capability) => capability.id)).toEqual(["aether-atlas"]);
  });

  it("suppresses a platform an OVERLAY row already reads, without adding that overlay row itself", () => {
    const result = withDerivedAtlasCapabilities({
      atlases: [AETHER, NX_CLOUD],
      baseCapabilities: [],
      overlay: [row({ command: ["slopweaver", "atlas", "aether", "coverage"], id: "aether-portal" })],
    });

    expect(result.map((capability) => capability.id)).toEqual(["nx-cloud-atlas"]);
  });

  it("suppresses a platform once however many rows read it — the twenty vanta rows", () => {
    const vanta: RegisteredAtlasSource = { platform: "vanta", summary: "The Vanta atlas" };
    const overlay = ["control", "vendor", "policy"].map((kind) =>
      row({ command: ["yarn", "slopweaver", "atlas", "vanta", "read", "--kind", kind], id: `vanta-${kind}-atlas` }),
    );

    expect(withDerivedAtlasCapabilities({ atlases: [vanta], baseCapabilities: [], overlay })).toEqual([]);
  });

  it("is not suppressed by an atlas-class row whose command names no platform", () => {
    const result = withDerivedAtlasCapabilities({
      atlases: [AETHER],
      baseCapabilities: [row({ command: ["slopweaver", "github", "vuln", "list"], id: "github-vulnerability-atlas" })],
      overlay: [],
    });

    expect(result.map((capability) => capability.id)).toEqual(["github-vulnerability-atlas", "aether-atlas"]);
  });

  it("keeps the base table's own rows first and in their own order", () => {
    const base = [row({ command: ["slopweaver", "fleet", "status"], id: "fleet-status" })];
    const result = withDerivedAtlasCapabilities({ atlases: [NX_CLOUD, AETHER], baseCapabilities: base });

    expect(result.map((capability) => capability.id)).toEqual(["fleet-status", "nx-cloud-atlas", "aether-atlas"]);
  });

  it("adds nothing when this build registers no atlas at all", () => {
    expect(withDerivedAtlasCapabilities({ atlases: [], baseCapabilities: [] })).toEqual([]);
  });
});

describe("every row this build derives parses through the real capability schema", () => {
  const atlases = registeredAtlasSources();

  it("registers at least one atlas to derive from", () => {
    expect(atlases.length).toBeGreaterThan(0);
  });

  it("parses every derived row, so none is silently dropped at a profile edge", () => {
    const refused = atlases
      .map((atlas) => ({ atlas, parsed: sourceCapabilitySchema.safeParse(derivedAtlasCapability({ atlas })) }))
      .filter((outcome) => !outcome.parsed.success)
      .map((outcome) => outcome.atlas.platform);

    expect(refused).toEqual([]);
  });

  it("gives every registered platform a non-empty sentence about itself", () => {
    expect(atlases.filter((atlas) => atlas.summary.trim().length === 0)).toEqual([]);
  });
});
