/**
 * The kit's normalized read view: selection, the plain-text query, staleness and paging.
 *
 * Every fixture is a plain object rather than a real generation, because the functions under test are pure
 * over the view — what a platform's adapter builds from its own store is that adapter's own test.
 */
import { describe, expect, it } from "vitest";

import { ATLAS_COVERAGE_STATES } from "../../../../atlas/kit/contract.js";
import { coverageStatesWorstLast } from "../../../../atlas/kit/coverageOrder.js";
import { type AtlasEntityView, type AtlasKindView, AtlasReadErrors } from "../../../../atlas/kit/read.js";
import { entityIsCurrent, entityMatchesQuery, selectEntities } from "../../../../atlas/kit/selectEntities.js";

/**
 * One entity view, with everything defaulted so a test names only what it is about.
 *
 * @param over the fields this test cares about
 * @returns the entity view
 */
function entity(over: Partial<AtlasEntityView> = {}): AtlasEntityView {
  return {
    detail: null,
    id: "id-1",
    kind: "access-application",
    observations: [
      {
        artifacts: [],
        deepLink: null,
        deepLinkStatus: "unverified",
        endpoint: "access-applications-list",
        observedAt: "2026-09-01T00:00:00.000Z",
        state: "observed",
        surface: "rest-api",
      },
    ],
    providerId: "provider-1",
    scope: "account/abc",
    ...over,
  };
}

/**
 * One kind view holding the given entities.
 *
 * @param kind the kind name
 * @param entities the entities it holds
 * @returns the kind view
 */
function kindView({ kind, entities }: { kind: string; entities: readonly AtlasEntityView[] }): AtlasKindView {
  return {
    coverage: [],
    entities,
    gaps: [],
    kind,
    lastSuccessAt: "2026-09-01T00:00:00.000Z",
    latestAttemptFailed: false,
    permissionBlocked: null,
    publishedCount: entities.length,
  };
}

describe("entityIsCurrent", () => {
  it("is true when any observation is observed", () => {
    expect(entityIsCurrent({ entity: entity() })).toBe(true);
  });

  it("is false when every observation is stale", () => {
    const stale = entity({
      observations: [
        {
          artifacts: [],
          deepLink: null,
          deepLinkStatus: "unverified",
          endpoint: "e",
          observedAt: "2026-09-01T00:00:00.000Z",
          state: "stale",
          surface: "rest-api",
        },
      ],
    });
    expect(entityIsCurrent({ entity: stale })).toBe(false);
  });
});

describe("entityMatchesQuery", () => {
  it("requires EVERY token to appear, not just one", () => {
    const target = entity({ detail: { name: "staging gateway" }, providerId: "app-7" });
    expect(entityMatchesQuery({ entity: target, query: "staging gateway" })).toBe(true);
    expect(entityMatchesQuery({ entity: target, query: "staging missing" })).toBe(false);
  });

  it("matches case-insensitively across provider id, scope, kind and detail leaves", () => {
    const target = entity({ detail: { nested: { deep: "PayRoll" } }, providerId: "APP-9", scope: "account/XYZ" });
    expect(entityMatchesQuery({ entity: target, query: "app-9" })).toBe(true);
    expect(entityMatchesQuery({ entity: target, query: "xyz" })).toBe(true);
    expect(entityMatchesQuery({ entity: target, query: "payroll" })).toBe(true);
    expect(entityMatchesQuery({ entity: target, query: "access-application" })).toBe(true);
  });

  it("treats regex metacharacters as literal text rather than a pattern", () => {
    const target = entity({ detail: { pattern: "a(b)c" } });
    expect(entityMatchesQuery({ entity: target, query: "a(b)c" })).toBe(true);
    expect(entityMatchesQuery({ entity: target, query: ".*" })).toBe(false);
  });

  it("matches everything when the query is only whitespace", () => {
    expect(entityMatchesQuery({ entity: entity(), query: "   " })).toBe(true);
  });
});

