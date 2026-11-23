/**
 * `atlasRouteReadings` over an injected registration lookup: which platforms it reads, how many times, with
 * which home, what a successful and a refused read become, and the one case it omits — a platform this build
 * does not register.
 */
import { describe, expect, it } from "vitest";

import type { AtlasKindView, AtlasReadSnapshot } from "../../../atlas/kit/read.js";
import { AtlasReadErrors } from "../../../atlas/kit/read.js";
import { VANTA_ATLAS_REGISTRATION } from "../../../atlas/vanta/registration.js";
import { err, ok } from "../../../lib/result.js";
import { type AtlasRegistrationLookup, atlasRouteReadings } from "../../../route/atlasReadings.js";
import type { SourceCapability } from "../../../route/profile.js";

/** One atlas row naming its platform in the command it runs. */
function atlasRow({ platform }: { platform: string }): SourceCapability {
  return {
    availability: { kind: "available" },
    command: ["slopweaver", "atlas", platform, "read"],
    coverage: { detail: "everything the platform holds", kind: "bounded" },
    effect: "read",
    freshness: { detail: "the last published generation", kind: "cached" },
    id: `${platform}-atlas`,
    owner: "slopweaver",
    sourceClass: "atlas",
    terms: [platform],
    truthMode: "current",
    what: `what the ${platform} platform contains`,
  };
}

/** A provider row, which names no atlas at all. */
const PROVIDER_ROW: SourceCapability = {
  ...atlasRow({ platform: "github" }),
  id: "github-live",
  sourceClass: "provider",
};

/** An atlas row whose command carries no platform token after `atlas`. */
const TOKENLESS_ROW: SourceCapability = {
  ...atlasRow({ platform: "x" }),
  command: ["slopweaver", "atlas"],
  id: "bare",
};

/** One answerable kind: the manifest vouches for two and the reader projected two. */
const CONTROL_KIND: AtlasKindView = {
  coverage: [],
  entities: ["control-a", "control-b"].map((id) => ({
    detail: null,
    id,
    kind: "control",
    observations: [],
    providerId: id,
    scope: "tenant",
  })),
  gaps: [],
  kind: "control",
  lastSuccessAt: "2026-10-12T00:00:00.000Z",
  latestAttemptFailed: false,
  permissionBlocked: null,
  publishedCount: 2,
};

/**
 * A lookup that knows the given platforms, answers each read with the given outcome, and records every
 * lookup and every read it was asked for.
 *
 * @returns the seam and what it recorded
 */
function recordingLookup({ known, outcome }: { known: readonly string[]; outcome: "answerable" | "refused" }): {
  readonly lookup: AtlasRegistrationLookup;
  readonly lookups: string[];
  readonly reads: unknown[];
} {
  const lookups: string[] = [];
  const reads: unknown[] = [];
  const lookup: AtlasRegistrationLookup = ({ platform }) => {
    lookups.push(platform);
    if (!known.includes(platform)) {
      return null;
    }
    return {
      ...VANTA_ATLAS_REGISTRATION,
      platform,
      readSnapshot: async (args) => {
        reads.push(args);
        if (outcome === "refused") {
          return err(AtlasReadErrors.storeUnreadable({ platform, reasons: ["manifest.json is not JSON"] }));
        }
        const snapshot: AtlasReadSnapshot = {
          descriptor: await VANTA_ATLAS_REGISTRATION.readDescriptor(),
          generation: {
            mismatched: [],
            missing: [],
            platform,
            schemaVersion: 3,
            superseded: [],
            unpublished: [],
            updatedAt: "2026-10-12T00:00:00.000Z",
          },
          kinds: [CONTROL_KIND],
        };
        return ok(snapshot);
      },
    };
  };
  return { lookup, lookups, reads };
}

describe("atlasRouteReadings", () => {
  it("looks nothing up for a provider row or an atlas row naming no platform", async () => {
    const seam = recordingLookup({ known: ["vanta"], outcome: "answerable" });

    const readings = await atlasRouteReadings({
      capabilities: [PROVIDER_ROW, TOKENLESS_ROW],
      findPlatform: seam.lookup,
    });

    expect(seam.lookups).toEqual([]);
    expect([...readings.keys()]).toEqual([]);
  });

  it("reads a platform named by two rows once, forwarding the explicit home", async () => {
    const seam = recordingLookup({ known: ["vanta"], outcome: "answerable" });

    await atlasRouteReadings({
      capabilities: [atlasRow({ platform: "vanta" }), { ...atlasRow({ platform: "vanta" }), id: "vanta-second" }],
      findPlatform: seam.lookup,
      home: "/explicit/home",
    });

    expect(seam.lookups).toEqual(["vanta"]);
    expect(seam.reads).toEqual([{ home: "/explicit/home" }]);
  });

  it("passes no home to the read when the caller named none", async () => {
    const seam = recordingLookup({ known: ["vanta"], outcome: "answerable" });

    await atlasRouteReadings({ capabilities: [atlasRow({ platform: "vanta" })], findPlatform: seam.lookup });

    expect(seam.reads).toEqual([{}]);
  });

  it("grades a successful read as answerable, carrying the grading's sentence and empty kind lists", async () => {
    const seam = recordingLookup({ known: ["vanta"], outcome: "answerable" });

    const readings = await atlasRouteReadings({
      capabilities: [atlasRow({ platform: "vanta" })],
      findPlatform: seam.lookup,
    });

    expect(readings.get("vanta")).toEqual({
      because: "2 entities readable from the generation published 2026-10-12T00:00:00.000Z",
      gapKinds: [],
      grade: "answerable",
      notAttemptedKinds: [],
      permissionBlockedKinds: [],
      platform: "vanta",
      productAbsentKinds: [],
    });
  });

  it("grades a refused read as dark, carrying the refusal's own message", async () => {
    const seam = recordingLookup({ known: ["vanta"], outcome: "refused" });

    const readings = await atlasRouteReadings({
      capabilities: [atlasRow({ platform: "vanta" })],
      findPlatform: seam.lookup,
    });

    expect(readings.get("vanta")).toEqual({
      because: AtlasReadErrors.storeUnreadable({ platform: "vanta", reasons: ["manifest.json is not JSON"] }).message,
      gapKinds: [],
      grade: "dark",
      notAttemptedKinds: [],
      permissionBlockedKinds: [],
      platform: "vanta",
      productAbsentKinds: [],
    });
    expect(readings.get("vanta")!.because).toBe("the vanta atlas could not be read: manifest.json is not JSON");
  });

  it("produces no reading for a platform the lookup does not register, while still reading the one it does", async () => {
    const seam = recordingLookup({ known: ["vanta"], outcome: "answerable" });

    const readings = await atlasRouteReadings({
      capabilities: [atlasRow({ platform: "unregistered" }), atlasRow({ platform: "vanta" })],
      findPlatform: seam.lookup,
    });

    expect(seam.lookups).toEqual(["unregistered", "vanta"]);
    expect([...readings.keys()]).toEqual(["vanta"]);
  });
});
