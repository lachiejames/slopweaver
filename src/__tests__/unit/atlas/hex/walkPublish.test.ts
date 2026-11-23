import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hexAtlasPaths, readHexAtlas } from "../../../../atlas/hex/store.js";
import type { HexPageObservation, HexWalkResult, ObservedHexCall } from "../../../../atlas/hex/walk.js";
import { outcomeExplanation, walkGaps } from "../../../../atlas/hex/walkGaps.js";
import { projectHexPages } from "../../../../atlas/hex/walkPages.js";
import { callKey, projectHexObservedMethods, publishHexWalk } from "../../../../atlas/hex/walkPublish.js";
import { unwrap } from "../../../../lib/result.js";

import { fixtureTransport } from "./fixture.js";

const AT = "2026-09-07T02:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home. Every write in this file is scoped to one, per `.claude/rules/testing.md`. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-hex-walk-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** One observed call, with only what a test varies overridden. */
function call(over: Partial<ObservedHexCall> = {}): ObservedHexCall {
  return {
    body: { values: [{ id: "p1", title: "a project" }] },
    method: "GET",
    onPage: "/home",
    statusCode: 200,
    url: "https://app.hex.tech/api/v1/projects",
    ...over,
  };
}

/** One visited page, with only what a test varies overridden. */
function page(over: Partial<HexPageObservation> = {}): HexPageObservation {
  return {
    artifacts: [],
    discoveredFrom: null,
    finalUrl: "https://app.hex.tech/home",
    linksRendered: [],
    outcome: "landed",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 3 },
    route: "/home",
    statusCode: 200,
    title: "Home",
    ...over,
  };
}

/** One walk result, with only what a test varies overridden. */
function walk(over: Partial<HexWalkResult> = {}): HexWalkResult {
  return {
    artifactsWritten: 1,
    calls: [call()],
    incompletePages: [],
    notAttempted: [],
    pages: [page()],
    roundsRun: 1,
    sessionEndedAt: null,
    signedOut: false,
    ...over,
  };
}

describe("keying one observed call", () => {
  // Every GraphQL call in the app goes to the same /graphql path, so a path-shaped key would fold 48
  // distinct operations into one row and destroy the comparison `report.ts` exists to make.
  it("folds a GraphQL call on its operation name, and a REST call on its path shape", () => {
    expect(callKey({ call: call({ url: "https://app.hex.tech/graphql?op=OrgDetails" }) })).toBe("GRAPHQL OrgDetails");
    expect(
      callKey({ call: call({ url: "https://app.hex.tech/api/v1/projects/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" }) }),
    ).toBe("GET /api/v1/projects/<uuid>");
  });
});

describe("projecting what the app's own client called", () => {
  it("records the field names of an ordinary configuration read", () => {
    const rows = projectHexObservedMethods({ at: AT, walk: walk() });
    const detail = rows[0]!.channels.browser!.detail as {
      fieldsWithheldBecause: string | null;
      responseFields: string[];
    };

    expect(rows.length).toBe(1);
    expect(detail.responseFields).toEqual(["values", "values[].id", "values[].title"]);
    expect(detail.fieldsWithheldBecause).toBe(null);
  });

  // The pairing is the whole design: the atlas records that Hex has a way to fetch a cell's output, on
  // which page and how often, and holds nothing whatever about the rows that came back.
  it("stores a result-bearing call's existence and NOT its shape, with the reason on the row", () => {
    const observed = walk({
      calls: [
        call({ body: { columns: ["customer_id"], rows: [[1]] }, url: "https://app.hex.tech/api/v1/cells/abc/output" }),
      ],
    });

    const rows = projectHexObservedMethods({ at: AT, walk: observed });
    const detail = rows[0]!.channels.browser!.detail as {
      callCount: number;
      fieldsWithheldBecause: string | null;
      responseFields: string[];
      seenOnPages: string[];
    };

    expect(detail.responseFields).toEqual([]);
    expect(detail.fieldsWithheldBecause).toContain("no customer data locally");
    expect(detail.callCount).toBe(1);
    expect(detail.seenOnPages).toEqual(["/home"]);
  });

  // One call carrying a result set settles the row: describing an operation from its innocent calls would
  // put a result set's shape in the store the first time the same endpoint answered differently.
  it("withholds a whole row when any one of its calls was result-bearing", () => {
    const observed = walk({
      calls: [
        call({ url: "https://app.hex.tech/graphql?op=OutputContentById" }),
        call({ url: "https://app.hex.tech/graphql?op=OutputContentById", onPage: "/settings" }),
      ],
      pages: [page(), page({ finalUrl: "https://app.hex.tech/settings", route: "/settings" })],
    });

    const rows = projectHexObservedMethods({ at: AT, walk: observed });
    const detail = rows[0]!.channels.browser!.detail as {
      fieldsWithheldBecause: string | null;
      responseFields: string[];
    };

    expect(rows.length).toBe(1);
    expect(detail.responseFields).toEqual([]);
    expect(detail.fieldsWithheldBecause).toContain("a cell's output content");
  });

  // A NAME says what the endpoint accepts; the telemetry pattern is what keeps a session token out.
  it("widens the query parameter names across every page that made the same call, telemetry dropped", () => {
    const observed = walk({
      calls: [
        call({ url: "https://app.hex.tech/api/v1/projects?limit=50&csrf=abc" }),
        call({ onPage: "/settings", url: "https://app.hex.tech/api/v1/projects?after=x&limit=10" }),
      ],
      pages: [page(), page({ finalUrl: "https://app.hex.tech/settings", route: "/settings" })],
    });

    const rows = projectHexObservedMethods({ at: AT, walk: observed });
    const detail = rows[0]!.channels.browser!.detail as { parameters: string[]; seenOnPages: string[] };

    expect(rows.length).toBe(1);
    expect(detail.parameters).toEqual(["after", "limit"]);
    expect(detail.seenOnPages).toEqual(["/home", "/settings"]);
  });
});

