/**
 * Publishing a console walk into a real generation in a throwaway home: the two console kinds, the console
 * channel folded onto the registry operations the console called, the gaps, and what the descriptor then
 * derives. A compiled sync runs first, because the corroboration lands on entities the catalogue made.
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { summariseOutcomes } from "../../../../atlas/datadog/consoleGaps.js";
import { DATADOG_CONSOLE_ROUTES } from "../../../../atlas/datadog/consolePages.js";
import { paletteBuckets } from "../../../../atlas/datadog/consolePalette.js";
import { reduceDatadogConsoleCalls } from "../../../../atlas/datadog/consoleReduction.js";
import { publishDatadogConsoleWalk } from "../../../../atlas/datadog/consoleSurface.js";
import type { DatadogWalkResult } from "../../../../atlas/datadog/consoleWalk.js";
import type { DatadogConsolePage, DatadogConsoleRequest } from "../../../../atlas/datadog/documents.js";
import { readDatadogSnapshot } from "../../../../atlas/datadog/readAdapter.js";
import { readDatadogAtlas } from "../../../../atlas/datadog/store.js";
import { datadogConsoleFill } from "../../../../atlas/datadog/surfaceFill.js";
import { syncDatadogCatalogue } from "../../../../atlas/datadog/sync.js";

const AT = "2026-09-16T01:00:00.000Z";
const ORIGIN = "https://ap1.datadoghq.invalid";

let home = "";

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "dd-console-"));
  unwrap(syncDatadogCatalogue({ at: AT, home }));
}, 60_000);

afterAll(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Every declared route, each landed, so a walk over the whole denominator can be published. */
function everyRouteLanded(): DatadogWalkResult["pages"] {
  return DATADOG_CONSOLE_ROUTES.map((route) => ({
    artifacts: [],
    finalUrl: `${ORIGIN}${route.href}`,
    outcome: "landed" as const,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 5 },
    route,
    statusCode: 200,
    title: route.label,
  }));
}

/** A walk that reached everything, re-read a nav matching the list, and opened the palette. */
function completeWalk({ over = {} }: { over?: Partial<DatadogWalkResult> } = {}): DatadogWalkResult {
  const requests = reduceDatadogConsoleCalls({
    calls: [
      {
        body: { monitors: [{ id: 1 }] },
        method: "GET",
        onPage: "/monitors/manage",
        statusCode: 200,
        url: `${ORIGIN}/api/v1/monitor`,
      },
      {
        body: { data: [] },
        method: "GET",
        onPage: "/organization-settings/users",
        statusCode: 200,
        url: `${ORIGIN}/api/v2/users`,
      },
      {
        body: { entities: [{ type: "dashboard" }, { type: "dashboard" }, { type: "monitor" }] },
        method: "POST",
        onPage: "cmd-k",
        statusCode: 200,
        url: `${ORIGIN}/api/ui/search/suggestions/entities`,
      },
    ],
  });
  return {
    artifactsWritten: 0,
    finalUrls: DATADOG_CONSOLE_ROUTES.map((route) => `${ORIGIN}${route.href}`),
    incompletePages: [],
    nav: {
      finalUrl: `${ORIGIN}/dashboard/lists`,
      hoverErrors: [],
      links: DATADOG_CONSOLE_ROUTES.map((route) => ({ href: route.href, label: route.label, section: route.section })),
      sections: [...new Set(DATADOG_CONSOLE_ROUTES.map((route) => route.section))],
      title: "Datadog",
    },
    navError: null,
    notAttempted: [],
    omitted: [],
    pages: everyRouteLanded(),
    palette: {
      dialogOpen: true,
      filterNames: ["Dashboard", "Monitor"],
      finalUrl: `${ORIGIN}/dashboard/lists`,
      keyError: null,
      optionCount: 24,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 1 },
      responses: [
        {
          body: { entities: [{ type: "dashboard" }, { type: "dashboard" }, { type: "monitor" }] },
          method: "POST",
          statusCode: 200,
          url: `${ORIGIN}/api/ui/search/suggestions/entities`,
        },
      ],
      screenshotError: null,
      screenshotPath: null,
      title: "Datadog",
    },
    paletteError: null,
    requests,
    unrenderedPages: [],
    ...over,
  };
}

