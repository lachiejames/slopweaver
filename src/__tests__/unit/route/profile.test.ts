/**
 * The pure capability-profile merge: which incoming ids get added, which are left alone because the
 * existing profile already declares them.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  CAPABILITY_PROFILE_SCHEMA_VERSION,
  type CapabilityProfile,
  mergeCapabilityProfiles,
  parseCapabilityProfile,
  parseCapabilityProfileRows,
  sourceCapabilitySchema,
} from "../../../route/profile.js";

/** One minimal, valid capability, keyed by `id`, with every other field a fixed placeholder. */
function capability({ id }: { id: string }): CapabilityProfile["capabilities"][number] {
  return {
    availability: { kind: "available" },
    command: ["work-console", id],
    coverage: { detail: "a placeholder capability for the merge test", kind: "unknown" },
    effect: "read",
    freshness: { detail: "a placeholder capability for the merge test", kind: "unknown" },
    id,
    owner: "work-console",
    sourceClass: "provider",
    terms: [id],
    truthMode: "current",
    what: "a placeholder capability for the merge test",
  };
}

/** A profile carrying exactly the given ids, in order. */
function profileOf({ ids }: { ids: readonly string[] }): CapabilityProfile {
  return { capabilities: ids.map((id) => capability({ id })), schemaVersion: 1 };
}

describe("sourceClass, decoded off an older persisted file", () => {
  // A brief written before the rename carries `"world-model"`, and `live/turn/brief.ts` decodes its
  // `routingInput.availableCapabilities` through this schema on every resume. Refusing the old spelling
  // turns every one of those briefs into a BRIEF_INVALID_ROUTING_INPUT, which is the regression this holds
  // down — ten committed replay fixtures carry that exact value.
  it("reads the retired spelling of the corpus class as `corpus`", () => {
    const row = { ...capability({ id: "a-history-row" }), sourceClass: "world-model" };

    expect(sourceCapabilitySchema.parse(row).sourceClass).toBe("corpus");
  });

  it("reads the current spelling unchanged", () => {
    const row = { ...capability({ id: "a-history-row" }), sourceClass: "corpus" };

    expect(sourceCapabilitySchema.parse(row).sourceClass).toBe("corpus");
  });

  it("still refuses a class that was never a spelling of anything", () => {
    const row = { ...capability({ id: "a-history-row" }), sourceClass: "almanac" };

    expect(sourceCapabilitySchema.safeParse(row).success).toBe(false);
  });
});

describe("mergeCapabilityProfiles", () => {
  it("adds every incoming id when the existing profile is empty", () => {
    const result = mergeCapabilityProfiles({
      existing: profileOf({ ids: [] }),
      incoming: profileOf({ ids: ["a", "b"] }),
    });

    expect(result.added).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([]);
    expect(result.merged.capabilities.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("skips an incoming id the existing profile already declares, and never overwrites it", () => {
    const existing = profileOf({ ids: ["vanta-controls-atlas"] });
    const overridden = { ...capability({ id: "vanta-controls-atlas" }), command: ["a-hand-tuned-override"] };
    const incoming: CapabilityProfile = { capabilities: [overridden], schemaVersion: 1 };

    const result = mergeCapabilityProfiles({ existing, incoming });

    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(["vanta-controls-atlas"]);
    expect(result.merged).toEqual(existing);
  });

  it("adds only the incoming ids not already present, keeping every existing row untouched", () => {
    const existing = profileOf({ ids: ["github-vulnerability-evidence"] });
    const incoming = profileOf({ ids: ["github-vulnerability-evidence", "vanta-controls-atlas", "telemetry"] });

    const result = mergeCapabilityProfiles({ existing, incoming });

    expect(result.added).toEqual(["vanta-controls-atlas", "telemetry"]);
    expect(result.skipped).toEqual(["github-vulnerability-evidence"]);
    expect(result.merged.capabilities.map((c) => c.id)).toEqual([
      "github-vulnerability-evidence",
      "vanta-controls-atlas",
      "telemetry",
    ]);
  });

  it("running the same merge twice adds nothing the second time", () => {
    const existing = profileOf({ ids: [] });
    const incoming = profileOf({ ids: ["a", "b"] });

    const first = mergeCapabilityProfiles({ existing, incoming });
    const second = mergeCapabilityProfiles({ existing: first.merged, incoming });

    expect(second.added).toEqual([]);
    expect(second.skipped).toEqual(["a", "b"]);
    expect(second.merged).toEqual(first.merged);
  });

  it("stamps the merged profile with the current schema version even if callers hand-construct one differently", () => {
    const result = mergeCapabilityProfiles({ existing: profileOf({ ids: [] }), incoming: profileOf({ ids: ["a"] }) });

    expect(result.merged.schemaVersion).toBe(1);
  });
});

describe("cached freshness", () => {
  it("accepts an atlas leg whose generation is neither live, snapshot nor periodic", () => {
    const row = {
      availability: { kind: "available" },
      command: ["slopweaver", "atlas", "vanta", "read"],
      coverage: { detail: "the published generation", kind: "bounded" },
      effect: "read",
      freshness: { detail: "the generation the last sync published locally", kind: "cached" },
      id: "vanta-control-atlas",
      owner: "private-console",
      sourceClass: "atlas",
      terms: ["control", "controls"],
      truthMode: "current",
      what: "the controls the published Vanta atlas holds",
    };

    const parsed = parseCapabilityProfile({
      value: { capabilities: [row], schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION },
    });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).capabilities[0]!.freshness.kind).toBe("cached");
  });
});

describe("a refusal names the capability and the field", () => {
  it("names the offending row rather than repeating a bare enum message", () => {
    const bad = {
      availability: { kind: "available" },
      command: ["slopweaver", "atlas", "vanta", "read"],
      coverage: { detail: "the published generation", kind: "bounded" },
      effect: "read",
      freshness: { detail: "a generation", kind: "carrier-pigeon" },
      id: "vanta-risk-atlas",
      owner: "private-console",
      sourceClass: "atlas",
      terms: ["risk"],
      truthMode: "current",
      what: "risks",
    };

    const parsed = parseCapabilityProfile({
      value: { capabilities: [bad], schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION },
    });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)[0]).toContain("vanta-risk-atlas");
    expect(unwrapErr(parsed)[0]).toContain("freshness.kind");
  });
});

