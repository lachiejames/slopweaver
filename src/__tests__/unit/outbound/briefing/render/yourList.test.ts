/*
 * The owner's ranked list on the rendered page: each row as `div.mine` so the unfolded-block budget stays the cards' own,
 * numbered from its own rank, with a close marked and every unshown row counted rather than cut silently.
 */
import { describe, expect, it } from "vitest";

import { renderBriefing, renderYourList, renderYourRow } from "../../../../../outbound/briefing/render.js";
import { FORM, yourRow } from "./harness.js";

describe("the one-index sections on the rendered page", () => {
  it("renders the owner's rows as `div.mine`, so the page's unfolded-block budget stays the cards' own", () => {
    const html = renderBriefing({
      form: {
        ...FORM,
        yourList: {
          notShown: 0,
          readIso: FORM.header.readyIso,
          rows: [yourRow({ over: {} })],
          source: "session-start",
        },
      },
    });

    expect(html).toContain('<div class="mine"><div class="q">1. Land the render verb yourself.</div></div>');
    expect([...html.matchAll(/<div class="need"/g)].length).toBe(4);
  });

  it("numbers a row from its own rank and marks a close before the headline", () => {
    const html = renderYourRow({ row: yourRow({ over: { closing: true, rank: 4 } }) });

    expect(html).toContain('<div class="q">4. CLOSE — Land the render verb yourself.</div>');
  });

  it("states how many ranked rows it is not showing rather than cutting them silently", () => {
    const lines = renderYourList({
      header: FORM.header,
      list: { notShown: 56, readIso: FORM.header.readyIso, rows: [yourRow({ over: {} })], source: "session-start" },
    });

    expect(lines.at(-2)).toBe('  <p class="sub">56 more ranked rows are not shown here.</p>');
  });

  it("names what a list cut short at its deadline did not read, in the section's own summary", () => {
    const lines = renderYourList({
      header: FORM.header,
      list: {
        cutShort: ["your mail", "the live re-read"],
        notShown: 0,
        readIso: FORM.header.readyIso,
        rows: [yourRow({ over: {} })],
        source: "session-start",
      },
    });

    expect(lines[1]).toContain(
      "before this page was rendered. Cut short, not read: your mail, the live re-read</summary>",
    );
  });

  it("says nothing about a cut when the list is whole", () => {
    const lines = renderYourList({
      header: FORM.header,
      list: { notShown: 0, readIso: FORM.header.readyIso, rows: [yourRow({ over: {} })], source: "session-start" },
    });

    expect(lines[1]).toContain("before this page was rendered</summary>");
  });

  it("says nothing about unshown rows when it is showing all of them", () => {
    const lines = renderYourList({
      header: FORM.header,
      list: { notShown: 0, readIso: FORM.header.readyIso, rows: [yourRow({ over: {} })], source: "session-start" },
    });

    expect(lines.some((line) => line.includes("not shown"))).toBe(false);
  });
});
