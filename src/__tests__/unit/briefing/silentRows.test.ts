/**
 * The briefing gate's gone-quiet leg: a page whose react-now block does not NAME a standing row that has
 * stopped posting is refused, and the refusal carries the row's own reason so a composer can write the card
 * from it without a second read.
 */
import { describe, expect, it } from "vitest";

import { checkSilentRows } from "../../../briefing/silentRows.js";
import type { SilentRow } from "../../../live/automation/silentRows.js";

const STOPPED: SilentRow = {
  cadence: "30 9 * * *",
  currentSlotHold: null,
  detail:
    "2 slot(s) of `30 9 * * *` went by unrun; the verb ran and declined to act — a top-up generation is " +
    "still opening this batch: vulnfix-topup-acme-acme-admin-1789633808900",
  lastRunAtIso: "2026-09-16T03:46:41.000Z",
  missedSlots: 2,
  reason: "DEFERRED",
  recipeId: "vulnfix-digest-acme-admin",
};

/** A page whose react-now block carries `body`, and whose later section carries `below`. */
function page({ body, below = "" }: { body: string; below?: string }): string {
  return `<h2 id="react-now">react now</h2>${body}<h2 id="in-flight">in flight</h2>${below}`;
}

const A_CARD_NAMING_IT =
  '<div class="need"><div class="q">The daily vulnerability digest has stopped posting.</div>' +
  '<dl class="f"><dt>options</dt><dd>A: Look at <code>vulnfix-digest-acme-admin</code>.</dd></dl></div>';

describe("the gone-quiet leg of the briefing gate", () => {
  it("passes a page whose react-now block names the stopped row", () => {
    const result = checkSilentRows({ html: page({ body: A_CARD_NAMING_IT }), silent: [STOPPED] });

    expect(result.rowsChecked).toBe(1);
    expect(result.defects).toEqual([]);
  });

  it("refuses a page that carries no card for it, and the refusal carries the row's own reason", () => {
    const result = checkSilentRows({ html: page({ body: '<div class="need"></div>' }), silent: [STOPPED] });

    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.recipeId).toBe("vulnfix-digest-acme-admin");
    expect(result.defects[0]!.reason).toContain("(DEFERRED)");
    expect(result.defects[0]!.reason).toContain("vulnfix-topup-acme-acme-admin-1789633808900");
  });

  it("refuses a page that names it only BELOW react-now — that is not where they look", () => {
    const result = checkSilentRows({ html: page({ below: A_CARD_NAMING_IT, body: "" }), silent: [STOPPED] });

    expect(result.defects.length).toBe(1);
  });

  it("refuses a page with no react-now block at all rather than passing it silently", () => {
    const result = checkSilentRows({ html: "<h2>in flight</h2>", silent: [STOPPED] });

    expect(result.defects.length).toBe(1);
  });

  it("checks nothing and refuses nothing when every standing row is posting", () => {
    const result = checkSilentRows({ html: page({ body: "" }), silent: [] });

    expect(result.rowsChecked).toBe(0);
    expect(result.defects).toEqual([]);
  });

  it("reports each unnamed row separately when several have stopped", () => {
    const second: SilentRow = {
      cadence: "0 12 * * *",
      currentSlotHold: null,
      detail: "1 slot(s) of `0 12 * * *` went by unrun and it has never run at all",
      lastRunAtIso: null,
      missedSlots: 1,
      reason: "NEVER RUN",
      recipeId: "team-alerts-daily-alerts-dx",
    };
    const result = checkSilentRows({ html: page({ body: A_CARD_NAMING_IT }), silent: [STOPPED, second] });

    expect(result.rowsChecked).toBe(2);
    expect(result.defects.map((defect) => defect.recipeId)).toEqual(["team-alerts-daily-alerts-dx"]);
  });
});
