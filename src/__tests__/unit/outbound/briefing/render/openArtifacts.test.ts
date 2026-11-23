/*
 * The ranked index of every open page, inside the react-now block: one line per page under an `<h3>`, each
 * validity mark stated with its provenance, omitted when nothing is open, and never sharing the standing band's
 * class. `openArtifact` and `matchCount` are used only here, so they stay here.
 */
import { describe, expect, it } from "vitest";

import { renderBriefing, renderOpenArtifacts } from "../../../../../outbound/briefing/render.js";
import type { BriefingOpenArtifact } from "../../../../../outbound/briefing/types.js";
import { FORM, NOW_ISO, text } from "./harness.js";

/** One line of the ranked open-artifact index. */
function openArtifact({ over }: { over: Partial<BriefingOpenArtifact> }): BriefingOpenArtifact {
  return {
    ask: text({ value: "Pick A or B on the scope split." }),
    label: "Scope split",
    landedIso: "2026-09-06T04:00:00Z",
    rank: 1,
    url: "https://example.invalid/page-1",
    validity: { mark: "valid" },
    ...over,
  };
}

/** How many times a pattern occurs in a page; `match` answers null rather than an empty list for none. */
function matchCount({ html, pattern }: { html: string; pattern: RegExp }): number {
  const matches = html.match(pattern);
  if (matches === null) {
    return 0;
  }
  return matches.length;
}

describe("the one-index sections on the rendered page", () => {
  it("puts the ranked index inside the react-now block, one line per open page", () => {
    const html = renderBriefing({
      form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts: [openArtifact({ over: {} })] } },
    });
    const reactNow = html.slice(html.indexOf('id="react-now"'), html.indexOf('id="alignment"'));

    expect(reactNow).toContain('<h3 id="react-now-artifacts">every open page, best first</h3>');
    expect(reactNow).toContain(
      '<p class="ranked">1. <a href="https://example.invalid/page-1">Scope split</a> — <span class="ask">Pick ' +
        'A or B on the scope split.</span> <span class="age" data-landed-iso="2026-09-06T04:00:00Z">landed ' +
        'after this page read the world</span> <span class="bg">2026-09-06 14:00:00 AEST</span> ' +
        '<span class="bg">still valid</span></p>',
    );
  });

  it("uses `<h3>` so the index cannot close the react-now region the gate reads", () => {
    const html = renderBriefing({
      form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts: [openArtifact({ over: {} })] } },
    });

    expect(html.indexOf('id="react-now-artifacts"')).toBeLessThan(html.indexOf('id="alignment"'));
    expect(html).not.toContain('<h2 id="react-now-artifacts"');
  });

  it("states a partly-ruled mark with the ruling's own date, so the claim carries its provenance", () => {
    const artifacts = [
      openArtifact({
        over: { validity: { mark: "partly-ruled", outcome: "edited", ruledIso: "2026-09-06T05:12:00Z" } },
      }),
    ];

    expect(renderOpenArtifacts({ artifacts, nowIso: NOW_ISO }).join("\n")).toContain(
      '<span class="bg">partly ruled 2026-09-06 (edited)</span>',
    );
  });

  it("links the page that superseded one, so it never moves the guess instead of removing it", () => {
    const artifacts = [
      openArtifact({
        over: { validity: { by: "Take two", byUrl: "https://example.invalid/take-two", mark: "superseded" } },
      }),
    ];

    expect(renderOpenArtifacts({ artifacts, nowIso: NOW_ISO }).join("\n")).toContain(
      '<span class="bg">superseded by <a href="https://example.invalid/take-two">Take two</a></span>',
    );
  });

  it("names a superseding page it has no address for, rather than saying nothing", () => {
    const artifacts = [openArtifact({ over: { validity: { by: "Take two", mark: "superseded" } } })];

    expect(renderOpenArtifacts({ artifacts, nowIso: NOW_ISO }).join("\n")).toContain(
      '<span class="bg">superseded by Take two</span>',
    );
  });

  it("omits the index entirely when no page is open on the owner", () => {
    expect(renderOpenArtifacts({ artifacts: [], nowIso: NOW_ISO })).toEqual([]);
  });

  it("never claims nothing is open while the ranked index carries a page", () => {
    const html = renderBriefing({
      form: {
        ...FORM,
        reactNow: { meFacing: [], openArtifacts: [openArtifact({ over: {} })], teamFacing: [] },
      },
    });

    expect(html).not.toContain("nothing open above the line right now");
    expect(html).toContain("every open page, best first");
  });

  it("does not share the standing band's class, which the one-index gate counts against the cap of three", () => {
    const html = renderBriefing({
      form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts: [openArtifact({ over: {} })] } },
    });

    expect(matchCount({ html, pattern: /<p class="await"/g })).toBe(0);
    expect(html.match(/<p class="ranked"/g)!.length).toBe(1);
  });
});
