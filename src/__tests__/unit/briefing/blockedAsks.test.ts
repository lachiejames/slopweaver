/**
 * The briefing gate's blocked-on-human leg: a page whose react-now block does not LINK a thread waiting on
 * them is refused, and the refusal names what they have to do so a composer can write the card from it.
 */
import { describe, expect, it } from "vitest";
import { type BlockedAskPremise, checkBlockedAsks } from "../../../briefing/blockedAsks.js";

const WAITING: BlockedAskPremise = {
  channel: "C1",
  messageTs: "1785000000.000100",
  what: "sign in to Google Cloud locally so the monitor can deploy",
};

/** A page whose react-now block carries `body`, and whose later section carries `below`. */
function page({ body, below = "" }: { body: string; below?: string }): string {
  return `<h2 id="react-now">react now</h2>${body}<h2 id="in-flight">in flight</h2>${below}`;
}

const A_LINKED_CARD =
  '<div class="need"><div class="q">Can you sign in to Google Cloud?</div>' +
  '<dl class="f"><dt>options</dt><dd>A: Sign in, at ' +
  '<a href="https://example.slack.com/archives/C1/p1785000000000100">the thread</a>.</dd></dl></div>';

describe("the blocked-on-human leg of the briefing gate", () => {
  it("passes a page whose react-now block links the waiting thread", () => {
    const result = checkBlockedAsks({ blocked: [WAITING], html: page({ body: A_LINKED_CARD }) });
    expect(result.blocksChecked).toBe(1);
    expect(result.defects).toEqual([]);
  });

  it("refuses a page that carries no card for it, and names what they have to do", () => {
    const result = checkBlockedAsks({ blocked: [WAITING], html: page({ body: '<div class="need"></div>' }) });
    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.channel).toBe("C1");
    expect(result.defects[0]!.messageTs).toBe("1785000000.000100");
    expect(result.defects[0]!.reason).toContain("sign in to Google Cloud locally so the monitor can deploy");
  });

  it("refuses a page that links it only BELOW react-now — that is not where they look", () => {
    const result = checkBlockedAsks({ blocked: [WAITING], html: page({ below: A_LINKED_CARD, body: "" }) });
    expect(result.defects.length).toBe(1);
  });

  it("refuses a page with no react-now block at all rather than passing it silently", () => {
    const result = checkBlockedAsks({ blocked: [WAITING], html: "<h2>in flight</h2>" });
    expect(result.defects.length).toBe(1);
  });

  it("checks nothing and refuses nothing when nothing is waiting on the owner", () => {
    const result = checkBlockedAsks({ blocked: [], html: page({ body: "" }) });
    expect(result.blocksChecked).toBe(0);
    expect(result.defects).toEqual([]);
  });

  it("reports each unsurfaced block separately when several are waiting", () => {
    const second: BlockedAskPremise = { channel: "C2", messageTs: "1785000000.000200", what: "approve the deploy" };
    const result = checkBlockedAsks({ blocked: [WAITING, second], html: page({ body: A_LINKED_CARD }) });
    expect(result.blocksChecked).toBe(2);
    expect(result.defects.map((defect) => defect.messageTs)).toEqual(["1785000000.000200"]);
  });
});
