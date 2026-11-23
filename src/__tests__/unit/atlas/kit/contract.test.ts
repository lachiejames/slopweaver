import { describe, expect, it } from "vitest";

import { AIRTABLE_ATLAS_DESCRIPTOR } from "../../../../atlas/airtable/descriptor.js";
import { FIGMA_ATLAS_DESCRIPTOR } from "../../../../atlas/figma/descriptor.js";
import {
  ATLAS_COVERAGE_STATES,
  type AtlasDescriptor,
  compiledSurfaceMapSurfaces,
  hasFilledBrowserSurface,
  unfilledSurfaces,
} from "../../../../atlas/kit/contract.js";
import { VANTA_ATLAS_DESCRIPTOR } from "../../../../atlas/vanta/descriptor.js";

function descriptor({ surfaces }: { surfaces: AtlasDescriptor["surfaces"] }): AtlasDescriptor {
  return {
    excludes: [{ because: "mutations of any kind", ground: "never-acted" }],
    kinds: ["thing"],
    platform: "example",
    question: "what does this platform hold",
    writePolicy: "refuse-every-write",
    resyncCommand: "slopweaver atlas example sync",
    surfaces,
    visibilityScope: "configured-token-visible",
  };
}

describe("ATLAS_COVERAGE_STATES", () => {
  it("is the closed vocabulary, the seven both pre-kit atlases arrived at plus held-elsewhere", () => {
    expect([...ATLAS_COVERAGE_STATES]).toEqual([
      "synced",
      "held-elsewhere",
      "deferred",
      "not-configured",
      "invalid-configuration",
      "unreadable",
      "unavailable",
      "excluded",
    ]);
  });

  it("separates held-elsewhere from excluded, because they make different claims", () => {
    expect(ATLAS_COVERAGE_STATES.includes("held-elsewhere")).toBe(true);
    expect(ATLAS_COVERAGE_STATES.includes("excluded")).toBe(true);
    expect(ATLAS_COVERAGE_STATES.indexOf("held-elsewhere")).toBe(1);
  });
});

describe("unfilledSurfaces", () => {
  it("names a surface that was declared and never populated", () => {
    const result = unfilledSurfaces({
      descriptor: descriptor({
        surfaces: [
          {
            denominator: { because: "a fixture surface with no provider catalogue", known: false },
            acquisition: "api",
            documented: true,
            name: "rest",
            role: "authoritative",
            status: "filled",
            unfilledBecause: null,
          },
          {
            denominator: { because: "a fixture surface with no provider catalogue", known: false },
            acquisition: "driven-browser",
            documented: false,
            name: "browser",
            role: "corroborating",
            status: "declared-unfilled",
            unfilledBecause: "no browser driving ships yet",
          },
        ],
      }),
    });
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("browser");
    expect(result[0]!.unfilledBecause).toBe("no browser driving ships yet");
  });

  it("returns nothing when every declared surface is filled", () => {
    const result = unfilledSurfaces({
      descriptor: descriptor({
        surfaces: [
          {
            denominator: { because: "a fixture surface with no provider catalogue", known: false },
            acquisition: "api",
            documented: true,
            name: "rest",
            role: "authoritative",
            status: "filled",
            unfilledBecause: null,
          },
        ],
      }),
    });
    expect(result.length).toBe(0);
  });

  it("does not count a not-applicable surface as unfilled", () => {
    const result = unfilledSurfaces({
      descriptor: descriptor({
        surfaces: [
          {
            denominator: { because: "a fixture surface with no provider catalogue", known: false },
            acquisition: "driven-browser",
            documented: false,
            name: "browser",
            role: "discovery",
            status: "not-applicable",
            unfilledBecause: null,
          },
        ],
      }),
    });
    expect(result.length).toBe(0);
  });
});

