/**
 * The Datadog console walk over two deterministic fakes: the page seam and the console seam.
 *
 * Both are plain objects satisfying their interfaces — injected seams, not mocks — so a redirect, a 404, a
 * lost session, an unrendered screenshot, a failed nav read and a palette that never opened are each settled
 * here rather than by luck in a live run that costs half an hour of the owner's browser.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import type { DatadogConsoleRoute } from "../../../../atlas/datadog/consolePages.js";
import {
  boundedRoutes,
  DATADOG_PALETTE_PAGE,
  outcomeOf,
  settledElsewhere,
  walkDatadogConsole,
} from "../../../../atlas/datadog/consoleWalk.js";
import type { AtlasArtifactWriter } from "../../../../atlas/kit/artifactWriter.js";
import type {
  DatadogConsoleTransport,
  DatadogNavObservation,
  DatadogPaletteObservation,
} from "../../../../browser/datadogConsole.js";
import {
  type BrowserPageTransport,
  type BrowserTransportError,
  BrowserTransportErrors,
  type PageCapture,
} from "../../../../browser/pageTransport.js";
import { unrenderedPng } from "../../../pngFixture.js";
import { capture as sharedCapture, fakeTransport as sharedFakeTransport } from "../../../walkTransportFake.js";

const ORIGIN = "https://ap1.datadoghq.invalid";

const routes: readonly DatadogConsoleRoute[] = [
  { href: "/monitors/manage", label: "Monitor List", posture: "read", section: "monitoring" },
  { href: "/monitors/create", label: "New Monitor", posture: "compose", section: "monitoring" },
  { href: "/logs", label: "Explorer", posture: "read", section: "logs" },
];

/** A capture that landed exactly where it was asked to. */
function landed({ url, responses = [] }: { url: string; responses?: PageCapture["responses"] }): PageCapture {
  return sharedCapture({
    over: {
      responseAccounting: {
        bodyFailed: 0,
        bodySucceeded: responses.length,
        eligible: responses.length,
        seen: responses.length,
      },
      responses,
      title: "Datadog",
    },
    url,
  });
}

/** A transport answering from a script keyed by requested URL, refusing anything the script omits. */
function transportOver({ script }: { script: Readonly<Record<string, PageCapture | BrowserTransportError>> }): {
  transport: BrowserPageTransport;
  released: () => boolean;
} {
  const fake = sharedFakeTransport({
    answer: ({ url }) => {
      const scripted = script[url];
      if (scripted === undefined) {
        return {
          failWith: BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "unscripted",
            url,
          }),
        };
      }
      if ("code" in scripted) {
        return { failWith: scripted };
      }
      return { capture: scripted };
    },
  });
  return { released: () => fake.releases() > 0, transport: fake.transport };
}

const NAV: DatadogNavObservation = {
  finalUrl: `${ORIGIN}/dashboard/lists`,
  hoverErrors: [],
  links: [{ href: "/monitors/manage", label: "Monitor List", section: "Monitoring" }],
  sections: ["Monitoring"],
  title: "Datadog",
};

const PALETTE: DatadogPaletteObservation = {
  dialogOpen: true,
  filterNames: ["Dashboard", "Monitor"],
  finalUrl: `${ORIGIN}/dashboard/lists`,
  keyError: null,
  optionCount: 24,
  responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 3 },
  responses: [
    {
      body: { entities: [{ type: "dashboard" }] },
      method: "POST",
      statusCode: 200,
      url: `${ORIGIN}/api/ui/search/suggestions/entities`,
    },
  ],
  screenshotError: null,
  screenshotPath: null,
  title: "Datadog",
};

/** A console seam answering as scripted, counting its release. */
function consoleOver({
  nav = ok(NAV),
  palette = ok(PALETTE),
}: {
  nav?: ReturnType<DatadogConsoleTransport["observeNav"]>;
  palette?: ReturnType<DatadogConsoleTransport["observePalette"]>;
} = {}): { console: DatadogConsoleTransport; released: () => number } {
  let releases = 0;
  return {
    console: {
      observeNav: () => nav,
      observePalette: () => palette,
      release: () => {
        releases += 1;
      },
    },
    released: () => releases,
  };
}

/** Accept every screenshot without touching disk, so the walk's own accounting is what is under test. */
const keepArtifact: AtlasArtifactWriter = () => ok(null);

