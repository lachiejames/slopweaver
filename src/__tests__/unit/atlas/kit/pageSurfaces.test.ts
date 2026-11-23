/*
 * The per-surface rows an atlas page prints: what each surface produced, counted from the entities, and the
 * synthetic row an entity's undeclared surface earns.
 *
 * Every fixture is a plain object over the normalized view; the whole page model is `pageModel.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import type { AtlasArtifactRef, AtlasDescriptor } from "../../../../atlas/kit/contract.js";
import { isPhotographed, pageSurfaces, tallySurfaces } from "../../../../atlas/kit/pageSurfaces.js";
import type { AtlasEntityView } from "../../../../atlas/kit/read.js";

const SCREENSHOT: AtlasArtifactRef = {
  byteLength: 100,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/pages/aa.png",
  sha256: "a".repeat(64),
};

const JSON_DUMP: AtlasArtifactRef = {
  byteLength: 50,
  kind: "api-json",
  mediaType: "application/json",
  relativePath: "artifacts/api/bb.json",
  sha256: "b".repeat(64),
};

/** One observation, with everything defaulted so a test names only what it is about. */
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
    scope: "acme",
    ...over,
  };
}

/** A descriptor declaring a filled compiled `catalogue` surface and a filled `rest-api` visit. */
function twoSurfaceDescriptor(): AtlasDescriptor {
  return {
    excludes: [],
    kinds: ["widget"],
    platform: "example",
    question: "what does example hold",
    resyncCommand: "slopweaver atlas example sync",
    surfaces: [
      {
        acquisition: "compiled",
        denominator: { because: "a fixture surface with no provider catalogue", known: false },
        documented: true,
        name: "catalogue",
        role: "authoritative",
        status: "filled",
        unfilledBecause: null,
      },
      {
        acquisition: "api",
        denominator: { because: "a fixture surface with no provider catalogue", known: false },
        documented: true,
        name: "rest-api",
        role: "authoritative",
        status: "filled",
        unfilledBecause: null,
      },
    ],
    visibilityScope: "whatever this token opens",
    writePolicy: "refuse-every-write",
  };
}

describe("isPhotographed", () => {
  it("is true only for an observation that kept a page screenshot", () => {
    expect(isPhotographed({ observation: observation({ artifacts: [JSON_DUMP, SCREENSHOT] }) })).toBe(true);
    expect(isPhotographed({ observation: observation({ artifacts: [JSON_DUMP] }) })).toBe(false);
    expect(isPhotographed({ observation: observation() })).toBe(false);
  });
});

describe("tallySurfaces", () => {
  it("counts distinct endpoints, entities, artifacts and screenshots per cited surface", () => {
    const tallies = tallySurfaces({
      entities: [
        entity({ observations: [observation({ artifacts: [SCREENSHOT, JSON_DUMP] })] }),
        entity({ id: "id-2", observations: [observation()] }),
        entity({ id: "id-3", observations: [observation({ endpoint: "widgets-get" })] }),
        entity({ id: "id-4", observations: [observation({ surface: "browser-walk" })] }),
      ],
    });
    expect([...tallies.keys()].toSorted()).toEqual(["browser-walk", "rest-api"]);
    const rest = tallies.get("rest-api")!;
    expect([...rest.endpoints].toSorted()).toEqual(["widgets-get", "widgets-list"]);
    expect(rest.entities).toBe(3);
    expect(rest.artifacts).toBe(2);
    expect(rest.photographed).toBe(1);
    const browser = tallies.get("browser-walk")!;
    expect([...browser.endpoints]).toEqual(["widgets-list"]);
    expect(browser.entities).toBe(1);
    expect(browser.artifacts).toBe(0);
    expect(browser.photographed).toBe(0);
  });

  it("holds no tally at all for an atlas with no entities", () => {
    expect(tallySurfaces({ entities: [] }).size).toBe(0);
  });
});

describe("pageSurfaces", () => {
  it("rows every declared surface, an unobserved one at zero, then appends each undeclared one", () => {
    const tallies = tallySurfaces({
      entities: [
        entity({ observations: [observation({ artifacts: [SCREENSHOT] })] }),
        entity({ id: "id-2", observations: [observation({ surface: "undocumented-api" })] }),
      ],
    });
    expect(pageSurfaces({ descriptor: twoSurfaceDescriptor(), tallies })).toEqual([
      {
        acquisition: "compiled",
        artifactCount: 0,
        declared: true,
        distinctEndpoints: 0,
        documented: true,
        entityCount: 0,
        name: "catalogue",
        photographedCount: 0,
        purpose: "declares-existence",
        role: "authoritative",
        status: "filled",
        unfilledBecause: null,
      },
      {
        acquisition: "api",
        artifactCount: 1,
        declared: true,
        distinctEndpoints: 1,
        documented: true,
        entityCount: 1,
        name: "rest-api",
        photographedCount: 1,
        purpose: "visits",
        role: "authoritative",
        status: "filled",
        unfilledBecause: null,
      },
      {
        acquisition: "unknown",
        artifactCount: 0,
        declared: false,
        distinctEndpoints: 1,
        documented: false,
        entityCount: 1,
        name: "undocumented-api",
        photographedCount: 0,
        purpose: "visits",
        role: "unknown",
        status: "undeclared",
        unfilledBecause: null,
      },
    ]);
  });
});
