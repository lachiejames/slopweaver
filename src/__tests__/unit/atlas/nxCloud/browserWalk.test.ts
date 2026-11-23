import { describe, expect, it } from "vitest";

import { UNRENDERED_SCREENSHOT_BECAUSE } from "../../../../atlas/kit/browserWalk.js";
import {
  isRouteHeld,
  markIndistinguishableRoutes,
  type NxCloudRouteObservation,
  nxCloudRouteOutcome,
} from "../../../../atlas/nxCloud/browserObservation.js";
import { nxCloudScreenshotArtifact, walkNxCloudBrowser } from "../../../../atlas/nxCloud/browserWalk.js";
import {
  type BrowserPageTransport,
  BrowserTransportErrors,
  type PageCapture,
} from "../../../../browser/pageTransport.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";
import { renderedPng, unrenderedPng } from "../../../pngFixture.js";
import { capture as sharedCapture, fakeTransport as sharedFakeTransport } from "../../../walkTransportFake.js";

const ORIGIN = "https://cloud.nx.app";
const SCOPE = { orgId: "aaaaaaaaaaaaaaaaaaaaaaaa", workspaceId: "bbbbbbbbbbbbbbbbbbbbbbbb" };
const PNG = renderedPng({ seed: 1 });
const OTHER_PNG = renderedPng({ seed: 2 });

/** What is NX CLOUD's about a capture, over the shared fake's own defaults: one data call per page. */
const NX_PAGE: Partial<PageCapture> = {
  responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 1 },
  screenshotPng: PNG,
  title: "Overview",
};

/** A capture with everything a healthy page has, overridable field by field. */
function capture({ url, over = {} }: { url: string; over?: Partial<PageCapture> }): PageCapture {
  return sharedCapture({ over: { ...NX_PAGE, ...over }, url });
}

/**
 * A deterministic transport: it answers from a table of captures keyed by the path asked for, and records
 * what it was asked. Not a mock — a plain fake, per `.claude/rules/testing.md`.
 */
function fakeTransport({
  captures,
  failWith,
}: {
  captures: Readonly<Record<string, PageCapture>>;
  failWith?: Readonly<Record<string, "SESSION_LOST" | "NAVIGATION_FAILED">>;
}): { transport: BrowserPageTransport; visited: readonly string[] } {
  const fake = sharedFakeTransport({
    answer: ({ url }) => {
      const path = new URL(url).pathname;
      const failure = failWith === undefined ? undefined : failWith[path];
      if (failure === "SESSION_LOST") {
        return { failWith: BrowserTransportErrors.sessionLost({ reason: "signed out" }) };
      }
      if (failure === "NAVIGATION_FAILED") {
        return {
          failWith: BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "timeout",
            url,
          }),
        };
      }
      const scripted = captures[path];
      if (scripted === undefined) {
        return { capture: NX_PAGE };
      }
      return { capture: scripted };
    },
  });
  return { transport: fake.transport, visited: fake.visited };
}

/** A writer that always succeeds, for the cases that are not about writing. */
const acceptingWriter = (): Result<null> => ok(null);

describe("nxCloudRouteOutcome", () => {
  it("holds a page that answered 200 at the address it was asked for", () => {
    const url = `${ORIGIN}/orgs/x/workspaces/y/overview`;
    expect(nxCloudRouteOutcome({ capture: capture({ url }), requestedUrl: url }).unreachableBecause).toBe(null);
  });

  it("records a 403 as a bound on the atlas rather than an absence in the platform", () => {
    const url = `${ORIGIN}/orgs/x/workspaces/y/settings`;
    const outcome = nxCloudRouteOutcome({ capture: capture({ over: { statusCode: 403 }, url }), requestedUrl: url });
    expect(outcome.unreachableBecause).toContain("does not reach it");
  });

  it("records a 404 as the application having no such route", () => {
    const url = `${ORIGIN}/orgs/x/settings`;
    const outcome = nxCloudRouteOutcome({ capture: capture({ over: { statusCode: 404 }, url }), requestedUrl: url });
    expect(outcome.unreachableBecause).toContain("no such route");
  });

  it("does not call a refused page redirected, because it did not go anywhere", () => {
    const url = `${ORIGIN}/orgs/x/workspaces/y/settings`;
    expect(
      nxCloudRouteOutcome({ capture: capture({ over: { statusCode: 403 }, url }), requestedUrl: url }).redirected,
    ).toBe(false);
  });

  it("records a settle on another origin as a redirect", () => {
    const url = `${ORIGIN}/orgs`;
    const outcome = nxCloudRouteOutcome({
      capture: capture({ over: { finalUrl: "https://nx.dev/pricing" }, url }),
      requestedUrl: url,
    });
    expect(outcome.redirected).toBe(true);
  });

  it("records a settle on a different path of the same origin as a redirect", () => {
    const url = `${ORIGIN}/orgs`;
    const outcome = nxCloudRouteOutcome({
      capture: capture({ over: { finalUrl: `${ORIGIN}/vcs-integration-prompt` }, url }),
      requestedUrl: url,
    });
    expect(outcome.unreachableBecause).toContain("did not keep this address");
  });

  it("tolerates a query string the client added to the address it kept", () => {
    const url = `${ORIGIN}/cipes/x/self-healing`;
    const outcome = nxCloudRouteOutcome({
      capture: capture({ over: { finalUrl: `${url}?runGroup=1-1` }, url }),
      requestedUrl: url,
    });
    expect(outcome.unreachableBecause).toBe(null);
  });
});