describe("parseCapabilityProfileRows", () => {
  const good = {
    availability: { kind: "available" },
    command: ["slopweaver", "atlas", "vanta", "read"],
    coverage: { detail: "the published generation", kind: "bounded" },
    effect: "read",
    freshness: { detail: "a generation", kind: "cached" },
    id: "vanta-control-atlas",
    owner: "private-console",
    sourceClass: "atlas",
    terms: ["control"],
    truthMode: "current",
    what: "controls",
  };
  const bad = { ...good, freshness: { detail: "a generation", kind: "carrier-pigeon" }, id: "vanta-risk-atlas" };

  it("keeps the good rows and names the skipped one, instead of dropping both", () => {
    const parsed = parseCapabilityProfileRows({
      value: { capabilities: [good, bad], schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION },
    });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).profile.capabilities.length).toBe(1);
    expect(unwrap(parsed).profile.capabilities[0]!.id).toBe("vanta-control-atlas");
    expect(unwrap(parsed).skipped.length).toBe(1);
    expect(unwrap(parsed).skipped[0]!.id).toBe("vanta-risk-atlas");
    expect(unwrap(parsed).skipped[0]!.reason).toContain("freshness.kind");
  });

  it("reports no skipped rows when every row parses", () => {
    const parsed = parseCapabilityProfileRows({
      value: { capabilities: [good], schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION },
    });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).skipped.length).toBe(0);
  });

  it("names a row that declared no usable id by its index", () => {
    const parsed = parseCapabilityProfileRows({
      value: { capabilities: [{ nonsense: true }], schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION },
    });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).skipped[0]!.id).toBe("capabilities[0]");
  });

  it("still refuses the ENVELOPE, because a document with no capabilities array is not partly usable", () => {
    const parsed = parseCapabilityProfileRows({ value: { schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION } });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)[0]).toContain("capabilities");
  });
});

describe("parseCapabilityProfile — the built-in history id cannot be declared", () => {
  it("refuses an overlay row named `corpus`, because it would REPLACE the built-in history row", () => {
    const refused = unwrapErr(
      parseCapabilityProfile({
        value: { capabilities: [capability({ id: "corpus" })], schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION },
      }),
    );
    expect(refused).toEqual(["corpus: id — corpus is reserved for Slopweaver's history source"]);
  });

  it("accepts an overlay row named `world-model`, so a pre-rename file still reads", () => {
    const accepted = unwrap(
      parseCapabilityProfile({
        value: { capabilities: [capability({ id: "world-model" })], schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION },
      }),
    );
    expect(accepted.capabilities.map((row) => row.id)).toEqual(["world-model"]);
  });

  it("still accepts the ids beside it, so the reservation is exactly one id wide", () => {
    const accepted = unwrap(
      parseCapabilityProfile({
        value: {
          capabilities: [capability({ id: "corpus-audit" }), capability({ id: "my-corpus" })],
          schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION,
        },
      }),
    );
    expect(accepted.capabilities.map((row) => row.id)).toEqual(["corpus-audit", "my-corpus"]);
  });
});
