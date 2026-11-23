import { describe, expect, it } from "vitest";

import { UNRENDERED_SCREENSHOT_BECAUSE } from "../../../../atlas/kit/browserWalk.js";
import {
  TRELICA_BROWSER_PAGES,
  TRELICA_SHELL_TITLE,
  TRELICA_UNDECLARED_PATH,
  TRELICA_UNPHOTOGRAPHED_PAGES,
} from "../../../../atlas/trelica/browserPages.js";
import { projectTrelicaPages } from "../../../../atlas/trelica/browserProjection.js";
import {
  type TrelicaArtifactWriter,
  trelicaPageOutcome,
  trelicaScreenshotArtifact,
  walkTrelicaWebApp,
} from "../../../../atlas/trelica/browserWalk.js";
import { TRELICA_PROVIDER_TEXT_WITHHELD } from "../../../../atlas/trelica/providerText.js";
import type { BrowserPageTransport, PageCapture } from "../../../../browser/pageTransport.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import { renderedPng, unrenderedPng } from "../../../pngFixture.js";
import { fakeTransport, inOrder, capture as sharedCapture } from "../../../walkTransportFake.js";

const TENANT = "https://team-example.trelica.app";

/**
 * What is TRELICA's about a capture, layered over the shared fake's own defaults: this client's pages each
 * make one first-party call to the apps API, and the shell titles every page with the bare product name.
 */
const TRELICA_PAGE: Partial<PageCapture> = {
  responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 4 },
  responses: [
    {
      body: { items: [{ id: "a" }], total: 1 },
      method: "POST",
      statusCode: 200,
      url: `${TENANT}/AppsApi/AppCatalog/FilterItems?skip=0&take=20`,
    },
  ],
  title: "App catalog",
};

/** A capture that reached the page it was asked for and made one first-party call. */
function capture(over: Partial<PageCapture> = {}): PageCapture {
  return sharedCapture({ over: { ...TRELICA_PAGE, ...over }, url: `${TENANT}/Catalog` });
}

/**
 * The shared fake, answering one scripted capture per visit in the order the walk asks.
 *
 * Each entry is a PARTIAL, so the fake stamps `requestedUrl` and `finalUrl` from the address the walk
 * actually asked for — which is what makes a redirect assertion about the walk rather than about the fixture.
 */
function scripted({ pages }: { pages: readonly Partial<PageCapture>[] }): BrowserPageTransport {
  return fakeTransport({
    answer: inOrder({ visits: pages.map((over) => ({ capture: { ...TRELICA_PAGE, ...over } })) }),
  }).transport;
}

/** A writer that always succeeds, so a screenshot's presence is decided by the capture alone. */
const acceptingWriter: TrelicaArtifactWriter = () => ok(null);

/** A writer that always refuses, so a stored-shot failure is a first-class outcome in a test. */
const refusingWriter: TrelicaArtifactWriter = () => err(["the disk is full"]);

describe("trelicaScreenshotArtifact", () => {
  it("addresses a screenshot by the digest of its own bytes", () => {
    const artifact = trelicaScreenshotArtifact({ bytes: new Uint8Array([1, 2, 3]) });
    expect(artifact.byteLength).toBe(3);
    expect(artifact.kind).toBe("page-png");
    expect(artifact.relativePath).toBe(`artifacts/pages/${artifact.sha256}.png`);
  });

  it("gives identical bytes one identical path", () => {
    const left = trelicaScreenshotArtifact({ bytes: new Uint8Array([9, 9]) });
    const right = trelicaScreenshotArtifact({ bytes: new Uint8Array([9, 9]) });
    expect(left.relativePath).toBe(right.relativePath);
  });
});

