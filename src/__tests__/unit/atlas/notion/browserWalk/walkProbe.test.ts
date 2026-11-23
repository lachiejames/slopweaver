/*
 * How `walkNotionBrowser` acts on what its workspace probe found: no workspace-rooted page addressed when the
 * landing carried no workspace segment, and no walk at all when the probe could not reach the client.
 */
import { describe, expect, it } from "vitest";

import { NOTION_WEB_ORIGIN } from "../../../../../atlas/notion/browserPages.js";
import { walkNotionBrowser } from "../../../../../atlas/notion/browserWalk.js";
import { BrowserTransportErrors } from "../../../../../browser/pageTransport.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

import { fakeTransport } from "../../../../walkTransportFake.js";
import { bySurface, probeVisit, recordingWriter } from "./harness.js";

describe("walkNotionBrowser", () => {
  it("never addresses a workspace-rooted page when the probe found no workspace segment", async () => {
    const fake = fakeTransport({ visits: probeVisit({ landing: `${NOTION_WEB_ORIGIN}/space/home` }) });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(bySurface({ pages: walked.pages, surface: "workspace-settings" }).attempted).toBe(false);
  });

  it("says the probe LANDED with no workspace segment, never that its navigation failed", async () => {
    const fake = fakeTransport({ visits: probeVisit({ landing: `${NOTION_WEB_ORIGIN}/space/home` }) });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(bySurface({ pages: walked.pages, surface: "workspace-settings" }).unreachableBecause).toBe(
      "this page hangs off the workspace root and the probe found no workspace segment in the client's own landing URL",
    );
  });

  it("still walks every space-rooted page when the probe found no workspace segment", async () => {
    const fake = fakeTransport({ visits: probeVisit({ landing: `${NOTION_WEB_ORIGIN}/space/home` }) });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(bySurface({ pages: walked.pages, surface: "account-profile" }).attempted).toBe(true);
  });

  it("refuses to start at all when the client itself cannot be reached", async () => {
    const fake = fakeTransport({
      visits: {
        [`${NOTION_WEB_ORIGIN}/`]: {
          failWith: BrowserTransportErrors.unavailable({ reason: "Chrome is not running" }),
        },
      },
    });
    const walked = await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([
      "could not reach the Notion web client to learn its workspace: no browser transport is attached: Chrome is not running",
    ]);
  });

  it("refuses to start on a lost session at the probe, rather than walking a signed-out client", async () => {
    const fake = fakeTransport({
      visits: { [`${NOTION_WEB_ORIGIN}/`]: { failWith: BrowserTransportErrors.sessionLost({ reason: "signed out" }) } },
    });
    const walked = await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([
      `could not reach the Notion web client to learn its workspace: ${BrowserTransportErrors.sessionLost({ reason: "signed out" }).message}`,
    ]);
  });

  it("refuses to start when the probe was sent off the leased origin", async () => {
    const failure = BrowserTransportErrors.offLeaseOrigin({ reason: "not leased", url: `${NOTION_WEB_ORIGIN}/` });
    const fake = fakeTransport({ visits: { [`${NOTION_WEB_ORIGIN}/`]: { failWith: failure } } });
    const walked = await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([
      `could not reach the Notion web client to learn its workspace: ${failure.message}`,
    ]);
  });
});
