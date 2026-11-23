/*
 * A below-the-line note: the landed accent, its fold kept inside the block, and a quoted note's fold marked by
 * role with its own words escaped rather than rewritten.
 */
import { describe, expect, it } from "vitest";

import { renderNote } from "../../../../../outbound/briefing/render.js";
import { text } from "./harness.js";

describe("the briefing renderer", () => {
  it("gives a below-the-line note the landed accent and puts its fold inside the block", () => {
    const note = {
      detail: { blocks: [{ content: text({ value: "The rest." }), kind: "para" as const }], summary: "the rest" },
      headline: text({ value: "It landed." }),
    };

    expect(renderNote({ note })).toBe(
      '<div class="need" style="border-left-color:var(--ok)"><div class="q">It landed. ' +
        "<details><summary>the rest</summary><div><p>The rest.</p></div></details></div></div>",
    );
  });

  it("marks a QUOTED note's fold by role, and changes nothing else about it", () => {
    const detail = { blocks: [{ content: text({ value: "The rest." }), kind: "para" as const }], summary: "the rest" };

    expect(renderNote({ note: { detail, headline: text({ value: "It landed." }), lane: "quoted" } })).toBe(
      '<div class="need" style="border-left-color:var(--ok)"><div class="q">It landed. ' +
        '<details data-section="quoted"><summary>the rest</summary><div><p>The rest.</p></div></details></div></div>',
    );
  });

  it("escapes a quoted note's own words rather than rewriting them", () => {
    const detail = {
      blocks: [{ content: text({ value: "leave <this> & that exactly as I typed it" }), kind: "para" as const }],
      summary: "each one, exactly as typed",
    };

    expect(renderNote({ note: { detail, headline: text({ value: "1 thing said" }), lane: "quoted" } })).toContain(
      "<p>leave &lt;this&gt; &amp; that exactly as I typed it</p>",
    );
  });
});
