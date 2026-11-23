/*
 * How `walkNotionBrowser` photographs each reached page: one stored screenshot per page, a second look at one
 * still loading, and a page with no screenshot, an unrendered one or an unstored one recorded as not
 * photographed.
 */
import { describe, expect, it } from "vitest";

import { UNRENDERED_SCREENSHOT_BECAUSE } from "../../../../../atlas/kit/browserWalk.js";
import { NOTION_WEB_ORIGIN } from "../../../../../atlas/notion/browserPages.js";
import { walkNotionBrowser } from "../../../../../atlas/notion/browserWalk.js";
import { err, unwrap } from "../../../../../lib/result.js";
import { renderedPng, unrenderedPng } from "../../../../pngFixture.js";

import { fakeTransport } from "../../../../walkTransportFake.js";
import { bySurface, probeVisit, recordingWriter } from "./harness.js";

describe("walkNotionBrowser", () => {
  it("stores one screenshot per reached page", async () => {
    const fake = fakeTransport({ visits: probeVisit() });
    const writer = recordingWriter();
    const walked = unwrap(await walkNotionBrowser({ transport: fake.transport, writeArtifact: writer.write }));
    expect(writer.stored.length).toBe(walked.pages.filter((page) => page.attempted).length);
  });

  it("records a page that came back with no screenshot as reached but not photographed", async () => {
    const url = `${NOTION_WEB_ORIGIN}/space/my-account`;
    const fake = fakeTransport({ visits: { ...probeVisit(), [url]: { capture: { screenshotPng: null } } } });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    const page = bySurface({ pages: walked.pages, surface: "account-profile" });
    expect(page.screenshotMissingBecause).toBe("the page was reached but the browser returned no screenshot for it");
  });

  it("records a page still loading in both looks as reached but not photographed", async () => {
    const url = `${NOTION_WEB_ORIGIN}/space/my-account`;
    const fake = fakeTransport({
      visits: { ...probeVisit(), [url]: { capture: { screenshotPng: unrenderedPng() } } },
    });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    const page = bySurface({ pages: walked.pages, surface: "account-profile" });
    expect(page.screenshotMissingBecause).toBe(UNRENDERED_SCREENSHOT_BECAUSE);
    expect(page.artifacts).toEqual([]);
  });

  it("looks at a still-loading page again and holds it when the second look rendered", async () => {
    const url = `${NOTION_WEB_ORIGIN}/space/my-account`;
    const fake = fakeTransport({
      visits: {
        ...probeVisit(),
        [url]: {
          capture: { screenshotPng: unrenderedPng() },
          thenCapture: { screenshotPng: renderedPng({ seed: 5 }) },
        },
      },
    });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    const page = bySurface({ pages: walked.pages, surface: "account-profile" });
    expect(page.screenshotMissingBecause).toBe(null);
    expect(fake.visited.filter((seen) => seen === url).length).toBe(2);
  });

  it("records a page whose screenshot could not be stored as not photographed", async () => {
    const fake = fakeTransport({ visits: probeVisit() });
    const walked = unwrap(
      await walkNotionBrowser({
        transport: fake.transport,
        writeArtifact: () => err(["the disk is full"]),
      }),
    );
    expect(bySurface({ pages: walked.pages, surface: "account-profile" }).screenshotMissingBecause).toContain(
      "the disk is full",
    );
  });

  it("keeps no artifact reference for a screenshot that was not stored", async () => {
    const fake = fakeTransport({ visits: probeVisit() });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: () => err(["the disk is full"]) }),
    );
    expect(bySurface({ pages: walked.pages, surface: "account-profile" }).artifacts).toEqual([]);
  });
});