const everyPage = (): Readonly<Record<string, PageCapture>> => ({
  [`${ORIGIN}/logs`]: landed({ url: `${ORIGIN}/logs` }),
  [`${ORIGIN}/monitors/create`]: landed({ url: `${ORIGIN}/monitors/create` }),
  [`${ORIGIN}/monitors/manage`]: landed({
    responses: [{ body: { monitors: [] }, method: "GET", statusCode: 200, url: `${ORIGIN}/api/v1/monitor` }],
    url: `${ORIGIN}/monitors/manage`,
  }),
});

describe("outcomeOf", () => {
  it("grades a 404 as not-found, an error as unavailable, a redirect as redirected and a landing as landed", () => {
    const base = landed({ url: `${ORIGIN}/x` });
    expect(outcomeOf({ capture: { ...base, statusCode: 404 } })).toBe("not-found");
    expect(outcomeOf({ capture: { ...base, statusCode: 403 } })).toBe("unavailable");
    expect(outcomeOf({ capture: { ...base, finalUrl: `${ORIGIN}/y` } })).toBe("redirected");
    expect(outcomeOf({ capture: base })).toBe("landed");
  });
});

describe("walkDatadogConsole", () => {
  it("refuses an empty registry rather than reporting full coverage over nothing", async () => {
    const { transport } = transportOver({ script: {} });
    const walked = await walkDatadogConsole({
      console: null,
      limit: null,
      origin: ORIGIN,
      routes: [],
      transport,
      writeArtifact: keepArtifact,
    });
    expect(unwrapErr(walked).code).toBe("CONSOLE_REGISTRY_EMPTY");
    expect(unwrapErr(walked).message).toContain("full coverage over nothing");
  });

  it("records a row for every declared route, the console's calls, and both legs", async () => {
    const { transport, released } = transportOver({ script: everyPage() });
    const seam = consoleOver();
    const value = unwrap(
      await walkDatadogConsole({
        console: seam.console,
        limit: null,
        origin: ORIGIN,
        routes,
        transport,
        writeArtifact: keepArtifact,
      }),
    );

    expect(value.pages.map((page) => `${page.route.href}:${page.outcome}`)).toStrictEqual([
      "/monitors/manage:landed",
      "/monitors/create:landed",
      "/logs:landed",
    ]);
    expect(
      value.requests.map((request) => `${request.method} ${request.pathShape} ← ${request.observedOnPages.join(",")}`),
    ).toStrictEqual([
      `POST /api/ui/search/suggestions/entities ← ${DATADOG_PALETTE_PAGE}`,
      "GET /api/v1/monitor ← /monitors/manage",
    ]);
    expect(value.requests[1]!.registry?.kind).toBe("monitor");
    expect(value.nav).toBe(NAV);
    expect(value.palette).toBe(PALETTE);
    expect(value.artifactsWritten).toBe(3);
    expect(released()).toBe(true);
    expect(seam.released()).toBe(1);
  });

  it("stops visiting on a lost session, records the rest as not attempted, and still takes both legs", async () => {
    const { transport } = transportOver({
      script: {
        ...everyPage(),
        [`${ORIGIN}/monitors/create`]: BrowserTransportErrors.sessionLost({ reason: "signed out" }),
      },
    });
    const value = unwrap(
      await walkDatadogConsole({
        console: consoleOver().console,
        limit: null,
        origin: ORIGIN,
        routes,
        transport,
        writeArtifact: keepArtifact,
      }),
    );

    // The route whose visit lost the session is not-attempted too: nothing about the PAGE was learned.
    expect(value.notAttempted).toStrictEqual(["/monitors/create", "/logs"]);
    expect(value.pages.map((page) => page.outcome)).toStrictEqual(["landed", "not-attempted", "not-attempted"]);
    // An unvisited route measured nothing, so it stores NO accounting rather than a clean-looking zero.
    expect(value.pages.map((page) => page.responseAccounting)).toStrictEqual([
      { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 1 },
      null,
      null,
    ]);
    expect(value.nav).toBe(NAV);
  });

  it("records a single failed visit as failed and carries on", async () => {
    const { transport } = transportOver({
      script: {
        ...everyPage(),
        [`${ORIGIN}/logs`]: BrowserTransportErrors.navigationFailed({
          because: "the fake reported this page unreachable",
          reason: "x",
          url: `${ORIGIN}/logs`,
        }),
      },
    });
    const value = unwrap(
      await walkDatadogConsole({
        console: null,
        limit: null,
        origin: ORIGIN,
        routes,
        transport,
        writeArtifact: keepArtifact,
      }),
    );
    expect(value.pages.map((page) => page.outcome)).toStrictEqual(["landed", "landed", "failed"]);
    expect(value.notAttempted).toStrictEqual([]);
  });

  it("names a page photographed mid-load as unrendered and a page that lost a body as incomplete", async () => {
    const { transport } = transportOver({
      script: {
        ...everyPage(),
        [`${ORIGIN}/logs`]: {
          ...landed({ url: `${ORIGIN}/logs` }),
          responseAccounting: { bodyFailed: 1, bodySucceeded: 0, eligible: 1, seen: 1 },
        },
        [`${ORIGIN}/monitors/create`]: {
          ...landed({ url: `${ORIGIN}/monitors/create` }),
          screenshotPng: unrenderedPng(),
        },
      },
    });
    const value = unwrap(
      await walkDatadogConsole({
        console: null,
        limit: null,
        origin: ORIGIN,
        routes,
        transport,
        writeArtifact: keepArtifact,
      }),
    );
    expect(value.unrenderedPages).toStrictEqual(["/monitors/create"]);
    expect(value.incompletePages).toStrictEqual(["/logs"]);
    expect(value.artifactsWritten).toBe(2);
  });

  it("records a failed nav read and a failed palette as the legs' own errors, never as a walk failure", async () => {
    const { transport } = transportOver({ script: everyPage() });
    const seam = consoleOver({
      nav: err(
        BrowserTransportErrors.navigationFailed({
          because: "the fake reported this page unreachable",
          reason: "nav gone",
          url: ORIGIN,
        }),
      ),
      palette: err(BrowserTransportErrors.sessionLost({ reason: "palette gone" })),
    });
    const value = unwrap(
      await walkDatadogConsole({
        console: seam.console,
        limit: null,
        origin: ORIGIN,
        routes,
        transport,
        writeArtifact: keepArtifact,
      }),
    );
    expect(value.nav).toBe(null);
    expect(value.navError).toContain("nav gone");
    expect(value.palette).toBe(null);
    expect(value.paletteError).toContain("palette gone");
    expect(value.requests.map((request) => request.pathShape)).toStrictEqual(["/api/v1/monitor"]);
    expect(seam.released()).toBe(1);
  });

  it("drops a palette response from off the console origin before it can be recorded", async () => {
    const { transport } = transportOver({ script: everyPage() });
    const seam = consoleOver({
      palette: ok({
        ...PALETTE,
        responses: [{ body: { x: 1 }, method: "GET", statusCode: 200, url: "https://elsewhere.invalid/api/x" }],
      }),
    });
    const value = unwrap(
      await walkDatadogConsole({
        console: seam.console,
        limit: null,
        origin: ORIGIN,
        routes,
        transport,
        writeArtifact: keepArtifact,
      }),
    );
    expect(value.requests.map((request) => request.pathShape)).toStrictEqual(["/api/v1/monitor"]);
  });
});

