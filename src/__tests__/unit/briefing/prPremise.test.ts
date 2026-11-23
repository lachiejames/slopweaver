/**
 * The freshness half of the briefing gate: which pull request a card's premise rests on, and which live
 * states make that premise stale.
 *
 * Every case here is one of the two cards the owner actually got — a merged pull request and a queued
 * one — plus the boundaries around them: an open pull request that must still pass, a card that names none,
 * and a premise the read never answered for.
 */
import { describe, expect, it } from "vitest";

import { cardPrRefs, checkPrPremises } from "../../../briefing/prPremise.js";
import type { PrPremise } from "../../../live/github/prPremise.js";

/** One react-now card, with an optional subject link and an optional fold. */
function card({ question, subject, fold }: { question: string; subject?: string; fold?: string }): string {
  const subjectLine = subject === undefined ? "" : `<div class="bg"><a href="${subject}">the subject</a></div>`;
  const foldBlock = fold === undefined ? "" : `<details><summary>more</summary><div>${fold}</div></details>`;
  return (
    `<div class="need"><div class="q">${question}</div>${subjectLine}` +
    `<dl class="f"><dt>what</dt><dd>Two sentences here. Background continues.${foldBlock}</dd>` +
    `<dt>why you</dt><dd>It is your call.</dd>` +
    `<dt>options</dt><dd>A: send it. B: hold it.</dd>` +
    `<dt>lean</dt><dd>A.</dd><dt>if silent</dt><dd>nothing ships.</dd></dl></div>`
  );
}

/** A whole page with the given cards in its react-now block. */
function page({ cards }: { cards: readonly string[] }): string {
  return `<h2>react now</h2>${cards.join("")}<h2>done</h2>`;
}

const OPEN: PrPremise = { identity: "acme/acme-admin#16359", queue: undefined, state: "OPEN" };
const MERGED: PrPremise = { identity: "acme/acme-admin#11141", queue: undefined, state: "MERGED" };
const CLOSED: PrPremise = { identity: "acme/acme-admin#900", queue: undefined, state: "CLOSED" };
const QUEUED: PrPremise = {
  identity: "acme/acme-admin#16358",
  queue: { position: 3, state: "QUEUED" },
  state: "OPEN",
};

/** The states a check reads, keyed the way the gate looks them up. */
function states({ premises }: { premises: readonly PrPremise[] }): ReadonlyMap<string, PrPremise> {
  return new Map(premises.map((premise) => [premise.identity, premise]));
}

describe("cardPrRefs", () => {
  it("reads the pull request from a card's subject link", () => {
    const refs = cardPrRefs({
      html: page({
        cards: [card({ question: "1. Ship it?", subject: "https://github.com/acme/acme-admin/pull/16359" })],
      }),
    });

    expect(refs.length).toBe(1);
    expect(refs[0]!.identity).toBe("acme/acme-admin#16359");
    expect(refs[0]!.card).toBe(1);
    expect(refs[0]!.address).toEqual({ number: 16359, owner: "acme", repo: "acme-admin" });
  });

  it("falls back to the first pull-request link in the fold when a card carries no subject", () => {
    const refs = cardPrRefs({
      html: page({
        cards: [
          card({
            fold: `<a href="https://github.com/acme/acme-admin/pull/11141">the pull request</a>`,
            question: "1. Post the proof?",
          }),
        ],
      }),
    });

    expect(refs.length).toBe(1);
    expect(refs[0]!.identity).toBe("acme/acme-admin#11141");
  });

  it("ignores a card that links no pull request at all", () => {
    const refs = cardPrRefs({
      html: page({ cards: [card({ question: "1. Ship it?", subject: "https://linear.app/acme/issue/SUP-12" })] }),
    });

    expect(refs).toEqual([]);
  });

  it("prefers the subject over a later link, so a cited pull request is never the premise", () => {
    const refs = cardPrRefs({
      html: page({
        cards: [
          card({
            fold: `<a href="https://github.com/acme/acme-admin/pull/11141">the one it cites</a>`,
            question: "1. Ship it?",
            subject: "https://github.com/acme/acme-admin/pull/16359",
          }),
        ],
      }),
    });

    expect(refs.length).toBe(1);
    expect(refs[0]!.identity).toBe("acme/acme-admin#16359");
  });

  it("still reads the fold when a `no page` subject carries no link of its own", () => {
    const plain =
      '<div class="need"><div class="q">1. Post the proof?</div><div class="bg">no page — this row</div>' +
      '<dl class="f"><dt>what</dt><dd>Two sentences here. Background continues.' +
      '<details><summary>more</summary><div><a href="https://github.com/acme/acme-admin/pull/11141">it</a>' +
      "</div></details></dd></dl></div>";
    const refs = cardPrRefs({ html: page({ cards: [plain] }) });

    expect(refs.length).toBe(1);
    expect(refs[0]!.identity).toBe("acme/acme-admin#11141");
  });

  it("names a card that carries no question block by its whole markup", () => {
    const unasked =
      '<div class="need"><div class="bg"><a href="https://github.com/acme/acme-admin/pull/11141">' +
      "Post the proof</a></div></div>";
    const refs = cardPrRefs({ html: page({ cards: [unasked] }) });

    expect(refs.length).toBe(1);
    expect(refs[0]!.identity).toBe("acme/acme-admin#11141");
    expect(refs[0]!.question).toBe("Post the proof");
  });

  it("finds nothing on a page with no react-now block", () => {
    expect(cardPrRefs({ html: "<h2>done</h2><div class='need'></div>" })).toEqual([]);
  });
});

