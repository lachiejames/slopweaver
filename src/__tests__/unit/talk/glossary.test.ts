/**
 * The glossary the console voice reads before it answers "what is a …". The load-bearing case is a past
 * failure: asked what a JumpCloud atlas is, the voice guessed. The matcher must hand back the
 * specific entry first and the general one after it.
 */
import { describe, expect, it } from "vitest";

import { fleetWordsIn, glossaryMatches, installGlossary, TALK_GLOSSARY } from "../../../talk/glossary.js";

describe("TALK_GLOSSARY", () => {
  it("defines every word the handover names, so none of them is answered from memory", () => {
    expect(TALK_GLOSSARY.length).toBeGreaterThan(0);
    const required = [
      "atlas",
      "handover",
      "card",
      "seat",
      "gate",
      "lap",
      "gold",
      "silver",
      "bronze",
      "landing",
      "react-now",
      "board",
      "loop",
      "chair",
      "plan-five",
      "cmux",
      "door",
      "recipe",
      "knowledge row",
      "finding",
      "context pack",
    ];
    expect(required.filter((word) => glossaryMatches({ query: word }).length === 0)).toEqual([]);
  });

  // `talk glossary` with no term prints the whole list, and the console refuses a tool result past 24 KiB.
  it("fits whole inside the console's tool cap, so a no-term read is never cut", () => {
    expect(Buffer.byteLength(JSON.stringify({ entries: TALK_GLOSSARY }), "utf8")).toBeLessThan(16 * 1024);
  });

  it("spells each term once", () => {
    const terms = TALK_GLOSSARY.map((entry) => entry.term);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("says a JumpCloud atlas is a read-only walk of the JumpCloud tenancy, and where its live state is", () => {
    const entry = TALK_GLOSSARY.find((row) => row.term === "JumpCloud atlas")!;
    expect(entry.means).toContain("walked read-only from the Directory API");
    expect(entry.means).toContain("`slopweaver atlas jumpcloud coverage`");
  });
});

describe("glossaryMatches", () => {
  it("answers a JumpCloud question with the specific entry first, then the general one", () => {
    expect(glossaryMatches({ query: "What is a JumpCloud atlas?" }).map((entry) => entry.term)).toEqual([
      "JumpCloud atlas",
      "atlas",
    ]);
  });

  it("finds a variant of a slash-separated term, and a plural of it", () => {
    expect(glossaryMatches({ query: "silver" }).map((entry) => entry.term)).toEqual(["gold / silver / bronze"]);
    expect(glossaryMatches({ query: "how many cards are there" }).map((entry) => entry.term)).toEqual(["card"]);
  });

  it("matches on whole words only, so a word that merely contains a term is not it", () => {
    expect(glossaryMatches({ query: "cardboard" })).toEqual([]);
  });

  it("finds the bot by its role, never a third party's bot", () => {
    expect(glossaryMatches({ query: "what does the bot do" }).map((entry) => entry.term)).toEqual(["the bot"]);
    expect(glossaryMatches({ query: "What is a Twitter bot?" })).toEqual([]);
  });

  it("finds the bot by a handle the install declares, and by no handle it does not", () => {
    const entries = installGlossary({ botHandles: ["acme-bot"] });
    expect(glossaryMatches({ entries, query: "what is acme-bot" }).map((entry) => entry.term)).toEqual([
      "the bot / acme-bot",
    ]);
    expect(glossaryMatches({ entries, query: "what is github-bot" })).toEqual([]);
    expect(glossaryMatches({ query: "what is acme-bot" })).toEqual([]);
    expect(installGlossary({ botHandles: [" "] })).toBe(TALK_GLOSSARY);
  });

  it("returns nothing for an empty or punctuation-only query", () => {
    expect(glossaryMatches({ query: "  ?! " })).toEqual([]);
  });

  it("searches the list it is handed", () => {
    const entries = [{ means: "a test word", notOwners: [], term: "widget" }];
    expect(glossaryMatches({ entries, query: "widgets" })).toEqual(entries);
    expect(glossaryMatches({ entries, query: "atlas" })).toEqual([]);
  });
});

describe("fleetWordsIn", () => {
  it("names only variants of the entry's own term, so a word the owner does not use is one the voice can explain", () => {
    expect(TALK_GLOSSARY.length).toBeGreaterThan(0);
    const stray = TALK_GLOSSARY.flatMap((entry) =>
      entry.notOwners.filter((word) => !entry.term.split(" / ").includes(word)).map((word) => `${entry.term}: ${word}`),
    );
    expect(stray).toEqual([]);
  });

  it("finds the word that cost the ruling, plural included", () => {
    expect(fleetWordsIn({ text: "a call that opened with a context pack" }).map((hit) => hit.word)).toEqual([
      "context pack",
    ]);
    expect(fleetWordsIn({ text: "Both context packs were stale" }).map((hit) => hit.word)).toEqual(["context pack"]);
  });

  it("leaves the owner's own words and a split phrase alone", () => {
    expect(fleetWordsIn({ text: "Check the board on the console, then pack the context away" })).toEqual([]);
    expect(fleetWordsIn({ text: "What is in the JumpCloud atlas?" }).map((hit) => hit.word)).toEqual([
      "JumpCloud atlas",
    ]);
  });
});
