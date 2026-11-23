import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { markIndistinguishablePages, publishTrelicaBrowserSurface } from "../../../../atlas/trelica/browserSurface.js";
import type { TrelicaPageObservation } from "../../../../atlas/trelica/browserWalk.js";
import { TrelicaAtlasErrors } from "../../../../atlas/trelica/errors.js";
import type { TrelicaFirstPartyRun } from "../../../../atlas/trelica/firstPartyRun.js";
import { TRELICA_CALLS } from "../../../../atlas/trelica/inventory.js";
import type { TrelicaAppDetail, TrelicaCoverageCell } from "../../../../atlas/trelica/model.js";
import type { TrelicaPublishedSurface } from "../../../../atlas/trelica/publishedSpec.js";
import { readTrelicaSnapshot } from "../../../../atlas/trelica/readAdapter.js";
import { readTrelicaKindFile, trelicaAtlasPaths } from "../../../../atlas/trelica/store.js";
import { publishTrelicaApiSurfaces } from "../../../../atlas/trelica/sync.js";
import type { TrelicaAiUsageResult } from "../../../../atlas/trelica/usageWalk.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const LATER = "2026-09-05T01:00:00.000Z";
const homes: string[] = [];

/** A throwaway state home this test writes into, and nowhere else. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-trelica-generation-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A published surface holding one operation, and one document the tenant would not serve. */
const SURFACE: TrelicaPublishedSurface = {
  documents: [
    {
      document: "apps",
      operations: [
        {
          bodyParams: [],
          document: "apps",
          httpMethod: "GET",
          operationId: "listApps",
          path: "/api/apps/v1",
          pathParams: [],
          queryParams: ["take"],
          responseFields: ["id", "name"],
          security: ["oauth2"],
          summary: "List applications",
        },
      ],
      securitySchemes: ["oauth2"],
      servers: ["https://trelica.app"],
      title: "SaaS Manager API",
      version: "v1",
    },
  ],
  unreadable: [{ document: "auth", reason: "the tenant answered HTTP 404 for /api/auth/docs/v1/swagger.json" }],
};

/** The window every run here reads the cost explorer over. */
const WINDOW = { endDate: "2026-09-05", startDate: "2024-09-06" };

/** One cost-explorer read by application: one row, charted monthly. */
const APP_USAGE: TrelicaAiUsageResult = {
  dimension: "app",
  granularity: "Monthly",
  path: "/AppsApi/AppAIUsage/UsageByApp",
  rows: [
    {
      customerAppId: "app-1",
      customerAppName: "Example App",
      metrics: {
        cachedInputTokens: 0,
        cachedOutputTokens: 0,
        credits: 0,
        inputTokens: 10,
        linesOfCodeAdded: 0,
        linesOfCodeRemoved: 0,
        outputTokens: 5,
        requests: 2,
        spend: 12.5,
        totalTokens: 15,
      },
    },
  ],
  series: [],
  statusCode: 200,
  stoppedAtFloor: false,
  total: 1,
};

/** What one first-party run returned: an inventory, a catalogue and the roles, and no cost-explorer read. */
function firstPartyRun(): TrelicaFirstPartyRun {
  return {
    entities: { calls: [], reads: [], steps: { firstFailure: null, read: 0, reused: 0, unread: 0 } },
    failures: [],
    usage: [],
    window: WINDOW,
    results: [
      {
        callId: TRELICA_CALLS.appInventory.id,
        httpMethod: "POST",
        items: [{ applicationId: "app-1", name: "Example App", status: "Managed", userCount: 4 }],
        path: TRELICA_CALLS.appInventory.path,
        statusCode: 200,
        total: 1,
      },
      {
        callId: TRELICA_CALLS.appCatalog.id,
        httpMethod: "POST",
        items: [{ id: "app-1", name: "Example App" }],
        path: TRELICA_CALLS.appCatalog.path,
        statusCode: 200,
        total: 1,
      },
      {
        callId: TRELICA_CALLS.roles.id,
        httpMethod: "GET",
        items: [{ id: "role-1", isSystemRole: false, name: "App catalog" }],
        path: TRELICA_CALLS.roles.path,
        statusCode: 200,
        total: 1,
      },
    ],
  };
}

