/**
 * One card per page: which projected cards survive a block that already cards their page, and what the
 * fold says it removed.
 *
 * The "composed cards are never refused" case is the one that decides the design rather than decorating it —
 * one chair's form really carries four me-facing cards on one page url, so a rule that deduplicated the block
 * itself would have taken three of the owner's cards away.
 */
import { describe, expect, it } from "vitest";

import { foldCardedPages, foldedPageLines } from "../../../briefing/openPageFold.js";
import type { BriefingCard } from "../../../outbound/briefing/types.js";

const PAGES = "/Users/owner/.slopweaver/pages";
const FIRST = `file://${PAGES}/first/index.html`;
const SECOND = `file://${PAGES}/second/index.html`;

/** One projected card, as `openPageCards.ts` would have built it from an entry. */
function card({ url, label }: { url: string | undefined; label: string }): BriefingCard {
  return {
    ifSilent: [{ kind: "text", text: "The page stands and re-ranks each tick." }],
    lean: [{ kind: "text", text: "A, since the fold already carries the order." }],
    options: [{ letter: "A", text: "Take them in the order the band ranks them." }],
    premise: { kind: "artifact", landedIso: "2026-09-06T10:00:00Z" },
    question: "Which of these do you want to react to first?",
    readiness: { state: "ready" },
    ...(url === undefined ? { subject: { text: label } } : { subject: { text: label, url } }),
    what: [{ kind: "text", text: "Fifteen pages still want a word." }],
    whyYou: [{ kind: "text", text: "Only you can say which is worth the next hour." }],
  };
}

/** A composed react-now block, unvalidated, exactly as it reaches `injectProjections`. */
function block({ meFacing = [], teamFacing = [] }: { meFacing?: unknown[]; teamFacing?: unknown[] }): unknown {
  return { meFacing, teamFacing };
}

describe("foldCardedPages", () => {
  it("drops the projected card for a page a composed me-facing card already names", () => {
    const fold = foldCardedPages({
      block: block({ meFacing: [{ subject: { text: "the Vanta reconnect", url: FIRST } }] }),
      cards: [card({ label: "the first one", url: FIRST })],
    });

    expect(fold.cards).toEqual([]);
    expect(fold.folded).toEqual([{ label: "the first one", url: FIRST }]);
  });

  it("drops it for a TEAM-facing card too, since two cards on one page is two either way", () => {
    const fold = foldCardedPages({
      block: block({ teamFacing: [{ subject: { text: "the Vanta reconnect", url: FIRST } }] }),
      cards: [card({ label: "the first one", url: FIRST })],
    });

    expect(fold.cards).toEqual([]);
    expect(fold.folded.length).toBe(1);
  });

  it("keeps every card whose page nothing on the block names", () => {
    const kept = card({ label: "the second one", url: SECOND });
    const fold = foldCardedPages({
      block: block({ meFacing: [{ subject: { text: "the Vanta reconnect", url: FIRST } }] }),
      cards: [kept],
    });

    expect(fold.cards).toEqual([kept]);
    expect(fold.folded).toEqual([]);
  });

  it("never refuses the block's own repeats: four composed cards on one page stay four", () => {
    const composed = [0, 1, 2, 3].map((index) => ({
      subject: { text: `board row ${String(index)}`, url: FIRST },
    }));
    const fold = foldCardedPages({ block: block({ meFacing: composed }), cards: [] });

    expect(fold.cards).toEqual([]);
    expect(fold.folded).toEqual([]);
  });

  it("folds a second PROJECTED card on one page, which a hand-edited document can still produce", () => {
    const fold = foldCardedPages({
      block: block({}),
      cards: [card({ label: "the first one", url: FIRST }), card({ label: "the first one again", url: FIRST })],
    });

    expect(fold.cards.length).toBe(1);
    expect(fold.cards[0]!.subject!.text).toBe("the first one");
    expect(fold.folded).toEqual([{ label: "the first one again", url: FIRST }]);
  });

  it("keeps a card whose subject names no page at all, since it can collide with nothing", () => {
    const noPage = card({ label: "no page yet, the finding is a board row", url: undefined });
    const fold = foldCardedPages({
      block: block({ meFacing: [{ subject: { text: "no page either" } }] }),
      cards: [noPage],
    });

    expect(fold.cards).toEqual([noPage]);
    expect(fold.folded).toEqual([]);
  });

  it("compares the url EXACTLY, so two fragments of one page are two subjects", () => {
    const fold = foldCardedPages({
      block: block({ meFacing: [{ subject: { text: "options A", url: `${FIRST}#options-a` } }] }),
      cards: [card({ label: "options B", url: `${FIRST}#options-b` })],
    });

    expect(fold.cards.length).toBe(1);
    expect(fold.folded).toEqual([]);
  });

  it("folds nothing against a block that is not a record, rather than throwing before the schema runs", () => {
    const kept = card({ label: "the first one", url: FIRST });
    const fold = foldCardedPages({ block: "reactNow written as a string", cards: [kept] });

    expect(fold.cards).toEqual([kept]);
    expect(fold.folded).toEqual([]);
  });
});

describe("foldedPageLines", () => {
  it("names the count and then every page, so the operator's next question is already answered", () => {
    expect(foldedPageLines({ folded: [{ label: "the Vanta reconnect", url: FIRST }] })).toEqual([
      "--open-page-cards folded 1 page(s) the react-now block already cards, so each reaches the owner once:",
      `  the Vanta reconnect: ${FIRST}`,
    ]);
  });

  it("says nothing at all when nothing folded", () => {
    expect(foldedPageLines({ folded: [] })).toEqual([]);
  });
});
