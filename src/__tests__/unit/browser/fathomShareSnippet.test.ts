/**
 * Unit: the Fathom share snippet, checked on the source it hands the terminal client — it navigates to the
 * one address it was given, polls for the page's cues within its declared bound, and presses nothing.
 */
import { describe, expect, it } from "vitest";

import { FATHOM_CUES_WAIT_MS, fathomShareTranscriptSnippet } from "../../../browser/fathomShareSnippet.js";

const URL = "https://fathom.video/share/cPAstBybUhyaoL9wD_xuMQK_byssuMG_";
const SOURCE = fathomShareTranscriptSnippet({ settleMs: 4_000, url: URL });

describe("fathomShareTranscriptSnippet", () => {
  it("navigates to exactly the address it was given and settles for the declared time", () => {
    expect(SOURCE).toContain(`await page.goto(${JSON.stringify(URL)},`);
    expect(SOURCE).toContain("await page.waitForTimeout(4000);");
  });

  it("bounds the poll for the cues by its own declared wait", () => {
    expect(FATHOM_CUES_WAIT_MS).toBe(20_000);
    expect(SOURCE).toContain("const deadline = Date.now() + 20000;");
  });

  it("reads the page element's own cue property and drops provider notes in the page", () => {
    expect(SOURCE).toContain('document.querySelector("page-call-detail")');
    expect(SOURCE).toContain("host.transcriptCues");
    expect(SOURCE).toContain("if (entry && entry.note) { droppedNotes += 1; continue; }");
  });

  it("presses, types and fills nothing on the page", () => {
    expect(SOURCE.includes(".click(")).toBe(false);
    expect(SOURCE.includes(".fill(")).toBe(false);
    expect(SOURCE.includes("keyboard")).toBe(false);
  });
});
