/**
 * The answer boundary — what a generic atlas read may and may not present as a zero.
 *
 * The fixture is built by overriding one field at a time off a healthy snapshot, so every test names the
 * ONE thing that made a zero unprovable. A test that assembled its own whole snapshot would pass while
 * silently disagreeing with the healthy case about three other fields.
 */
import { describe, expect, it } from "vitest";

import type { AtlasDescriptor } from "../../../../atlas/kit/contract.js";
import type { AtlasGenerationView, AtlasKindView, AtlasReadSnapshot } from "../../../../atlas/kit/read.js";
import {
  AtlasReadAnswerErrors,
  type AtlasReadEmptyUnprovenError,
  answerAtlasRead,
  assessAtlasReadAnswer,
} from "../../../../atlas/kit/readAnswer.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** The instant every test judges freshness at — one hour after the fixture's last successful sync. */
const NOW_MS = Date.parse("2026-08-20T08:07:53.351Z");

/** The fixture's own last successful sync, inside the four-hour default window at {@link NOW_MS}. */
const SYNCED_AT = "2026-08-20T07:07:53.351Z";

/** A descriptor with two declared surfaces and one exclusion that withholds no record. */
function descriptor(): AtlasDescriptor {
  return {
    excludes: [{ because: "any mutation", ground: "never-acted" }],
    kinds: ["zone"],
    platform: "cloudflare",
    question: "what edge configuration exists",
    resyncCommand: "slopweaver cloudflare sync",
    surfaces: [
      {
        acquisition: "api",
        denominator: { because: "a fixture surface with no provider catalogue", known: false },
        documented: true,
        name: "rest-api",
        role: "authoritative",
        status: "filled",
        unfilledBecause: null,
      },
      {
        acquisition: "driven-browser",
        denominator: { because: "a fixture surface with no provider catalogue", known: false },
        documented: false,
        name: "dashboard",
        role: "corroborating",
        status: "declared-unfilled",
        unfilledBecause: "nobody has driven a browser here",
      },
    ],
    visibilityScope: "configured-token-visible",
    writePolicy: "refuse-every-write",
  };
}

/** A generation whose manifest and files agree. */
function generation(): AtlasGenerationView {
  return {
    mismatched: [],
    missing: [],
    platform: "cloudflare",
    schemaVersion: 1,
    superseded: [],
    unpublished: [],
    updatedAt: SYNCED_AT,
  };
}

/** A kind that synced successfully, holds no entity, and has nothing standing against it. */
function healthyKind(): AtlasKindView {
  return {
    coverage: [
      {
        lastSuccessAt: SYNCED_AT,
        latestAttemptFailed: false,
        reason: "read 0 zone(s)",
        scope: "account/abc",
        state: "synced",
        surface: "rest-api",
        unblockedBy: null,
      },
    ],
    entities: [],
    gaps: [],
    kind: "zone",
    lastSuccessAt: SYNCED_AT,
    latestAttemptFailed: false,
    permissionBlocked: null,
    publishedCount: 0,
  };
}

/** The healthy snapshot, with the kind replaced by whatever a test is pinning. */
function snapshotWith({ kind }: { kind: AtlasKindView }): AtlasReadSnapshot {
  return { descriptor: descriptor(), generation: generation(), kinds: [kind] };
}

/**
 * Unwrap an unprovable-empty refusal, throwing on any other outcome.
 *
 * A helper rather than a conditional in each assertion: `.boundary` lives on one arm of the union only, so
 * a test reading it has to narrow first, and `testing.md` bans doing that inside an `expect`.
 *
 * @param result what the kit answered
 * @returns the refusal, narrowed to the arm that carries the boundary
 */
function unprovenOf({ result }: { result: ReturnType<typeof answerAtlasRead> }): AtlasReadEmptyUnprovenError {
  const error = unwrapErr(result);
  if (error.code !== "ATLAS_READ_EMPTY_UNPROVEN") {
    throw new Error(`expected ATLAS_READ_EMPTY_UNPROVEN, got ${error.code}`);
  }
  return error;
}

/** Run the whole selection-and-assessment path over one kind with no filters. */
function answerOver({ kind, surface }: { kind: AtlasKindView; surface?: string }) {
  const snapshot = snapshotWith({ kind });
  return answerAtlasRead({
    kinds: snapshot.kinds,
    nowMs: NOW_MS,
    selection: { includeStale: false, ...(surface === undefined ? {} : { surface }) },
    snapshot,
  });
}

