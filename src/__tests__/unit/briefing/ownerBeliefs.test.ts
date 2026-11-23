/**
 * The correction block: the projection of the proposal queue, and the gate that reads the block back off the
 * rendered bytes.
 *
 * The two halves are tested in one file on purpose — the property that matters is that they AGREE, and a
 * change to the row's shape that broke the reader's regular expression would otherwise pass one file and
 * fail nothing.
 */
import { describe, expect, it } from "vitest";

import { OWNER_BELIEFS_MAX_ROWS } from "../../../briefing/caps.js";
import { NO_OWNER_BELIEFS, projectOwnerBeliefs } from "../../../briefing/ownerBeliefs.js";
import { checkOwnerBeliefs } from "../../../briefing/ownerBeliefsCheck.js";
import type { ProposedBelief, VoiceUnit } from "../../../knowledge/voice/types.js";
import { renderOwnerBeliefs } from "../../../outbound/briefing/render.js";

const AT = "2026-09-12T01:00:00.000Z";

/** One open proposal, varying only what a test overrides. */
const proposed = (over: Partial<ProposedBelief> = {}): ProposedBelief => ({
  claim: "The gold tier is being built up as the corpus grows.",
  domain: "slopweaver-corpus",
  held: "stated-uncertain",
  kind: "proposed",
  proposalId: "p-0123456789abcdef",
  quote: "do we ever build up that gold",
  reviewedAtIso: AT,
  run: "half-kept-ledger-a",
  unitId: "u-0123456789abcdef",
  ...over,
});

/** One unit, so the projection can read `wrapped` off something. */
const unit = (over: Partial<VoiceUnit> = {}): VoiceUnit => ({
  id: "u-0123456789abcdef",
  locator: "/tmp/tick-ledger.jsonl",
  occurrences: 1,
  source: "tick-ledger",
  text: "do we ever build up that gold",
  words: 7,
  wrapped: false,
  ...over,
});

/** A map of units by id, the shape the projection takes. */
const units = (...entries: readonly VoiceUnit[]): ReadonlyMap<string, VoiceUnit> =>
  new Map(entries.map((entry) => [entry.id, entry]));

/** A distinct proposal per index, so a test can build more of them than the cap allows. */
const nth = ({ index }: { index: number }): ProposedBelief =>
  proposed({ proposalId: `p-${String(index).padStart(16, "0")}`, unitId: `u-${String(index).padStart(16, "0")}` });

describe("projectOwnerBeliefs", () => {
  it("carries the claim, the quote and the hold through untouched", () => {
    const block = projectOwnerBeliefs({ open: [proposed()], units: units(unit()) });

    expect(block.rows[0]?.claim).toBe("The gold tier is being built up as the corpus grows.");
    expect(block.rows[0]?.quote).toBe("do we ever build up that gold");
    expect(block.rows[0]?.held).toBe("stated-uncertain");
    expect(block.rows[0]?.domain).toBe("slopweaver-corpus");
  });

  it("reads `wrapped` off the UNIT, because it is a property of where the owner's words were found", () => {
    const plain = projectOwnerBeliefs({ open: [proposed()], units: units(unit()) });
    const wrapped = projectOwnerBeliefs({ open: [proposed()], units: units(unit({ wrapped: true })) });

    expect(plain.rows[0]?.wrapped).toBe(false);
    expect(wrapped.rows[0]?.wrapped).toBe(true);
  });

  it("calls a proposal whose unit it can no longer find WRAPPED, never proven to be the owner's", () => {
    expect(projectOwnerBeliefs({ open: [proposed()], units: units() }).rows[0]?.wrapped).toBe(true);
  });

  it("states how many it is not showing, so the block never reads as everything", () => {
    const open = [nth({ index: 1 }), nth({ index: 2 }), nth({ index: 3 }), nth({ index: 4 }), nth({ index: 5 })];
    const block = projectOwnerBeliefs({ open, units: units() });

    expect(block.rows.length).toBe(OWNER_BELIEFS_MAX_ROWS);
    expect(block.notShown).toBe(open.length - OWNER_BELIEFS_MAX_ROWS);
  });

  it("shows the OLDEST open proposals, so one proposed once never sinks out of reach", () => {
    const block = projectOwnerBeliefs({
      open: [nth({ index: 1 }), nth({ index: 2 }), nth({ index: 3 }), nth({ index: 4 })],
      top: 2,
      units: units(),
    });

    expect(block.rows.map((row) => row.proposalId)).toEqual([
      nth({ index: 1 }).proposalId,
      nth({ index: 2 }).proposalId,
    ]);
  });

  it("is empty, and claims nothing, when they have answered everything", () => {
    expect(projectOwnerBeliefs({ open: [], units: units() })).toEqual(NO_OWNER_BELIEFS);
  });
});

