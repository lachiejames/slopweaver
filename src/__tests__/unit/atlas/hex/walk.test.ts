import { describe, expect, it } from "vitest";

import { hexDeclaredPages, hexParameterisedRoutes } from "../../../../atlas/hex/browserPages.js";
import {
  type HexPageObservation,
  isSignedOut,
  isSignInWall,
  outcomeOf,
  settledOnApp,
  walkHexApp,
} from "../../../../atlas/hex/walk.js";
import type { PageCapture } from "../../../../browser/pageTransport.js";
import { takeSignInWalls } from "../../../../browser/signInWalls.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";
import { fakeTransport, capture as sharedCapture } from "../../../walkTransportFake.js";

/** What is HEX's about a capture, over the shared fake's own defaults: its pages each make two data calls. */
const HEX_PAGE: Partial<PageCapture> = {
  responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 9 },
  title: "Home",
};

/** A capture in the shape the transport really returns, with only what a test varies overridden. */
function capture(over: Partial<PageCapture> = {}): PageCapture {
  return sharedCapture({ over: { ...HEX_PAGE, ...over }, url: "https://app.hex.tech/home" });
}

/** A writer that always succeeds, so a walk's grading is not confounded by disk. */
const writeArtifact = (): Result<null> => ok(null);

/** Progress lines are irrelevant to what these tests assert. */
const progress = (): void => {};

/** One page observation, for the pure predicates below. */
function page(over: Partial<HexPageObservation> = {}): HexPageObservation {
  return {
    artifacts: [],
    discoveredFrom: null,
    finalUrl: "https://app.hex.tech/home",
    linksRendered: [],
    outcome: "landed",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    route: "/home",
    statusCode: 200,
    title: "Home",
    ...over,
  };
}

describe("grading one visited Hex page", () => {
  // The wall lives on the SAME origin as every declared page and at a route this atlas declares, which no
  // sibling walk has to handle: an origin test cannot see it, and a path test that did not know what was
  // asked for would report the owner signed out every time the walk visited /login on purpose.
  it("calls a bounce to /login the sign-in wall when another route was asked for", () => {
    const bounced = capture({
      finalUrl: "https://app.hex.tech/login?next=%2Fsettings",
      requestedUrl: "https://app.hex.tech/settings",
    });

    expect(isSignInWall({ capture: bounced, route: "/settings" })).toBe(true);
    expect(outcomeOf({ capture: bounced, route: "/settings" })).toBe("signed-out");
  });

  it("calls a deliberate visit to /login a page that landed", () => {
    const login = capture({ finalUrl: "https://app.hex.tech/login", requestedUrl: "https://app.hex.tech/login" });

    expect(isSignInWall({ capture: login, route: "/login" })).toBe(false);
    expect(outcomeOf({ capture: login, route: "/login" })).toBe("landed");
  });

  // A prefix test grades `/login-success` — a declared route of its own — as the wall, and because the walk
  // stops at the first wall that aborts the whole run. It ended a real walk partway through its declared routes.
  it("does not mistake /login-success for the wall", () => {
    const success = capture({
      finalUrl: "https://app.hex.tech/login-success",
      requestedUrl: "https://app.hex.tech/login-success",
    });

    expect(isSignInWall({ capture: success, route: "/login-success" })).toBe(false);
    expect(outcomeOf({ capture: success, route: "/login-success" })).toBe("landed");
  });

  it("grades an error status, a foreign origin and a missing screenshot each as itself", () => {
    expect(outcomeOf({ capture: capture({ statusCode: 404 }), route: "/home" })).toBe("unavailable");
    expect(outcomeOf({ capture: capture({ finalUrl: "https://hex.tech/pricing" }), route: "/home" })).toBe(
      "redirected",
    );
    expect(outcomeOf({ capture: capture({ screenshotPng: null }), route: "/home" })).toBe("unphotographed");
  });

  it("knows whether the browser stayed on the app origin", () => {
    expect(settledOnApp({ capture: capture() })).toBe(true);
    expect(settledOnApp({ capture: capture({ finalUrl: "https://hex.tech/pricing" }) })).toBe(false);
  });
});

describe("deciding whether the app is signed out", () => {
  it("needs a wall AND no page that landed, because the walk stops at the first wall", () => {
    expect(isSignedOut({ pages: [page({ outcome: "signed-out" })] })).toBe(true);
    expect(isSignedOut({ pages: [page({ outcome: "landed" }), page({ outcome: "signed-out" })] })).toBe(false);
    expect(isSignedOut({ pages: [page({ outcome: "failed" })] })).toBe(false);
    expect(
      isSignedOut({ pages: [page({ outcome: "unphotographed" }), page({ outcome: "signed-out" })] }),
      "an unphotographed page rendered behind the session, so the session was signed in",
    ).toBe(false);
  });
});

