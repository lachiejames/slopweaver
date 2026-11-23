/*
 * The owner's further steers on a queue card, and their words on the card's pull request stored on other cards: placed ones
 * drawn, unread ones said after them with their reason beneath. Driven through the real readers, so every row is one
 * the page would actually hold.
 */

import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../../components/live/read";
import { readRowSteers } from "../../../components/live/readHisWords";
import { belongingRowSource, handSource } from "../../../lib/queueCardSource";
import { sourceBlockCopy } from "../../../lib/sourceBlock";
import { ask, boardOf, CALL, QUOTE, sourceOf, TALK } from "./harness";

describe("the owner's further steers on a card", () => {
  const LATER = { ...QUOTE, anchor: CALL, atIso: "2026-10-03T08:57:21.724Z", where: "call", words: "the later one" };
  const EARLIER = { ...QUOTE, anchor: "talk:earlier", atIso: "2026-09-30T01:00:00.000Z", words: "the earlier one" };

  it("draws each in the order the owner said them, oldest first, whatever order the row numbered them", () => {
    const source = sourceOf({
      fields: {
        anchor: TALK,
        ownerWords: QUOTE,
        ownerWordsSteers: [
          { index: 1, kind: "held", quote: LATER },
          { index: 2, kind: "held", quote: EARLIER },
        ],
      },
    });
    const steers = sourceBlockCopy({ source }).steers!;
    expect(steers.summary).toBe("2 more times you steered this, oldest first");
    expect(steers.placed.map((one) => [one.words.text, one.line])).toEqual([
      ["the earlier one", "You said this to the console voice; the voice transcript relayed it at 2026-09-30 01:00Z."],
      ["the later one", "You said this on a console call; the call transcript recorded it at 2026-10-03 08:57Z."],
    ]);
    expect(steers.unplaced).toEqual([]);
  });

  it("says a steer that did not read, and one the wire garbled, after the placed ones with each reason beneath", () => {
    const source = sourceOf({
      fields: {
        ownerWordsSteers: [
          { anchor: CALL, index: 1, kind: "unread", why: "no card landing carries this utterance" },
          { index: 2, kind: "held", quote: { ...LATER, where: "somewhere" } },
          { index: 3, kind: "held", quote: EARLIER },
        ],
      },
    });
    const steers = sourceBlockCopy({ source }).steers!;
    expect(steers.summary).toBe("3 more times you steered this");
    expect(steers.placed.map((one) => one.words.text)).toEqual(["the earlier one"]);
    expect(steers.unplaced).toEqual([
      {
        line: "Your words on a console call bear on this too, but did not read",
        why: "no card landing carries this utterance",
      },
      {
        line: "One more of your steers is stored on this card but does not read",
        why: "the board published a steer for this row that does not read",
      },
    ]);
  });

  it("carries a fleet finding's steers too, since the owner can steer a card the fleet raised", () => {
    const source = sourceOf({
      fields: { ownerWordsSteers: [{ index: 1, kind: "held", quote: EARLIER }], observedBy: "a1", origin: "finding" },
    });
    expect([source.kind, sourceBlockCopy({ source }).steers!.summary]).toEqual([
      "none",
      "1 more time you steered this",
    ]);
  });

  it("inherits the row's steers onto a hand step's card", () => {
    const rows = boardOf({
      rows: [
        ask({
          fields: { anchor: TALK, ownerWords: QUOTE, ownerWordsSteers: [{ index: 1, kind: "held", quote: EARLIER }] },
        }),
      ],
    }).rows;
    const [step] = readHandSteps([
      {
        id: "steer-the-ask",
        postedIso: "2026-10-03T09:00:00.000Z",
        url: "http://localhost:3000/queue?open=ask%3Athe-ask",
        what: "Pick which lands first",
        where: "the queue page",
        witness: "slopweaver hand done steer-the-ask --did 'picked'",
      },
    ])!;
    expect(handSource({ rows, step }).steers).toEqual([{ index: 1, kind: "held", quote: EARLIER }]);
  });

  it("draws no steers fold when the row carries none, and reads a non-list as one defect", () => {
    expect(sourceBlockCopy({ source: sourceOf({ fields: { anchor: TALK, ownerWords: QUOTE } }) }).steers).toBe(
      undefined,
    );
    expect(readRowSteers({ row: { hisWordsSteers: "two" } })).toEqual([
      { index: undefined, kind: "defect", why: "the board published this row's steers as something not a list" },
    ]);
  });

  // The board counts a steer number only while it is exact, so the reader does too.
  it("reports a steer numbered past exact counting, or at 0 as anything but the board's defect, rather than drawing it", () => {
    const unreadable = {
      index: undefined,
      kind: "defect",
      why: "the board published a steer for this row that does not read",
    };
    const quote = EARLIER;
    expect(
      readRowSteers({
        row: {
          ownerWordsSteers: [
            { index: 9007199254740992, kind: "held", quote },
            { index: 0, kind: "held", quote },
            { index: 0, kind: "defect", why: "numbered past what a row can count" },
          ],
        },
      }),
    ).toEqual([unreadable, unreadable, { index: 0, kind: "defect", why: "numbered past what a row can count" }]);
  });
});

