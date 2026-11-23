/*
 * captureFrom tells a channel failure apart from a page failure: unparseable output or a closed session is the
 * session being lost, and any other snippet-reported failure is one page's own navigation failing.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { captureFrom } from "../../../../browser/playwrightCli.js";
import { unwrapErr } from "../../../../lib/result.js";
import { clientStdout, NOTION_LEASE } from "./harness.js";

describe("captureFrom tells a channel failure apart from a page failure", () => {
  const screenshotPath = join(tmpdir(), "capture-from-no-such-shot.png");
  const url = "https://app.notion.com/settings/members";

  // The page may well have loaded — what failed is the channel the answer returns on, and the two send a
  // reader to completely different places.
  it("reads unparseable output as the session being lost, not the page being missing", () => {
    const captured = captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: "not json at all",
      url,
    });
    expect(unwrapErr(captured).code).toBe("SESSION_LOST");
  });

  it("says the RESULT never came back, rather than blaming the page", () => {
    const captured = captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: "not json at all",
      url,
    });
    expect(unwrapErr(captured).message).toContain("its RESULT never came back");
  });

  it("grades a snippet-reported failure naming a closed session as the session being lost", () => {
    const captured = captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: clientStdout({ failure: "Error: Session closed" }),
      url,
    });
    expect(unwrapErr(captured).code).toBe("SESSION_LOST");
  });

  it("grades any other snippet-reported failure as one page's own navigation failing", () => {
    const captured = captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: clientStdout({ failure: "net::ERR_NAME_NOT_RESOLVED" }),
      url,
    });
    expect(unwrapErr(captured).code).toBe("NAVIGATION_FAILED");
  });
});
