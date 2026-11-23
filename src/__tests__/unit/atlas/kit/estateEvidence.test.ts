/**
 * Whether a kind's records can establish what this organisation holds.
 *
 * Two cases produced the rule and both are pinned by name, because each is a draft of the module that
 * passed its own tests and still got the founding generation wrong. A kind whose records were seen by a
 * DISCOVERY surface and a CORROBORATING one and by no authoritative surface cannot answer about the
 * estate; and neither can one whose records an AUTHORITATIVE surface has seen, when a discovery surface
 * had already declared every one of them. A test that only exercised the pure-discovery shape would have
 * passed over both.
 */
import { describe, expect, it } from "vitest";

import type { AtlasDescriptor } from "../../../../atlas/kit/contract.js";
import { estateNotEstablishedKinds, estateNotEstablishedReason } from "../../../../atlas/kit/estateEvidence.js";
import type { AtlasEntityView, AtlasKindView } from "../../../../atlas/kit/read.js";

/** When every fixture observation was made. */
const SEEN_AT = "2026-09-19T00:19:11.314Z";

/** Three surfaces, one per evidence role, so a test names the role it is about. */
function descriptor(): AtlasDescriptor {
  return {
    excludes: [],
    kinds: ["monitor"],
    platform: "datadog",
    question: "what does this organisation hold",
    resyncCommand: "slopweaver atlas datadog sync",
    surfaces: [
      {
        acquisition: "compiled",
        denominator: { because: "a fixture surface with no provider catalogue", known: false },
        documented: true,
        name: "compiled-catalogue",
        role: "discovery",
        status: "filled",
        unfilledBecause: null,
      },
      {
        acquisition: "api",
        denominator: { because: "a fixture surface with no provider catalogue", known: false },
        documented: true,
        name: "api",
        role: "authoritative",
        status: "filled",
        unfilledBecause: null,
      },
      {
        acquisition: "driven-browser",
        denominator: { because: "a fixture surface with no provider catalogue", known: false },
        documented: false,
        name: "console",
        role: "corroborating",
        status: "filled",
        unfilledBecause: null,
      },
    ],
    visibilityScope: "one organisation at one site",
    writePolicy: "read-before-write",
  };
}

/** One record, seen by the surfaces a test names. */
function entity({ id, surfaces }: { id: string; surfaces: readonly string[] }): AtlasEntityView {
  return {
    detail: { name: id },
    id,
    kind: "monitor",
    observations: surfaces.map((surface) => ({
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: "GET /api/v1/monitor",
      observedAt: SEEN_AT,
      state: "observed" as const,
      surface,
    })),
    providerId: id,
    scope: "org/1500051282",
  };
}

/** A kind holding the records a test names, with nothing else standing against it. */
function kindWith({ entities }: { entities: readonly AtlasEntityView[] }): AtlasKindView {
  return {
    coverage: [],
    entities,
    gaps: [],
    kind: "monitor",
    lastSuccessAt: SEEN_AT,
    latestAttemptFailed: false,
    permissionBlocked: null,
    publishedCount: entities.length,
  };
}

describe("estateNotEstablishedReason", () => {
  it("names the kind holding only compiled declarations, and counts them", () => {
    const reason = estateNotEstablishedReason({
      descriptor: descriptor(),
      kind: kindWith({
        entities: [
          entity({ id: "v1-monitors-list-monitors", surfaces: ["compiled-catalogue"] }),
          entity({ id: "v1-monitors-get-monitor", surfaces: ["compiled-catalogue"] }),
        ],
      }),
    });
    expect(reason).toBe(
      "all 2 stored record(s) here were observed on compiled-catalogue, and datadog declares no" +
        " authoritative role for any of them: discovery evidence reveals that something exists without" +
        " establishing anything about its contents, and corroborating evidence may never satisfy an" +
        " authoritative obligation alone. These records describe the platform, never what this" +
        " organisation holds",
    );
  });

  it("is NOT cleared by a corroborating sighting — the masking measured on a real generation", () => {
    const reason = estateNotEstablishedReason({
      descriptor: descriptor(),
      kind: kindWith({
        entities: [
          entity({ id: "v1-monitors-list-monitors", surfaces: ["compiled-catalogue", "console"] }),
          entity({ id: "v1-monitors-get-monitor", surfaces: ["compiled-catalogue"] }),
        ],
      }),
    });
    expect(reason).toContain("were observed on compiled-catalogue, console");
    expect(reason).toContain("corroborating evidence may never satisfy an authoritative obligation alone");
  });

  it("is cleared by ONE authoritative observation, so filling the estate removes the line", () => {
    const reason = estateNotEstablishedReason({
      descriptor: descriptor(),
      kind: kindWith({
        entities: [
          entity({ id: "v1-monitors-list-monitors", surfaces: ["compiled-catalogue"] }),
          entity({ id: "50100", surfaces: ["api"] }),
        ],
      }),
    });
    expect(reason).toBe(null);
  });

  it("leaves an EMPTY kind out — that silence is already reported by kindReason's three classes", () => {
    expect(estateNotEstablishedReason({ descriptor: descriptor(), kind: kindWith({ entities: [] }) })).toBe(null);
  });

  it("treats a surface the descriptor does not declare as NOT authoritative", () => {
    const reason = estateNotEstablishedReason({
      descriptor: descriptor(),
      kind: kindWith({ entities: [entity({ id: "50100", surfaces: ["invented-surface"] })] }),
    });
    expect(reason).toContain("were observed on invented-surface");
  });
});