describe("assessAtlasReadAnswer — a measured zero is answered", () => {
  it("answers a successful empty sync as zero STORED records, with the boundary attached", () => {
    const answer = unwrap(answerOver({ kind: healthyKind() }));
    expect(answer.page.matched).toBe(0);
    expect(answer.boundary.countScope).toBe("stored-selection");
    expect(answer.boundary.providerCompleteness).toBe("not-established");
    expect(answer.boundary.fieldAbsence).toBe("not-evidence-of-absence");
    expect(answer.boundary.kinds[0]!.emptyIsUnproven).toEqual([]);
  });

  it("answers a HISTORICAL zero rather than refusing it, because that zero really was measured", () => {
    const answer = unwrap(
      answerAtlasRead({
        kinds: [healthyKind()],
        // Two days past the fixture's sync, so the four-hour default window is long gone.
        nowMs: Date.parse("2026-08-22T07:07:53.351Z"),
        selection: { includeStale: false },
        snapshot: snapshotWith({ kind: healthyKind() }),
      }),
    );
    expect(answer.boundary.kinds[0]!.freshness.verdict).toBe("historical");
    expect(answer.boundary.kinds[0]!.emptyIsUnproven).toEqual([]);
  });

  it("carries only the exclusions that really withhold records, and counts the rest", () => {
    const snapshot = snapshotWith({ kind: healthyKind() });
    const answer = unwrap(
      answerAtlasRead({
        kinds: snapshot.kinds,
        nowMs: NOW_MS,
        selection: { includeStale: false },
        snapshot: {
          ...snapshot,
          descriptor: {
            ...snapshot.descriptor,
            excludes: [
              { because: "any mutation", ground: "never-acted" },
              {
                because: "every audit log line",
                ground: "shape-index",
                volume: {
                  basis: "measured",
                  establishedBy: "slopweaver atlas cloudflare coverage --json",
                  magnitude: "14 GB over 30 days",
                  unboundedBecause: "the family grows with traffic",
                },
              },
            ],
          },
        },
      }),
    );
    expect(answer.boundary.withheldBy.length).toBe(1);
    expect(answer.boundary.withheldBy[0]!.ground).toBe("shape-index");
    expect(answer.boundary.boundedByCount).toBe(1);
  });
});

