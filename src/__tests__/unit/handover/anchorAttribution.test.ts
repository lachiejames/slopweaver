/**
 * The acme-admin card, as a test: its anchor linked Kieran Mendez's review ask, and its prose said Theo asked.
 */
import { describe, expect, it } from "vitest";

import {
  attributedNames,
  attributionMismatches,
  givenNamesOf,
  posterWordsOf,
  slackHumans,
} from "../../../handover/anchorAttribution.js";
import type { PersonIdentity } from "../../../silver/identity.js";

const KIERAN_IDENTITIES: readonly PersonIdentity[] = [
  { handle: "kieran.mendez", name: "Kieran Mendez", nativeId: "U0SYN000014", source: "slack" },
  { handle: "kieranmendez-acme", nativeId: "kieranmendez-acme", source: "github" },
];
const KIERAN = givenNamesOf({ identities: KIERAN_IDENTITIES });
const POSTER = posterWordsOf({ identities: KIERAN_IDENTITIES });
const THEO = givenNamesOf({
  identities: [{ handle: "theo.marsh", name: "Theo Marsh", nativeId: "U0THEO", source: "slack" }],
});
const PEOPLE = new Set([...KIERAN, ...THEO]);

describe("givenNamesOf", () => {
  it("takes the first word of each name and the first part of each handle, lowercased", () => {
    expect([...KIERAN].toSorted()).toEqual(["kieran", "kieranmendez"]);
  });

  it("is empty for a person with no name or handle", () => {
    expect(givenNamesOf({ identities: [{ nativeId: "U1", source: "slack" }] }).size).toBe(0);
  });

  it("reads past an honorific, and never takes the platform's own name", () => {
    const names = givenNamesOf({
      identities: [
        { handle: "dr.martin.zell", name: "Dr Martin Zell", nativeId: "U2", source: "slack" },
        { name: "Slack", nativeId: "USLACKBOT", source: "slack" },
      ],
    });
    expect([...names]).toEqual(["martin"]);
  });

  it("reads a name through punctuation, never a word a sentence cannot spell", () => {
    const names = givenNamesOf({
      identities: [
        { name: "Dr. Lauren Mac Arthur", nativeId: "U0SYN000036", source: "slack" },
        { name: "Anna-Marie", nativeId: "U3", source: "slack" },
        { name: "Reynold(US)", nativeId: "U4", source: "slack" },
      ],
    });
    expect([...names]).toEqual(["lauren", "anna", "reynold"]);
  });
});

describe("posterWordsOf", () => {
  it("is every name word, each handle's first word and every native id, lowercased — never a handle's org suffix", () => {
    expect([...POSTER].toSorted()).toEqual(["kieran", "kieranmendez", "kieranmendez-acme", "mendez", "u0syn000014"]);
  });

  it("reads a handle with digits whole, and only a login's or email's first word even in a name field", () => {
    const words = posterWordsOf({
      identities: [
        { handle: "h2009210", name: "Nina Hale", nativeId: "U0SYN000037", source: "slack" },
        { name: "nina.hale@acme.com", nativeId: "L1", source: "linear" },
      ],
    });
    expect([...words].toSorted()).toEqual(["h2009210", "hale", "l1", "nina", "u0syn000037"]);
  });
});

describe("slackHumans", () => {
  it("keeps a person with a Slack identity, never a bot, an integration or someone Slack never saw", () => {
    const humans = slackHumans({
      people: [
        { confidence: "email", id: "person:kieran", identities: [{ nativeId: "U0SYN000014", source: "slack" }] },
        { confidence: "x", id: "person:bot", identities: [{ nativeId: "B1", source: "slack" }], kind: "bot" },
        {
          confidence: "x",
          id: "person:linear",
          identities: [{ nativeId: "L1", source: "slack" }],
          kind: "integration",
        },
        {
          confidence: "x",
          id: "person:claude",
          identities: [{ nativeId: "claude", source: "github" }],
          kind: "person",
        },
      ],
    });
    expect(humans.map((person) => person.id)).toEqual(["person:kieran"]);
  });
});

