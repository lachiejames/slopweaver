/**
 * The two fragments every relay snippet opens and closes with.
 *
 * These are SOURCE built from data, so the property worth proving is that a caller supplies values and
 * never source: every interpolated value goes through `JSON.stringify`, so a URL or a path carrying a quote
 * closes nothing. The second property is the reporting contract — `failure`, `screenshotWritten` and
 * `screenshotError` are the exact field names every transport in this directory branches on.
 */
import { describe, expect, it } from "vitest";

import { gotoFragment, photographFragment } from "../../../browser/snippetParts.js";

describe("gotoFragment", () => {
  const url = "https://app.vanta.com/policies/x";

  it("navigates to the address it was given", () => {
    expect(gotoFragment({ settleMs: 6_000, url })).toContain(`page.goto("${url}"`);
  });

  it("waits the settle it was given, not a default of its own", () => {
    expect(gotoFragment({ settleMs: 6_000, url })).toContain("page.waitForTimeout(6000)");
  });

  // Every consumer of this fragment branches on `failure` first, so the field name is the contract.
  it("reports a navigation that threw as the `failure` field and nothing else", () => {
    expect(gotoFragment({ settleMs: 1, url })).toContain("JSON.stringify({ failure: String(error) })");
  });

  it("bounds the navigation, so a page that never loads does not hang the whole walk", () => {
    expect(gotoFragment({ settleMs: 1, url })).toContain("timeout: 45000");
  });

  it("waits for load rather than for the network to go idle", () => {
    expect(gotoFragment({ settleMs: 1, url })).toContain('waitUntil: "load"');
  });

  // A caller supplies DATA and never source: a quote in the address has to close nothing.
  it("bakes an address carrying a quote in as a JSON literal", () => {
    const hostile = 'https://evil.test/");process.exit(1);//';
    expect(gotoFragment({ settleMs: 1, url: hostile })).toContain(JSON.stringify(hostile));
  });

  it("leaves no raw copy of such an address in the source it emits", () => {
    const hostile = 'https://evil.test/");process.exit(1);//';
    expect(gotoFragment({ settleMs: 1, url: hostile })).not.toContain(`goto("${hostile}"`);
  });
});

describe("photographFragment", () => {
  const screenshotPath = "/tmp/shot.png";

  it("writes the PNG where it was told to", () => {
    expect(photographFragment({ screenshotPath })).toContain(`path: "${screenshotPath}"`);
  });

  it("photographs the whole page rather than the viewport", () => {
    expect(photographFragment({ screenshotPath })).toContain("fullPage: true");
  });

  it("brings the tab to the front first, because Chrome never answers an inactive one", () => {
    expect(photographFragment({ screenshotPath })).toContain("page.bringToFront()");
  });

  // A screenshot is EVIDENCE, never the operation: a page that will not photograph still reports what it did.
  it("declares both variables the consumers read, rather than throwing", () => {
    const source = photographFragment({ screenshotPath });
    expect(source).toContain("let screenshotWritten = false");
    expect(source).toContain("let screenshotError = null");
  });

  it("records the failure rather than letting it escape", () => {
    expect(photographFragment({ screenshotPath })).toContain("screenshotError = String(error)");
  });

  it("bounds the screenshot, so a tab that will not paint costs one page rather than the run", () => {
    expect(photographFragment({ screenshotPath })).toContain("timeout: 8000");
  });

  it("bakes a path carrying a quote in as a JSON literal", () => {
    const hostile = '/tmp/a".png';
    expect(photographFragment({ screenshotPath: hostile })).toContain(JSON.stringify(hostile));
  });
});