describe("assessAtlasReadAnswer — an unmeasured zero is refused", () => {
  it("refuses when the only coverage cell is unavailable", () => {
    const kind = healthyKind();
    const error = unwrapErr(
      answerOver({
        kind: {
          ...kind,
          coverage: [{ ...kind.coverage[0]!, reason: "no Vanta token is configured", state: "unavailable" }],
        },
      }),
    );
    expect(error.code).toBe("ATLAS_READ_EMPTY_UNPROVEN");
    expect(error.message).toContain("cannot establish that a zero was ever measured");
  });

  it("refuses when the kind declares no coverage cell at all", () => {
    const error = unprovenOf({ result: answerOver({ kind: { ...healthyKind(), coverage: [] } }) });
    expect(error.code).toBe("ATLAS_READ_EMPTY_UNPROVEN");
    expect(error.boundary.kinds[0]!.emptyIsUnproven).toEqual([
      "no coverage cell says anything ever looked at this kind on the selected surface",
    ]);
  });

  it("refuses a kind that has never synced successfully, which is the measured witness", () => {
    const kind = healthyKind();
    const error = unprovenOf({
      result: answerOver({
        kind: {
          ...kind,
          coverage: [{ ...kind.coverage[0]!, lastSuccessAt: null, reason: "never acquired", state: "unavailable" }],
          lastSuccessAt: null,
        },
      }),
    });
    expect(error.boundary.kinds[0]!.emptyIsUnproven).toEqual([
      "its rest-api coverage is unavailable (never acquired)",
      "its freshness is never-synced, so there is no instant to have measured a zero at",
    ]);
  });

  it("refuses when the latest attempt failed, because the stored records may be short", () => {
    const kind = healthyKind();
    const error = unprovenOf({
      result: answerOver({ kind: { ...kind, coverage: [{ ...kind.coverage[0]!, latestAttemptFailed: true }] } }),
    });
    expect(error.boundary.kinds[0]!.emptyIsUnproven).toEqual([
      "the latest rest-api attempt failed, so the stored records may be short",
    ]);
  });

  it("refuses a permission-blocked kind — the 404 case, where a refusal to read is not a reading", () => {
    const error = unprovenOf({
      result: answerOver({
        kind: {
          ...healthyKind(),
          permissionBlocked: {
            at: SYNCED_AT,
            detail: "403 insufficient scope",
            unblockedBy: "the audit:read scope",
          },
        },
      }),
    });
    expect(error.boundary.kinds[0]!.emptyIsUnproven).toEqual([
      "this credential is not permitted to read it (403 insufficient scope), which is a refusal to read rather than a reading of nothing",
    ]);
  });

  it("refuses while an open gap stands, and ignores a closed one", () => {
    const gap = {
      condition: "permission-refused",
      id: "gap-1",
      lastDetectedAt: SYNCED_AT,
      reason: "the configured token cannot see this surface",
      scope: "zone/abc",
    };
    const open = unprovenOf({ result: answerOver({ kind: { ...healthyKind(), gaps: [{ ...gap, status: "open" }] } }) });
    expect(open.boundary.kinds[0]!.emptyIsUnproven).toEqual(["an open gap stands against it: permission-refused"]);
    const closed = unwrap(answerOver({ kind: { ...healthyKind(), gaps: [{ ...gap, status: "closed" }] } }));
    expect(closed.boundary.kinds[0]!.emptyIsUnproven).toEqual([]);
  });

  it("refuses when the generation itself disagrees with its manifest about this kind", () => {
    const snapshot = snapshotWith({ kind: healthyKind() });
    const error = unprovenOf({
      result: answerAtlasRead({
        kinds: snapshot.kinds,
        nowMs: NOW_MS,
        selection: { includeStale: false },
        snapshot: { ...snapshot, generation: { ...snapshot.generation, missing: ["zone"] } },
      }),
    });
    expect(error.boundary.kinds[0]!.emptyIsUnproven).toEqual([
      "the manifest vouches for this kind and its file is gone",
    ]);
  });

  it("refuses on an unreadable timestamp, where there is no instant to have measured a zero at", () => {
    const error = unprovenOf({ result: answerOver({ kind: { ...healthyKind(), lastSuccessAt: "the other day" } }) });
    expect(error.boundary.kinds[0]!.emptyIsUnproven).toEqual([
      "its freshness is indeterminate, so there is no instant to have measured a zero at",
    ]);
  });
});

describe("assessAtlasReadAnswer — the surface filter decides which evidence counts", () => {
  it("refuses a --surface read that leans on a surface with no cell, even though another surface synced", () => {
    const error = unprovenOf({ result: answerOver({ kind: healthyKind(), surface: "dashboard" }) });
    expect(error.boundary.kinds[0]!.emptyIsUnproven).toEqual([
      "no coverage cell says anything ever looked at this kind on the selected surface",
    ]);
    expect(error.boundary.kinds[0]!.coverage).toEqual([]);
  });

  it("answers a --surface read that names the surface which actually synced", () => {
    const answer = unwrap(answerOver({ kind: healthyKind(), surface: "rest-api" }));
    expect(answer.boundary.kinds[0]!.coverage.length).toBe(1);
    expect(answer.boundary.kinds[0]!.emptyIsUnproven).toEqual([]);
  });

  it("refuses a surface this atlas does not declare, rather than answering the zero a typo selects", () => {
    const error = unwrapErr(answerOver({ kind: healthyKind(), surface: "consoel" }));
    expect(error.code).toBe("ATLAS_READ_SURFACE_UNKNOWN");
    expect(error.message).toBe("cloudflare declares no surface consoel — it declares: rest-api, dashboard");
  });
});

describe("assessAtlasReadAnswer — ANY unmeasured kind, not every", () => {
  it("refuses an empty selection spanning a measured kind and an unmeasured one", () => {
    const measured = healthyKind();
    const unmeasured: AtlasKindView = { ...healthyKind(), coverage: [], kind: "ruleset" };
    const snapshot = snapshotWith({ kind: measured });
    const error = unprovenOf({
      result: answerAtlasRead({
        kinds: [measured, unmeasured],
        nowMs: NOW_MS,
        selection: { includeStale: false },
        snapshot: { ...snapshot, kinds: [measured, unmeasured] },
      }),
    });
    expect(error.boundary.kinds[0]!.emptyIsUnproven).toEqual([]);
    expect(error.boundary.kinds[1]!.emptyIsUnproven).toEqual([
      "no coverage cell says anything ever looked at this kind on the selected surface",
    ]);
    expect(error.message).toContain("ruleset —");
  });
});