describe("attributedNames", () => {
  it("reads one or two capitalised words before an attributing verb", () => {
    expect(attributedNames({ text: "This morning Theo Marsh tagged @platform-eng; Kieran asked twice." })).toEqual([
      { verb: "tagged", words: ["Theo", "Marsh"] },
      { verb: "asked", words: ["Kieran"] },
    ]);
  });

  it("reads nothing from a text with no attribution", () => {
    expect(attributedNames({ text: "a seat reviews #18326 and parks the comments" })).toEqual([]);
  });
});

describe("attributionMismatches", () => {
  it("catches the incident's summary: Theo named as asking over Kieran's message", () => {
    expect(
      attributionMismatches({
        author: POSTER,
        people: PEOPLE,
        texts: [
          "Should a seat review acme-admin#18326 for platform? Theo asked @platform-eng to review and ship it this morning.",
        ],
      }),
    ).toEqual([{ name: "Theo", verb: "asked" }]);
  });

  it("catches the incident's example scene, a full name and a leading word included", () => {
    expect(
      attributionMismatches({
        author: POSTER,
        people: PEOPLE,
        texts: ["Theo tagged @platform-eng this morning", "Yesterday Theo Marsh posted it"],
      }),
    ).toEqual([
      { name: "Theo", verb: "tagged" },
      { name: "Theo", verb: "posted" },
    ]);
  });

  it("passes the recut card naming the person who posted it", () => {
    expect(
      attributionMismatches({
        author: POSTER,
        people: PEOPLE,
        texts: ["Kieran Mendez asked @platform-eng to review and ship it this morning"],
      }),
    ).toEqual([]);
  });

  it("passes a capitalised word that is nobody on the roster", () => {
    expect(
      attributionMismatches({
        author: POSTER,
        people: PEOPLE,
        texts: ["Platform asked for it", "CodeRabbit flagged one"],
      }),
    ).toEqual([]);
  });

  it("passes a text naming the poster beside someone else's separate act", () => {
    expect(
      attributionMismatches({
        author: POSTER,
        people: PEOPLE,
        texts: ["Kieran asked @platform-eng to review #18326; it supersedes the fix Theo raised in #13953."],
      }),
    ).toEqual([]);
  });

  it("passes a text naming the poster in any shape, not only before a verb", () => {
    expect(
      attributionMismatches({
        author: POSTER,
        people: PEOPLE,
        texts: [
          "Review Kieran's #18326 for @platform-eng; it supersedes the fix Theo raised in #13953.",
          "@kieran.mendez wants a review; Theo wrote the older fix.",
          "Mendez wants a review; Theo wrote the older fix.",
          "<@U0SYN000014> wants a review; Theo wrote the older fix.",
        ],
      }),
    ).toEqual([]);
  });

  it("never reads a name ending one line and a verb opening the next as one claim", () => {
    expect(
      attributionMismatches({
        author: POSTER,
        people: PEOPLE,
        texts: ["PR #18326 by Theo\nPlatform asked for a review"],
      }),
    ).toEqual([]);
  });

  it("never reads words in double quotes as a claim", () => {
    expect(
      attributionMismatches({
        author: POSTER,
        people: PEOPLE,
        texts: ['The old card said "Theo tagged platform"; the ask is on the thread.'],
      }),
    ).toEqual([]);
  });

  it("judges each text alone, so a scene naming only someone else is caught beside a summary naming the poster", () => {
    expect(
      attributionMismatches({
        author: POSTER,
        people: PEOPLE,
        texts: ["Kieran asked @platform-eng to ship it.", "Theo tagged @platform-eng this morning."],
      }),
    ).toEqual([{ name: "Theo", verb: "tagged" }]);
  });

  it("passes no texts at all", () => {
    expect(attributionMismatches({ author: POSTER, people: PEOPLE, texts: [] })).toEqual([]);
  });
});
