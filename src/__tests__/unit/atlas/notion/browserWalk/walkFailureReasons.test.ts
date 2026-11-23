/*
 * What `walkNotionBrowser` records as a failed page's reason: never the page's address, nor any http address
 * at all, yet still which kind of failure it was.
 */
import { describe, expect, it } from "vitest";

import { NOTION_WEB_ORIGIN } from "../../../../../atlas/notion/browserPages.js";
import { walkNotionBrowser } from "../../../../../atlas/notion/browserWalk.js";
import { BrowserTransportErrors } from "../../../../../browser/pageTransport.js";
import { unwrap } from "../../../../../lib/result.js";

import { fakeTransport } from "../../../../walkTransportFake.js";
import { bySurface, probeVisit, recordingWriter } from "./harness.js";

describe("walkNotionBrowser", () => {
  // A Codex counterexample, kept as a test: the transport's own message interpolates the URL it was given,
  // and a Notion URL carries the workspace slug.
  it("never puts the failed page's ADDRESS in the reason it records", async () => {
    const url = `${NOTION_WEB_ORIGIN}/p/acme/settings`;
    const fake = fakeTransport({
      visits: {
        ...probeVisit(),
        [url]: {
          failWith: BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "timeout",
            url,
          }),
        },
      },
    });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    const reasons = walked.pages
      .flatMap((page) => (page.unreachableBecause === null ? [] : [page.unreachableBecause]))
      .join(" ");
    expect(reasons.includes("acme")).toBe(false);
  });

  it("records no http address at all in any page's reason", async () => {
    const url = `${NOTION_WEB_ORIGIN}/p/acme/settings`;
    const fake = fakeTransport({
      visits: {
        ...probeVisit(),
        [url]: {
          failWith: BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "timeout",
            url,
          }),
        },
      },
    });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    const reasons = walked.pages
      .flatMap((page) => (page.unreachableBecause === null ? [] : [page.unreachableBecause]))
      .join(" ");
    expect(reasons.includes("http")).toBe(false);
  });

  it("still says WHICH kind of failure it was, so the reason is actionable without the address", async () => {
    const url = `${NOTION_WEB_ORIGIN}/space/my-account`;
    const fake = fakeTransport({
      visits: { ...probeVisit(), [url]: { failWith: BrowserTransportErrors.sessionLost({ reason: "signed out" }) } },
    });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(bySurface({ pages: walked.pages, surface: "account-profile" }).unreachableBecause).toContain(
      "the browser session was lost",
    );
  });
});