describe("checkPrPremises", () => {
  it("passes a card whose pull request is still open", () => {
    const result = checkPrPremises({
      html: page({
        cards: [card({ question: "1. Ship it?", subject: "https://github.com/acme/acme-admin/pull/16359" })],
      }),
      states: states({ premises: [OPEN] }),
    });

    expect(result.refsChecked).toBe(1);
    expect(result.defects).toEqual([]);
  });

  it("refuses a card on a merged pull request, naming the state", () => {
    const result = checkPrPremises({
      html: page({
        cards: [card({ question: "1. Post the proof?", subject: "https://github.com/acme/acme-admin/pull/11141" })],
      }),
      states: states({ premises: [MERGED] }),
    });

    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.card).toBe(1);
    expect(result.defects[0]!.identity).toBe("acme/acme-admin#11141");
    expect(result.defects[0]!.question).toBe("Post the proof?");
    expect(result.defects[0]!.reason).toBe(
      "acme/acme-admin#11141 is MERGED on GitHub, so this card asks about work that is already settled. " +
        "Drop the card, or re-render the page from a fresh sweep.",
    );
  });

  it("refuses a card on a closed pull request, naming the state", () => {
    const result = checkPrPremises({
      html: page({
        cards: [card({ question: "1. Chase it?", subject: "https://github.com/acme/acme-admin/pull/900" })],
      }),
      states: states({ premises: [CLOSED] }),
    });

    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.reason).toBe(
      "acme/acme-admin#900 is CLOSED on GitHub, so this card asks about work that is already settled. " +
        "Drop the card, or re-render the page from a fresh sweep.",
    );
  });

  it("refuses a card on a queued pull request, naming the entry and the position", () => {
    const result = checkPrPremises({
      html: page({
        cards: [card({ question: "1. Resolve the thread?", subject: "https://github.com/acme/acme-admin/pull/16358" })],
      }),
      states: states({ premises: [QUEUED] }),
    });

    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.reason).toBe(
      "acme/acme-admin#16358 is in the merge queue (entry QUEUED, position 3), so it lands without the owner. " +
        "Drop the card, or re-render the page from a fresh sweep.",
    );
  });

  it("reports a premise the read never answered for as unverified rather than passing it", () => {
    const result = checkPrPremises({
      html: page({
        cards: [card({ question: "1. Ship it?", subject: "https://github.com/acme/acme-admin/pull/16359" })],
      }),
      states: states({ premises: [] }),
    });

    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.reason).toBe(
      "acme/acme-admin#16359's live state could not be read, so this card's premise is unverified. " +
        "Drop the card, or re-render the page from a fresh sweep.",
    );
  });

  it("names the right card when only the second of three is stale", () => {
    const result = checkPrPremises({
      html: page({
        cards: [
          card({ question: "1. Ship it?", subject: "https://github.com/acme/acme-admin/pull/16359" }),
          card({ question: "2. Post the proof?", subject: "https://github.com/acme/acme-admin/pull/11141" }),
          card({ question: "3. Nothing linked?" }),
        ],
      }),
      states: states({ premises: [OPEN, MERGED] }),
    });

    expect(result.refsChecked).toBe(2);
    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.card).toBe(2);
  });

  it("checks nothing, and finds nothing, on a page whose cards name no pull request", () => {
    const result = checkPrPremises({
      html: page({ cards: [card({ question: "1. Ship it?" })] }),
      states: states({ premises: [] }),
    });

    expect(result.refsChecked).toBe(0);
    expect(result.defects).toEqual([]);
  });
});