/** One walked page, held and photographed, having observed one first-party call. */
function heldPage(over: Partial<TrelicaPageObservation> = {}): TrelicaPageObservation {
  return {
    artifacts: [
      {
        byteLength: 3,
        kind: "page-png",
        mediaType: "image/png",
        relativePath: "artifacts/pages/aa.png",
        sha256: "a".repeat(64),
      },
    ],
    attempted: true,
    calls: [
      {
        method: "POST",
        pathShape: "/AppsApi/CustomerApp/FilterItems",
        responseFields: ["items[].name", "total"],
        statusCode: 200,
      },
    ],
    captureComplete: true,
    finalUrl: "https://team-example.trelica.app/Catalog",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://team-example.trelica.app/Catalog",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 3 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "catalog",
    title: "App catalog",
    unreachableBecause: null,
    ...over,
  };
}

describe("markIndistinguishablePages", () => {
  it("withdraws both screenshot claims when two declared pages photographed the same bytes", () => {
    const marked = markIndistinguishablePages({
      pages: [heldPage(), heldPage({ surface: "people" })],
    });
    expect(marked.map((page) => page.artifacts.length)).toEqual([0, 0]);
    expect(marked[0]!.screenshotMissingBecause).toContain("byte-identical");
  });

  it("leaves a page alone when its screenshot is its own", () => {
    const other = heldPage({
      artifacts: [
        {
          byteLength: 4,
          kind: "page-png",
          mediaType: "image/png",
          relativePath: "artifacts/pages/bb.png",
          sha256: "b".repeat(64),
        },
      ],
      surface: "people",
    });
    const marked = markIndistinguishablePages({ pages: [heldPage(), other] });
    expect(marked.map((page) => page.artifacts.length)).toEqual([1, 1]);
  });
});

describe("publishTrelicaApiSurfaces", () => {
  it("publishes both API channels onto one generation", () => {
    const home = scratchHome();
    const outcome = unwrap(
      publishTrelicaApiSurfaces({ at: AT, paths: trelicaAtlasPaths({ home }), run: firstPartyRun(), surface: SURFACE }),
    );
    expect(outcome.publishedOperations).toBe(1);
    expect(outcome.apps).toBe(1);
    expect(outcome.roles).toBe(1);
    expect(outcome.publishedDocumentsUnreadable).toBe(1);
  });

  it("keeps the published map and the published DATA as two separate claims", () => {
    const home = scratchHome();
    publishTrelicaApiSurfaces({ at: AT, paths: trelicaAtlasPaths({ home }), run: firstPartyRun(), surface: SURFACE });
    const methods = unwrap(readTrelicaKindFile({ kind: "method", paths: trelicaAtlasPaths({ home }) }))!;
    const map = methods.coverage.find((cell: TrelicaCoverageCell) => cell.surface === "published-api")!;
    const data = methods.coverage.find((cell: TrelicaCoverageCell) => cell.surface === "published-api-data")!;
    expect(map.state).toBe("deferred");
    expect(data.state).toBe("not-configured");
  });

  it("raises a gap naming the document the tenant would not serve", () => {
    const home = scratchHome();
    publishTrelicaApiSurfaces({ at: AT, paths: trelicaAtlasPaths({ home }), run: firstPartyRun(), surface: SURFACE });
    const methods = unwrap(readTrelicaKindFile({ kind: "method", paths: trelicaAtlasPaths({ home }) }))!;
    const gap = methods.gaps.find((entry) => entry.scope === "published-document:auth")!;
    expect(gap.condition).toBe("published-document-unreadable");
    expect(gap.status).toBe("open");
  });

  it("declares the voluminous families rather than pretending they do not exist", () => {
    const home = scratchHome();
    publishTrelicaApiSurfaces({ at: AT, paths: trelicaAtlasPaths({ home }), run: firstPartyRun(), surface: SURFACE });
    const methods = unwrap(readTrelicaKindFile({ kind: "method", paths: trelicaAtlasPaths({ home }) }))!;
    const cell = methods.coverage.find((entry: TrelicaCoverageCell) => entry.surface === "voluminous-families")!;
    expect(cell.state).toBe("excluded");
    expect(cell.reason).toContain("time-series observations");
  });

  it("closes a document gap once the tenant starts serving it", () => {
    const home = scratchHome();
    const paths = trelicaAtlasPaths({ home });
    publishTrelicaApiSurfaces({ at: AT, paths, run: firstPartyRun(), surface: SURFACE });
    const second = publishTrelicaApiSurfaces({
      at: LATER,
      paths,
      run: firstPartyRun(),
      surface: {
        documents: [...SURFACE.documents, { ...SURFACE.documents[0]!, document: "auth" }],
        unreadable: [],
      },
    });
    expect(second.isOk()).toBe(true);
    const methods = unwrap(readTrelicaKindFile({ kind: "method", paths }))!;
    expect(methods.gaps.find((entry) => entry.scope === "published-document:auth")!.status).toBe("closed");
  });

  it("records a refused call as a gap and still publishes what answered", () => {
    const home = scratchHome();
    const run = firstPartyRun();
    publishTrelicaApiSurfaces({
      at: AT,
      paths: trelicaAtlasPaths({ home }),
      run: {
        entities: run.entities,
        failures: [
          {
            callId: TRELICA_CALLS.roles.id,
            error: TrelicaAtlasErrors.callRefused({ callId: "roles", statusCode: 403 }),
          },
        ],
        results: run.results.filter((result) => result.callId !== TRELICA_CALLS.roles.id),
        usage: [],
        window: WINDOW,
      },
      surface: SURFACE,
    });
    const methods = unwrap(readTrelicaKindFile({ kind: "method", paths: trelicaAtlasPaths({ home }) }))!;
    const apps = unwrap(readTrelicaKindFile({ kind: "app", paths: trelicaAtlasPaths({ home }) }))!;
    expect(methods.gaps.some((entry) => entry.scope === "first-party-call:roles")).toBe(true);
    expect(apps.entities.length).toBe(1);
  });

  it("publishes a cost-explorer read as ai-usage rows and stamps the kind in the manifest", () => {
    const home = scratchHome();
    const paths = trelicaAtlasPaths({ home });
    const outcome = unwrap(
      publishTrelicaApiSurfaces({
        at: AT,
        paths,
        run: { ...firstPartyRun(), usage: [APP_USAGE] },
        surface: SURFACE,
      }),
    );
    expect(outcome.aiUsage).toBe(1);
    const usage = unwrap(readTrelicaKindFile({ kind: "ai-usage", paths }))!;
    expect(usage.entities.map((entity) => entity.providerId)).toEqual(["app:app-1"]);
    expect(usage.coverage.find((cell: TrelicaCoverageCell) => cell.surface === "ai-usage:app")!.state).toBe("synced");
    const snapshot = unwrap(readTrelicaSnapshot({ home }));
    expect(snapshot.kinds.find((kind) => kind.kind === "ai-usage")!.entities.length).toBe(1);
  });
});

