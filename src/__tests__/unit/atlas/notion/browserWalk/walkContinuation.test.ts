/*
 * Whether `walkNotionBrowser` stops or keeps walking after a failed page: a lost session ends the walk and
 * leaves every later page not-attempted, while a page that merely failed to navigate does not.
 */
import { describe, expect, it } from "vitest";

import { NOTION_BROWSER_PAGES, NOTION_WEB_ORIGIN } from "../../../../../atlas/notion/browserPages.js";
import { walkNotionBrowser } from "../../../../../atlas/notion/browserWalk.js";
import { BrowserTransportErrors } from "../../../../../browser/pageTransport.js";
import { unwrap } from "../../../../../lib/result.js";

import { fakeTransport } from "../../../../walkTransportFake.js";
import { probeVisit, recordingWriter } from "./harness.js";

describe("walkNotionBrowser", () => {
  it("stops the walk on a lost session, so one sign-out is not thirty false page gaps", async () => {
    const url = `${NOTION_WEB_ORIGIN}/space/my-account`;
    const fake = fakeTransport({
      visits: { ...probeVisit(), [url]: { failWith: BrowserTransportErrors.sessionLost({ reason: "signed out" }) } },
    });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.sessionLost).toBe(true);
  });

  it("marks every page after a lost session not-attempted rather than unreachable", async () => {
    const url = `${NOTION_WEB_ORIGIN}/space/my-account`;
    const fake = fakeTransport({
      visits: { ...probeVisit(), [url]: { failWith: BrowserTransportErrors.sessionLost({ reason: "signed out" }) } },
    });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages.filter((page) => page.attempted).length).toBe(1);
  });

  it("keeps walking after a page that merely failed to navigate", async () => {
    const url = `${NOTION_WEB_ORIGIN}/space/my-account`;
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
    expect(walked.pages.filter((page) => page.attempted).length).toBe(NOTION_BROWSER_PAGES.length);
  });
});
