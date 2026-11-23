/**
 * The Aether portal walk over a deterministic fake transport — an injected seam, not a mock.
 *
 * The outcomes that decide whether this atlas is honest about its browser half are settled here: a landed
 * page carries its responses forward, a redirect to the sign-in form is a `login-wall` that reduces nothing,
 * and a lost session stops the walk rather than recording every later route as a failure of its own.
 */
import { describe, expect, it } from "vitest";

import type { AetherPortalRoute } from "../../../../atlas/aether/pages.js";
import { isReducibleResponse, outcomeOf, walkAetherPortal } from "../../../../atlas/aether/walk.js";
import type { AtlasArtifactWriter } from "../../../../atlas/kit/artifactWriter.js";
import type { BrowserPageTransport, BrowserTransportError, PageCapture } from "../../../../browser/pageTransport.js";
import { BrowserTransportErrors } from "../../../../browser/pageTransport.js";
import { takeSignInWalls } from "../../../../browser/signInWalls.js";
import { ok, unwrap } from "../../../../lib/result.js";
import { capture as sharedCapture, fakeTransport as sharedFakeTransport } from "../../../walkTransportFake.js";

const ORIGIN = "https://app.tryaether.invalid";

const routes: readonly AetherPortalRoute[] = [
  { href: "/home", section: "overview", verified: true, why: "a" },
  { href: "/risk-inbox", section: "findings", verified: true, why: "b" },
  { href: "/api/findings?tab=open&page=1&limit=100", section: "findings-api", verified: true, why: "c" },
];

/** A capture that landed exactly where it was asked to, with optional first-party responses. */
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
      title: "Aether",
    },
    url,
  });
}

/** A transport answering from a script keyed by requested URL. */
function transportOver({
  script,
}: {
  script: Readonly<Record<string, PageCapture | BrowserTransportError>>;
}): BrowserPageTransport {
  return sharedFakeTransport({
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
      return "code" in scripted ? { failWith: scripted } : { capture: scripted };
    },
  }).transport;
}

/** Accept every screenshot without touching disk. */
const keepArtifact: AtlasArtifactWriter = () => ok(null);

describe("outcomeOf", () => {
  it("grades a settle on the sign-in form as login-wall, never as data", () => {
    const cap = { ...landed({ url: `${ORIGIN}/home` }), finalUrl: `${ORIGIN}/login` };
    expect(outcomeOf({ capture: cap })).toBe("login-wall");
  });

  it("grades a page that settled where it was asked as landed", () => {
    expect(outcomeOf({ capture: landed({ url: `${ORIGIN}/home` }) })).toBe("landed");
  });

  it("grades a 404 as not-found", () => {
    expect(outcomeOf({ capture: { ...landed({ url: `${ORIGIN}/x` }), statusCode: 404 } })).toBe("not-found");
  });
});

describe("isReducibleResponse", () => {
  it("keeps a first-party JSON body", () => {
    expect(
      isReducibleResponse({ origin: ORIGIN, response: { body: { data: [] }, url: `${ORIGIN}/api/findings` } }),
    ).toBe(true);
  });

  it("drops an off-origin response", () => {
    expect(
      isReducibleResponse({ origin: ORIGIN, response: { body: { x: 1 }, url: "https://cloudflare.com/cdn" } }),
    ).toBe(false);
  });

  it("drops a non-object body", () => {
    expect(isReducibleResponse({ origin: ORIGIN, response: { body: "html", url: `${ORIGIN}/home` } })).toBe(false);
  });
});