describe("selectEntities", () => {
  const many = Array.from({ length: 5 }, (_, index) =>
    entity({ id: `id-${String(index)}`, providerId: `p-${String(index)}` }),
  );

  it("returns every entity when nothing narrows, sorted by kind then id", () => {
    const page = selectEntities({
      kinds: [kindView({ entities: [many[1]!, many[0]!], kind: "access-application" })],
      selection: {},
    });
    expect(page.entities.map((one) => one.id)).toEqual(["id-0", "id-1"]);
    expect(page.matched).toBe(2);
    expect(page.truncated).toBe(false);
    expect(page.nextAfter).toBe(null);
  });

  it("pages with a cursor that resumes exactly after the last entity returned", () => {
    const kinds = [kindView({ entities: many, kind: "access-application" })];
    const first = selectEntities({ kinds, selection: { limit: 2 } });
    expect(first.entities.map((one) => one.id)).toEqual(["id-0", "id-1"]);
    expect(first.truncated).toBe(true);
    expect(first.nextAfter).toBe("id-1");
    expect(first.matched).toBe(5);

    const second = selectEntities({ kinds, selection: { after: first.nextAfter!, limit: 2 } });
    expect(second.entities.map((one) => one.id)).toEqual(["id-2", "id-3"]);
    expect(second.nextAfter).toBe("id-3");

    const last = selectEntities({ kinds, selection: { after: "id-3", limit: 2 } });
    expect(last.entities.map((one) => one.id)).toEqual(["id-4"]);
    expect(last.truncated).toBe(false);
    expect(last.nextAfter).toBe(null);
  });

  it("reports `matched` as the census, not the page — so a page is never quoted as a count", () => {
    const page = selectEntities({
      kinds: [kindView({ entities: many, kind: "access-application" })],
      selection: { limit: 1 },
    });
    expect(page.entities.length).toBe(1);
    expect(page.matched).toBe(5);
  });

  it("hides entities no surface has seen recently unless includeStale is set", () => {
    const stale = entity({
      id: "id-stale",
      observations: [
        {
          artifacts: [],
          deepLink: null,
          deepLinkStatus: "unverified",
          endpoint: "e",
          observedAt: "2026-09-01T00:00:00.000Z",
          state: "stale",
          surface: "rest-api",
        },
      ],
    });
    const kinds = [kindView({ entities: [entity(), stale], kind: "access-application" })];
    expect(selectEntities({ kinds, selection: {} }).matched).toBe(1);
    expect(selectEntities({ kinds, selection: { includeStale: true } }).matched).toBe(2);
  });

  it("matches --id against either the atlas id or the provider id", () => {
    const kinds = [kindView({ entities: [entity({ id: "atlas-1", providerId: "cf-1" })], kind: "zone" })];
    expect(selectEntities({ kinds, selection: { id: "atlas-1" } }).matched).toBe(1);
    expect(selectEntities({ kinds, selection: { id: "cf-1" } }).matched).toBe(1);
    expect(selectEntities({ kinds, selection: { id: "nope" } }).matched).toBe(0);
  });

  it("narrows to entities a named surface actually observed", () => {
    const browserSeen = entity({
      id: "id-browser",
      observations: [
        {
          artifacts: [],
          deepLink: "https://example.test/x",
          deepLinkStatus: "browser-discovered",
          endpoint: "/x",
          observedAt: "2026-09-01T00:00:00.000Z",
          state: "observed",
          surface: "browser",
        },
      ],
    });
    const kinds = [kindView({ entities: [entity(), browserSeen], kind: "method" })];
    expect(selectEntities({ kinds, selection: { surface: "browser" } }).entities.map((one) => one.id)).toEqual([
      "id-browser",
    ]);
    expect(selectEntities({ kinds, selection: { surface: "rest-api" } }).entities.map((one) => one.id)).toEqual([
      "id-1",
    ]);
  });

  it("clamps a limit above the ceiling instead of returning an unbounded page", () => {
    const page = selectEntities({
      kinds: [kindView({ entities: many, kind: "access-application" })],
      selection: { limit: 100000 },
    });
    expect(page.entities.length).toBe(5);
    expect(page.truncated).toBe(false);
  });

  it("sorts across kinds by kind first, so a multi-kind page is stable", () => {
    const page = selectEntities({
      kinds: [
        kindView({ entities: [entity({ id: "z-1", kind: "zone" })], kind: "zone" }),
        kindView({ entities: [entity({ id: "a-1", kind: "access-application" })], kind: "access-application" }),
      ],
      selection: {},
    });
    expect(page.entities.map((one) => one.kind)).toEqual(["access-application", "zone"]);
  });
});

describe("coverageStatesWorstLast", () => {
  it("ends on the states a reader most needs to see", () => {
    const order = coverageStatesWorstLast();
    expect(order.at(0)).toBe("synced");
    expect(order.at(-1)).toBe("unreadable");
  });

  it("covers every closed coverage state exactly once", () => {
    const order = coverageStatesWorstLast();
    expect(new Set(order).size).toBe(order.length);
    expect(order.length).toBe(8);
    expect(order.toSorted()).toEqual(ATLAS_COVERAGE_STATES.toSorted());
  });

  it("prints held-elsewhere at the good end, beside synced rather than beside a failure", () => {
    const order = coverageStatesWorstLast();
    expect(order.at(1)).toBe("held-elsewhere");
  });
});

describe("AtlasReadErrors", () => {
  it("names the platforms a caller could have meant", () => {
    const error = AtlasReadErrors.platformUnknown({ known: ["cloudflare", "vanta"], platform: "clouflare" });
    expect(error.code).toBe("ATLAS_PLATFORM_UNKNOWN");
    expect(error.message).toBe("no atlas for platform clouflare — this build has: cloudflare, vanta");
  });

  it("names the kinds a platform declares when one is unknown", () => {
    const error = AtlasReadErrors.kindUnknown({ kind: "gateway-policy", known: ["zone"], platform: "cloudflare" });
    expect(error.code).toBe("ATLAS_KIND_UNKNOWN");
    expect(error.message).toBe("cloudflare has no kind gateway-policy — it declares: zone");
  });

  it("carries every reason a store refused, joined for display", () => {
    const error = AtlasReadErrors.storeUnreadable({ platform: "cloudflare", reasons: ["a", "b"] });
    expect(error.code).toBe("ATLAS_STORE_UNREADABLE");
    expect(error.message).toBe("the cloudflare atlas could not be read: a; b");
    expect(error.reasons).toEqual(["a", "b"]);
  });
});
