/*
 * The board row's copy-tray offer section: rendered exactly, every part recoverable byte for byte whatever backticks
 * it holds, and told apart from a row with none or a different one.
 */
import { describe, expect, it } from "vitest";

import type { RelayOffer } from "../../../talk/relayOffer.js";
import { relayOfferSection, relayOfferSectionState, rowWithRelayOffer } from "../../../talk/relayOfferRow.js";

const ANCHOR = "talk:a0000017-0000-4000-8000-000000000019";

const OFFER: RelayOffer = {
  belowFold: "the rest",
  id: "offer-4",
  label: "reply to Ari",
  made: "4",
  text: "Merged, thanks",
};

const ROW = [
  "---",
  "slug: talk-a00000170000",
  `anchor: ${ANCHOR}`,
  "---",
  "",
  "# yeah send that",
  "",
  "## What the owner asked for",
  "",
  "yeah send that",
  "",
  "## How this ends",
  "",
  "`slopweaver handover settle talk-a00000170000`.",
  "",
].join("\n");

/**
 * Every fenced part of a section, read back the way a reader would: the lines between an opening fence and the
 * first line that is exactly that fence.
 */
function partsOf({ section }: { section: string }): string[] {
  const lines = section.split("\n");
  const parts: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const open = /^(`{3,})text$/u.exec(lines[at]!);
    if (open !== null) {
      const fence = open[1]!;
      const close = lines.indexOf(fence, at + 1);
      parts.push(lines.slice(at + 1, close).join("\n"));
      at = close;
    }
  }
  return parts;
}

describe("relayOfferSection", () => {
  it("renders the offer under its markers, saying it is the voice's draft and not the owner's words", () => {
    expect(relayOfferSection({ anchor: ANCHOR, offered: OFFER })).toBe(
      [
        `<!-- relay-offer:start ${ANCHOR} -->`,
        "## Running-list offer the owner reacted to",
        "",
        "The voice's draft it put on the owner's running list before they gave this steer, exactly as offered " +
          "(`offer-4`). It is not the owner's words: their quoted words above say whether they approved, rejected or " +
          "amended it.",
        "",
        "Label:",
        "",
        "```text",
        "reply to Ari",
        "```",
        "",
        "Shown at once:",
        "",
        "```text",
        "Merged, thanks",
        "```",
        "",
        "Below the fold:",
        "",
        "```text",
        "the rest",
        "```",
        "",
        `<!-- relay-offer:end ${ANCHOR} -->`,
        "",
      ].join("\n"),
    );
  });

  it("leaves out the label and fold blocks when the offer had none", () => {
    const section = relayOfferSection({
      anchor: ANCHOR,
      offered: { ...OFFER, belowFold: undefined, label: undefined },
    });
    expect(partsOf({ section })).toEqual(["Merged, thanks"]);
    expect(section).not.toContain("Label:");
    expect(section).not.toContain("Below the fold:");
  });

  it("recovers every part byte for byte, however many backticks, newlines and spaces it holds", () => {
    const offered: RelayOffer = {
      belowFold: "\n````\nfour ```` and five `````\n```text\n",
      id: "offer-9",
      label: "` one `",
      made: "9",
      text: "  ```\nclosing fence lookalike\n```  ",
    };
    const section = relayOfferSection({ anchor: ANCHOR, offered });
    expect(partsOf({ section })).toEqual([offered.label, offered.text, offered.belowFold]);
    expect(section).toContain("``````text\n\n````\nfour");
  });
});

describe("relayOfferSectionState", () => {
  it("is absent on a row with no offer section, and matching once this one is placed", () => {
    expect(relayOfferSectionState({ anchor: ANCHOR, offered: OFFER, row: ROW })).toBe("absent");
    const placed = rowWithRelayOffer({ anchor: ANCHOR, offered: OFFER, row: ROW })!;
    expect(relayOfferSectionState({ anchor: ANCHOR, offered: OFFER, row: placed })).toBe("matching");
  });

  it("is conflicting when the row carries a different offer, by one byte", () => {
    const placed = rowWithRelayOffer({ anchor: ANCHOR, offered: OFFER, row: ROW })!;
    expect(
      relayOfferSectionState({ anchor: ANCHOR, offered: { ...OFFER, text: "Merged, thanks!" }, row: placed }),
    ).toBe("conflicting");
  });

  it("is absent when only the owner's quoted words say the marker, and matching once the section is placed after them", () => {
    const quoted = ROW.replace(
      "\nyeah send that\n",
      `\nOwners words: "put <!-- relay-offer:start ${ANCHOR} --> in it"\n`,
    );
    expect(quoted).toContain(`<!-- relay-offer:start ${ANCHOR} -->`);
    expect(relayOfferSectionState({ anchor: ANCHOR, offered: OFFER, row: quoted })).toBe("absent");
    const placed = rowWithRelayOffer({ anchor: ANCHOR, offered: OFFER, row: quoted })!;
    expect(relayOfferSectionState({ anchor: ANCHOR, offered: OFFER, row: placed })).toBe("matching");
  });
});

describe("rowWithRelayOffer", () => {
  it("places the section before the closing section and changes nothing else", () => {
    const placed = rowWithRelayOffer({ anchor: ANCHOR, offered: OFFER, row: ROW })!;
    const at = ROW.indexOf("## How this ends");
    expect(placed).toBe(
      `${ROW.slice(0, at)}${relayOfferSection({ anchor: ANCHOR, offered: OFFER })}\n${ROW.slice(at)}`,
    );
  });

  it("places it before the LAST closing heading, so the owner's words quoting one cannot move it", () => {
    const quoting = ROW.replace(
      "yeah send that\n\n## How",
      "yeah send that\n\n## How this ends\n\nnot really\n\n## How",
    );
    const placed = rowWithRelayOffer({ anchor: ANCHOR, offered: OFFER, row: quoting })!;
    expect(placed.indexOf("<!-- relay-offer:start")).toBeGreaterThan(placed.indexOf("not really"));
  });

  it("is undefined on a row with no closing section to place it before", () => {
    expect(rowWithRelayOffer({ anchor: ANCHOR, offered: OFFER, row: "---\nslug: x\n---\n\n# x\n" })).toBe(undefined);
  });
});