describe("hasFilledBrowserSurface", () => {
  it("is false for an atlas whose only filled surface is an API", () => {
    const result = hasFilledBrowserSurface({
      descriptor: descriptor({
        surfaces: [
          {
            denominator: { because: "a fixture surface with no provider catalogue", known: false },
            acquisition: "api",
            documented: true,
            name: "rest",
            role: "authoritative",
            status: "filled",
            unfilledBecause: null,
          },
          {
            denominator: { because: "a fixture surface with no provider catalogue", known: false },
            acquisition: "driven-browser",
            documented: false,
            name: "browser",
            role: "corroborating",
            status: "declared-unfilled",
            unfilledBecause: "not built",
          },
        ],
      }),
    });
    expect(result).toBe(false);
  });

  it("is true once a driven-browser surface is filled", () => {
    const result = hasFilledBrowserSurface({
      descriptor: descriptor({
        surfaces: [
          {
            denominator: { because: "a fixture surface with no provider catalogue", known: false },
            acquisition: "driven-browser",
            documented: false,
            name: "browser",
            role: "corroborating",
            status: "filled",
            unfilledBecause: null,
          },
        ],
      }),
    });
    expect(result).toBe(true);
  });
});

describe("the Vanta descriptor", () => {
  it("has an API surface and a BROWSER surface both filled, which is what the mandatory-both ruling asks for", () => {
    const filled = VANTA_ATLAS_DESCRIPTOR.surfaces.filter((surface) => surface.status === "filled");
    expect(filled.map((surface) => surface.name).toSorted()).toEqual(["browser", "manage-api"]);
    expect(hasFilledBrowserSurface({ descriptor: VANTA_ATLAS_DESCRIPTOR })).toBe(true);
  });

  it("declares all four API documents Vanta publishes, and says why three of them are unfilled", () => {
    expect(VANTA_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name).toSorted()).toEqual([
      "auditor-api",
      "browser",
      "build-integrations-api",
      "manage-api",
      "webhooks",
    ]);
    // Unfilled is a STATE the descriptor says rather than an omission, so every one of them carries a
    // reason. The atlas once declared only `manage-api` and `browser` and divided its
    // coverage by the first of Vanta's four published documents.
    expect(unfilledSurfaces({ descriptor: VANTA_ATLAS_DESCRIPTOR }).map((surface) => surface.name)).toEqual([
      "auditor-api",
      "build-integrations-api",
      "webhooks",
    ]);
    expect(
      unfilledSurfaces({ descriptor: VANTA_ATLAS_DESCRIPTOR }).map((surface) => surface.unfilledBecause!.length > 20),
    ).toEqual([true, true, true]);
  });

  it("divides the Auditor surface by Vanta's own count of it, reaching none of it", () => {
    const auditor = VANTA_ATLAS_DESCRIPTOR.surfaces.find((surface) => surface.name === "auditor-api")!;
    expect(auditor.denominator).toEqual({
      exists: 38,
      known: true,
      reached: 0,
      source:
        "https://developer.vanta.com/reference/auditor-api.json — Vanta's own published Auditor API document, counted from the document itself",
    });
  });

  it("gives the webhook surface a measured ZERO read denominator rather than calling it unknown", () => {
    const webhooks = VANTA_ATLAS_DESCRIPTOR.surfaces.find((surface) => surface.name === "webhooks")!;
    expect(webhooks.denominator.known).toBe(true);
    expect(webhooks.denominator).toEqual({
      exists: 0,
      known: true,
      reached: 0,
      source:
        "https://developer.vanta.com/reference/webhooks.json — Vanta's own published webhook document, counted from the document itself: 24 topics, 0 GET operations",
    });
  });

  it("still names the browser surface as driven rather than folding it into the API one", () => {
    const browser = VANTA_ATLAS_DESCRIPTOR.surfaces.find((surface) => surface.name === "browser")!;
    expect(browser.acquisition).toBe("driven-browser");
    expect(browser.role).toBe("corroborating");
    // Filled means the walk lands on every DECLARED page. How many is the coverage cell's job, never this
    // flag's — a walk reaching four of twelve publishes `deferred` with the fraction in its reason.
    expect(browser.unfilledBecause).toBe(null);
  });

  it("names one platform and one command that brings the whole atlas current", () => {
    expect(VANTA_ATLAS_DESCRIPTOR.platform).toBe("vanta");
    // BOTH legs. `sync` alone refreshes the Manage API channel and leaves the browser
    // one wherever the last walk left it, so a reader following this field took the atlas for current with
    // one of its two surfaces stale.
    expect(VANTA_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas vanta sync && slopweaver atlas vanta walk");
  });

  it("states what it deliberately does not hold", () => {
    expect(VANTA_ATLAS_DESCRIPTOR.excludes.length).toBe(6);
    // The two Manage API families this credential is refused, each named with the status that proves it —
    // and neither attributed to a human's role, which is what the descriptor used to claim.
    expect(VANTA_ATLAS_DESCRIPTOR.excludes[0]!.because).toContain("HTTP 403");
    expect(VANTA_ATLAS_DESCRIPTOR.excludes.map((entry) => entry.because).join(" ")).not.toContain("Editor");
    // The 65 documented GET operations this atlas has no disposition for, declared on the one ground the
    // coverage gate refuses. It replaced a "the TEXT of a policy" row: the body turned out to
    // be served by `GET /v1/knowledge-base/resources` and is now held, while the endpoints nobody has been
    // to are the debt that remains.
    expect(VANTA_ATLAS_DESCRIPTOR.excludes[1]!.because).toContain("107 GET operations");
    expect(VANTA_ATLAS_DESCRIPTOR.excludes[1]!.ground).toBe("not-fetched");
    // The Manage API surface is the one surface in this build that can divide its coverage by what exists.
    const manageApi = VANTA_ATLAS_DESCRIPTOR.surfaces.find((surface) => surface.name === "manage-api")!;
    expect(manageApi.denominator.known).toBe(true);
    // `reached` counts CALLS. 46 of the 107 documented GET operations, and never the ones with a good
    // reason for not being called — an earlier draft forgave those and claimed 42.
    expect(manageApi.denominator).toEqual({
      exists: 107,
      known: true,
      reached: 46,
      source: "generated/specLock.ts — Vanta's own published OpenAPI document, pinned by digest",
    });
    // `vanta deactivate` writes to Vanta and publishes nothing here, and vulnerabilities are ALSO read live
    // on top of the stored census — both are declared exclusions rather than silent ones.
    expect(VANTA_ATLAS_DESCRIPTOR.excludes[4]!.because).toContain("this ATLAS only ever reads");
    expect(VANTA_ATLAS_DESCRIPTOR.excludes[5]!.because).toContain("the census stores every finding");
  });
});