describe("nxCloudScreenshotArtifact", () => {
  it("addresses a screenshot by the digest of its own bytes", () => {
    expect(nxCloudScreenshotArtifact({ bytes: PNG }).relativePath).toBe(
      `artifacts/pages/${nxCloudScreenshotArtifact({ bytes: PNG }).sha256}.png`,
    );
  });

  it("records the byte length it actually saw", () => {
    expect(nxCloudScreenshotArtifact({ bytes: new Uint8Array([1, 2, 3, 4]) }).byteLength).toBe(4);
  });
});

describe("walkNxCloudBrowser", () => {
  it("visits every declared route in order", async () => {
    const { transport, visited } = fakeTransport({ captures: {} });
    await walkNxCloudBrowser({
      routes: ["/orgs", "/profile/tokens"],
      scope: SCOPE,
      transport,
      writeArtifact: acceptingWriter,
    });
    expect(visited).toEqual([`${ORIGIN}/orgs`, `${ORIGIN}/profile/tokens`]);
  });

  it("substitutes the scope into a parameterised route", async () => {
    const { transport, visited } = fakeTransport({ captures: {} });
    await walkNxCloudBrowser({
      routes: ["/orgs/:orgId/workspaces/:workspaceId/runs"],
      scope: SCOPE,
      transport,
      writeArtifact: acceptingWriter,
    });
    expect(visited).toEqual([`${ORIGIN}/orgs/${SCOPE.orgId}/workspaces/${SCOPE.workspaceId}/runs`]);
  });

  it("holds a page that was reached and photographed", async () => {
    const { transport } = fakeTransport({ captures: {} });
    const walk = unwrap(
      await walkNxCloudBrowser({ routes: ["/orgs"], scope: SCOPE, transport, writeArtifact: acceptingWriter }),
    );
    expect(isRouteHeld({ route: walk.routes[0]! })).toBe(true);
  });

  it("does NOT hold a page whose screenshot could not be written", async () => {
    const { transport } = fakeTransport({ captures: {} });
    const walk = unwrap(
      await walkNxCloudBrowser({
        routes: ["/orgs"],
        scope: SCOPE,
        transport,
        writeArtifact: () => err(["disk full"]),
      }),
    );
    expect(walk.routes[0]!.screenshotMissingBecause).toContain("disk full");
  });

  it("does NOT hold a page that was still loading in both looks", async () => {
    const { transport, visited } = fakeTransport({
      captures: { "/orgs": capture({ over: { screenshotPng: unrenderedPng() }, url: `${ORIGIN}/orgs` }) },
    });
    const walk = unwrap(
      await walkNxCloudBrowser({ routes: ["/orgs"], scope: SCOPE, transport, writeArtifact: () => ok(null) }),
    );
    expect(walk.routes[0]!.screenshotMissingBecause).toBe(UNRENDERED_SCREENSHOT_BECAUSE);
    expect(walk.routes[0]!.artifacts).toEqual([]);
    expect(visited.filter((url) => url === `${ORIGIN}/orgs`).length).toBe(2);
  });

  it("does NOT hold a page the browser returned no screenshot for", async () => {
    const { transport } = fakeTransport({
      captures: { "/orgs": capture({ over: { screenshotPng: null }, url: `${ORIGIN}/orgs` }) },
    });
    const walk = unwrap(
      await walkNxCloudBrowser({ routes: ["/orgs"], scope: SCOPE, transport, writeArtifact: acceptingWriter }),
    );
    expect(isRouteHeld({ route: walk.routes[0]! })).toBe(false);
  });

  it("records the routes the client itself declared while the page rendered", async () => {
    const manifest = capture({
      over: {
        responses: [
          {
            body: { "routes/_auth.orgs._index": { hasLoader: true, index: true, parentId: "root", path: "orgs" } },
            method: "GET",
            statusCode: 200,
            url: `${ORIGIN}/__manifest?paths=%2Forgs`,
          },
        ],
      },
      url: `${ORIGIN}/orgs`,
    });
    const { transport } = fakeTransport({ captures: { "/orgs": manifest } });
    const walk = unwrap(
      await walkNxCloudBrowser({ routes: ["/orgs"], scope: SCOPE, transport, writeArtifact: acceptingWriter }),
    );
    expect(walk.declaredRoutes.map((route) => route.routeId)).toEqual(["routes/_auth.orgs._index"]);
  });

  it("stops asking for pages once the session is lost", async () => {
    const { transport, visited } = fakeTransport({ captures: {}, failWith: { "/orgs": "SESSION_LOST" } });
    await walkNxCloudBrowser({
      routes: ["/orgs", "/profile/tokens"],
      scope: SCOPE,
      transport,
      writeArtifact: acceptingWriter,
    });
    expect(visited).toEqual([`${ORIGIN}/orgs`]);
  });

  it("records a route it never reached as not attempted, which is not the same as unreachable", async () => {
    const { transport } = fakeTransport({ captures: {}, failWith: { "/orgs": "SESSION_LOST" } });
    const walk = unwrap(
      await walkNxCloudBrowser({
        routes: ["/orgs", "/profile/tokens"],
        scope: SCOPE,
        transport,
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walk.routes[1]!.attempted).toBe(false);
  });

  it("says the session was lost, so a caller can report the run rather than the pages", async () => {
    const { transport } = fakeTransport({ captures: {}, failWith: { "/orgs": "SESSION_LOST" } });
    const walk = unwrap(
      await walkNxCloudBrowser({ routes: ["/orgs"], scope: SCOPE, transport, writeArtifact: acceptingWriter }),
    );
    expect(walk.sessionLost).toBe(true);
  });

  it("keeps a navigation failure as one recorded row rather than ending the walk", async () => {
    const { transport, visited } = fakeTransport({ captures: {}, failWith: { "/orgs": "NAVIGATION_FAILED" } });
    await walkNxCloudBrowser({
      routes: ["/orgs", "/profile/tokens"],
      scope: SCOPE,
      transport,
      writeArtifact: acceptingWriter,
    });
    expect(visited.length).toBe(2);
  });

  // The reason is the transport's own URL-free `because`, so a client killed at its process
  // bound stops reading identically to a page that would not load — `browser/clientKill.ts` carries the
  // finding. What must never change is that the ADDRESS stays out: an Nx Cloud URL carries the org id.
  it("records the transport's own URL-free diagnosis, never the address it could not reach", async () => {
    const { transport } = fakeTransport({ captures: {}, failWith: { "/orgs": "NAVIGATION_FAILED" } });
    const walk = unwrap(
      await walkNxCloudBrowser({ routes: ["/orgs"], scope: SCOPE, transport, writeArtifact: acceptingWriter }),
    );
    expect(walk.routes[0]!.unreachableBecause).toBe("the fake reported this page unreachable");
    expect(walk.routes[0]!.unreachableBecause).not.toContain(SCOPE.orgId);
  });
});

describe("markIndistinguishableRoutes", () => {
  /** Two observations, each already photographed, whose artifacts the caller decides. */
  function observed({ pattern, bytes }: { pattern: string; bytes: Uint8Array }): NxCloudRouteObservation {
    return {
      artifacts: [nxCloudScreenshotArtifact({ bytes })],
      attempted: true,
      calls: [],
      captureComplete: true,
      finalUrl: `${ORIGIN}${pattern}`,
      observedAt: "2026-09-05T00:00:00.000Z",
      pathPattern: pattern,
      redirected: false,
      requestedUrl: `${ORIGIN}${pattern}`,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
      screenshotMissingBecause: null,
      statusCode: 200,
      title: "",
      unreachableBecause: null,
    };
  }

  it("drops the artifact from two routes whose pictures are byte-identical", () => {
    const marked = markIndistinguishableRoutes({
      routes: [observed({ bytes: PNG, pattern: "/a" }), observed({ bytes: PNG, pattern: "/b" })],
    });
    expect(marked.map((route) => route.artifacts.length)).toEqual([0, 0]);
  });

  it("names the other routes that share the picture", () => {
    const marked = markIndistinguishableRoutes({
      routes: [observed({ bytes: PNG, pattern: "/a" }), observed({ bytes: PNG, pattern: "/b" })],
    });
    expect(marked[0]!.screenshotMissingBecause).toContain("/b");
  });

  it("leaves two routes with different pictures exactly as they were", () => {
    const marked = markIndistinguishableRoutes({
      routes: [observed({ bytes: PNG, pattern: "/a" }), observed({ bytes: OTHER_PNG, pattern: "/b" })],
    });
    expect(marked.map((route) => route.artifacts.length)).toEqual([1, 1]);
  });

  it("stops a shared picture counting as held", () => {
    const marked = markIndistinguishableRoutes({
      routes: [observed({ bytes: PNG, pattern: "/a" }), observed({ bytes: PNG, pattern: "/b" })],
    });
    expect(isRouteHeld({ route: marked[0]! })).toBe(false);
  });
});
