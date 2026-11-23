/**
 * An atlas capability row derived from what its generation actually published.
 *
 * The row this closes was registered because `capability-profile.json` held 29 atlas rows, every one
 * hand-declared `available` / `current`, while nothing in `src/route/` read a manifest or a coverage cell.
 * So each case here is one of the three things a generation can be, plus the distinction the owner asked
 * never to have to guess at: fenced by permissions, or simply never acquired.
 */
import { describe, expect, it } from "vitest";

import { type AtlasRouteReading, atlasPlatformOf, deriveAtlasCapabilities } from "../../../route/atlasReading.js";
import type { SourceCapability } from "../../../route/profile.js";

const DECLARED_DETAIL = "everything the platform holds";

/** One atlas row as a private profile would declare it: available, current, bounded. */
function atlasRow({ platform }: { platform: string }): SourceCapability {
  return {
    availability: { kind: "available" },
    command: ["slopweaver", "atlas", platform, "read"],
    coverage: { detail: DECLARED_DETAIL, kind: "bounded" },
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

/** A grading with no gaps at all, which a test then narrows. */
function reading({ over }: { over: Partial<AtlasRouteReading> }): AtlasRouteReading {
  return {
    because: "4419 entities readable from the generation published 2026-09-07T09:11:24.010Z",
    gapKinds: [],
    grade: "answerable",
    notAttemptedKinds: [],
    permissionBlockedKinds: [],
    platform: "example",
    productAbsentKinds: [],
    ...over,
  };
}

/** Derive one row against one grading, which is what every case below wants. */
function derivedRow({
  capability,
  reading: graded,
}: {
  capability: SourceCapability;
  reading: AtlasRouteReading | undefined;
}): SourceCapability {
  const readings = new Map<string, AtlasRouteReading>();
  if (graded !== undefined) {
    readings.set(graded.platform, graded);
  }
  return deriveAtlasCapabilities({ capabilities: [capability], readings })[0]!;
}

describe("atlasPlatformOf", () => {
  it("reads the platform out of the argv, which is the only place a row names it", () => {
    expect(atlasPlatformOf({ capability: atlasRow({ platform: "example" }) })).toBe("example");
  });

  it("answers null for a row that is not an atlas read at all", () => {
    const row = { ...atlasRow({ platform: "example" }), sourceClass: "provider" } as const;
    expect(atlasPlatformOf({ capability: row })).toBe(null);
  });

  it("answers null for an atlas row whose command names no platform after the noun", () => {
    const row = { ...atlasRow({ platform: "example" }), command: ["slopweaver", "atlas"] };
    expect(atlasPlatformOf({ capability: row })).toBe(null);
  });
});

describe("deriveAtlasCapabilities", () => {
  it("leaves a row exactly as declared when nothing graded its atlas", () => {
    const declared = atlasRow({ platform: "example" });
    expect(derivedRow({ capability: declared, reading: undefined })).toEqual(declared);
  });

  it("leaves a non-atlas row untouched even when a grading shares its platform name", () => {
    const provider = { ...atlasRow({ platform: "example" }), sourceClass: "provider" } as const;
    expect(derivedRow({ capability: provider, reading: reading({ over: {} }) })).toEqual(provider);
  });

  it("keeps the declared coverage when the generation has no gap of either kind", () => {
    const derived = derivedRow({ capability: atlasRow({ platform: "example" }), reading: reading({ over: {} }) });
    expect(derived.coverage).toEqual({ detail: DECLARED_DETAIL, kind: "bounded" });
    expect(derived.availability).toEqual({ kind: "available" });
  });

  it("says a fenced surface is REACHABLE if permissions are widened, not missing", () => {
    const derived = derivedRow({
      capability: atlasRow({ platform: "example" }),
      reading: reading({ over: { permissionBlockedKinds: ["audit", "policy"] } }),
    });
    expect(derived.coverage.kind).toBe("bounded");
    expect(derived.coverage.detail).toContain("2 surface(s) this credential is not permitted to read");
    expect(derived.coverage.detail).toContain("audit, policy");
    expect(derived.coverage.detail).toContain("reachable if the permissions are widened, not missing");
  });

  it("says a product this organisation does not have is excluded as unreachable, not missing", () => {
    const derived = derivedRow({
      capability: atlasRow({ platform: "example" }),
      reading: reading({ over: { productAbsentKinds: ["gcep"] } }),
    });
    expect(derived.coverage.kind).toBe("bounded");
    expect(derived.coverage.detail).toContain(
      "1 surface(s) this organisation has no such product for (gcep) — excluded as unreachable, not missing",
    );
  });

  it("gives a fence, a gap and an unattempted surface three separate clauses naming three remedies", () => {
    const derived = derivedRow({
      capability: atlasRow({ platform: "example" }),
      reading: reading({
        over: { gapKinds: ["audit"], notAttemptedKinds: ["vendor"], permissionBlockedKinds: ["policy"] },
      }),
    });
    expect(derived.coverage.detail).toContain("1 surface(s) this credential is not permitted to read (policy)");
    expect(derived.coverage.detail).toContain("reachable if the permissions are widened, not missing");
    expect(derived.coverage.detail).toContain(
      "1 surface(s) attempted and never acquired, with no permission boundary explaining it (audit) — a fix, not a grant",
    );
    expect(derived.coverage.detail).toContain(
      "1 surface(s) no run has ever attempted (vendor) — nothing is broken and nothing is fenced",
    );
  });

  it("makes a DARK atlas unavailable and clears its command, so no plan can still run it", () => {
    const derived = derivedRow({
      capability: atlasRow({ platform: "example" }),
      reading: reading({ over: { because: "vouches for 12 kinds the reader cannot see", grade: "dark" } }),
    });
    expect(derived.availability).toEqual({
      kind: "unavailable",
      reason: "the example atlas cannot answer: vouches for 12 kinds the reader cannot see",
    });
    expect(derived.command).toEqual([]);
    expect(derived.coverage.kind).toBe("unknown");
  });

  it("makes an UNPUBLISHED atlas unavailable rather than advertising it as current truth", () => {
    const derived = derivedRow({
      capability: atlasRow({ platform: "example" }),
      reading: reading({
        over: { because: "no generation has been published", grade: "unpublished" },
      }),
    });
    expect(derived.availability.kind).toBe("unavailable");
    expect(derived.command).toEqual([]);
  });

  it("leaves truthMode alone, so an empty atlas never outranks the world model on history", () => {
    const derived = derivedRow({
      capability: atlasRow({ platform: "example" }),
      reading: reading({ over: { grade: "unpublished" } }),
    });
    expect(derived.truthMode).toBe("current");
  });

  it("does not re-grade a row its own profile already declared unavailable", () => {
    const declared: SourceCapability = {
      ...atlasRow({ platform: "example" }),
      availability: { kind: "unavailable", reason: "no credential is configured for this platform" },
      command: [],
    };
    expect(derivedRow({ capability: declared, reading: reading({ over: {} }) })).toEqual(declared);
  });
});
