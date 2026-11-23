import { describe, expect, it } from "vitest";

import * as model from "../../../../atlas/cloudflare/model.js";
import {
  CLOUDFLARE_ATLAS_PLATFORM,
  CLOUDFLARE_ATLAS_SCHEMA_VERSION,
  CLOUDFLARE_KINDS,
  CLOUDFLARE_ZERO_TRUST_HELD_KINDS,
  cloudflareKindFileSchema,
  cloudflareManifestSchema,
  cloudflareSelectionSchema,
  emptyCloudflareKindFile,
  initialCloudflareManifest,
  isCloudflareZoneScopedKind,
} from "../../../../atlas/cloudflare/model.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("initialCloudflareManifest", () => {
  it("carries every kind, all never-synced, and no selection", () => {
    const manifest = initialCloudflareManifest({ updatedAt: AT });
    expect(manifest.selection).toBeNull();
    expect(manifest.platform).toBe(CLOUDFLARE_ATLAS_PLATFORM);
    expect(manifest.schemaVersion).toBe(CLOUDFLARE_ATLAS_SCHEMA_VERSION);
    expect(Object.keys(manifest.kinds).toSorted()).toEqual([...CLOUDFLARE_KINDS].toSorted());
    for (const kind of CLOUDFLARE_KINDS) {
      expect(manifest.kinds[kind]).toEqual({ digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null });
    }
  });

  it("validates against its own schema", () => {
    expect(cloudflareManifestSchema.safeParse(initialCloudflareManifest({ updatedAt: AT })).success).toBe(true);
  });
});

describe("emptyCloudflareKindFile", () => {
  it("is empty and validates against its own schema", () => {
    const file = emptyCloudflareKindFile({ kind: "zone", updatedAt: AT });
    expect(file.entities).toEqual([]);
    expect(file.coverage).toEqual([]);
    expect(file.gaps).toEqual([]);
    expect(cloudflareKindFileSchema.safeParse(file).success).toBe(true);
  });
});

describe("cloudflareSelectionSchema", () => {
  it("accepts a lowercase 32-char account id and a nonblank deep zone", () => {
    const result = cloudflareSelectionSchema.safeParse({
      accountId: "0".repeat(32),
      deepZone: { id: "zone-id", name: "example.test" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an uppercase or short account id", () => {
    expect(
      cloudflareSelectionSchema.safeParse({ accountId: "A".repeat(32), deepZone: { id: "z", name: "n" } }).success,
    ).toBe(false);
    expect(
      cloudflareSelectionSchema.safeParse({ accountId: "0".repeat(31), deepZone: { id: "z", name: "n" } }).success,
    ).toBe(false);
  });
});

describe("CLOUDFLARE_KINDS", () => {
  it("has exactly 66 distinct kinds", () => {
    expect(CLOUDFLARE_KINDS.length).toBe(66);
    expect(new Set(CLOUDFLARE_KINDS).size).toBe(66);
  });

  it("is the thirty pre-Zero-Trust kinds, thirty-four Zero Trust ones, and Rulesets at both scopes", () => {
    expect(CLOUDFLARE_ZERO_TRUST_HELD_KINDS.length).toBe(34);
    const zeroTrust = new Set<string>(CLOUDFLARE_ZERO_TRUST_HELD_KINDS);
    expect(CLOUDFLARE_KINDS.filter((kind) => zeroTrust.has(kind)).length).toBe(34);
    expect(CLOUDFLARE_KINDS.includes("ruleset")).toBe(true);
    expect(CLOUDFLARE_KINDS.includes("zone-ruleset")).toBe(true);
  });

  it("holds every Zero Trust kind at ACCOUNT scope, never inside a zone", () => {
    const zoneScoped = CLOUDFLARE_ZERO_TRUST_HELD_KINDS.filter((kind) => isCloudflareZoneScopedKind(kind));
    expect(zoneScoped).toEqual([]);
  });

  it("declares NO deferred Zero Trust kind — the distinction is deleted", () => {
    // A source-level assertion rather than a list one, because the point of the ruling is that the list is
    // gone rather than empty: an empty list is a mechanism the next session fills back up.
    expect(Object.keys(model).filter((name) => name.includes("DEFERRED"))).toEqual([]);
  });

  it("holds the risk-scoring summary as its own kind, so a 403 is a visible permission boundary", () => {
    expect(CLOUDFLARE_KINDS.includes("risk-score-summary")).toBe(true);
    expect(CLOUDFLARE_ZERO_TRUST_HELD_KINDS.includes("risk-score-summary")).toBe(true);
  });
});
