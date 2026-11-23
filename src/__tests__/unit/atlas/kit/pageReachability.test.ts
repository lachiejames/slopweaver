/**
 * The exists-versus-hit verdict: what an atlas may claim it never hit, and — the property that matters most
 * — when it must refuse to claim anything at all.
 *
 * Every fixture is a plain object over the normalized view, because the judgement is pure over that view.
 */
import { describe, expect, it } from "vitest";

import type { AtlasDescriptor } from "../../../../atlas/kit/contract.js";
import { atlasPageReachability, surfacePurpose } from "../../../../atlas/kit/pageReachability.js";
import type { AtlasEntityView, AtlasKindView } from "../../../../atlas/kit/read.js";

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

/** A filled compiled surface, which is the only shape that declares what exists. */
function declaringSurface(
  over: Partial<AtlasDescriptor["surfaces"][number]> = {},
): AtlasDescriptor["surfaces"][number] {
  return surface({ acquisition: "compiled", name: "spec-declared", ...over });
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

describe("surfacePurpose", () => {
  it("treats a filled compiled surface as the provider's own statement of what exists", () => {
    expect(surfacePurpose({ surface: { acquisition: "compiled", status: "filled" } })).toBe("declares-existence");
  });

  it("refuses to divide by a promise: a compiled surface nobody has filled is not a denominator", () => {
    expect(surfacePurpose({ surface: { acquisition: "compiled", status: "declared-unfilled" } })).toBe("visits");
  });

  it("treats an api or driven-browser surface as a visit", () => {
    expect(surfacePurpose({ surface: { acquisition: "api", status: "filled" } })).toBe("visits");
    expect(surfacePurpose({ surface: { acquisition: "driven-browser", status: "filled" } })).toBe("visits");
  });
});

describe("atlasPageReachability", () => {
  it("refuses to compute a figure when nothing declares what the provider offers", () => {
    const verdict = atlasPageReachability({ descriptor: descriptor(), kinds: [kind()], neverHitCap: 10 });
    expect(verdict.denominator).toBe("absent");
    expect(verdict.neverHitCount).toBe(0);
    expect(verdict.undeclaredFindCount).toBe(1);
    expect(verdict.undeterminedKinds).toEqual(["widget"]);
    expect(verdict.unknownBecause).toContain("no denominator to subtract from");
  });

  it("names an entity a declaring surface states and no visit ever reached", () => {
    const verdict = atlasPageReachability({
      descriptor: descriptor({ surfaces: [declaringSurface(), surface()] }),
      kinds: [
        kind({
          entities: [
            entity({
              observations: [observation({ endpoint: "GET /widgets/{id}", surface: "spec-declared" })],
              providerId: "widgets-get",
            }),
          ],
        }),
      ],
      neverHitCap: 10,
    });
    expect(verdict.denominator).toBe("declared");
    expect(verdict.neverHitCount).toBe(1);
    expect(verdict.unknownBecause).toBe(null);
    expect(verdict.neverHit[0]!.providerId).toBe("widgets-get");
    expect(verdict.neverHit[0]!.endpoint).toBe("GET /widgets/{id}");
    expect(verdict.neverHit[0]!.surface).toBe("spec-declared");
  });

  it("counts an entity both declared and visited as corroborated", () => {
    const verdict = atlasPageReachability({
      descriptor: descriptor({ surfaces: [declaringSurface(), surface()] }),
      kinds: [
        kind({
          entities: [
            entity({ observations: [observation({ surface: "spec-declared" }), observation({ surface: "rest-api" })] }),
          ],
        }),
      ],
      neverHitCap: 10,
    });
    expect(verdict.neverHitCount).toBe(0);
    expect(verdict.corroboratedCount).toBe(1);
    expect(verdict.undeclaredFindCount).toBe(0);
  });

  it("counts an entity only a visit found as an undeclared find", () => {
    const verdict = atlasPageReachability({
      descriptor: descriptor({ surfaces: [declaringSurface(), surface()] }),
      kinds: [kind({ entities: [entity({ observations: [observation({ surface: "rest-api" })] })] })],
      neverHitCap: 10,
    });
    expect(verdict.neverHitCount).toBe(0);
    expect(verdict.undeclaredFindCount).toBe(1);
    expect(verdict.denominator).toBe("absent");
  });

  // Google Admin compiles a complete denominator
  // for its API and has nothing at all declaring what its admin console holds, and one atlas-wide verdict
  // let the API's figure imply something about console pages it says nothing about.
  it("reports PARTIAL when one kind can be judged and another cannot", () => {
    const verdict = atlasPageReachability({
      descriptor: descriptor({ surfaces: [declaringSurface({ name: "discovery" }), surface({ name: "admin-api" })] }),
      kinds: [
        kind({
          entities: [entity({ observations: [observation({ surface: "discovery" })] })],
          kind: "api-method",
        }),
        kind({
          entities: [entity({ observations: [observation({ surface: "admin-console" })] })],
          kind: "console-page",
        }),
      ],
      neverHitCap: 10,
    });
    expect(verdict.denominator).toBe("partial");
    expect(verdict.undeterminedKinds).toEqual(["console-page"]);
    expect(verdict.unknownBecause).toContain("console-page");
    expect(verdict.neverHitCount).toBe(1);
  });

  it("calls a kind PARTIAL when it holds both declared entities and entities nothing declares", () => {
    const verdict = atlasPageReachability({
      descriptor: descriptor({ surfaces: [declaringSurface(), surface()] }),
      kinds: [
        kind({
          entities: [
            entity({ id: "declared", observations: [observation({ surface: "spec-declared" })] }),
            entity({ id: "found", observations: [observation({ surface: "rest-api" })] }),
          ],
        }),
      ],
      neverHitCap: 10,
    });
    expect(verdict.kinds[0]!.denominator).toBe("partial");
    expect(verdict.denominator).toBe("partial");
    expect(verdict.undeterminedKinds).toEqual(["widget"]);
  });

  it("gives each kind its own verdict", () => {
    const verdict = atlasPageReachability({
      descriptor: descriptor({ surfaces: [declaringSurface(), surface()] }),
      kinds: [
        kind({ entities: [entity({ observations: [observation({ surface: "spec-declared" })] })], kind: "method" }),
        kind({ entities: [entity()], kind: "page" }),
      ],
      neverHitCap: 10,
    });
    expect(verdict.kinds.find((one) => one.kind === "method")!.denominator).toBe("declared");
    expect(verdict.kinds.find((one) => one.kind === "page")!.denominator).toBe("absent");
  });

  it("ignores a kind holding nothing rather than counting it undetermined", () => {
    const verdict = atlasPageReachability({
      descriptor: descriptor({ surfaces: [declaringSurface(), surface()] }),
      kinds: [
        kind({ entities: [entity({ observations: [observation({ surface: "spec-declared" })] })], kind: "method" }),
        kind({ entities: [], kind: "empty", publishedCount: 0 }),
      ],
      neverHitCap: 10,
    });
    expect(verdict.denominator).toBe("declared");
    expect(verdict.undeterminedKinds).toEqual([]);
  });

  it("caps the rows it carries without ever capping the count it reports", () => {
    const entities = [0, 1, 2, 3].map((index) =>
      entity({
        id: `id-${String(index)}`,
        observations: [observation({ surface: "spec-declared" })],
        providerId: `op-${String(index)}`,
      }),
    );
    const verdict = atlasPageReachability({
      descriptor: descriptor({ surfaces: [declaringSurface(), surface()] }),
      kinds: [kind({ entities })],
      neverHitCap: 2,
    });
    expect(verdict.neverHitCount).toBe(4);
    expect(verdict.neverHit).toHaveLength(2);
  });

  it("treats an unfilled compiled surface as no denominator at all", () => {
    const verdict = atlasPageReachability({
      descriptor: descriptor({ surfaces: [declaringSurface({ status: "declared-unfilled" }), surface()] }),
      kinds: [kind({ entities: [entity({ observations: [observation({ surface: "spec-declared" })] })] })],
      neverHitCap: 10,
    });
    expect(verdict.denominator).toBe("absent");
    expect(verdict.neverHitCount).toBe(0);
  });
});