describe("the declared page list", () => {
  // A route needing an id could only be visited by taking one from the workspace's own contents, which is
  // the half of Hex this atlas deliberately does not reach.
  it("excludes a template with a required parameter and carries no parameter at all", () => {
    expect(hexDeclaredPages().every((route) => !route.includes(":"))).toBe(true);
    expect(hexParameterisedRoutes().every((route) => route.includes(":"))).toBe(true);
    expect(hexParameterisedRoutes()).toContain("/hex/:hexLocator/:version?/:view?/:appSessionId?");
  });

  // The failure this pins: an OPTIONAL parameter still leaves a visitable base path, and treating it as
  // required excluded every surface a person actually opens. A walk over the wrong list landed pages and not
  // one of them was a page a human uses.
  it("visits the base path of a template whose parameters are all optional", () => {
    expect(hexDeclaredPages()).toContain("/home");
    expect(hexDeclaredPages()).toContain("/settings");
    expect(hexDeclaredPages()).toContain("/context-studio");
    expect(hexDeclaredPages()).not.toContain("/home/:subView?/:tabView?");
  });
});

describe("walking the app", () => {
  it("stops at the first sign-in wall and records the rest as not attempted", async () => {
    const { transport, visited } = fakeTransport({
      answer: () => ({ capture: { ...HEX_PAGE, finalUrl: "https://app.hex.tech/login" } }),
    });

    const walked = unwrap(await walkHexApp({ progress, transport, writeArtifact }));

    expect(visited.length).toBe(1);
    expect(walked.signedOut).toBe(true);
    expect(walked.notAttempted.length).toBe(hexDeclaredPages().length - 1);
  });

  // A signed-out walk publishes its gap and exits 0, so without the noted
  // wall a scheduled resync recorded it SUCCEEDED — no failure hold, no sign-in card, the row read current.
  it("notes the app's sign-in wall when the walk is signed out, and none when a page landed", async () => {
    takeSignInWalls();
    const signedOut = fakeTransport({
      answer: () => ({ capture: { ...HEX_PAGE, finalUrl: "https://app.hex.tech/login" } }),
    });
    unwrap(await walkHexApp({ progress, transport: signedOut.transport, writeArtifact }));
    expect(takeSignInWalls()).toEqual(["https://app.hex.tech"]);

    const signedIn = fakeTransport({ answer: () => ({ capture: HEX_PAGE }) });
    unwrap(await walkHexApp({ progress, transport: signedIn.transport, writeArtifact }));
    expect(takeSignInWalls()).toEqual([]);
  });

  // MEASURED twice on the owner's app: one OAuth completion page closes its own tab, and aborting on the
  // first lost session cost every declared route after it. A page that closes the browser is a property of the
  // PAGE; the owner closing Chrome is a property of the SESSION, and one loss cannot tell them apart.
  it("takes one more route after a single lost session, and keeps walking when it succeeds", async () => {
    let seen = 0;
    const walked = unwrap(
      await walkHexApp({
        progress,
        transport: {
          release: async () => ok(null),
          visit: async ({ url }) => {
            seen += 1;
            if (seen === 2) {
              return err({ code: "SESSION_LOST" as const, message: "Target page, context or browser has been closed" });
            }
            return ok(capture({ finalUrl: url, requestedUrl: url }));
          },
        },
        writeArtifact,
      }),
    );

    expect(walked.pages.filter((visited) => visited.outcome === "landed").length).toBe(hexDeclaredPages().length - 1);
    expect(walked.notAttempted).toEqual([]);
  });

  it("stops after two lost sessions in a row, because then the session really is gone", async () => {
    const fake = fakeTransport({
      answer: () => ({ failWith: { code: "SESSION_LOST", message: "closed" } }),
    });
    const walked = unwrap(await walkHexApp({ progress, transport: fake.transport, writeArtifact }));

    expect(fake.visited).toHaveLength(2);
    expect(walked.notAttempted.length).toBe(hexDeclaredPages().length - 2);
  });

  it("follows a landed page's own rendered links, naming which page found each", async () => {
    const { transport } = fakeTransport({
      answer: ({ url }) => ({
        capture: {
          ...HEX_PAGE,
          links: url.endsWith("/settings") ? ["https://app.hex.tech/settings/undocumented-tab"] : [],
        },
      }),
    });

    const walked = unwrap(await walkHexApp({ progress, transport, writeArtifact }));
    const discovered = walked.pages.find((visited) => visited.route === "/settings/undocumented-tab");

    expect(discovered!.discoveredFrom).toBe("/settings");
    expect(walked.roundsRun).toBe(2);
  });
});
