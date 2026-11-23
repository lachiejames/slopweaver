/**
 * Xero's own five decisions about walking its web client. The ENGINE's behaviour — the four-way accounting,
 * the lost-session stop, the duplicate-picture check, the artifact addressing — is `kit/pageWalk/`.
 *
 * What is left here is the part a reader would get wrong about Xero specifically: its client migrated in
 * stages, so the interesting failure is a 200 on a DIFFERENT origin rather than a 404, and a settle on its
 * sign-in origin is the session ending rather than one page being missing.
 */
import { describe, expect, it } from "vitest";

import { XERO_BROWSER_PAGES, XERO_WEB_ORIGIN } from "../../../../atlas/xero/browserPages.js";
import { walkXeroBrowser, XERO_PAGE_WALK_SPEC, xeroPageOutcome } from "../../../../atlas/xero/browserWalk.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { capture, fakeTransport, recordingWriter } from "../../../walkTransportFake.js";

describe("xeroPageOutcome", () => {
  const url = "https://go.xero.com/Contacts";

  it("holds a page the client settled on exactly", () => {
    expect(xeroPageOutcome({ capture: capture({ over: {}, url }), requestedUrl: url }).unreachableBecause).toBe(null);
  });

  it("tolerates a query-string difference, because the client restores its own view state", () => {
    const settled = capture({ over: { finalUrl: `${url}?status=ALL` }, url });
    expect(xeroPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).toBe(null);
  });

  // The interesting Xero failure is not a 404. It is a 200 on a different origin, which is what a legacy
  // route does once the surface has moved.
  it("records a settle on another origin as unreachable, and NAMES the origin", () => {
    const settled = capture({ over: { finalUrl: "https://reporting.xero.com/reports" }, url });
    expect(xeroPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).toContain(
      "https://reporting.xero.com",
    );
  });

  it("records a settle on another origin as a redirect", () => {
    const settled = capture({ over: { finalUrl: "https://reporting.xero.com/reports" }, url });
    expect(xeroPageOutcome({ capture: settled, requestedUrl: url }).redirected).toBe(true);
  });

  it("recognises the sign-in wall before any other rule, so a lost session is not read as a moved page", () => {
    const settled = capture({ over: { finalUrl: "https://login.xero.com/identity/connect/authorize" }, url });
    expect(xeroPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).toContain(
      "no longer signed in",
    );
  });

  it("records a settle on a different path under the same origin as unreachable", () => {
    const settled = capture({ over: { finalUrl: "https://go.xero.com/Dashboard" }, url });
    expect(xeroPageOutcome({ capture: settled, requestedUrl: url }).redirected).toBe(true);
  });

  // The settled path can carry the organisation short code, so it may never be quoted into an observation.
  it("does not quote the settled PATH, only its origin", () => {
    const settled = capture({ over: { finalUrl: "https://go.xero.com/app/!Ab3dE/dashboard" }, url });
    expect(xeroPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).not.toContain("Ab3dE");
  });

  it("treats a trailing slash as the same address", () => {
    const settled = capture({ over: { finalUrl: `${url}/` }, url });
    expect(xeroPageOutcome({ capture: settled, requestedUrl: url }).unreachableBecause).toBe(null);
  });

  it("refuses an address it cannot read rather than grading it reached", () => {
    const settled = capture({ over: { finalUrl: "::::" }, url });
    expect(xeroPageOutcome({ capture: settled, requestedUrl: url }).redirected).toBe(true);
  });
});

describe("XERO_PAGE_WALK_SPEC", () => {
  it("reads a settle on the sign-in origin as the session ending, so one sign-out is not forty page gaps", () => {
    const settled = capture({ over: { finalUrl: "https://login.xero.com/identity" }, url: "https://go.xero.com/x" });
    expect(XERO_PAGE_WALK_SPEC.sessionLostOn({ capture: settled })).toBe(true);
  });

  it("reads an ordinary settle as the session continuing", () => {
    const settled = capture({ over: {}, url: "https://go.xero.com/Contacts" });
    expect(XERO_PAGE_WALK_SPEC.sessionLostOn({ capture: settled })).toBe(false);
  });

  it("walks the declared inventory and nothing else", () => {
    expect(XERO_PAGE_WALK_SPEC.pages).toBe(XERO_BROWSER_PAGES);
  });
});

describe("walkXeroBrowser", () => {
  const appRoot = `${XERO_WEB_ORIGIN}/app/!Ab3dE`;
  const probeUrl = `${XERO_WEB_ORIGIN}/`;

  /** A transport whose probe lands on an app route, so every declared root resolves. */
  function signedIn(): ReturnType<typeof fakeTransport> {
    return fakeTransport({ visits: { [probeUrl]: { capture: { finalUrl: `${appRoot}/dashboard` } } } });
  }

  it("asks for the bare origin first, purely to learn the organisation root", async () => {
    const fake = signedIn();
    await walkXeroBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(fake.visited[0]).toBe(probeUrl);
  });

  it("reports that it found an organisation short code", async () => {
    const fake = signedIn();
    const walked = unwrap(await walkXeroBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }));
    expect(walked.rootFound).toBe(true);
  });

  it("returns exactly one observation per declared page", async () => {
    const fake = signedIn();
    const walked = unwrap(await walkXeroBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }));
    expect(walked.pages).toHaveLength(XERO_BROWSER_PAGES.length);
  });

  it("refuses to start at all when the probe lands on the sign-in wall", async () => {
    const fake = fakeTransport({
      visits: { [probeUrl]: { capture: { finalUrl: "https://login.xero.com/identity" } } },
    });
    const walked = await walkXeroBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([
      "the Xero web client sent this browser to its sign-in origin, so no page could be walked",
      "sign in to Xero in your own Chrome and run the walk again",
    ]);
  });

  it("records every app-rooted page as not addressable when no short code was found", async () => {
    const fake = fakeTransport({ visits: { [probeUrl]: { capture: { finalUrl: `${XERO_WEB_ORIGIN}/Dashboard` } } } });
    const walked = unwrap(await walkXeroBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }));
    const appPages = new Set(
      XERO_BROWSER_PAGES.filter((declared) => declared.root === "app").map((declared) => declared.surface),
    );
    const notAddressable = walked.pages.filter((page) => appPages.has(page.surface));
    expect(notAddressable.filter((page) => page.attempted)).toEqual([]);
  });

  it("writes a screenshot for every page it reached", async () => {
    const fake = signedIn();
    const writer = recordingWriter();
    await walkXeroBrowser({ transport: fake.transport, writeArtifact: writer.write });
    expect(writer.written.length).toBeGreaterThan(0);
  });
});