describe("the compiled surface-map pair every offline atlas declares", () => {
  it("declares the specification authoritative and the route inventory only discovery", () => {
    const [spec, routes] = compiledSurfaceMapSurfaces();

    expect(spec!.name).toBe("spec-declared");
    expect(spec!.acquisition).toBe("compiled");
    expect(spec!.role).toBe("authoritative");
    expect(routes!.name).toBe("browser-routes");
    expect(routes!.role).toBe("discovery");
  });

  // Both are FILLED with no credential configured, which is the property that makes this pair a shape
  // rather than a coincidence: a compiled surface map publishes complete on any installation.
  it("marks both filled, so neither reports as an unlooked-at surface", () => {
    const filled = compiledSurfaceMapSurfaces().filter((surface) => surface.status === "filled");

    expect(filled.length).toBe(2);
    expect(compiledSurfaceMapSurfaces().map((surface) => surface.unfilledBecause)).toEqual([null, null]);
  });

  // It is kit-owned because it was COPIED: these two atlases declared byte-identical entries and the clone
  // ratchet said so. This is the assertion that stops them drifting apart again.
  it("is the pair both compiled atlases actually declare", () => {
    const pair = compiledSurfaceMapSurfaces();

    expect(AIRTABLE_ATLAS_DESCRIPTOR.surfaces.slice(0, 2)).toEqual([...pair]);
    expect(FIGMA_ATLAS_DESCRIPTOR.surfaces.slice(0, 2)).toEqual([...pair]);
  });
});
