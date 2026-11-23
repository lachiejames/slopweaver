/**
 * The page model's judgements — above all the one the owner asked for by name: which endpoints exist and
 * were never hit, and what the page says when it cannot know.
 *
 * Every fixture is a plain object over the normalized view, because the projection is pure over that view
 * and what a platform's adapter builds from its own store is that adapter's own test.
 */
import { describe, expect, it } from "vitest";

import type { AtlasDescriptor } from "../../../../atlas/kit/contract.js";
import { atlasPageModel } from "../../../../atlas/kit/pageModel.js";
import type { AtlasEntityView, AtlasKindView, AtlasReadSnapshot } from "../../../../atlas/kit/read.js";

/** One surface, with everything defaulted so a test names only what it is about. */
function surface(over: Partial<AtlasDescriptor["surfaces"][number]> = {}): AtlasDescriptor["surfaces"][number] {
  return {
    acquisition: "api",
    denominator: { because: "a fixture surface with no provider catalogue", known: false },
    documented: true,
    name: "rest-api",
    role: "authoritative",
    status: "filled",
    unfilledBecause: null,
    ...over,
  };
}

/** One descriptor, with everything defaulted. */
function descriptor(over: Partial<AtlasDescriptor> = {}): AtlasDescriptor {
  const base: AtlasDescriptor = {
    excludes: [],
    kinds: ["widget"],
    platform: "example",
    question: "what does example hold",
    resyncCommand: "slopweaver atlas example sync",
    surfaces: [surface()],
    visibilityScope: "whatever this token opens",
    writePolicy: "refuse-every-write",
  };
  return { ...base, ...over };
}

/** One observation, with everything defaulted. */
function observation(
  over: Partial<AtlasEntityView["observations"][number]> = {},
): AtlasEntityView["observations"][number] {
  return {
    artifacts: [],
    deepLink: null,
    deepLinkStatus: "unverified",
    endpoint: "widgets-list",
    observedAt: "2026-09-01T00:00:00.000Z",
    state: "observed",
    surface: "rest-api",
    ...over,
  };
}

/** One entity, with everything defaulted. */
function entity(over: Partial<AtlasEntityView> = {}): AtlasEntityView {
  return {
    detail: null,
    id: "id-1",
    kind: "widget",
    observations: [observation()],
    providerId: "widget-1",
    scope: "example",
    ...over,
  };
}

/** One kind view, with everything defaulted. */
function kind(over: Partial<AtlasKindView> = {}): AtlasKindView {
  return {
    coverage: [],
    entities: [entity()],
    gaps: [],
    kind: "widget",
    lastSuccessAt: "2026-09-01T00:00:00.000Z",
    latestAttemptFailed: false,
    permissionBlocked: null,
    publishedCount: 1,
    ...over,
  };
}

