/**
 * The shape half of the briefing gate: react-now first, the groupings in order, both instants stated.
 *
 * These are the three rules the retired ranked-list page brought with it, so each test is written against
 * the failure it was measured on rather than against the code — a page that opens with something else, a
 * page whose groupings read the wrong way round, and a page whose freshness claim cannot be checked.
 */
import { describe, expect, it } from "vitest";

import { checkBriefingShape } from "../../../briefing/shape.js";

/** The eyebrow every rendered briefing carries, in `outbound/briefing/stamp.ts`'s own format. */
const EYEBROW =
  '<div class="eyebrow">supervisor ws:598 · last refreshed 2026-09-02 11:12:00 AEST · ' +
  "ready for review 2026-09-02 11:40:00 AEST</div>";

/** One card, in the exact skeleton the renderer emits. */
const CARD = '<div class="need"><div class="q">1. Ship it?</div></div>';

const TEAM_HEADING = '<h3 id="react-now-team">team-facing — this reaches a colleague</h3>';
const ME_HEADING = '<h3 id="react-now-me">yours — nobody else sees it</h3>';

/** A well-shaped page: the eyebrow, then react-now with both groupings, then everything else. */
const PAGE =
  `${EYEBROW}<h1>Fleet Briefing</h1><h2 id="react-now">react now</h2>` +
  `${TEAM_HEADING}${CARD}${ME_HEADING}${CARD}` +
  `<h2 id="your-list">your list</h2><div class="mine"><div class="q">1. Answer it.</div></div>` +
  `<h2 id="alignment">what we are actually working</h2>`;

/** Every rule the page broke, in the order the check reports them. */
function rules({ html }: { html: string }): readonly string[] {
  return checkBriefingShape({ html }).defects.map((defect) => defect.rule);
}

describe("checkBriefingShape", () => {
  it("passes the page the renderer emits", () => {
    const result = checkBriefingShape({ html: PAGE });

    expect(result.stamped).toBe(true);
    expect(result.defects).toEqual([]);
  });

  it("refuses a page whose list of the owner's opens above the cards", () => {
    const reordered =
      `${EYEBROW}<h1>Fleet Briefing</h1><h2 id="your-list">your list</h2>` +
      `<h2 id="react-now">react now</h2>${TEAM_HEADING}${CARD}`;

    expect(rules({ html: reordered })).toEqual(["react-now-not-first"]);
  });

  it("refuses a row or a fold sitting between the eyebrow and the cards", () => {
    const above =
      `${EYEBROW}<div class="mine"><div class="q">1. Answer it.</div></div>` +
      `<h2 id="react-now">react now</h2>${TEAM_HEADING}${CARD}`;

    expect(rules({ html: above })).toEqual(["above-the-cards"]);
  });

  it("names the missing block rather than every other rule when there is no react-now section at all", () => {
    expect(rules({ html: `${EYEBROW}<h1>Fleet Briefing</h1><h2 id="recent">done</h2>` })).toEqual([
      "no-react-now-block",
    ]);
  });

  it("finds the block on a page rendered before section ids existed, which the reader still has to judge", () => {
    const legacy = `${EYEBROW}<h1>Fleet Briefing</h1><h2>react now</h2>${CARD}<h2>done</h2>`;

    expect(checkBriefingShape({ html: legacy }).defects).toEqual([]);
  });

  it("refuses a page whose me-facing grouping renders above the team-facing one", () => {
    const swapped =
      `${EYEBROW}<h1>Fleet Briefing</h1><h2 id="react-now">react now</h2>` +
      `${ME_HEADING}${CARD}${TEAM_HEADING}${CARD}`;

    expect(rules({ html: swapped })).toEqual(["groupings-out-of-order"]);
  });

  it("says nothing about order on a page carrying only one grouping, which has no order to get wrong", () => {
    const one = `${EYEBROW}<h1>Fleet Briefing</h1><h2 id="react-now">react now</h2>${ME_HEADING}${CARD}`;

    expect(checkBriefingShape({ html: one }).defects).toEqual([]);
  });

  it("refuses a page carrying only its render instant, which is the page the owner stopped trusting", () => {
    const oneStamp =
      '<div class="eyebrow">supervisor ws:598 · ready for review 2026-09-02 11:40:00 AEST</div>' +
      `<h2 id="react-now">react now</h2>${CARD}`;
    const result = checkBriefingShape({ html: oneStamp });

    expect(result.stamped).toBe(false);
    expect(result.defects.map((defect) => defect.rule)).toEqual(["missing-stamps"]);
  });

  it("accepts a zone abbreviation a node build without full ICU data resolves to a GMT offset", () => {
    const gmt =
      '<div class="eyebrow">last refreshed 2026-09-02 11:12:00 GMT+10 · ready for review 2026-09-02 11:40:00 GMT+10</div>' +
      `<h2 id="react-now">react now</h2>${CARD}`;

    expect(checkBriefingShape({ html: gmt }).stamped).toBe(true);
  });

  it("never reads a stamp out of the chrome's own stylesheet", () => {
    const styled = `<style>.eyebrow { content: "last refreshed 2026-09-02 11:12:00 AEST"; }</style>${PAGE}`;

    expect(checkBriefingShape({ html: styled }).stamped).toBe(true);
  });
});