describe("settledElsewhere — the console's own view state is not a redirect", () => {
  it("grades a page that appended its own defaults as landed", () => {
    const capture = {
      ...landed({ url: `${ORIGIN}/cost/analyze/explorer` }),
      finalUrl: `${ORIGIN}/cost/analyze/explorer?filterRecent=false&start=1786924800000&paused=false`,
    };
    expect(settledElsewhere({ capture })).toBe(false);
    expect(outcomeOf({ capture })).toBe("landed");
  });

  it("grades a different path as the redirect it is", () => {
    const capture = { ...landed({ url: `${ORIGIN}/ci` }), finalUrl: `${ORIGIN}/ci/pipelines/health?group=x` };
    expect(settledElsewhere({ capture })).toBe(true);
    expect(outcomeOf({ capture })).toBe("redirected");
  });

  it("grades a page that DROPPED a parameter the route asked for as a redirect", () => {
    const capture = {
      ...landed({ url: `${ORIGIN}/synthetics/explorer?track=synbatch` }),
      finalUrl: `${ORIGIN}/synthetics/explorer?track=synthetics`,
    };
    expect(settledElsewhere({ capture })).toBe(true);
  });

  it("grades a landing on another origin as a redirect, however its path reads", () => {
    const capture = { ...landed({ url: `${ORIGIN}/logs` }), finalUrl: "https://elsewhere.invalid/logs" };
    expect(settledElsewhere({ capture })).toBe(true);
  });

  it("grades a REPEATED parameter the console kept in full as landed", () => {
    const capture = {
      ...landed({ url: `${ORIGIN}/monitors/manage?status=Alert&status=Warn` }),
      finalUrl: `${ORIGIN}/monitors/manage?status=Alert&status=Warn&paused=false`,
    };
    expect(settledElsewhere({ capture })).toBe(false);
  });

  it("grades a repeated parameter the console kept only once as a redirect", () => {
    const capture = {
      ...landed({ url: `${ORIGIN}/monitors/manage?status=Alert&status=Warn` }),
      finalUrl: `${ORIGIN}/monitors/manage?status=Alert`,
    };
    expect(settledElsewhere({ capture })).toBe(true);
  });

  it("grades a trailing slash as the same address", () => {
    const capture = { ...landed({ url: `${ORIGIN}/logs` }), finalUrl: `${ORIGIN}/logs/` };
    expect(settledElsewhere({ capture })).toBe(false);
  });
});

