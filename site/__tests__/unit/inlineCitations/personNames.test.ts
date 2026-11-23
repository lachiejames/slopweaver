import { describe, expect, it } from "vitest";

import {
  type CardReferences,
  inlinePlain,
  inlineSegments,
  NO_CARD_REFERENCES,
  resolveInline,
} from "../../../lib/inlineCitations";
import { cardPeople } from "../../../lib/personMentions";
import { pr } from "./fixtures";

/**
 * A drafts roster for two cards, plus two Kyles and a Will: the cards name Sophie and Tobias in words, never by id,
 * so the names themselves must be hoverable.
 */
const NAMED: CardReferences = {
  ...NO_CARD_REFERENCES,
  people: cardPeople({
    board: [],
    owner: undefined,
    roster: new Map([
      ["U0SYN000034", { firstNameUnique: true, handle: "sophie", name: "Sophie G", nameUnique: true }],
      ["U0SYN000017", { firstNameUnique: true, handle: "tobias", name: "Tobias Wren", nameUnique: true }],
      ["U0SYN000025", { firstNameUnique: false, handle: "kyle.yardley", name: "Kyle Yardley", nameUnique: true }],
      ["U0KYLE2", { firstNameUnique: false, handle: "kyle.b", name: "Kyle Brown", nameUnique: true }],
      ["U0WILL", { firstNameUnique: true, handle: "will", name: "Will Hart", nameUnique: true }],
      ["U0SYN000005", { firstNameUnique: false, handle: "acme-bot", name: "acme-bot", nameUnique: false }],
    ]),
  }),
};

describe("a person's name: names, not only ids, are hoverable", () => {
  it("draws a unique first name as that person's chip under the words written, a possessive included", () => {
    expect(
      inlineSegments({ references: NAMED, text: "reply as the owner to Sophie's digital desktop question" }),
    ).toEqual([
      { kind: "text", text: "reply as the owner to " },
      { id: "U0SYN000034", kind: "person", label: "Sophie" },
      { kind: "text", text: "'s digital desktop question" },
    ]);
  });

  it("draws a whole name as ONE chip, never its first name then words", () => {
    expect(inlineSegments({ references: NAMED, text: "Tobias Wren's transcript" })).toEqual([
      { id: "U0SYN000017", kind: "person", label: "Tobias Wren" },
      { kind: "text", text: "'s transcript" },
    ]);
  });

  it("chips a whole name whose first name two people share, and leaves that first name alone as words", () => {
    expect(inlineSegments({ references: NAMED, text: "Kyle Yardley asked Kyle" })).toEqual([
      { id: "U0SYN000025", kind: "person", label: "Kyle Yardley" },
      { kind: "text", text: " asked Kyle" },
    ]);
  });

  it("never chips a lower-case word, a hyphen-joined word, an @word or a bot", () => {
    const text = "we will ask Will-bot, @Will and the bot";
    expect(inlineSegments({ references: NAMED, text })).toEqual([{ kind: "text", text }]);
  });

  it("never cuts a name out of an address or a Slack link's label: each stays one chip", () => {
    const url = "https://acme.slack.com/archives/C0SYN000040/p1790304293926279?from=Sophie";
    expect(inlineSegments({ references: NAMED, text: `see <${url}|Sophie's thread>` })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "Sophie's thread", url },
    ]);
  });

  it("chips a name beside a pull request the same sentence links", () => {
    expect(inlineSegments({ references: NAMED, text: `Tobias reviews #17560 (${pr({ n: 17560 })})` })).toEqual([
      { id: "U0SYN000017", kind: "person", label: "Tobias" },
      { kind: "text", text: " reviews " },
      { kind: "cite", label: "#17560", url: pr({ n: 17560 }) },
    ]);
  });

  it("folds a named person to the first name the drawn card gives them, for a tile that is itself a link", () => {
    const text = "Watch Tobias's ISO meeting transcript and Sophie G's thread";
    expect(inlinePlain({ references: NAMED, text })).toBe("Watch Tobias's ISO meeting transcript and Sophie's thread");
  });

  it("reports no finding for a name, chipped or not", () => {
    expect(resolveInline({ references: NAMED, text: "Sophie and Kyle" }).unlinked).toEqual([]);
  });
});