describe("the two publishers together", () => {
  it("neither blanks the other's rows, on either kind", () => {
    const home = scratchHome();
    const paths = trelicaAtlasPaths({ home });
    publishTrelicaApiSurfaces({ at: AT, paths, run: firstPartyRun(), surface: SURFACE });
    const published = unwrap(
      publishTrelicaBrowserSurface({ at: LATER, paths, walk: { pages: [heldPage()], sessionLost: false } }),
    );
    expect(published.pagesReached).toBe(1);
    const methods = unwrap(readTrelicaKindFile({ kind: "method", paths }))!;
    expect(methods.entities.some((entity) => entity.providerId === "GET /api/apps/v1")).toBe(true);
    expect(methods.entities.some((entity) => entity.providerId === "POST /AppsApi/CustomerApp/FilterItems")).toBe(true);
    const apps = unwrap(readTrelicaKindFile({ kind: "app", paths }))!;
    expect(apps.entities.length).toBe(1);
  });

  it("keeps a walk's coverage cell when a later sync runs", () => {
    const home = scratchHome();
    const paths = trelicaAtlasPaths({ home });
    publishTrelicaBrowserSurface({ at: AT, paths, walk: { pages: [heldPage()], sessionLost: false } });
    publishTrelicaApiSurfaces({ at: LATER, paths, run: firstPartyRun(), surface: SURFACE });
    const methods = unwrap(readTrelicaKindFile({ kind: "method", paths }))!;
    expect(methods.coverage.some((cell: TrelicaCoverageCell) => cell.surface === "web-client-operations")).toBe(true);
    expect(methods.coverage.some((cell: TrelicaCoverageCell) => cell.surface === "published-api")).toBe(true);
  });
});