describe("the walk honours a route's screenshot policy before the visit", () => {
  it("asks the transport not to photograph a withheld page at all", async () => {
    const withheldRoutes: readonly DatadogConsoleRoute[] = [
      { href: "/monitors/manage", label: "Monitor List", posture: "read", section: "monitoring" },
      { href: "/logs", label: "Explorer", photograph: "withheld", posture: "read", section: "logs" },
    ];
    const fake = sharedFakeTransport({
      answer: ({ url }) => ({ capture: landed({ url }) }),
    });
    await walkDatadogConsole({
      console: null,
      limit: null,
      origin: ORIGIN,
      routes: withheldRoutes,
      transport: fake.transport,
      writeArtifact: keepArtifact,
    });

    expect(fake.asked.map((visit) => `${visit.url}:${String(visit.photographed)}`)).toStrictEqual([
      `${ORIGIN}/monitors/manage:true`,
      `${ORIGIN}/logs:false`,
    ]);
  });
});

describe("boundedRoutes", () => {
  it("keeps the whole registry and omits nothing when there is no bound", () => {
    const split = unwrap(boundedRoutes({ limit: null, routes }));

    expect(split.visiting).toStrictEqual(routes);
    expect(split.omitted).toStrictEqual([]);
  });

  it("keeps the prefix a bound asks for and REPORTS the remainder rather than dropping it", () => {
    const split = unwrap(boundedRoutes({ limit: 2, routes }));

    expect(split.visiting.map((route) => route.href)).toStrictEqual(["/monitors/manage", "/monitors/create"]);
    expect(split.omitted.map((route) => route.href)).toStrictEqual(["/logs"]);
  });

  it("omits nothing when the bound is larger than the registry", () => {
    const split = unwrap(boundedRoutes({ limit: 99, routes }));

    expect(split.visiting).toStrictEqual(routes);
    expect(split.omitted).toStrictEqual([]);
  });

  it("refuses a bound that would keep no route at all, naming the flag", () => {
    const refused = unwrapErr(boundedRoutes({ limit: 0, routes }));

    expect(refused.code).toBe("CONSOLE_LIMIT_EMPTY");
    expect(refused.message).toContain("keeps no console route");
  });
});

describe("walkDatadogConsole under a --limit", () => {
  it("visits only the bound and carries the routes it never asked for on the result", async () => {
    const fake = sharedFakeTransport({ answer: ({ url }) => ({ capture: landed({ url }) }) });
    const walked = unwrap(
      await walkDatadogConsole({
        console: null,
        limit: 1,
        origin: ORIGIN,
        routes,
        transport: fake.transport,
        writeArtifact: keepArtifact,
      }),
    );

    expect(fake.asked.map((visit) => visit.url)).toStrictEqual([`${ORIGIN}/monitors/manage`]);
    expect(walked.pages.map((page) => page.route.href)).toStrictEqual(["/monitors/manage"]);
    expect(walked.omitted).toStrictEqual(["/monitors/create", "/logs"]);
    // A bound is not a lost session, and the two carry different remedies.
    expect(walked.notAttempted).toStrictEqual([]);
  });

  it("omits nothing on an unbounded walk, so a whole run can still publish as complete", async () => {
    const fake = sharedFakeTransport({ answer: ({ url }) => ({ capture: landed({ url }) }) });
    const walked = unwrap(
      await walkDatadogConsole({
        console: null,
        limit: null,
        origin: ORIGIN,
        routes,
        transport: fake.transport,
        writeArtifact: keepArtifact,
      }),
    );

    expect(walked.pages.length).toBe(3);
    expect(walked.omitted).toStrictEqual([]);
  });
});