describe("estateNotEstablishedKinds", () => {
  it("returns only the kinds without authoritative evidence, sorted", () => {
    const declared = {
      ...kindWith({ entities: [entity({ id: "a", surfaces: ["compiled-catalogue"] })] }),
      kind: "slo",
    };
    const alsoDeclared = {
      ...kindWith({ entities: [entity({ id: "b", surfaces: ["console"] })] }),
      kind: "dashboard",
    };
    const filled = { ...kindWith({ entities: [entity({ id: "c", surfaces: ["api"] })] }), kind: "monitor" };
    const empty = { ...kindWith({ entities: [] }), kind: "notebooks" };
    expect(
      estateNotEstablishedKinds({ descriptor: descriptor(), kinds: [declared, alsoDeclared, filled, empty] }),
    ).toEqual(["dashboard", "slo"]);
  });
});

describe("estateNotEstablishedReason — a record ANNOTATED is not a record revealed", () => {
  it("is NOT cleared when the authoritative surface only filled in records a declaration already carried", () => {
    const reason = estateNotEstablishedReason({
      descriptor: descriptor(),
      kind: kindWith({
        entities: [
          entity({ id: "v1-monitors-list-monitors", surfaces: ["compiled-catalogue", "api"] }),
          entity({ id: "v1-monitors-get-monitor", surfaces: ["compiled-catalogue", "api"] }),
        ],
      }),
    });
    expect(reason).toBe(
      "none of the 2 stored record(s) here is one of this organisation's own: datadog has read 2 of them" +
        " on an authoritative surface, and every one of those was ALREADY declared by a discovery surface" +
        " — which reveals that something exists without establishing anything about its contents. An" +
        " authoritative surface has never revealed a record here that a declaration did not already carry," +
        " so these records describe the platform and not what this organisation holds",
    );
  });

  it("clears the moment the authoritative surface reveals ONE record no declaration carried", () => {
    const reason = estateNotEstablishedReason({
      descriptor: descriptor(),
      kind: kindWith({
        entities: [
          entity({ id: "v1-monitors-list-monitors", surfaces: ["compiled-catalogue", "api"] }),
          entity({ id: "819486", surfaces: ["api"] }),
        ],
      }),
    });
    expect(reason).toBe(null);
  });

  it("clears every authoritative record for an atlas that declares no discovery surface at all", () => {
    const apiOnly: AtlasDescriptor = {
      ...descriptor(),
      surfaces: descriptor().surfaces.filter((one) => one.role !== "discovery"),
    };
    const reason = estateNotEstablishedReason({
      descriptor: apiOnly,
      kind: kindWith({ entities: [entity({ id: "test-1", surfaces: ["api"] })] }),
    });
    expect(reason).toBe(null);
  });
});

describe("estateNotEstablishedReason — the lean when nothing states what established a record", () => {
  it("does NOT clear a kind whose records carry no observation at all", () => {
    const reason = estateNotEstablishedReason({
      descriptor: descriptor(),
      kind: kindWith({ entities: [entity({ id: "819486", surfaces: [] })] }),
    });
    expect(reason).toBe(
      "the 1 stored record(s) here carry no observation at all, so nothing states which surface" +
        " established them and datadog cannot answer from them about what this organisation holds",
    );
  });
});
