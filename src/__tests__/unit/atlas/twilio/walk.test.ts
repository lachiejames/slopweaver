import { describe, expect, it } from "vitest";

import { TWILIO_BROWSER_PAGES } from "../../../../atlas/twilio/browserPages.js";
import {
  type ConsolePageObservation,
  isSignedOut,
  isSignInWall,
  outcomeOf,
  regionOf,
  settledOnConsole,
  walkTwilioConsole,
} from "../../../../atlas/twilio/walk.js";
import type { PageCapture } from "../../../../browser/pageTransport.js";
import { takeSignInWalls } from "../../../../browser/signInWalls.js";
import { ok, type Result } from "../../../../lib/result.js";
import { fakeTransport, capture as sharedCapture } from "../../../walkTransportFake.js";

/** What is TWILIO's about a capture, over the shared fake's own defaults: two data calls per console page. */
const TWILIO_PAGE: Partial<PageCapture> = {
  responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 9 },
  title: "Messaging Services",
};

/** A capture in the shape the transport really returns, with only what a test varies overridden. */
function capture(over: Partial<PageCapture> = {}): PageCapture {
  return sharedCapture({
    over: { ...TWILIO_PAGE, ...over },
    url: "https://console.twilio.com/us1/develop/sms/services",
  });
}

/** A writer that always succeeds, so a walk's grading is not confounded by disk. */
const writeArtifact = (): Result<null> => ok(null);

/** Progress lines are irrelevant to what these tests assert. */
const progress = (): void => {};

describe("grading one visited console page", () => {
  it("calls Twilio's sign-in wall its own outcome rather than a redirect", () => {
    const wall = capture({ finalUrl: "https://www.twilio.com/login?g=%2Fconsole-zen%2F" });

    expect(isSignInWall({ capture: wall })).toBe(true);
    expect(outcomeOf({ capture: wall })).toBe("signed-out");
  });

  // A CodeQL alert: the first version matched the host by suffix, so `eviltwilio.com` read as
  // Twilio's own wall — and on this walk that means recording the owner as signed out, and stopping, on the
  // word of somebody else's domain.
  it("does not mistake a lookalike host for Twilio's sign-in wall", () => {
    expect(isSignInWall({ capture: capture({ finalUrl: "https://eviltwilio.com/login" }) })).toBe(false);
    expect(isSignInWall({ capture: capture({ finalUrl: "https://twilio.com.example.test/login" }) })).toBe(false);
  });

  it("accepts Twilio's own host and its subdomains at a dot boundary", () => {
    expect(isSignInWall({ capture: capture({ finalUrl: "https://twilio.com/login" }) })).toBe(true);
    expect(isSignInWall({ capture: capture({ finalUrl: "https://www.twilio.com/login?g=x" }) })).toBe(true);
  });

  it("calls a page that landed on the console and was photographed landed", () => {
    expect(outcomeOf({ capture: capture() })).toBe("landed");
    expect(settledOnConsole({ capture: capture() })).toBe(true);
  });

  // The atlas holds the picture, so a row claiming a page landed while holding none is a claim it cannot
  // back.
  it("refuses to credit a page it could not photograph", () => {
    expect(outcomeOf({ capture: capture({ screenshotPng: null }) })).toBe("unphotographed");
  });

  it("calls an error status unavailable", () => {
    expect(outcomeOf({ capture: capture({ statusCode: 404 }) })).toBe("unavailable");
  });

  it("calls a landing on another origin a redirect, whatever the status says", () => {
    const elsewhere = capture({ finalUrl: "https://www.twilio.com/docs/messaging" });

    expect(settledOnConsole({ capture: elsewhere })).toBe(false);
    expect(outcomeOf({ capture: elsewhere })).toBe("redirected");
  });

  it("reads the account's home region off where the console settled", () => {
    expect(regionOf({ finalUrl: "https://console.twilio.com/ie1/develop/sms/services" })).toBe("ie1");
    expect(regionOf({ finalUrl: "https://console.twilio.com/organization/settings/overview" })).toBe(null);
    expect(regionOf({ finalUrl: "not a url" })).toBe(null);
  });
});

