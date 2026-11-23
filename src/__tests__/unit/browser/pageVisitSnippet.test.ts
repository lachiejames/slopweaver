/**
 * The page-visit snippet's SOURCE: its caps, how caller values are embedded, and the order its fixed
 * statements run in. This is source generation only — no browser runs here.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_BODY_BYTES,
  MAX_LINKS_PER_PAGE,
  MAX_RESPONSES_PER_PAGE,
  NAVIGATION_TIMEOUT_MS,
  pageVisitSnippet,
  RESPONSE_HOOK,
  SCREENSHOT_TIMEOUT_MS,
} from "../../../browser/pageVisitSnippet.js";

/** How many times `needle` appears in `text`. */
function occurrences({ text, needle }: { text: string; needle: string }): number {
  return text.split(needle).length - 1;
}

/** A URL and a path carrying a quote and a line break, so escaping is exercised rather than assumed. */
const HOSTILE = {
  screenshotPath: '/tmp/shots/a"b\nc.png',
  settleMs: 2500,
  url: 'https://console.example.test/p?q="x"\nnext',
};

describe("the page-visit caps", () => {
  it("hold their measured values", () => {
    expect(SCREENSHOT_TIMEOUT_MS).toBe(8000);
    expect(MAX_BODY_BYTES).toBe(1_048_576);
    expect(MAX_RESPONSES_PER_PAGE).toBe(200);
    expect(NAVIGATION_TIMEOUT_MS).toBe(45_000);
    expect(MAX_LINKS_PER_PAGE).toBe(500);
  });
});

describe("pageVisitSnippet", () => {
  const photographed = pageVisitSnippet({ ...HOSTILE, photograph: true });
  const unphotographed = pageVisitSnippet({ ...HOSTILE, photograph: false });

  it("embeds the URL, settle time and screenshot path as JSON literals, quote and line break escaped", () => {
    expect(photographed).toContain('  const url = "https://console.example.test/p?q=\\"x\\"\\nnext";\n');
    expect(photographed).toContain("  const settleMs = 2500;\n");
    expect(photographed).toContain('  const screenshotPath = "/tmp/shots/a\\"b\\nc.png";\n');
  });

  it("embeds every cap as a literal in the source", () => {
    expect(photographed).toContain("  const maxBodyBytes = 1048576;\n");
    expect(photographed).toContain("  const maxResponses = 200;\n");
    expect(photographed).toContain("  const maxLinks = 500;\n");
    expect(photographed).toContain('await page.goto(url, { timeout: 45000, waitUntil: "load" });');
    expect(photographed).toContain("await page.screenshot({ fullPage: true, path: screenshotPath, timeout: 8000 });");
  });

  it("installs the response hook exactly once, before navigation", () => {
    expect(occurrences({ needle: RESPONSE_HOOK, text: photographed })).toBe(1);
    expect(photographed.indexOf('page.on("response"')).toBeLessThan(photographed.indexOf("page.goto(url"));
  });

  it("drains pending bodies before collecting links, and collects links before photographing", () => {
    const drain = photographed.indexOf("await Promise.all(pending.splice(0, pending.length));");
    const links = photographed.indexOf('page.$$eval("a[href]"');
    const shot = photographed.indexOf("page.screenshot(");
    expect(drain).toBeGreaterThan(photographed.indexOf("page.goto(url"));
    expect(drain).toBeLessThan(links);
    expect(links).toBeLessThan(shot);
  });

  it("emits one bounded full-page capture in a two-attempt loop, activating the tab only before the retry", () => {
    expect(occurrences({ needle: "page.screenshot(", text: photographed })).toBe(1);
    expect(occurrences({ needle: "await page.bringToFront();", text: photographed })).toBe(1);
    expect(occurrences({ needle: "attempt <= 2 && !screenshotWritten", text: photographed })).toBe(1);
    expect(photographed.indexOf("if (attempt === 2)")).toBeLessThan(photographed.indexOf("page.bringToFront"));
  });

  it("emits no screenshot and no tab activation for a page that may not be photographed", () => {
    expect(unphotographed).toContain(
      "  // This page may not be photographed, so no screenshot is requested and no bytes are produced.\n",
    );
    expect(occurrences({ needle: "page.screenshot(", text: unphotographed })).toBe(0);
    expect(occurrences({ needle: "bringToFront", text: unphotographed })).toBe(0);
  });
});