describe("assessAtlasReadAnswer — what the refusal is NOT reachable for", () => {
  it("answers a partial positive: one unprovable kind cannot refuse a page that holds records", () => {
    const holding: AtlasKindView = {
      ...healthyKind(),
      entities: [
        {
          detail: { name: "acme.com" },
          id: "atlas-1",
          kind: "zone",
          observations: [
            {
              artifacts: [],
              deepLink: null,
              deepLinkStatus: "unverified",
              endpoint: "zones-list",
              observedAt: SYNCED_AT,
              state: "observed",
              surface: "rest-api",
            },
          ],
          providerId: "00000000000000000000000000002e01",
          scope: "account/abc",
        },
      ],
    };
    const dark: AtlasKindView = { ...healthyKind(), coverage: [], kind: "ruleset" };
    const snapshot = snapshotWith({ kind: holding });
    const answer = unwrap(
      answerAtlasRead({
        kinds: [holding, dark],
        nowMs: NOW_MS,
        selection: { includeStale: false },
        snapshot: { ...snapshot, kinds: [holding, dark] },
      }),
    );
    expect(answer.page.matched).toBe(1);
    expect(answer.boundary.kinds[1]!.emptyIsUnproven.length).toBe(1);
  });

  it("judges `matched`, not the page, so an exhausted cursor is not mistaken for an absence", () => {
    const kind: AtlasKindView = { ...healthyKind(), coverage: [] };
    const withEntity: AtlasKindView = {
      ...kind,
      entities: [
        {
          detail: {},
          id: "atlas-1",
          kind: "zone",
          observations: [
            {
              artifacts: [],
              deepLink: null,
              deepLinkStatus: "unverified",
              endpoint: "zones-list",
              observedAt: SYNCED_AT,
              state: "observed",
              surface: "rest-api",
            },
          ],
          providerId: "p1",
          scope: "account/abc",
        },
      ],
    };
    const snapshot = snapshotWith({ kind: withEntity });
    const answer = unwrap(
      answerAtlasRead({
        kinds: snapshot.kinds,
        nowMs: NOW_MS,
        // `after` the only entity: the page is empty and `matched` is 1, which is a cursor at its end.
        selection: { after: "atlas-1", includeStale: false },
        snapshot,
      }),
    );
    expect(answer.page.entities).toEqual([]);
    expect(answer.page.matched).toBe(1);
  });
});

describe("assessAtlasReadAnswer — the assessment is reachable without the selector", () => {
  it("judges a page a caller computed elsewhere, so the contract is one function rather than one path", () => {
    const error = unwrapErr(
      assessAtlasReadAnswer({
        descriptor: descriptor(),
        generation: generation(),
        kinds: [{ ...healthyKind(), coverage: [] }],
        nowMs: NOW_MS,
        page: { entities: [], matched: 0, nextAfter: null, truncated: false },
        selection: { includeStale: false },
      }),
    );
    expect(error.code).toBe("ATLAS_READ_EMPTY_UNPROVEN");
  });
});

describe("AtlasReadAnswerErrors", () => {
  it("builds the refusal message from the boundary, naming every kind that made a zero unprovable", () => {
    const snapshot = snapshotWith({ kind: { ...healthyKind(), coverage: [] } });
    const boundary = unprovenOf({
      result: answerAtlasRead({ kinds: snapshot.kinds, nowMs: NOW_MS, selection: { includeStale: false }, snapshot }),
    }).boundary;
    const built = AtlasReadAnswerErrors.emptyUnproven({
      boundary,
      generation: generation(),
      platform: "cloudflare",
    });
    expect(built.code).toBe("ATLAS_READ_EMPTY_UNPROVEN");
    expect(built.message).toBe(
      "no stored cloudflare record matched, and this atlas cannot establish that a zero was ever measured:" +
        " zone — no coverage cell says anything ever looked at this kind on the selected surface." +
        " Answering zero here would be indistinguishable from an organisation that holds none",
    );
  });

  it("names every declared surface when a filter selects one that is not there", () => {
    const built = AtlasReadAnswerErrors.surfaceUnknown({
      known: ["rest-api", "dashboard"],
      platform: "cloudflare",
      surface: "consoel",
    });
    expect(built.message).toBe("cloudflare declares no surface consoel — it declares: rest-api, dashboard");
  });
});