describe("paletteBuckets", () => {
  it("counts the palette's entities by their kind and never keeps a name", () => {
    const reduced = paletteBuckets({
      body: { entities: [{ name: "Quinn", type: "dashboard" }, { type: "monitor" }, { type: "dashboard" }] },
    });
    expect(reduced).toStrictEqual({
      bodyRead: true,
      buckets: [
        { bucket: "dashboard", count: 2 },
        { bucket: "monitor", count: 1 },
      ],
      pageHrefs: [],
      unreadShape: [],
    });
    expect(JSON.stringify(reduced)).not.toContain("Quinn");
  });

  it("reports the body's top-level fields when it finds no list, rather than throwing", () => {
    expect(paletteBuckets({ body: { meta: {}, page: 1 } })).toStrictEqual({
      bodyRead: false,
      buckets: [],
      pageHrefs: [],
      unreadShape: ["meta", "page"],
    });
    expect(paletteBuckets({ body: "text" })).toStrictEqual({
      bodyRead: false,
      buckets: [],
      pageHrefs: [],
      unreadShape: [],
    });
  });

  it("keeps a page entry's ADDRESS and nothing else, reading the measured JSON:API envelope", () => {
    const body = {
      data: {
        attributes: {
          entities: [
            { title: "Monitor List", type: "page", url: "/monitors/manage" },
            { title: "Somewhere new", type: "page", url: "/brand/new?from-top-level-nav=true" },
            { name: "Quinn", type: "dashboard", url: "/dashboard/abc-def-ghi/quinn" },
          ],
        },
      },
    };
    const reduced = paletteBuckets({ body });
    expect(reduced.pageHrefs).toStrictEqual(["/brand/new", "/monitors/manage"]);
    expect(JSON.stringify(reduced)).not.toContain("quinn");
  });
});

describe("summariseOutcomes", () => {
  it("tallies outcomes in a stable order", () => {
    const walk = completeWalk({
      over: { pages: [...everyRouteLanded().slice(0, 2), { ...everyRouteLanded()[2]!, outcome: "redirected" }] },
    });
    expect(summariseOutcomes({ walk })).toBe("landed×2, redirected×1");
  });
});