describe("trelicaPageOutcome", () => {
  it("holds a page that settled where it was asked and did something", () => {
    const outcome = trelicaPageOutcome({
      capture: capture(),
      firstPartyCallCount: 1,
      requestedUrl: `${TENANT}/Catalog`,
    });
    expect(outcome.redirected).toBe(false);
    expect(outcome.unreachableBecause).toBe(null);
  });

  it("tolerates a query string the client restored its own view state with", () => {
    const outcome = trelicaPageOutcome({
      capture: capture({ finalUrl: `${TENANT}/Catalog?view=grid` }),
      firstPartyCallCount: 1,
      requestedUrl: `${TENANT}/Catalog`,
    });
    expect(outcome.redirected).toBe(false);
    expect(outcome.unreachableBecause).toBe(null);
  });

  it("names the origin when the client settled somewhere else entirely", () => {
    const outcome = trelicaPageOutcome({
      capture: capture({ finalUrl: "https://app.trelica.com/Account/Login" }),
      firstPartyCallCount: 0,
      requestedUrl: `${TENANT}/Catalog`,
    });
    expect(outcome.redirected).toBe(true);
    expect(outcome.unreachableBecause).toContain("https://app.trelica.com");
  });

  it("refuses a page whose declared parameter the client answered with another value", () => {
    const outcome = trelicaPageOutcome({
      capture: capture({ finalUrl: `${TENANT}/Catalog?appId=beta` }),
      firstPartyCallCount: 1,
      requestedUrl: `${TENANT}/Catalog?appId=alpha`,
    });
    expect(outcome.redirected).toBe(true);
    expect(outcome.unreachableBecause).toContain("dropped or changed a query parameter");
  });

  it("names the path when the client kept the origin and moved the page", () => {
    const outcome = trelicaPageOutcome({
      capture: capture({ finalUrl: `${TENANT}/Home/Dashboard` }),
      firstPartyCallCount: 1,
      requestedUrl: `${TENANT}/Catalog`,
    });
    expect(outcome.redirected).toBe(true);
    expect(outcome.unreachableBecause).toBe("the client sent this page to /Home/Dashboard instead");
  });

  it("names a path it does not declare only as a marker, never as the client wrote it", () => {
    const outcome = trelicaPageOutcome({
      capture: capture({ finalUrl: `${TENANT}/Admin/Integrations/hunter2` }),
      firstPartyCallCount: 1,
      requestedUrl: `${TENANT}/Catalog`,
    });
    expect(outcome.redirected).toBe(true);
    expect(outcome.unreachableBecause).toBe(`the client sent this page to ${TRELICA_UNDECLARED_PATH} instead`);
  });

  it("names a foreign origin only as a marker", () => {
    const outcome = trelicaPageOutcome({
      capture: capture({ finalUrl: "https://hunter2.example/Catalog" }),
      firstPartyCallCount: 1,
      requestedUrl: `${TENANT}/Catalog`,
    });
    expect(outcome.unreachableBecause).toBe("the client settled on an origin that is not the tenant's own");
  });

  it("refuses to hold the empty shell a route the app does not have renders", () => {
    const outcome = trelicaPageOutcome({
      capture: capture({ finalUrl: `${TENANT}/Admin`, title: TRELICA_SHELL_TITLE }),
      firstPartyCallCount: 0,
      requestedUrl: `${TENANT}/Admin`,
    });
    expect(outcome.redirected).toBe(false);
    expect(outcome.unreachableBecause).toContain("empty shell");
  });

  it("holds a page titled with the bare product name that DID call something", () => {
    const outcome = trelicaPageOutcome({
      capture: capture({ title: TRELICA_SHELL_TITLE }),
      firstPartyCallCount: 3,
      requestedUrl: `${TENANT}/Catalog`,
    });
    expect(outcome.unreachableBecause).toBe(null);
  });
});