describe("publishTrelicaBrowserSurface", () => {
  it("reports deferred when a declared page was reached and not photographed", () => {
    const home = scratchHome();
    const published = unwrap(
      publishTrelicaBrowserSurface({
        at: AT,
        paths: trelicaAtlasPaths({ home }),
        walk: {
          pages: [heldPage({ artifacts: [], screenshotMissingBecause: "the browser could not photograph it" })],
          sessionLost: false,
        },
      }),
    );
    expect(published.pagesPhotographed).toBe(0);
    const pages = unwrap(readTrelicaKindFile({ kind: "page", paths: trelicaAtlasPaths({ home }) }))!;
    expect(pages.coverage.find((cell: TrelicaCoverageCell) => cell.surface === "web-app")!.state).toBe("deferred");
  });

  it("carries a permanently open gap saying the vendor publishes no page inventory", () => {
    const home = scratchHome();
    publishTrelicaBrowserSurface({
      at: AT,
      paths: trelicaAtlasPaths({ home }),
      walk: { pages: [heldPage()], sessionLost: false },
    });
    const pages = unwrap(readTrelicaKindFile({ kind: "page", paths: trelicaAtlasPaths({ home }) }))!;
    const gap = pages.gaps.find((entry) => entry.scope === "declared-page-inventory")!;
    expect(gap.condition).toBe("provider-publishes-no-page-inventory");
    expect(gap.status).toBe("open");
  });

  it("a lost session may not close anything the walk did not recheck", () => {
    const home = scratchHome();
    const paths = trelicaAtlasPaths({ home });
    publishTrelicaBrowserSurface({
      at: AT,
      paths,
      walk: { pages: [heldPage({ screenshotMissingBecause: "not photographed", artifacts: [] })], sessionLost: false },
    });
    publishTrelicaBrowserSurface({
      at: LATER,
      paths,
      walk: { pages: [heldPage()], sessionLost: true },
    });
    const pages = unwrap(readTrelicaKindFile({ kind: "page", paths }))!;
    expect(pages.gaps.find((entry) => entry.condition === "browser-screenshot-missing")!.status).toBe("open");
  });
});

describe("readTrelicaSnapshot", () => {
  it("projects every kind, its coverage and its gaps through the generic read seam", () => {
    const home = scratchHome();
    const paths = trelicaAtlasPaths({ home });
    publishTrelicaApiSurfaces({ at: AT, paths, run: firstPartyRun(), surface: SURFACE });
    publishTrelicaBrowserSurface({ at: LATER, paths, walk: { pages: [heldPage()], sessionLost: false } });
    const snapshot = unwrap(readTrelicaSnapshot({ home }));
    expect(snapshot.generation.platform).toBe("trelica");
    expect(snapshot.kinds.map((kind) => kind.kind)).toEqual([
      "access-review",
      "ai-alert",
      "ai-usage",
      "app",
      "assessment",
      "contract",
      "device",
      "integration",
      "method",
      "page",
      "person",
      "role",
      "team",
      "workflow",
      "workflow-run",
    ]);
    expect(snapshot.kinds.find((kind) => kind.kind === "app")!.entities.length).toBe(1);
    expect(snapshot.kinds.find((kind) => kind.kind === "role")!.entities.length).toBe(1);
  });

  it("hands a reader the application detail the projection kept", () => {
    const home = scratchHome();
    publishTrelicaApiSurfaces({ at: AT, paths: trelicaAtlasPaths({ home }), run: firstPartyRun(), surface: SURFACE });
    const snapshot = unwrap(readTrelicaSnapshot({ home }));
    const app = snapshot.kinds.find((kind) => kind.kind === "app")!.entities[0]!;
    expect(app.providerId).toBe("app-1");
    expect((app.detail as TrelicaAppDetail).name).toBe("Example App");
  });

  it("gives a method entity one observation per channel that has actually looked", () => {
    const home = scratchHome();
    const paths = trelicaAtlasPaths({ home });
    publishTrelicaApiSurfaces({ at: AT, paths, run: firstPartyRun(), surface: SURFACE });
    const snapshot = unwrap(readTrelicaSnapshot({ home }));
    const published = snapshot.kinds
      .find((kind) => kind.kind === "method")!
      .entities.find((entity) => entity.providerId === "GET /api/apps/v1")!;
    expect(published.observations.map((observation) => observation.surface)).toEqual(["published-api"]);
  });
});
