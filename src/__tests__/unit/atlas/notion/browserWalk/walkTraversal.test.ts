/*
 * How `walkNotionBrowser` traverses: the probe first, then every declared page, reporting the workspace root
 * as found without ever returning it.
 */
import { describe, expect, it } from "vitest";

import { NOTION_BROWSER_PAGES, NOTION_WEB_ORIGIN } from "../../../../../atlas/notion/browserPages.js";
import { walkNotionBrowser } from "../../../../../atlas/notion/browserWalk.js";
import { unwrap } from "../../../../../lib/result.js";

import { fakeTransport } from "../../../../walkTransportFake.js";
import { probeVisit, recordingWriter } from "./harness.js";

describe("walkNotionBrowser", () => {
  it("asks for the probe first, so the workspace root is learned before anything is addressed", async () => {
    const fake = fakeTransport({ visits: probeVisit() });
    await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(fake.visited[0]).toBe(`${NOTION_WEB_ORIGIN}/`);
  });

  it("visits every declared page", async () => {
    const fake = fakeTransport({ visits: probeVisit() });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages.length).toBe(NOTION_BROWSER_PAGES.length);
  });

  it("reports the workspace root as found without ever returning it", async () => {
    const fake = fakeTransport({ visits: probeVisit() });
    const walked = unwrap(
      await walkNotionBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(JSON.stringify(walked.workspaceRootFound)).toBe("true");
  });
});
