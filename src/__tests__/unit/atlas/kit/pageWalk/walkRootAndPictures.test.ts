/**
 * The page walk's root probe and its pictures: the probe goes first and decides which pages can be addressed,
 * a failed probe is a walk that cannot start, and a page that comes back without a usable picture is named as
 * a gap rather than passed silently.
 */
import { describe, expect, it } from "vitest";

import { UNRENDERED_SCREENSHOT_BECAUSE } from "../../../../../atlas/kit/browserWalk.js";
import { isPageHeld, walkDeclaredPages } from "../../../../../atlas/kit/pageWalk.js";
import { BrowserTransportErrors, type PageCapture } from "../../../../../browser/pageTransport.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";

import { renderedPng, unrenderedPng } from "../../../../pngFixture.js";

import { fakeTransport, recordingWriter } from "../../../../walkTransportFake.js";

import { ORIGIN, PROBE, toySpec, withRoot } from "./harness.js";

describe("walkDeclaredPages", () => {
  it("asks for the platform's own probe first, before any declared page", async () => {
    const fake = withRoot();
    await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(fake.visited[0]).toBe(PROBE);
  });

  it("returns exactly one observation per declared page", async () => {
    const fake = withRoot();
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages.map((page) => page.surface)).toEqual(["one", "two", "three"]);
  });

  it("reports that the probe found a root", async () => {
    const fake = withRoot();
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.rootFound).toBe(true);
  });

  // A page that needs a root there is none of was never ASKED for, which is a different fact from a page
  // that was asked for and did not answer.
  it("records a root-rooted page as not attempted when the probe found no root", async () => {
    const fake = fakeTransport({ visits: { [PROBE]: { capture: { finalUrl: PROBE } } } });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages.find((page) => page.surface === "three")!.attempted).toBe(false);
  });

  it("names WHY a root-rooted page was not addressed, in the platform's own words", async () => {
    const fake = fakeTransport({ visits: { [PROBE]: { capture: { finalUrl: PROBE } } } });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages.find((page) => page.surface === "three")!.unreachableBecause).toBe(
      "this page hangs off a root the probe did not find",
    );
  });

  // A probe that cannot reach the client at all is a walk that cannot start, which is a different fact from
  // a walk that reached nothing — and the caller has to be able to tell them apart.
  it("refuses to start when the platform's own probe fails", async () => {
    const fake = fakeTransport({
      visits: { [PROBE]: { failWith: BrowserTransportErrors.unavailable({ reason: "no browser" }) } },
    });
    const walked = await walkDeclaredPages({
      spec: toySpec({ over: { resolveRoot: async () => err(["the client could not be reached"]) } }),
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)).toEqual(["the client could not be reached"]);
  });

  it("visits no declared page at all when the probe failed", async () => {
    const fake = fakeTransport({});
    await walkDeclaredPages({
      spec: toySpec({ over: { resolveRoot: async () => err(["the client could not be reached"]) } }),
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.visited).toEqual([]);
  });

  it("records a page the browser returned no picture for, rather than passing it silently", async () => {
    const noShot: Partial<PageCapture> = { screenshotPng: null };
    const fake = fakeTransport({
      defaultCapture: noShot,
      visits: { [PROBE]: { capture: { finalUrl: `${ORIGIN}/root/landed` } } },
    });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages.filter((page) => page.attempted && page.screenshotMissingBecause === null)).toEqual([]);
  });

  it("names a page still loading in both looks as a gap, rather than storing the spinner", async () => {
    const fake = withRoot({ visits: { [`${ORIGIN}/one`]: { capture: { screenshotPng: unrenderedPng() } } } });
    const writer = recordingWriter();
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: writer.write }),
    );
    const page = walked.pages.find((row) => row.requestedUrl === `${ORIGIN}/one`)!;
    expect(page.screenshotMissingBecause).toBe(UNRENDERED_SCREENSHOT_BECAUSE);
    expect(page.artifacts).toEqual([]);
    expect(isPageHeld({ page })).toBe(false);
  });

  it("looks at a still-loading page again, and holds it when the second look rendered", async () => {
    // Every page gets its own picture: the engine withdraws a page whose shot is byte-identical to another
    // one's, and the default fixture is one file, so a shared picture would fail this for the wrong reason.
    const fake = withRoot({
      visits: {
        [`${ORIGIN}/one`]: {
          capture: { screenshotPng: unrenderedPng() },
          thenCapture: { screenshotPng: renderedPng({ seed: 7 }) },
        },
        [`${ORIGIN}/two`]: { capture: { screenshotPng: renderedPng({ seed: 8 }) } },
        [`${ORIGIN}/root/landed/three`]: { capture: { screenshotPng: renderedPng({ seed: 9 }) } },
      },
    });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    const page = walked.pages.find((row) => row.requestedUrl === `${ORIGIN}/one`)!;
    expect(page.screenshotMissingBecause).toBe(null);
    expect(fake.visited.filter((url) => url === `${ORIGIN}/one`).length).toBe(2);
    expect(isPageHeld({ page })).toBe(true);
  });

  it("names the browser's own reason on a page the transport could not photograph", async () => {
    // The defect: Chrome timed out capturing an inactive tab, the transport dropped the reason,
    // and every walking atlas filed a gap saying only that no screenshot came back. A gap that cannot name
    // its cause got the defect attributed to the pull request that happened to land that morning.
    const fake = withRoot({
      visits: {
        [`${ORIGIN}/one`]: {
          capture: {
            screenshotBlockedBecause: "TimeoutError: page.screenshot: Timeout 8000ms exceeded.",
            screenshotPng: null,
          },
        },
      },
    });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    const page = walked.pages.find((row) => row.requestedUrl === `${ORIGIN}/one`)!;
    expect(page.screenshotMissingBecause).toBe(
      "the page was reached but the browser returned no screenshot for it: TimeoutError: page.screenshot: " +
        "Timeout 8000ms exceeded.",
    );
  });

  it("says only that none came back when the browser volunteered no reason", async () => {
    const fake = withRoot({
      visits: {
        [`${ORIGIN}/one`]: { capture: { screenshotBlockedBecause: null, screenshotPng: null } },
      },
    });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    const page = walked.pages.find((row) => row.requestedUrl === `${ORIGIN}/one`)!;
    expect(page.screenshotMissingBecause).toBe("the page was reached but the browser returned no screenshot for it");
  });

  it("records a page whose screenshot the writer refused, naming the writer's own reason", async () => {
    const fake = withRoot();
    const walked = unwrap(
      await walkDeclaredPages({
        spec: toySpec(),
        transport: fake.transport,
        writeArtifact: () => err(["disk full"]),
      }),
    );
    expect(walked.pages[0]!.screenshotMissingBecause).toContain("disk full");
  });
});