/** One snapshot, with everything defaulted. */
function snapshot(over: Partial<AtlasReadSnapshot> = {}): AtlasReadSnapshot {
  const base: AtlasReadSnapshot = {
    descriptor: descriptor(),
    generation: {
      mismatched: [],
      missing: [],
      platform: "example",
      schemaVersion: 3,
      superseded: [],
      unpublished: [],
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    kinds: [kind()],
  };
  return { ...base, ...over };
}

describe("atlasPageModel", () => {
  it("prints the never-hit row as unknown rather than zero when the denominator is absent", () => {
    const model = atlasPageModel({ snapshot: snapshot() });
    const neverHit = model.defects.find((defect) => defect.id === "never-hit")!;
    expect(neverHit.unknown).toBe(true);
    expect(neverHit.count).toBe(0);
    expect(model.defects.find((defect) => defect.id === "denominator-absent")!.count).toBe(1);
  });

  it("marks the never-hit row measurable once a filled compiled surface declares a denominator", () => {
    const built = atlasPageModel({
      snapshot: snapshot({
        descriptor: descriptor({
          surfaces: [surface({ acquisition: "compiled", name: "spec-declared" }), surface()],
        }),
        kinds: [kind({ entities: [entity({ observations: [observation({ surface: "spec-declared" })] })] })],
      }),
    });
    expect(built.defects.find((defect) => defect.id === "never-hit")!.unknown).toBe(false);
    expect(built.defects.find((defect) => defect.id === "denominator-absent")!.count).toBe(0);
  });

  it("names the kind whose latest acquisition failed", () => {
    const built = atlasPageModel({ snapshot: snapshot({ kinds: [kind({ latestAttemptFailed: true })] }) });
    const row = built.defects.find((defect) => defect.id === "latest-attempt-failed")!;
    expect(row.count).toBe(1);
    expect(row.detail).toBe("widget");
    expect(built.kinds[0]!.latestAttemptFailed).toBe(true);
  });

  it("flags a surface the entities cite that the descriptor never declared", () => {
    const model = atlasPageModel({
      snapshot: snapshot({
        kinds: [kind({ entities: [entity({ observations: [observation({ surface: "undocumented-api" })] })] })],
      }),
    });
    const undeclared = model.surfaces.find((row) => row.name === "undocumented-api")!;
    expect(undeclared.declared).toBe(false);
    expect(undeclared.entityCount).toBe(1);
    expect(model.defects.find((defect) => defect.id === "undeclared-surfaces")!.count).toBe(1);
  });

  it("calls a kind holding nothing with nothing at all to explain it dark", () => {
    const built = atlasPageModel({
      snapshot: snapshot({ kinds: [kind({ entities: [], lastSuccessAt: null, publishedCount: 0 })] }),
    });
    expect(built.kinds[0]!.darkWithoutReason).toBe(true);
    expect(built.defects.find((defect) => defect.id === "dark-kinds")!.count).toBe(1);
  });

  // Calling every empty kind dark is wrong: an exhaustive sync
  // that legitimately found nothing has a success stamp, and flagging it trains a reader to ignore the row.
  it("does not call a successful zero dark", () => {
    const built = atlasPageModel({
      snapshot: snapshot({
        kinds: [kind({ entities: [], lastSuccessAt: "2026-09-01T00:00:00.000Z", publishedCount: 0 })],
      }),
    });
    expect(built.kinds[0]!.darkWithoutReason).toBe(false);
    expect(built.defects.find((defect) => defect.id === "dark-kinds")!.count).toBe(0);
  });

  it("does not call an empty kind dark when an open gap explains it", () => {
    const built = atlasPageModel({
      snapshot: snapshot({
        kinds: [
          kind({
            entities: [],
            gaps: [
              {
                condition: "api-scope-refused",
                id: "g1",
                lastDetectedAt: "2026-09-01T00:00:00.000Z",
                reason: "HTTP 403",
                scope: "widgets",
                status: "open",
              },
            ],
            lastSuccessAt: null,
            publishedCount: 0,
          }),
        ],
      }),
    });
    expect(built.kinds[0]!.darkWithoutReason).toBe(false);
  });

  it("does not call a kind dark when a permission block explains the emptiness", () => {
    const model = atlasPageModel({
      snapshot: snapshot({
        kinds: [
          kind({
            entities: [],
            permissionBlocked: {
              at: "2026-09-01T00:00:00.000Z",
              detail: "HTTP 403 on this credential",
              unblockedBy: "the audit-read scope",
            },
            publishedCount: 0,
          }),
        ],
      }),
    });
    expect(model.kinds[0]!.darkWithoutReason).toBe(false);
    expect(model.kinds[0]!.permissionBlockedReason).toBe(
      "HTTP 403 on this credential — unblocked by the audit-read scope",
    );
  });

  it("counts each way the generation disagrees with its own manifest", () => {
    const model = atlasPageModel({
      snapshot: snapshot({
        generation: {
          mismatched: ["b"],
          missing: ["a"],
          platform: "example",
          schemaVersion: 3,
          superseded: [],
          unpublished: ["c"],
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      }),
    });
    expect(model.generationDisagreements).toHaveLength(3);
    expect(model.defects.find((defect) => defect.id === "generation-disagreements")!.count).toBe(3);
  });

  it("counts a screenshot once however many entities cite the same digest, smallest first", () => {
    const big = {
      byteLength: 900,
      kind: "page-png" as const,
      mediaType: "image/png",
      relativePath: "artifacts/pages/bb.png",
      sha256: "b".repeat(64),
    };
    const small = {
      byteLength: 100,
      kind: "page-png" as const,
      mediaType: "image/png",
      relativePath: "artifacts/pages/aa.png",
      sha256: "a".repeat(64),
    };
    const model = atlasPageModel({
      snapshot: snapshot({
        kinds: [
          kind({
            entities: [
              entity({ id: "one", observations: [observation({ artifacts: [big] })] }),
              entity({ id: "two", observations: [observation({ artifacts: [big, small] })] }),
            ],
          }),
        ],
      }),
    });
    expect(model.screenshots).toHaveLength(2);
    expect(model.screenshots[0]!.byteLength).toBe(100);
    expect(model.surfaces[0]!.photographedCount).toBe(2);
  });

  it("caps the rows one kind prints without capping the entity count it reports", () => {
    const entities = [0, 1, 2].map((index) => entity({ id: `id-${String(index)}` }));
    const model = atlasPageModel({
      rowCap: 1,
      snapshot: snapshot({ kinds: [kind({ entities, publishedCount: 3 })] }),
    });
    expect(model.kinds[0]!.entityCount).toBe(3);
    expect(model.kinds[0]!.rows).toHaveLength(1);
    expect(model.entityCount).toBe(3);
  });

  it("carries the contract's own verdict on a refused exclusion rather than re-judging it", () => {
    const model = atlasPageModel({
      snapshot: snapshot({
        descriptor: descriptor({
          excludes: [
            { because: "nobody has been to get it", ground: "not-fetched", wouldBeClosedBy: "the browser channel" },
            { because: "a mutation this atlas never performs", ground: "never-acted" },
          ],
        }),
      }),
    });
    expect(model.exclusions[0]!.refused).toBe(true);
    expect(model.exclusions[0]!.withholdsRecords).toBe(true);
    expect(model.exclusions[1]!.refused).toBe(false);
    expect(model.exclusions[1]!.withholdsRecords).toBe(false);
    expect(model.defects.find((defect) => defect.id === "refused-exclusions")!.count).toBe(1);
  });

  it("splits gaps into the open ones it prints and a count of the closed ones", () => {
    const model = atlasPageModel({
      snapshot: snapshot({
        kinds: [
          kind({
            gaps: [
              {
                condition: "detail-unreadable",
                id: "gap-open",
                lastDetectedAt: "2026-09-01T00:00:00.000Z",
                reason: "the browser could not navigate to this page's address",
                scope: "policies-collection",
                status: "open",
              },
              {
                condition: "detail-unreadable",
                id: "gap-closed",
                lastDetectedAt: "2026-09-01T00:00:00.000Z",
                reason: "reached on the next walk",
                scope: "tests-collection",
                status: "closed",
              },
            ],
          }),
        ],
      }),
    });
    expect(model.openGaps).toHaveLength(1);
    expect(model.openGaps[0]!.id).toBe("gap-open");
    expect(model.closedGapCount).toBe(1);
    expect(model.kinds[0]!.openGapCount).toBe(1);
  });
});
