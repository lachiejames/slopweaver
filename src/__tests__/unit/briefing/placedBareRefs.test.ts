import { describe, expect, it } from "vitest";

import {
  carriesScanMark,
  type MarkedAnchor,
  spanMarked,
  withEntryMarks,
  withLinkMarks,
  withoutScanMarks,
  withoutSpanMarks,
} from "../../../briefing/placedBareRefs.js";

describe("spanMarked and withoutSpanMarks", () => {
  it("round-trips a reference's text through its fence", () => {
    const fenced = spanMarked({ index: 7, text: "#2692" });
    expect(fenced).not.toBe("#2692");
    expect(carriesScanMark({ text: fenced })).toBe(true);
    expect(withoutSpanMarks({ html: `<p>see ${fenced} now</p>` })).toBe("<p>see #2692 now</p>");
  });

  it("finds no scan mark in ordinary text", () => {
    expect(carriesScanMark({ text: "acme/widgets#12 and " })).toBe(false);
  });
});

describe("withoutScanMarks", () => {
  const link = withLinkMarks({
    anchors: [],
    html: '<a href="https://github.com/acme/widgets/pull/12">x</a>',
  });

  it("drops a mark against a label's closing quote along with its space", () => {
    expect(withoutScanMarks({ text: `"Ship it ${link}" · fold` })).toBe(`"Ship it" · fold`);
  });

  it("drops a mark against a label's opening quote along with its space", () => {
    expect(withoutScanMarks({ text: `note "${link} Ship it"` })).toBe(`note "Ship it"`);
  });

  it("leaves one space where a mark sat inside a label", () => {
    expect(withoutScanMarks({ text: `Ship ${link} it` })).toBe("Ship it");
  });

  it("drops half a mark a cap left behind", () => {
    expect(withoutScanMarks({ text: `Ship it ${link.slice(0, 2)}` })).toBe("Ship it ");
  });
});

describe("withLinkMarks and withEntryMarks", () => {
  it("indexes each GitHub link in one list across calls", () => {
    const anchors: MarkedAnchor[] = [];
    withLinkMarks({ anchors, html: '<a href="https://github.com/acme/widgets/pull/12">a</a>' });
    withLinkMarks({ anchors, html: '<a class="raw" href="https://github.com/acme/gadgets">b</a>' });
    expect(anchors.map(({ repo }) => `${repo.owner}/${repo.repo}`)).toEqual(["acme/widgets", "acme/gadgets"]);
  });

  it("fences only the outermost entry", () => {
    const html = '<div class="need"><div class="need">x</div></div>';
    const fenced = withEntryMarks({ html });
    const open = '<div class="need">';
    // One mark just inside each of the OUTER element's own tags, the inner one read whole between them.
    expect(fenced.length).toBe(html.length + 2);
    expect(fenced.slice(0, open.length)).toBe(open);
    expect(fenced.slice(open.length + 1, -"</div>".length - 1)).toBe('<div class="need">x</div>');
    expect(fenced.slice(-"</div>".length)).toBe("</div>");
  });
});
