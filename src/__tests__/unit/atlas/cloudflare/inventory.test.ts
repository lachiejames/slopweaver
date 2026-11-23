import { describe, expect, it } from "vitest";

import {
  CLOUDFLARE_EXCLUDED_SURFACES,
  CLOUDFLARE_REQUIRED_SURFACES,
  cloudflareRequiredSurfacesForKind,
} from "../../../../atlas/cloudflare/inventory.js";
import { CLOUDFLARE_KINDS, isCloudflareZoneScopedKind } from "../../../../atlas/cloudflare/model.js";

describe("CLOUDFLARE_REQUIRED_SURFACES", () => {
  it("has at least one entry in CLOUDFLARE_KINDS, so the guards below are not vacuously green", () => {
    expect(CLOUDFLARE_KINDS.length).toBeGreaterThan(0);
  });

  it("names exactly one required surface for EVERY kind, with no deferred list left to fall into", () => {
    for (const kind of CLOUDFLARE_KINDS) {
      expect(CLOUDFLARE_REQUIRED_SURFACES.filter((entry) => entry.kind === kind).length).toBe(1);
    }
  });

  it("names no surface for a kind that does not exist", () => {
    const kinds = new Set<string>(CLOUDFLARE_KINDS);
    expect(CLOUDFLARE_REQUIRED_SURFACES.filter((entry) => !kinds.has(entry.kind)).length).toBe(0);
  });

  it("gives every surface a distinct surface name", () => {
    expect(new Set(CLOUDFLARE_REQUIRED_SURFACES.map((entry) => entry.surface)).size).toBe(
      CLOUDFLARE_REQUIRED_SURFACES.length,
    );
  });

  it("agrees with the model on which kinds are read from inside a zone", () => {
    const fromInventory = CLOUDFLARE_REQUIRED_SURFACES.filter((entry) => entry.deepZoneOnly)
      .map((entry) => entry.kind)
      .toSorted();
    const fromModel = CLOUDFLARE_KINDS.filter((kind) => isCloudflareZoneScopedKind(kind)).toSorted();
    expect(fromInventory).toEqual(fromModel);
  });
});

describe("cloudflareRequiredSurfacesForKind", () => {
  it("returns only the surface for the requested kind", () => {
    const surfaces = cloudflareRequiredSurfacesForKind({ kind: "gateway-list" });
    expect(surfaces.length).toBe(1);
    expect(surfaces[0]!.kind).toBe("gateway-list");
  });

  it("marks a deep-zone-only surface accordingly", () => {
    const surfaces = cloudflareRequiredSurfacesForKind({ kind: "dns-record" });
    expect(surfaces[0]!.deepZoneOnly).toBe(true);
  });

  it("marks an account-scoped surface accordingly", () => {
    const surfaces = cloudflareRequiredSurfacesForKind({ kind: "access-application" });
    expect(surfaces[0]!.deepZoneOnly).toBe(false);
  });

  it("covers the account and zone Rulesets surfaces the owner refused to leave excluded", () => {
    expect(cloudflareRequiredSurfacesForKind({ kind: "ruleset" })[0]!.surface).toBe("account-rulesets-list");
    expect(cloudflareRequiredSurfacesForKind({ kind: "zone-ruleset" })[0]!.deepZoneOnly).toBe(true);
  });

  it("covers the risk-scoring summary, the permission boundary held as a kind", () => {
    const surfaces = cloudflareRequiredSurfacesForKind({ kind: "risk-score-summary" });
    expect(surfaces.length).toBe(1);
    expect(surfaces[0]!.surface).toBe("risk-scoring-summary-get");
  });
});

describe("CLOUDFLARE_EXCLUDED_SURFACES", () => {
  it("no longer excludes Rulesets at any scope", () => {
    expect(CLOUDFLARE_EXCLUDED_SURFACES.filter((entry) => entry.because.includes("Ruleset")).length).toBe(0);
  });

  it("is still a non-empty, named list", () => {
    expect(CLOUDFLARE_EXCLUDED_SURFACES.length).toBe(6);
  });
});