describe("walking the Twilio console", () => {
  // The measured state, and the reason the walk stops: a wall is a property of the session,
  // so eighty navigations to the same login page in the owner's visible browser establish one fact eighty times.
  it("stops at the first sign-in wall and records the rest as not attempted", async () => {
    const fake = fakeTransport({
      answer: () => ({ capture: { ...TWILIO_PAGE, finalUrl: "https://www.twilio.com/login?g=x" } }),
    });

    const walked = await walkTwilioConsole({ progress, transport: fake.transport, writeArtifact });

    expect(walked.isOk()).toBe(true);
    const result = walked._unsafeUnwrap();
    expect(result.signedOut).toBe(true);
    expect(result.pages.length).toBe(1);
    expect(fake.visited.length).toBe(1);
    expect(result.notAttempted.length).toBe(TWILIO_BROWSER_PAGES.length - 1);
  });

  // A signed-out walk publishes its gap and exits 0, so without the noted
  // wall a scheduled resync recorded it SUCCEEDED — no failure hold, no sign-in card, the row read current.
  it("notes the console's sign-in wall when the walk is signed out, and none when every page landed", async () => {
    takeSignInWalls();
    const signedOut = fakeTransport({
      answer: () => ({ capture: { ...TWILIO_PAGE, finalUrl: "https://www.twilio.com/login?g=x" } }),
    });
    await walkTwilioConsole({ progress, transport: signedOut.transport, writeArtifact });
    expect(takeSignInWalls()).toEqual(["https://console.twilio.com"]);

    const signedIn = fakeTransport({ answer: () => ({ capture: TWILIO_PAGE }) });
    await walkTwilioConsole({ progress, transport: signedIn.transport, writeArtifact });
    expect(takeSignInWalls()).toEqual([]);
  });

  it("carries the transport's own response accounting onto the page row", async () => {
    const fake = fakeTransport({ answer: () => ({ capture: TWILIO_PAGE }) });

    const walked = await walkTwilioConsole({ progress, transport: fake.transport, writeArtifact });

    expect(walked._unsafeUnwrap().pages[0]!.responseAccounting).toEqual({
      bodyFailed: 0,
      bodySucceeded: 2,
      eligible: 2,
      seen: 9,
    });
  });

  it("visits every declared route when none of them hits the wall", async () => {
    const fake = fakeTransport({ answer: () => ({ capture: TWILIO_PAGE }) });

    const walked = await walkTwilioConsole({ progress, transport: fake.transport, writeArtifact });

    expect(fake.visited.length).toBe(TWILIO_BROWSER_PAGES.length);
    expect(walked._unsafeUnwrap().signedOut).toBe(false);
    expect(walked._unsafeUnwrap().notAttempted).toEqual([]);
  });

  it("substitutes the region it discovered into the routes it visits next", async () => {
    const fake = fakeTransport({
      answer: ({ url }) => ({ capture: { ...TWILIO_PAGE, finalUrl: url.replace("/us1/", "/ie1/") } }),
    });

    const walked = await walkTwilioConsole({ progress, transport: fake.transport, writeArtifact });

    expect(walked._unsafeUnwrap().region).toBe("ie1");
    expect(fake.visited.some((url) => url.includes("/ie1/"))).toBe(true);
  });

  // The declared list is a FLOOR, and this is the mechanism that raises it.
  it("adds console routes a landed page rendered to the next round's frontier", async () => {
    const discovered = "https://console.twilio.com/us1/develop/undocumented/thing";
    const fake = fakeTransport({
      answer: () => ({ capture: { ...TWILIO_PAGE, links: [discovered] } }),
    });

    const walked = await walkTwilioConsole({ progress, transport: fake.transport, writeArtifact });
    const result = walked._unsafeUnwrap();

    expect(result.pages.some((page) => page.route === "/{region}/develop/undocumented/thing")).toBe(true);
    expect(result.pages.find((page) => page.route === "/{region}/develop/undocumented/thing")!.discoveredFrom).toBe(
      TWILIO_BROWSER_PAGES[0]!.route,
    );
    expect(result.roundsRun).toBe(2);
  });

  it("counts a page whose bodies were not all read as incomplete", async () => {
    const fake = fakeTransport({
      answer: () => ({
        capture: {
          ...TWILIO_PAGE,
          responseAccounting: { bodyFailed: 1, bodySucceeded: 1, eligible: 2, seen: 9 },
        },
      }),
    });

    const walked = await walkTwilioConsole({ progress, transport: fake.transport, writeArtifact });

    expect(walked._unsafeUnwrap().incompletePages.length).toBe(TWILIO_BROWSER_PAGES.length);
  });
});

describe("isSignedOut", () => {
  /** One observed console page with the given outcome. */
  function observed({ outcome }: { outcome: ConsolePageObservation["outcome"] }): ConsolePageObservation {
    return {
      artifacts: [],
      discoveredFrom: null,
      finalUrl: "https://console.twilio.com/",
      linksRendered: [],
      outcome,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
      route: "/",
      statusCode: 200,
      title: "Console",
    };
  }

  it("needs a wall and no page reached, an unphotographed page counting as reached", () => {
    expect(isSignedOut({ pages: [observed({ outcome: "signed-out" })] })).toBe(true);
    expect(isSignedOut({ pages: [observed({ outcome: "landed" }), observed({ outcome: "signed-out" })] })).toBe(false);
    expect(isSignedOut({ pages: [observed({ outcome: "unphotographed" }), observed({ outcome: "signed-out" })] })).toBe(
      false,
    );
    expect(isSignedOut({ pages: [observed({ outcome: "failed" })] })).toBe(false);
  });
});