describe("publishDatadogConsoleWalk", () => {
  it("publishes both console kinds, corroborates the kinds the console called, and fills the surface", () => {
    const outcome = unwrap(publishDatadogConsoleWalk({ at: AT, home, origin: ORIGIN, walk: completeWalk() }));

    expect(outcome.pageCount).toBe(DATADOG_CONSOLE_ROUTES.length);
    expect(outcome.landedCount).toBe(DATADOG_CONSOLE_ROUTES.length);
    expect(outcome.requestCount).toBe(3);
    expect(outcome.corroboratedKinds).toStrictEqual(["monitor", "users"]);
    expect(outcome.navDrift).toStrictEqual({ gone: [], undeclared: [] });
    expect(outcome.palette?.buckets).toStrictEqual([
      { bucket: "dashboard", count: 2 },
      { bucket: "monitor", count: 1 },
    ]);

    const snapshot = unwrap(readDatadogAtlas({ home }));
    const pages = snapshot.files["console-page"]!;
    expect(pages.entities.length).toBe(DATADOG_CONSOLE_ROUTES.length);
    const first = pages.entities.find((entity) => entity.providerId === "/monitors/manage")!;
    // `as`: the detail is what this run just wrote, and the test asserts its exact fields below.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const detail = first.channels.console!.detail as DatadogConsolePage;
    expect(detail.outcome).toBe("landed");
    expect(detail.section).toBe("monitoring");
    // Carried through verbatim rather than recomputed: a page that dropped bodies reads exactly like one
    // that kept them all unless the row says how many were seen against how many were kept.
    expect(detail.responseAccounting).toStrictEqual({ bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 5 });
    expect(first.channels.console!.source!.deepLink).toBe(`${ORIGIN}/monitors/manage`);
    expect(pages.coverage.find((cell) => cell.surface === "console")!.state).toBe("synced");
    expect(pages.gaps.filter((gap) => gap.status === "open")).toStrictEqual([]);

    const requests = snapshot.files["console-request"]!;
    const palette = requests.entities.find(
      (entity) => entity.providerId === "POST /api/ui/search/suggestions/entities",
    )!;
    // oxlint-disable-next-line no-unsafe-type-assertion
    const paletteDetail = palette.channels.console!.detail as DatadogConsoleRequest;
    expect(paletteDetail.registryOperation).toBe(null);
    expect(paletteDetail.observedOnPages).toStrictEqual(["cmd-k"]);
    expect(paletteDetail.responseFieldPaths).toStrictEqual(["entities", "entities[].type"]);

    const monitor = snapshot.files["monitor"]!;
    const listed = monitor.entities.find((entity) => entity.providerId === "v1-monitors-list-monitors")!;
    expect(listed.channels.console!.channel).toBe("console");
    expect(listed.channels["compiled-catalogue"]!.state).toBe("observed");
    expect(monitor.coverage.find((cell) => cell.surface === "console")!.state).toBe("synced");
    expect(monitor.gaps.find((gap) => gap.condition === "console-never-walked")!.status).toBe("closed");
    expect(snapshot.files["dashboard"]!.gaps.find((gap) => gap.condition === "console-never-walked")!.status).toBe(
      "open",
    );

    const fill = datadogConsoleFill({ files: snapshot.files });
    expect(fill).toStrictEqual({
      complete: true,
      filled: true,
      landed: DATADOG_CONSOLE_ROUTES.length,
      navChecked: true,
      navDrifted: false,
      reason: pages.coverage.find((cell) => cell.surface === "console")!.reason,
      walked: true,
    });
    const read = unwrap(readDatadogSnapshot({ home }));
    const surface = read.descriptor.surfaces.find((one) => one.name === "console")!;
    expect(surface.status).toBe("filled");
    expect(surface.denominator).toStrictEqual({
      exists: DATADOG_CONSOLE_ROUTES.length,
      known: true,
      reached: DATADOG_CONSOLE_ROUTES.length,
      source: expect.stringContaining("left nav"),
    });
  });

  it("keeps the walk's console cell and closure across a later compiled sync", () => {
    unwrap(syncDatadogCatalogue({ at: "2026-09-16T02:00:00.000Z", home }));
    const snapshot = unwrap(readDatadogAtlas({ home }));
    expect(snapshot.files["monitor"]!.coverage.find((cell) => cell.surface === "console")!.state).toBe("synced");
    expect(snapshot.files["monitor"]!.gaps.find((gap) => gap.condition === "console-never-walked")!.status).toBe(
      "closed",
    );
    expect(snapshot.files["console-page"]!.entities.length).toBe(DATADOG_CONSOLE_ROUTES.length);
  });

  it("grades a partial walk deferred, raises the gaps it earned, and leaves the surface unfilled", () => {
    const pages = everyRouteLanded();
    const partial = completeWalk({
      over: {
        finalUrls: [`${ORIGIN}/somewhere/else`],
        nav: null,
        navError: "the nav could not be hovered",
        notAttempted: pages.slice(2).map((page) => page.route.href),
        pages: [
          { ...pages[0]!, finalUrl: `${ORIGIN}/somewhere/else`, outcome: "redirected" },
          { ...pages[1]!, outcome: "not-found", statusCode: 404 },
          ...pages
            .slice(2)
            .map((page) => ({ ...page, finalUrl: null, outcome: "not-attempted" as const, statusCode: null })),
        ],
        palette: null,
        paletteError: "the chord did nothing",
        requests: [],
        unrenderedPages: [],
      },
    });
    const outcome = unwrap(
      publishDatadogConsoleWalk({ at: "2026-09-16T03:00:00.000Z", home, origin: ORIGIN, walk: partial }),
    );

    expect(outcome.landedCount).toBe(0);
    expect(outcome.attemptedCount).toBe(2);
    expect(outcome.undeclaredCount).toBe(1);
    expect(outcome.navDrift).toBe(null);
    const snapshot = unwrap(readDatadogAtlas({ home }));
    const pageFile = snapshot.files["console-page"]!;
    expect(pageFile.coverage.find((cell) => cell.surface === "console")!.state).toBe("deferred");
    expect(
      pageFile.gaps
        .filter((gap) => gap.status === "open")
        .map((gap) => gap.condition)
        .toSorted(),
    ).toStrictEqual(["console-nav-unread", "console-page-unreachable", "console-route-undeclared"]);
    expect(
      snapshot.files["console-request"]!.gaps.filter((gap) => gap.status === "open").map((gap) => gap.condition),
    ).toStrictEqual(["console-palette-unread"]);
    const fill = datadogConsoleFill({ files: snapshot.files });
    expect(fill.filled).toBe(false);
    expect(fill.complete).toBe(false);
    expect(fill.navChecked).toBe(false);
    const surface = unwrap(readDatadogSnapshot({ home })).descriptor.surfaces.find((one) => one.name === "console")!;
    expect(surface.status).toBe("declared-unfilled");
    expect(surface.unfilledBecause).toContain("did not attempt every declared route");
    expect(surface.unfilledBecause).toContain("could not be re-read");
  });

  it("raises nav drift in both directions when the live nav disagrees with the list", () => {
    const drifted = completeWalk();
    const walk: DatadogWalkResult = {
      ...drifted,
      nav: {
        ...drifted.nav!,
        links: [
          ...drifted.nav!.links.filter((link) => link.href !== "/logs"),
          { href: "/brand-new", label: "New", section: "logs" },
        ],
      },
    };
    const outcome = unwrap(publishDatadogConsoleWalk({ at: "2026-09-16T04:00:00.000Z", home, origin: ORIGIN, walk }));

    expect(outcome.navDrift).toStrictEqual({ gone: ["/logs"], undeclared: ["/brand-new"] });
    const snapshot = unwrap(readDatadogAtlas({ home }));
    const drift = snapshot.files["console-page"]!.gaps.find((gap) => gap.condition === "console-nav-drifted")!;
    expect(drift.status).toBe("open");
    expect(drift.reason).toContain("/brand-new");
    expect(drift.reason).toContain("/logs");
    expect(datadogConsoleFill({ files: snapshot.files }).navDrifted).toBe(true);
  });

  it("grades a --limit walk deferred, naming the bound rather than the session", () => {
    // The regression this holds down: `--limit` used to slice the registry in the CLI, so the walk only
    // ever saw the prefix, `notAttempted` came back empty, and `walkTally` read that as a whole console. A
    // three-page smoke run published `synced` over every declared page — the exact failure `walkRun.ts`'s
    // own header says the flag must not produce.
    const pages = everyRouteLanded();
    const bounded = completeWalk({
      over: {
        finalUrls: pages.slice(0, 3).map((page) => `${ORIGIN}${page.route.href}`),
        notAttempted: [],
        omitted: pages.slice(3).map((page) => page.route.href),
        pages: pages.slice(0, 3),
      },
    });
    const outcome = unwrap(
      publishDatadogConsoleWalk({ at: "2026-09-16T05:00:00.000Z", home, origin: ORIGIN, walk: bounded }),
    );

    expect(outcome.attemptedCount).toBe(3);
    expect(outcome.landedCount).toBe(3);
    const unvisited = String(pages.length - 3);
    const cell = unwrap(readDatadogAtlas({ home })).files["console-page"]!.coverage.find(
      (held) => held.surface === "console",
    )!;
    expect(cell.state).toBe("deferred");
    expect(cell.unblockedBy).toBe(
      `slopweaver atlas datadog walk: re-running it without --limit, which left ${unvisited} declared page(s) unvisited`,
    );
    expect(cell.reason).toContain(`--limit left ${unvisited} declared page(s) unvisited this run`);
    expect(datadogConsoleFill({ files: unwrap(readDatadogAtlas({ home })).files }).complete).toBe(false);
  });

  it("grades a CORROBORATED registry kind deferred under a bound too, not just the two console kinds", () => {
    // Counterexample: `consoleKindFold` was graded by the tally while `corroboratedFold` still
    // hard-coded `complete: true`, so a bounded walk that happened to call `GET /api/v1/monitor` on one of
    // the pages it DID open published `monitor`'s console cell as `synced` — the same overstatement, one
    // publishing path over, and invisible to a regression that only reads `console-page`.
    const pages = everyRouteLanded();
    const monitorsPage = pages.find((page) => page.route.href === "/monitors/manage")!;
    const bounded = completeWalk({
      over: {
        notAttempted: [],
        omitted: pages.filter((page) => page.route.href !== "/monitors/manage").map((page) => page.route.href),
        pages: [monitorsPage],
      },
    });
    unwrap(publishDatadogConsoleWalk({ at: "2026-09-16T06:00:00.000Z", home, origin: ORIGIN, walk: bounded }));

    const monitor = unwrap(readDatadogAtlas({ home })).files["monitor"]!;
    const cell = monitor.coverage.find((held) => held.surface === "console")!;
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toContain("this is a floor, not this kind's console total");
    expect(cell.unblockedBy).toContain("without --limit");
  });
});
