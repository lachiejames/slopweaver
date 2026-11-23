/*
 * The visit snippet's screenshot is bounded and activates the tab before its second try, and a page that may not be
 * photographed gets no screenshot call at all.
 */
import { describe, expect, it } from "vitest";

import { pageVisitSnippet, SCREENSHOT_TIMEOUT_MS } from "../../../../browser/playwrightCli.js";

describe("the visit snippet's screenshot is bounded and activates the tab before its second try", () => {
  const snippetFor = ({ photograph }: { photograph: boolean }) =>
    pageVisitSnippet({
      photograph,
      screenshotPath: "/scratch/1.png",
      settleMs: 1200,
      url: "https://app.notion.com/settings",
    });

  it("bounds the capture rather than inheriting Playwright's own default", () => {
    // Unbounded, a wedged capture cost 30s of the walk's time per remaining page — measured.
    expect(snippetFor({ photograph: true })).toContain(`timeout: ${String(SCREENSHOT_TIMEOUT_MS)}`);
  });

  it("takes exactly two attempts and activates the tab before the second", () => {
    const snippet = snippetFor({ photograph: true });
    expect(snippet).toContain("attempt <= 2 && !screenshotWritten");
    expect(snippet.indexOf("page.bringToFront()")).toBeGreaterThan(0);
  });

  it("emits no screenshot call at all for a page that may not be photographed", () => {
    const snippet = snippetFor({ photograph: false });
    expect(snippet).not.toContain("page.screenshot");
    expect(snippet).not.toContain("page.bringToFront");
  });
});
