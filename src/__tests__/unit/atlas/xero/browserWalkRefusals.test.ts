/**
 * The Xero walk's refusals when its app probe FAILS, before any page is navigated.
 *
 * Its own file rather than a case in `browserWalk.test.ts`: the sign-in refusal on a probe that LANDS is pinned
 * there, and these are the two `resolveAppRoot` authors when the probe errors instead — an unreachable client,
 * the only reason the walk quotes a transport message, and a sign-in redirect that tore the probe's page down.
 */
import { describe, expect, it } from "vitest";

import { walkXeroBrowser } from "../../../../atlas/xero/browserWalk.js";
import { BrowserTransportErrors, SNIPPET_REPORTED_FAILURE_BECAUSE } from "../../../../browser/pageTransport.js";
import { takeSignInWalls } from "../../../../browser/signInWalls.js";
import { unwrapErr } from "../../../../lib/result.js";

import { fakeTransport, recordingWriter } from "../../../walkTransportFake.js";

describe("walkXeroBrowser refuses to start when the web client is unreachable", () => {
  it("quotes the transport's own message when the sign-in origin sends a signed-in browser on into the app", async () => {
    takeSignInWalls();
    const fake = fakeTransport({
      visits: {
        "https://go.xero.com/": { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } },
        "https://login.xero.com/": { capture: { finalUrl: "https://go.xero.com/app/!AbCdE/dashboard" } },
      },
    });
    const walked = await walkXeroBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([
      "could not reach the Xero web client to learn its organisation root: the relay stopped answering",
    ]);
    expect(fake.visited).toEqual(["https://go.xero.com/", "https://login.xero.com/"]);
    expect(takeSignInWalls()).toEqual([]);
  });

  it("answers SIGNED OUT, and notes the wall, when the probe's page was torn down by a sign-in redirect", async () => {
    // MEASURED: every scheduled resync-atlas-xero firing recorded "the browser session driving
    // this walk is no longer usable" while Chrome sat on Xero's sign-in form, so no sign-in card was raised.
    takeSignInWalls();
    const fake = fakeTransport({
      visits: {
        "https://go.xero.com/": {
          failWith: BrowserTransportErrors.navigationFailed({
            because: SNIPPET_REPORTED_FAILURE_BECAUSE,
            reason: "the page, its context or the browser this walk was driving went away underneath the call",
            url: "https://go.xero.com/",
          }),
        },
        "https://login.xero.com/": { capture: { finalUrl: "https://login.xero.com/identity/user/login" } },
      },
    });
    const walked = await walkXeroBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([
      "the Xero web client sent this browser to its sign-in origin, so no page could be walked",
      "sign in to Xero in your own Chrome and run the walk again",
    ]);
    expect(fake.visited).toEqual(["https://go.xero.com/", "https://login.xero.com/"]);
    expect(takeSignInWalls()).toEqual(["https://login.xero.com"]);
  });

  it("reads an error page on the sign-in origin as unreachable, and notes no wall", async () => {
    takeSignInWalls();
    const fake = fakeTransport({
      visits: {
        "https://go.xero.com/": { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } },
        "https://login.xero.com/": { capture: { finalUrl: "https://login.xero.com/", statusCode: 503 } },
      },
    });
    const walked = await walkXeroBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([
      "could not reach the Xero web client to learn its organisation root: the relay stopped answering",
    ]);
    expect(takeSignInWalls()).toEqual([]);
  });

  it("gives ONE verdict for any sign-in page on the sign-in origin, so the walk never says unreachable beside a noted wall", async () => {
    takeSignInWalls();
    const fake = fakeTransport({
      visits: {
        "https://go.xero.com/": { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } },
        "https://login.xero.com/": { capture: { finalUrl: "https://login.xero.com/" } },
      },
    });
    const walked = await walkXeroBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)[0]).toBe(
      "the Xero web client sent this browser to its sign-in origin, so no page could be walked",
    );
    expect(takeSignInWalls()).toEqual(["https://login.xero.com"]);
  });
});