describe("projecting the pages a walk visited", () => {
  it("says why a page is not held rather than leaving an empty row", () => {
    const rows = projectHexPages({ at: AT, walk: walk({ pages: [page({ artifacts: [], outcome: "redirected" })] }) });
    const detail = rows[0]!.channels.browser!.detail as { unreachableBecause: string | null };

    expect(detail.unreachableBecause).toBe("the app settled somewhere other than the route that was asked for");
    expect(outcomeExplanation({ outcome: "landed" })).toBe(null);
  });
});

describe("the gaps one walk earns", () => {
  // Forty rows saying "redirected" is a reader having to work out for themselves that they are one sign-in.
  it("raises ONE gap for a signed-out walk, naming what was not attempted", () => {
    const gaps = walkGaps({ at: AT, walk: walk({ notAttempted: ["/settings", "/home"], signedOut: true }) });

    expect(gaps.length).toBe(1);
    expect(gaps[0]!.condition).toBe("signed-out");
    expect(gaps[0]!.reason).toContain("2 further declared route(s) were not attempted");
  });

  // `notAttempted` on its own is a silence with a count: it says routes were skipped and not which page
  // caused it.
  it("names the route that reported the session gone, so the unattempted routes have a cause", () => {
    const gaps = walkGaps({
      at: AT,
      walk: walk({ notAttempted: ["/sent", "/welcome"], sessionEndedAt: "/login-success" }),
    });
    const ended = gaps.find((gap) => gap.condition === "session-ended-by-page")!;

    expect(ended.scope).toBe("/login-success");
    expect(ended.reason).toContain("2 further declared route(s) went unattempted");
  });

  it("raises one gap per page when the reasons genuinely differ", () => {
    const gaps = walkGaps({
      at: AT,
      walk: walk({
        pages: [
          page(),
          page({ outcome: "unavailable", route: "/checkout" }),
          page({ outcome: "unphotographed", route: "/sent" }),
        ],
      }),
    });

    expect(gaps.map((gap) => gap.condition)).toEqual(["page-unreachable", "page-unphotographed"]);
  });

  it("states each page gap's reason as its route plus why it is not held", () => {
    const gaps = walkGaps({ at: AT, walk: walk({ pages: [page(), page({ outcome: "unavailable", route: "/c" })] }) });

    expect(gaps.map((gap) => gap.reason)).toEqual(["/c: the app answered an error status for this route"]);
  });
});

describe("publishing a walk", () => {
  it("does not advance the page kind's success when every route hit the wall", async () => {
    const home = scratchHome();
    const paths = hexAtlasPaths({ home });
    const { syncHexApiSurface } = await import("../../../../atlas/hex/syncPublish.js");
    unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));

    unwrap(
      publishHexWalk({ at: AT, paths, walk: walk({ pages: [page({ outcome: "signed-out" })], signedOut: true }) }),
    );
    const snapshot = unwrap(readHexAtlas({ paths }));

    expect(snapshot.manifest!.kinds.page.lastSuccessAt).toBe(null);
    expect(snapshot.manifest!.kinds.page.lastAttempt!.outcome).toBe("failed");
  });

  it("publishes a signed-out walk run after the spec compile, keeping the method clock on the spec leg", async () => {
    const later = "2026-09-08T02:00:00.000Z";
    const home = scratchHome();
    const paths = hexAtlasPaths({ home });
    const { syncHexApiSurface } = await import("../../../../atlas/hex/syncPublish.js");
    unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));

    const outcome = publishHexWalk({
      at: later,
      paths,
      walk: walk({ pages: [page({ outcome: "signed-out" })], signedOut: true }),
    });
    const snapshot = unwrap(readHexAtlas({ paths }));

    expect(outcome.isOk()).toBe(true);
    expect(snapshot.files.method!.updatedAt).toBe(AT);
    expect(snapshot.manifest!.kinds.method.lastSuccessAt).toBe(AT);
    expect(snapshot.manifest!.kinds.method.lastAttempt!.at).toBe(later);
  });

  // A walk's success must outlive a later sync: the sync stamps an attempt on the page kind, never erases it.
  it("carries the page kind's walked success and count forward through a later sync", async () => {
    const walkedAt = "2026-09-08T02:00:00.000Z";
    const resyncedAt = "2026-09-09T02:00:00.000Z";
    const home = scratchHome();
    const paths = hexAtlasPaths({ home });
    const { syncHexApiSurface } = await import("../../../../atlas/hex/syncPublish.js");
    unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));
    unwrap(publishHexWalk({ at: walkedAt, paths, walk: walk() }));

    unwrap(await syncHexApiSurface({ at: resyncedAt, paths, transport: fixtureTransport }));
    const pageStatus = unwrap(readHexAtlas({ paths })).manifest!.kinds.page;

    expect(pageStatus.lastSuccessAt).toBe(walkedAt);
    expect(pageStatus.entityCount).toBe(1);
    expect(pageStatus.lastAttempt!.at).toBe(resyncedAt);
  });
});