describe("walkTrelicaWebApp", () => {
  it("reduces a page's own calls and drops the third-party telemetry beside them", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 1),
        tenantOrigin: TENANT,
        transport: scripted({
          pages: [
            {
              responses: [
                ...capture().responses,
                { body: { code: 200 }, method: "POST", statusCode: 200, url: "https://api.eu.amplitude.com/2/httpapi" },
              ],
            },
          ],
        }),
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walked.pages.length).toBe(1);
    expect(walked.pages[0]!.calls.length).toBe(1);
    expect(walked.pages[0]!.calls[0]!.pathShape).toBe("/AppsApi/AppCatalog/FilterItems");
  });

  it("stops the walk at a sign-in landing and records the rest as not attempted", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 3),
        tenantOrigin: TENANT,
        transport: scripted({ pages: [{ finalUrl: "https://app.trelica.com/Account/Login", title: "Log in" }] }),
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walked.sessionLost).toBe(true);
    expect(walked.pages.map((page) => page.attempted)).toEqual([true, false, false]);
    expect(walked.pages[1]!.screenshotMissingBecause).toBe("the page was never visited");
  });

  it("stops the walk at the tenant's own sign-in page, naming it rather than the vendor origin", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-10-19T17:10:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 2),
        tenantOrigin: TENANT,
        transport: scripted({ pages: [{ finalUrl: `${TENANT}/Account/Login?ReturnUrl=%2F`, title: "Log in" }] }),
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walked.sessionLost).toBe(true);
    expect(walked.pages.map((page) => page.attempted)).toEqual([true, false]);
    expect(walked.pages[0]!.finalUrl).toBe(`${TENANT}/Account/Login`);
    expect(walked.pages[0]!.unreachableBecause).toBe(
      `the client sent this page to the sign-in page at ${TENANT}/Account/Login — the session is gone, so the rest of the walk was not attempted`,
    );
  });

  it("records a reached page that could not be photographed as an incomplete observation", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 1),
        tenantOrigin: TENANT,
        transport: scripted({ pages: [{ screenshotPng: null }] }),
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walked.pages[0]!.unreachableBecause).toBe(null);
    expect(walked.pages[0]!.artifacts.length).toBe(0);
    expect(walked.pages[0]!.screenshotMissingBecause).toContain("could not photograph");
  });

  it("withdraws the screenshot claim when the writer could not store it", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 1),
        tenantOrigin: TENANT,
        transport: scripted({ pages: [{}] }),
        writeArtifact: refusingWriter,
      }),
    );
    expect(walked.pages[0]!.artifacts.length).toBe(0);
    expect(walked.pages[0]!.screenshotMissingBecause).toContain("the disk is full");
  });

  it("withdraws the screenshot claim when the page was still loading in both looks", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 1),
        tenantOrigin: TENANT,
        transport: scripted({
          pages: [{ screenshotPng: unrenderedPng() }, { screenshotPng: unrenderedPng() }],
        }),
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walked.pages[0]!.artifacts.length).toBe(0);
    expect(walked.pages[0]!.screenshotMissingBecause).toBe(UNRENDERED_SCREENSHOT_BECAUSE);
  });

  it("keeps the picture from the second look when the first was still loading", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 1),
        tenantOrigin: TENANT,
        transport: scripted({
          pages: [{ screenshotPng: unrenderedPng() }, { screenshotPng: renderedPng() }],
        }),
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walked.pages[0]!.screenshotMissingBecause).toBe(null);
    expect(walked.pages[0]!.artifacts.length).toBe(1);
  });

  it("carries a lost body out as a number rather than a silence", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 1),
        tenantOrigin: TENANT,
        transport: scripted({
          pages: [{ responseAccounting: { bodyFailed: 2, bodySucceeded: 1, eligible: 3, seen: 9 } }],
        }),
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walked.pages[0]!.captureComplete).toBe(false);
    expect(walked.pages[0]!.responseAccounting.bodyFailed).toBe(2);
  });

  it("photographs nothing when a declared page redirects to one that renders provider-written text", async () => {
    const written: string[] = [];
    const recordingWriter: TrelicaArtifactWriter = ({ relativePath }) => {
      written.push(relativePath);
      return ok(null);
    };
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 1),
        tenantOrigin: TENANT,
        transport: scripted({
          pages: [{ finalUrl: `${TENANT}${TRELICA_UNPHOTOGRAPHED_PAGES[1]!.path}`, screenshotPng: renderedPng() }],
        }),
        writeArtifact: recordingWriter,
      }),
    );
    expect(TRELICA_UNPHOTOGRAPHED_PAGES[1]!.path).toBe("/Admin/Integrations");
    expect(walked.pages[0]!.redirected).toBe(true);
    expect(walked.pages[0]!.artifacts.length).toBe(0);
    expect(written).toEqual([]);
    expect(walked.pages[0]!.screenshotMissingBecause).toBe(
      "not photographed, because the page is not held as declared: the client sent this page to /Admin/Integrations instead",
    );
  });

  it("holds a redirect's destination and title only in closed form, on the observation and the projected page", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 1),
        tenantOrigin: TENANT,
        transport: scripted({
          pages: [
            {
              finalUrl: `${TENANT}/Admin/Integrations/hunter2?error=hunter2`,
              screenshotPng: renderedPng(),
              title: "hunter2 failed",
            },
          ],
        }),
        writeArtifact: acceptingWriter,
      }),
    );
    const projected = projectTrelicaPages({ at: "2026-09-05T00:00:00.000Z", pages: walked.pages });

    expect(walked.pages[0]!.redirected).toBe(true);
    expect(walked.pages[0]!.finalUrl).toBe(TRELICA_UNDECLARED_PATH);
    expect(walked.pages[0]!.title).toBe(TRELICA_PROVIDER_TEXT_WITHHELD);
    expect(walked.pages[0]!.screenshotMissingBecause).toBe(
      `not photographed, because the page is not held as declared: the client sent this page to ${TRELICA_UNDECLARED_PATH} instead`,
    );
    expect(JSON.stringify(walked)).not.toContain("hunter2");
    expect(JSON.stringify(projected)).toContain(TRELICA_UNDECLARED_PATH);
    expect(JSON.stringify(projected)).not.toContain("hunter2");
  });

  it("holds a page that settled where it was declared at its own address, query dropped, its title closed", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 2),
        tenantOrigin: TENANT,
        transport: scripted({
          pages: [
            { finalUrl: `${TENANT}/Catalog?view=grid`, title: "401: Unauthorized - token=hunter2" },
            { title: ` ${TRELICA_SHELL_TITLE} ` },
          ],
        }),
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walked.pages.map((page) => page.finalUrl)).toEqual([`${TENANT}/Catalog`, `${TENANT}/Catalog/AppRequests`]);
    expect(walked.pages.map((page) => page.title)).toEqual([TRELICA_PROVIDER_TEXT_WITHHELD, TRELICA_SHELL_TITLE]);
    expect(JSON.stringify(walked)).not.toContain("hunter2");
  });

  it("keeps a row for a page the transport could not visit at all", async () => {
    const walked = unwrap(
      await walkTrelicaWebApp({
        nowIso: () => "2026-09-05T00:00:00.000Z",
        pages: TRELICA_BROWSER_PAGES.slice(0, 1),
        tenantOrigin: TENANT,
        transport: scripted({ pages: [] }),
        writeArtifact: acceptingWriter,
      }),
    );
    expect(walked.pages[0]!.attempted).toBe(true);
    expect(walked.pages[0]!.unreachableBecause).toContain("ran out of captures");
    expect(walked.sessionLost).toBe(false);
  });
});

describe("TRELICA_BROWSER_PAGES", () => {
  it("walks none of the pages that render provider-written text", () => {
    const walked = new Set(TRELICA_BROWSER_PAGES.map((page) => page.path));

    expect(TRELICA_UNPHOTOGRAPHED_PAGES.length).toBeGreaterThan(0);
    expect(TRELICA_UNPHOTOGRAPHED_PAGES.filter((page) => walked.has(page.path))).toEqual([]);
  });
});
