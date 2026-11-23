/*
 * Whether a count of the owner's Queue the voice said is one the app shows, and the provenance entry a wrong one is owed —
 * never a correction handed back to the voice. The incident line "That covers fourteen cards.
 * That's the last one." was said while the app showed Everything 29, Queue 26, Blocking the fleet 26 and Check-ins 3.
 */

import { describe, expect, it } from "vitest";

import type { QueueShownCounts } from "../../lib/queueShownCounts";
import {
  type CountGroundingNote,
  countClaimsOf,
  countGroundingDetail,
  foldCountGrounding,
  NO_COUNT_GROUNDING,
  ungroundedCounts,
} from "../../lib/talkCountGrounding";

const INCIDENT_LINE = "That covers fourteen cards. That's the last one.";

/** The app's figures when the incident line was said. */
const SHOWN: QueueShownCounts = {
  everything: 29,
  otherContext: { context: "slopweaver", count: 14 },
  view: "all",
  views: { all: 29, "check-in": 3, colleague: 0, finding: 0, fleet: 26, review: 0, slack: 0, urgent: 0 },
  waiting: 26,
};

describe("countClaimsOf", () => {
  it("reads the incident's line as one count of every card, and nothing else in it", () => {
    expect(countClaimsOf({ text: INCIDENT_LINE })).toEqual([
      { count: 14, end: 26, noun: "card", start: 12, subject: "everything", words: "fourteen cards" },
    ]);
  });

  it("reads digits, spaced and hyphenated words and hundreds, and the figure the words around it name", () => {
    const text =
      "You have 1,204 items, twenty six waiting, twenty-six cards blocking the fleet, three check-ins and one hundred and five asks.";
    expect(countClaimsOf({ text }).map(({ count, subject, words }) => [count, subject, words])).toEqual([
      [1204, "everything", "1,204 items"],
      [26, "waiting", "twenty six waiting"],
      [26, "fleet", "twenty-six cards blocking the fleet"],
      [3, "check-in", "three check-ins"],
      [105, "asks", "one hundred and five asks"],
    ]);
  });

  it("reads a figure said after what it counts, under the name it is said with", () => {
    const text =
      "The count of cards on your Queue is 14. Everything stands at twenty-nine, and check-ins are three. Blocking the fleet, cards are now 26.";
    expect(countClaimsOf({ text }).map(({ count, subject, words }) => [count, subject, words])).toEqual([
      [14, "queue", "cards on your Queue is 14"],
      [29, "everything", "Everything stands at twenty-nine"],
      [3, "check-in", "check-ins are three"],
      [26, "everything", "cards are now 26"],
    ]);
  });

  it("reads 'Queue is' as the badge's figure, so Everything's number does not ground it", () => {
    const [claim] = countClaimsOf({ text: "Queue is 29." });
    expect([claim.subject, ungroundedCounts({ claims: [claim], shown: SHOWN })]).toEqual(["waiting", [claim]]);
    const [loose] = countClaimsOf({ text: "The cards on your Queue are 29." });
    expect([loose.subject, ungroundedCounts({ claims: [loose], shown: SHOWN })]).toEqual(["queue", []]);
  });

  it("reads a count past a Queue's size as one, but no digit run past exact integers", () => {
    const text = "There are 100001 cards, or 99999999999999999999 cards.";
    expect(countClaimsOf({ text }).map(({ count }) => count)).toEqual([100_001]);
  });

  it("is no count for digits glued to a name", () => {
    expect(countClaimsOf({ text: "I still couldn't pull the KnowBe4 card before the lookup timed out." })).toEqual([]);
    expect(countClaimsOf({ text: "The 4th card and the 4x cards." })).toEqual([]);
    expect(countClaimsOf({ text: "𐐀4 cards and é4 cards." })).toEqual([]);
    expect(countClaimsOf({ text: "There are é4 cards." })).toEqual([]);
    const joiner = String.fromCodePoint(0x200d);
    expect(countClaimsOf({ text: `The KnowBe${joiner}4 card timed out, and 4${joiner}x cards.` })).toEqual([]);
    const joiners = joiner.repeat(9);
    expect(countClaimsOf({ text: `There are KnowBe${joiners}4 cards, and 4${joiners}x cards.` })).toEqual([]);
    expect(countClaimsOf({ text: "There are KnowBe\u{E0001}4 cards." })).toEqual([]);
    expect(countClaimsOf({ text: `There are KnowBe4${joiner}2 cards, and 4${joiners}2 cards.` })).toEqual([]);
    expect(countClaimsOf({ text: "There are 4² cards, and ½4 cards." })).toEqual([]);
    expect(countClaimsOf({ text: `There are ${joiners}4 cards.` }).map(({ count }) => count)).toEqual([4]);
    // The stated trade: a word run into its figure is read as a name too.
    expect(countClaimsOf({ text: "There are exactly4 cards." })).toEqual([]);
    expect(countClaimsOf({ text: "There are 4 cards about KnowBe4." }).map(({ count }) => count)).toEqual([4]);
  });

  it("is no figure said after its noun when the number runs on or names a place", () => {
    const text = "The Queue is 14 days old. The next cards are two. Cards are fine.";
    expect(countClaimsOf({ text })).toEqual([]);
  });

  it("is no count for a pronoun 'one' or a noun that is the verb of its own clause", () => {
    // Exactly what the voice said; the count it was read as had the voice say "Everything's ninety-three." twice.
    const text = "Yes — that's the 'Read' box ticked; that's the one it asks for.";
    expect(countClaimsOf({ text })).toEqual([]);
    expect(countClaimsOf({ text: "Take that one. Each one they ask about is fine. Two it wants." })).toEqual([]);
  });

  it("is no count for a supposed case", () => {
    const text =
      "On it. Say one card contains three controls, but one screenshot includes employee details and needs your call on redaction; should the whole upload wait for that, or should the two unaffected controls come as a separate action for you to approve now?";
    expect(countClaimsOf({ text })).toEqual([]);
    expect(countClaimsOf({ text: "Suppose two cards wait. If three cards were urgent, fine." })).toEqual([]);
  });

  it("is no count anywhere in a supposed clause, and a count again once the clause ends", () => {
    expect(countClaimsOf({ text: "Suppose there are fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "Imagine Everything is twenty-nine." })).toEqual([]);
    expect(countClaimsOf({ text: "Everything hypothetically is twenty-nine." })).toEqual([]);
    expect(countClaimsOf({ text: "Hypothetically, there are fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "Say, hypothetically speaking, there are fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "Fine, there are fourteen cards." }).map(({ count }) => count)).toEqual([14]);
    expect(countClaimsOf({ text: "Hypothetically, for example, there are fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "Imagine this: there are fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "For example—say fourteen cards are waiting." })).toEqual([]);
    expect(countClaimsOf({ text: "Everything, say, is twenty-nine." })).toEqual([]);
    expect(countClaimsOf({ text: "Suppose the U.S. has fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "Suppose Dr. Patel has fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "Imagine Mr. Smith had 14 cards waiting." })).toEqual([]);
    expect(countClaimsOf({ text: "If the No. 2 team has fourteen cards, fine." })).toEqual([]);
    expect(countClaimsOf({ text: "Imagine Queue vs. Everything is twenty-nine." })).toEqual([]);
    expect(countClaimsOf({ text: "Thank you—say fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "What-if: fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "If so.) Fourteen cards are waiting." })).toEqual([]);
    expect(countClaimsOf({ text: 'If so."Fourteen cards' })).toEqual([]);
    expect(countClaimsOf({ text: 'Ana asked what if it grows." Fourteen cards are waiting.' })).toEqual([]);
    expect(countClaimsOf({ text: "Suppose it ends. (Fourteen cards are waiting.)" })).toEqual([]);
    expect(countClaimsOf({ text: "If so. *Fourteen cards* wait." })).toEqual([]);
    expect(countClaimsOf({ text: "Suppose plan é. Fourteen cards are waiting." })).toEqual([]);
    expect(countClaimsOf({ text: "Suppose é. Fourteen cards are waiting." })).toEqual([]);
    expect(countClaimsOf({ text: `Suppose e${"́".repeat(40)}. Fourteen cards.` })).toEqual([]);
    expect(countClaimsOf({ text: "We é say 14 cards." })).toEqual([]);
    expect(countClaimsOf({ text: "they сейчас say fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "You 也 say fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "They (say fourteen cards) wait." })).toEqual([]);
    expect(countClaimsOf({ text: "I'd-say fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "If’s aside, fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "ſAY fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "İF so, fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "ⅰ say fourteen cards." })).toEqual([]);
    expect(countClaimsOf({ text: "whatʼif fourteen cards." })).toEqual([]);
    const after = countClaimsOf({ text: "Suppose it ends.  Fourteen cards are waiting." });
    expect(after.map(({ count }) => count)).toEqual([14]);
    const accented = countClaimsOf({ text: "Suppose it ends. Élan aside, fourteen cards are waiting." });
    expect(accented.map(({ count }) => count)).toEqual([14]);
    expect(countClaimsOf({ text: "Suppose so; there are fourteen cards." })).toEqual([]);
    // Sentence-scoped on purpose: a total after an "if" clause in the same sentence is not recorded either.
    expect(countClaimsOf({ text: "If there were ten cards, Everything is twenty-nine." })).toEqual([]);
    const claims = countClaimsOf({ text: "If there were ten cards, fine. Everything is twenty-nine." });
    expect(claims.map(({ count, subject }) => [count, subject])).toEqual([[29, "everything"]]);
  });

  it("is no count for a picked subset", () => {
    const text =
      "I can’t name ten specific cards yet; the queue read gave an old snapshot, and the overnight lookup timed out.";
    expect(countClaimsOf({ text })).toEqual([]);
    expect(countClaimsOf({ text: "Pick three particular cards." })).toEqual([]);
  });

  it("still reads 'different' between a number and its noun as a total", () => {
    expect(
      countClaimsOf({ text: "There are fourteen different cards in Everything." }).map(({ count }) => count),
    ).toEqual([14]);
  });

  it("still reads a real count of one card, the incident's fourteen, and a count after 'I'd say', as counts", () => {
    expect(countClaimsOf({ text: "There's one card waiting" })).toEqual([
      { count: 1, end: 24, noun: "card", start: 8, subject: "waiting", words: "one card waiting" },
    ]);
    expect(countClaimsOf({ text: "That covers fourteen cards" })).toEqual([
      { count: 14, end: 26, noun: "card", start: 12, subject: "everything", words: "fourteen cards" },
    ]);
    expect(countClaimsOf({ text: "I'd say fourteen cards" })).toEqual([
      { count: 14, end: 22, noun: "card", start: 8, subject: "everything", words: "fourteen cards" },
    ]);
  });

  it("is no count where a determiner or joining word opens a new phrase before the noun", () => {
    const text = "I picked one because the card is urgent. Two of them, and urgent cards wait. Three so a card waits.";
    expect(countClaimsOf({ text })).toEqual([]);
    // The witness: a word that only describes the noun still reads as its count.
    expect(countClaimsOf({ text: "There are three urgent cards." }).map(({ count, noun }) => [count, noun])).toEqual([
      [3, "card"],
    ]);
  });

  it("is no count where a third-person pronoun opens a clause or a phrase before the noun, whichever person it names", () => {
    // Spoken words, spelled through a pattern's source: the owner-pronoun gate reads a pattern as speech, which these are.
    const [subject, possessive] = [/he/u.source, /his/u.source];
    const texts = [
      `Two ${subject} flagged cards.`,
      "Two she flagged cards.",
      `Two ${possessive} flagged cards.`,
      "Two her flagged cards.",
    ];
    expect(texts.map((text) => countClaimsOf({ text }))).toEqual(texts.map(() => []));
    // The witness: the same words with no pronoun read as a count.
    expect(countClaimsOf({ text: "Two flagged cards." }).map(({ count, noun }) => [count, noun])).toEqual([
      [2, "card"],
    ]);
  });

  it("ends what a count names at a joining word, and takes a second number before the noun as the count", () => {
    expect(countClaimsOf({ text: "There are twenty-nine cards and Blocking the fleet remains visible." })).toEqual([
      { count: 29, end: 27, noun: "card", start: 10, subject: "everything", words: "twenty-nine cards" },
    ]);
    expect(countClaimsOf({ text: "There are twenty plus nine cards." }).map((claim) => claim.count)).toEqual([9]);
  });

  it("is no count of the Queue for rules, places, parts, money, percentages or a relative figure", () => {
    const text =
      "That's the last of the nine rules. The top three cards, the first two items, one of the cards, two more cards, $5 cards, 40% cards, card 14.";
    expect(countClaimsOf({ text })).toEqual([]);
  });
});

describe("ungroundedCounts", () => {
  it("finds the incident's fourteen ungrounded, though a view the words do not name holds fourteen", () => {
    const claims = countClaimsOf({ text: INCIDENT_LINE });
    // SHOWN's other context holds fourteen too: a bare count never borrows the figure the switch hides.
    expect([SHOWN.otherContext.count, ungroundedCounts({ claims, shown: SHOWN })]).toEqual([14, claims]);
    const fourteenFindings = { ...SHOWN, views: { ...SHOWN.views, finding: 14 } };
    expect(ungroundedCounts({ claims, shown: fourteenFindings })).toEqual(claims);
  });

  it("grounds a count of review cards in Reviews under your name only, never in Check-ins", () => {
    const claims = countClaimsOf({ text: "There are three review cards." });
    expect([claims[0].subject, ungroundedCounts({ claims, shown: SHOWN })]).toEqual(["review", claims]);
    const threeReviews = { ...SHOWN, views: { ...SHOWN.views, review: 3 } };
    expect(ungroundedCounts({ claims, shown: threeReviews })).toEqual([]);
  });

  it("grounds each figure the app shows under the words that name it", () => {
    const text = "29 cards, 26 waiting, 26 blocking the fleet cards, 3 check-ins, 26 on your queue";
    expect(countClaimsOf({ text }).length).toBe(4);
    expect(ungroundedCounts({ claims: countClaimsOf({ text }), shown: SHOWN })).toEqual([]);
  });

  it("grounds a bare count in the open view's figure too, and nothing when the app printed no number", () => {
    const claims = countClaimsOf({ text: "That's 26 cards." });
    expect(ungroundedCounts({ claims, shown: { ...SHOWN, view: "fleet" } })).toEqual([]);
    expect(ungroundedCounts({ claims, shown: { ...SHOWN, everything: undefined } }).length).toBe(1);
    expect(ungroundedCounts({ claims, shown: undefined }).length).toBe(1);
  });

  it("grounds a count that names the hidden context in that context's figure only, and one naming this context in Everything", () => {
    const hidden = countClaimsOf({ text: "There are fourteen cards in the Slopweaver context." });
    expect([hidden[0].subject, ungroundedCounts({ claims: hidden, shown: SHOWN })]).toEqual(["slopweaver-context", []]);
    const wrong = countClaimsOf({ text: "There are five cards in the Slopweaver context." });
    expect(ungroundedCounts({ claims: wrong, shown: SHOWN })).toEqual(wrong);
    const here = countClaimsOf({ text: "There are 29 cards in the work context." });
    expect([here[0].subject, ungroundedCounts({ claims: here, shown: SHOWN })]).toEqual(["work-context", []]);
    // "work cards" without the word context is a bare count, Everything's.
    expect(countClaimsOf({ text: "There are 29 work cards." })[0].subject).toBe("everything");
  });

  it("reads the context named as one, never a context word elsewhere in the clause", () => {
    // The counterexample: Slopweaver is the topic, the work context is where the fourteen are claimed.
    const about = countClaimsOf({ text: "There are fourteen cards about Slopweaver in the work context." });
    expect([about[0].subject, ungroundedCounts({ claims: about, shown: SHOWN })]).toEqual(["work-context", about]);
    // A context that is only a clause's subject places no count in it, so the fourteen is held to Everything.
    const because = countClaimsOf({ text: "There are fourteen cards because the Slopweaver context is open." });
    expect([because[0].subject, ungroundedCounts({ claims: because, shown: SHOWN })]).toEqual(["everything", because]);
  });
});

const NOT_THREAD = "nothing the thinking model wrote said it";

describe("foldCountGrounding", () => {
  it("owes the incident's fourteen one grounding, keyed by its segment and offset, and notes it ungrounded", () => {
    const step = foldCountGrounding({
      id: "seg-1",
      shown: SHOWN,
      state: NO_COUNT_GROUNDING,
      text: INCIDENT_LINE,
      written: [],
    });
    const [claim] = countClaimsOf({ text: INCIDENT_LINE });
    expect(step.owed).toEqual([
      {
        claim,
        grounding: {
          claimed: 14,
          expected: [{ count: 29, label: "Everything" }],
          fromThread: false,
          key: "seg-1:12",
          subject: "everything",
        },
      },
    ]);
    expect(step.notes).toEqual([
      { claim, expected: [{ count: 29, label: "Everything" }], fromThread: false, kind: "ungrounded" },
    ]);
    expect(step.state).toEqual({ checked: ["seg-1"] });
  });

  it("owes every wrong count in one sentence once each, in the order said, under the figures its words name", () => {
    const step = foldCountGrounding({
      id: "seg-1",
      shown: SHOWN,
      state: NO_COUNT_GROUNDING,
      text: "Fourteen cards and nine waiting.",
      written: [],
    });
    expect(step.owed.map(({ grounding }) => [grounding.key, grounding.claimed, grounding.expected])).toEqual([
      ["seg-1:0", 14, [{ count: 29, label: "Everything" }]],
      ["seg-1:19", 9, [{ count: 26, label: "Queue" }]],
    ]);
  });

  it("owes nothing when the same segment is folded again, and leaves the state as it was", () => {
    const first = foldCountGrounding({
      id: "seg-1",
      shown: SHOWN,
      state: NO_COUNT_GROUNDING,
      text: INCIDENT_LINE,
      written: [],
    });
    const again = foldCountGrounding({
      id: "seg-1",
      shown: SHOWN,
      state: first.state,
      text: INCIDENT_LINE,
      written: [],
    });
    expect([first.owed.length, again.owed, again.notes, again.state]).toEqual([1, [], [], first.state]);
  });

  it("owes nothing for a count the app shows, and still marks the segment checked", () => {
    const step = foldCountGrounding({
      id: "seg-1",
      shown: SHOWN,
      state: NO_COUNT_GROUNDING,
      text: "That covers 29 cards.",
      written: [],
    });
    expect([step.owed, step.notes, step.state]).toEqual([[], [], { checked: ["seg-1"] }]);
  });

  it("says the thinking model wrote the number when one of its messages carried it, and not otherwise", () => {
    const fromThread = foldCountGrounding({
      id: "seg-1",
      shown: SHOWN,
      state: NO_COUNT_GROUNDING,
      text: INCIDENT_LINE,
      written: ["You have 26 cards waiting.", "That covers 14 cards, the last of them a check-in."],
    });
    const other = foldCountGrounding({
      id: "seg-1",
      shown: SHOWN,
      state: NO_COUNT_GROUNDING,
      text: INCIDENT_LINE,
      written: ["You have 26 cards waiting.", "I found fourteen problems."],
    });
    expect([fromThread.owed[0].grounding.fromThread, other.owed[0].grounding.fromThread]).toEqual([true, false]);
  });

  it("owes a count against no figure when the app has no reading at all", () => {
    const step = foldCountGrounding({
      id: "seg-1",
      shown: undefined,
      state: NO_COUNT_GROUNDING,
      text: INCIDENT_LINE,
      written: [],
    });
    expect(step.owed.map(({ grounding }) => grounding.expected)).toEqual([[]]);
    expect(countGroundingDetail({ note: step.notes[0] })).toBe(
      `said "fourteen cards", which the app does not show: the app shows no figure for it yet; ${NOT_THREAD}`,
    );
  });
});

describe("countGroundingDetail", () => {
  it("says each of the three notes exactly", () => {
    const [claim] = countClaimsOf({ text: INCIDENT_LINE });
    const expected = [{ count: 29, label: "Everything" }];
    const notes: readonly CountGroundingNote[] = [
      { claim, expected, fromThread: false, kind: "ungrounded" },
      { claim, expected, fromThread: true, kind: "ungrounded" },
      { claim, kind: "recorded" },
      { claim, kind: "not-recorded", why: "the call ended first" },
    ];
    expect(notes.map((note) => countGroundingDetail({ note }))).toEqual([
      `said "fourteen cards", which the app does not show: the app shows Everything 29; ${NOT_THREAD}`,
      'said "fourteen cards", which the app does not show: the app shows Everything 29; the thinking model wrote the same number',
      'recorded where "fourteen cards" came from, for the thinking model; the voice was not told',
      'could not record where "fourteen cards" came from: the call ended first',
    ]);
  });
});