describe("walkAetherPortal", () => {
  it("carries a landed page's first-party responses forward and photographs it", async () => {
    const apiUrl = `${ORIGIN}/api/findings?tab=open&page=1&limit=100`;
    const script: Record<string, PageCapture> = {
      [`${ORIGIN}/home`]: landed({ url: `${ORIGIN}/home` }),
      [`${ORIGIN}/risk-inbox`]: landed({ url: `${ORIGIN}/risk-inbox` }),
      [apiUrl]: landed({
        responses: [{ body: { data: [] }, method: "GET", statusCode: 200, url: apiUrl }],
        url: apiUrl,
      }),
    };
    const result = unwrap(
      await walkAetherPortal({
        origin: ORIGIN,
        routes,
        transport: transportOver({ script }),
        writeArtifact: keepArtifact,
      }),
    );
    expect(result.pages.length).toBe(3);
    expect(result.pages.every((page) => page.outcome === "landed")).toBe(true);
    expect(result.responses.length).toBe(1);
    expect(result.artifactsWritten).toBe(3);
    expect(result.loginWallPages.length).toBe(0);
  });

  it("records a login-wall page and reduces none of its responses", async () => {
    const home = {
      ...landed({
        responses: [{ body: { data: [1] }, method: "GET", statusCode: 200, url: `${ORIGIN}/api/x` }],
        url: `${ORIGIN}/home`,
      }),
      finalUrl: `${ORIGIN}/login`,
    };
    const script: Record<string, PageCapture> = {
      [`${ORIGIN}/home`]: home,
      [`${ORIGIN}/risk-inbox`]: landed({ url: `${ORIGIN}/risk-inbox` }),
      [`${ORIGIN}/api/findings?tab=open&page=1&limit=100`]: landed({
        url: `${ORIGIN}/api/findings?tab=open&page=1&limit=100`,
      }),
    };
    const result = unwrap(
      await walkAetherPortal({
        origin: ORIGIN,
        routes,
        transport: transportOver({ script }),
        writeArtifact: keepArtifact,
      }),
    );
    expect(result.loginWallPages).toEqual(["/home"]);
    expect(result.responses.length).toBe(0);
  });

  it("stops the walk on a lost session, leaving later routes not-attempted", async () => {
    const script: Record<string, PageCapture | BrowserTransportError> = {
      [`${ORIGIN}/home`]: landed({ url: `${ORIGIN}/home` }),
      [`${ORIGIN}/risk-inbox`]: BrowserTransportErrors.sessionLost({ reason: "tab closed" }),
    };
    const result = unwrap(
      await walkAetherPortal({
        origin: ORIGIN,
        routes,
        transport: transportOver({ script }),
        writeArtifact: keepArtifact,
      }),
    );
    expect(result.notAttempted).toEqual(["/risk-inbox", "/api/findings?tab=open&page=1&limit=100"]);
    expect(result.pages.filter((page) => page.outcome === "landed").length).toBe(1);
  });
});

// A 7/7 login-wall walk exited 3 and the scheduled resync recorded only that, so the row
// was held behind a finding instead of carding the owner's sign-in.
describe("walkAetherPortal's sign-in wall", () => {
  /** Walk the three routes over a script and return every wall the walk noted. */
  async function wallsNoted({
    script,
  }: {
    script: Readonly<Record<string, PageCapture | BrowserTransportError>>;
  }): Promise<readonly string[]> {
    takeSignInWalls();
    unwrap(
      await walkAetherPortal({
        origin: ORIGIN,
        routes,
        transport: transportOver({ script }),
        writeArtifact: keepArtifact,
      }),
    );
    return takeSignInWalls();
  }

  /** A capture asked for `url` that settled on the portal sign-in form. */
  function walled({ url }: { url: string }): PageCapture {
    return { ...landed({ url }), finalUrl: `${ORIGIN}/login` };
  }

  it("notes the portal origin when every visited page met the sign-in form", async () => {
    const script = Object.fromEntries(
      routes.map((route) => [`${ORIGIN}${route.href}`, walled({ url: `${ORIGIN}${route.href}` })]),
    );
    expect(await wallsNoted({ script })).toEqual([ORIGIN]);
  });

  it("notes nothing when a page landed beside a wall", async () => {
    const script = {
      [`${ORIGIN}/home`]: walled({ url: `${ORIGIN}/home` }),
      [`${ORIGIN}/risk-inbox`]: landed({ url: `${ORIGIN}/risk-inbox` }),
    };
    expect(await wallsNoted({ script })).toEqual([]);
  });

  it("notes nothing when no page landed only because every visit failed — contention, not a sign-out", async () => {
    expect(await wallsNoted({ script: {} })).toEqual([]);
  });
});