describe("renderOwnerBeliefs", () => {
  it("renders nothing at all when nothing is open, rather than an empty heading", () => {
    expect(renderOwnerBeliefs({ ownerBeliefs: NO_OWNER_BELIEFS })).toEqual([]);
  });

  it("puts the proposal id on the visible line, because it is what they say back", () => {
    const html = renderOwnerBeliefs({
      ownerBeliefs: projectOwnerBeliefs({ open: [proposed()], units: units(unit()) }),
    }).join("\n");

    expect(html).toContain("<code>p-0123456789abcdef</code>");
  });

  it("offers all three of the owner's marks on every row", () => {
    const html = renderOwnerBeliefs({
      ownerBeliefs: projectOwnerBeliefs({ open: [proposed()], units: units(unit()) }),
    }).join("\n");

    expect(html).toContain("</span> right");
    expect(html).toContain("</span> wrong");
    expect(html).toContain("</span> partly");
  });

  it("keeps the claim outside the fold, so the budget that counts words can see it", () => {
    const html = renderOwnerBeliefs({
      ownerBeliefs: projectOwnerBeliefs({ open: [proposed()], units: units(unit()) }),
    }).join("\n");

    expect(html.indexOf("gold tier is being built up")).toBeLessThan(html.indexOf("<details"));
  });

  it("says a wrapped quote is the record rather than proven to be the owner's", () => {
    const html = renderOwnerBeliefs({
      ownerBeliefs: projectOwnerBeliefs({ open: [proposed()], units: units(unit({ wrapped: true })) }),
    }).join("\n");

    expect(html).toContain("proven to be yours");
  });

  it("escapes a claim carrying markup, so nothing a session composed can close the page's own tags", () => {
    const html = renderOwnerBeliefs({
      ownerBeliefs: projectOwnerBeliefs({
        open: [proposed({ claim: "The <script>alert(1)</script> pool exhausts." })],
        units: units(unit()),
      }),
    }).join("\n");

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("checkOwnerBeliefs", () => {
  /** The rendered block, as a whole page's worth of bytes. */
  const rendered = ({ open }: { open: readonly ProposedBelief[] }): string =>
    renderOwnerBeliefs({ ownerBeliefs: projectOwnerBeliefs({ open, top: open.length, units: units(unit()) }) }).join(
      "\n",
    );

  it("reads back exactly what the renderer emitted, with no defects", () => {
    const result = checkOwnerBeliefs({ html: rendered({ open: [proposed()] }) });

    expect(result.rowsChecked).toBe(1);
    expect(result.defects).toEqual([]);
  });

  it("counts every row, so the two halves cannot disagree about the block's size", () => {
    expect(checkOwnerBeliefs({ html: rendered({ open: [nth({ index: 1 }), nth({ index: 2 })] }) }).rowsChecked).toBe(2);
  });

  it("reports a page with no block at all as zero rows rather than as a defect", () => {
    const result = checkOwnerBeliefs({ html: "<main><h2>react now</h2></main>" });

    expect(result.rowsChecked).toBe(0);
    expect(result.defects).toEqual([]);
  });

  it("names a row that renders without its proposal id", () => {
    const html = rendered({ open: [proposed()] }).replace("<code>p-0123456789abcdef</code>", "<code>the first</code>");
    const defects = checkOwnerBeliefs({ html }).defects;

    expect(defects.map((defect) => defect.rule)).toEqual(["row-without-id"]);
    expect(defects[0]?.reason).toContain("knowledge answer");
  });

  it("names a row offering fewer than all three marks", () => {
    const html = rendered({ open: [proposed()] }).replace("</span> partly", "</span>");

    expect(checkOwnerBeliefs({ html }).defects.map((defect) => defect.rule)).toEqual(["marks-incomplete"]);
  });

  it("does not read a quote saying `wrong` as an offered mark", () => {
    const html = rendered({ open: [proposed({ quote: "do we ever build up that gold" })] }).replace(
      "</span> partly",
      "</span>",
    );

    expect(checkOwnerBeliefs({ html }).defects.map((defect) => defect.rule)).toEqual(["marks-incomplete"]);
  });

  it("names a block rendering more rows than the cap allows", () => {
    const open = Array.from({ length: OWNER_BELIEFS_MAX_ROWS + 1 }, (_unused, index) => nth({ index: index + 1 }));
    const defects = checkOwnerBeliefs({ html: rendered({ open }) }).defects;

    expect(defects.map((defect) => defect.rule)).toEqual(["too-many-rows"]);
    expect(defects[0]?.reason).toContain(String(OWNER_BELIEFS_MAX_ROWS));
  });
});