describe("the owner's words on the card's pull request, stored on other cards", () => {
  const PR = "acme/acme-admin#9";
  const PROOF = {
    ...QUOTE,
    anchor: "transcript:s#u",
    atIso: "2026-10-12T09:00:00.000Z",
    where: "session",
    words: "show me a screenshot",
  };
  const OLDER = { ...QUOTE, anchor: "talk:older", atIso: "2026-10-10T09:00:00.000Z", words: "split it in two" };

  it("travels from the board onto the card, oldest first, each placed by where the owner said it and which pull request", () => {
    const source = sourceOf({
      fields: {
        prSteers: [
          { identity: PR, quote: PROOF, rowSlug: "proof-row" },
          { identity: PR, quote: OLDER, rowSlug: "older-row" },
        ],
      },
    });
    const copy = sourceBlockCopy({ source }).prSteers!;
    expect(copy.summary).toBe("2 more things you said about its pull request, on other cards, oldest first");
    expect(copy.placed.map((one) => [one.words.text, one.line])).toEqual([
      [
        "split it in two",
        `You said this to the console voice; the voice transcript relayed it at 2026-10-10 09:00Z. It is stored on another card about ${PR}.`,
      ],
      [
        "show me a screenshot",
        `You said this in a Claude session at 2026-10-12 09:00Z; the session transcript captured it. It is stored on another card about ${PR}.`,
      ],
    ]);
  });

  it("rides a card that belongs to the row, and says one that will not read rather than dropping it", () => {
    const rows = boardOf({
      rows: [
        ask({
          fields: {
            prSteers: [
              { identity: PR, quote: PROOF, rowSlug: "proof-row" },
              { identity: PR, rowSlug: "x" },
            ],
          },
        }),
      ],
    }).rows;
    const source = belongingRowSource({
      otherwise: { kind: "unrecorded", origin: "its own", steers: [] },
      rows,
      slug: "the-ask",
    });
    const copy = sourceBlockCopy({ source }).prSteers!;
    expect([copy.summary, copy.placed.length, copy.unplaced]).toEqual([
      "2 more things you said about its pull request, on other cards",
      1,
      [
        {
          line: "One more of your words on its pull request does not read",
          why: "the board published words of yours on this card's pull request that do not read",
        },
      ],
    ]);
  });

  it("draws no fold on a board from before the field, or a single-row read", () => {
    const source = sourceOf({ fields: { anchor: TALK, ownerWords: QUOTE } });
    expect([source.prSteers, sourceBlockCopy({ source }).prSteers]).toEqual([undefined, undefined]);
  });
});
