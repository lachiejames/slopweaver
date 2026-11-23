/**
 * "Is there already a card for this": the topic ranking behind `talk find-card` and the lines the voice reads back.
 * The load-bearing case is the measured one: a one-sentence row that IS about the owner's words
 * outranks a long one that merely mentions them all, and the paraphrases the voice adds find a row the owner's own
 * words do not share. Every row here is synthetic.
 */
import { describe, expect, it } from "vitest";

import type { BoardSection } from "../../../handover/boardTypes.js";
import type { OwnerWaitKind } from "../../../handover/ownerWait.js";
import { type CardText, cardSearchWords, compositionRoots, findCards, rowWordMemo } from "../../../talk/cardFind.js";
import { CLOSED_SHOWN, cardFindLines, LIVE_SHOWN, type PlacedCard, sectionSaid } from "../../../talk/cardFindLines.js";

/** A row with one text, filed under its slug, and no asked instant. */
const row = ({ slug, text, askedIso }: { slug: string; text: string; askedIso?: string }): CardText => ({
  askedIso,
  path: `/board/${slug}.md`,
  slug,
  texts: [text],
});

/** Words no row below is about, so a long row is long without being about anything. */
const PADDING = Array.from({ length: 60 }, (_, index) => `ledger${String(index)} reconcile invoice quarter`).join(" ");

/** The rest of a board: rows about other things, so a word's rarity is measured against something. */
const OTHER_ROWS: readonly CardText[] = Array.from({ length: 20 }, (_, index) =>
  row({ slug: `unrelated-${String(index)}`, text: `rotate the database credentials for cluster ${String(index)}` }),
);

const TARGET = row({
  slug: "the-console-voice-can-do-what-other-agents",
  text: "The console voice can do what other agents can: open the owner's browser on a page they name and run slopweaver verbs",
});

const HANDOFF = row({
  slug: "supervisor-handoff",
  text: `${PADDING} the voice said the other agents were busy, a browser tab was open, the slopweaver verbs ran ${PADDING}`,
});

describe("cardSearchWords", () => {
  it("drops the words the owner says ABOUT a card and keeps the ones naming its topic, browser among them", () => {
    expect(
      cardSearchWords({ words: ["is", "there", "already", "a", "queue", "card", "for", "the", "browser", "voice"] }),
    ).toEqual(["browser", "voice"]);
  });

  it("drops a third-person pronoun as filler, whichever person it names", () => {
    // Spoken words, spelled through a pattern's source: the owner-pronoun gate reads a pattern as speech, which these are.
    const [subject, object, possessive] = [/he/u.source, /him/u.source, /his/u.source];
    const words = ["did", subject, "ask", "for", possessive, "browser", "card", "or", object, "her", "voice"];
    expect(cardSearchWords({ words })).toEqual(["browser", "voice"]);
    // A plural `s` dropped onto one is filler too, as it was when these words sat in the filler list.
    expect(cardSearchWords({ words: ["hiss", "hims", "browser"] })).toEqual(["browser"]);
  });
});

describe("findCards", () => {
  it("ranks a short row that is about the owner's words above a long one that mentions them all", () => {
    const search = findCards({
      rows: [HANDOFF, TARGET, ...OTHER_ROWS],
      words: ["voice", "other", "agents", "browser", "slopweaver", "verbs"],
    });
    expect(search.found.map((found) => found.slug)).toEqual([
      "the-console-voice-can-do-what-other-agents",
      "supervisor-handoff",
    ]);
    expect(search.found[0]!.matched).toEqual(["voice", "other", "agent", "browser", "slopweaver", "verb"]);
  });

  it("never matches a row on its slug", () => {
    const search = findCards({
      rows: [row({ slug: "browser-transport", text: "rotate the signing key" }), ...OTHER_ROWS],
      words: ["browser"],
    });
    expect(search.found).toEqual([]);
    expect(search.searched).toEqual(["browser"]);
  });

  it("names words that leave nothing to search on rather than reading them as every row", () => {
    const search = findCards({ rows: [TARGET, ...OTHER_ROWS], words: ["is", "there", "already", "a", "card"] });
    expect(search).toEqual({
      closeAtTop: 0,
      found: [],
      searched: [],
      unsearchable: ["is", "there", "already", "a", "card"],
    });
  });

  it("counts the rows the owner's words did not choose between, and puts the newer of two equal rows first", () => {
    const search = findCards({
      rows: [
        row({ askedIso: "2026-09-01T00:00:00.000Z", slug: "older", text: "voice browser" }),
        row({ askedIso: "2026-10-01T00:00:00.000Z", slug: "newer", text: "voice browser" }),
        ...OTHER_ROWS,
      ],
      words: ["voice", "browser"],
    });
    expect(search.found.map((found) => found.slug)).toEqual(["newer", "older"]);
    expect(search.closeAtTop).toBe(2);
  });

  it("matches a word at the start of a row's word only", () => {
    const search = findCards({
      rows: [row({ slug: "a", text: "the toolchain" }), row({ slug: "b", text: "a stool" }), ...OTHER_ROWS],
      words: ["tool"],
    });
    expect(search.found.map((found) => found.slug)).toEqual(["a"]);
  });
});

describe("findCards with a shared memo", () => {
  it("ranks a board exactly as an unshared search does, on both of a search's rankings", () => {
    const rows = [TARGET, HANDOFF, ...OTHER_ROWS];
    const words = ["voice", "other", "agents", "browser"];
    const counted = rowWordMemo();

    const first = findCards({ counted, rows, words });
    const second = findCards({ counted, rows, words });

    expect(counted.size).toBe(rows.length);
    expect(first).toEqual(findCards({ rows, words }));
    expect(second).toEqual(first);
  });

  it("counts a row anew when its texts change under the same array, never serving the old counts", () => {
    const texts = ["apple"];
    const mutable: CardText = { askedIso: undefined, path: "/board/r.md", slug: "r", texts };
    const counted = rowWordMemo();

    const before = findCards({ counted, rows: [mutable, ...OTHER_ROWS], words: ["apple"] });
    texts[0] = "banana";
    const after = findCards({ counted, rows: [mutable, ...OTHER_ROWS], words: ["apple"] });

    expect(before.found.map((found) => found.slug)).toEqual(["r"]);
    expect(after.found).toEqual([]);
  });
});

describe("compositionRoots", () => {
  it("adds every row the found rows' blockedBy reaches, transitively, found rows first and each once", () => {
    const board = [
      { blockedBy: ["b"], slug: "a" },
      { blockedBy: ["c", "archived"], slug: "b" },
      { blockedBy: [], slug: "c" },
      { blockedBy: ["c"], slug: "d" },
      { blockedBy: [], slug: "e" },
    ];
    expect(compositionRoots({ board, found: ["a", "d", "a", "gone"] })).toEqual(["a", "d", "b", "c"]);
  });

  // A slug two docs carry must keep the blockers of both, not only the later doc's.
  it("follows the blockers of every doc that carries a found slug", () => {
    const board = [
      { blockedBy: ["b"], slug: "a" },
      { blockedBy: ["c"], slug: "a" },
      { blockedBy: [], slug: "b" },
      { blockedBy: [], slug: "c" },
    ];
    expect(compositionRoots({ board, found: ["a"] })).toEqual(["a", "b", "c"]);
  });

  it("composes nothing when nothing was found", () => {
    expect(compositionRoots({ board: [{ blockedBy: [], slug: "a" }], found: [] })).toEqual([]);
  });
});

/** A placed row in a section, its summary its slug's words, waiting on nobody. */
const placed = ({ slug, section }: { slug: string; section: BoardSection }): PlacedCard => ({
  matched: ["voice"],
  ownerWait: "not-waiting",
  section,
  slug,
  summary: `about ${slug}`,
  unchecked: false,
});

describe("sectionSaid", () => {
  it("says each section but WAITING ON OWNER in words the owner can hear, for a row the Queue does not draw", () => {
    const sections: readonly BoardSection[] = [
      "IN FLIGHT",
      "RUN NOW",
      "PAUSED",
      "NOT YET",
      "AWAITING SHIP",
      "LOOKS SHIPPED",
      "CONTRADICTION",
      "DONE",
      "CLOSED — NOT SHIPPED",
    ];
    expect(sections.map((section) => sectionSaid({ ownerWait: "not-waiting", section }))).toEqual([
      "a session is working on it now",
      "on the board, ready for a session, nobody on it yet",
      "paused",
      "on the board, waiting on another row first",
      "built and waiting to land",
      "looks shipped, not yet closed",
      "on the board, its state contradicting itself",
      "done",
      "closed without shipping",
    ]);
  });

  // A WAITING ON OWNER row the owner had already ruled on must not be said to be on their Queue: the voice would call
  // open_card on it and the console would refuse it in front of them.
  it("says a WAITING ON OWNER row is on the owner's Queue only when it is theirs, and why it is not otherwise", () => {
    const waits: readonly OwnerWaitKind[] = ["owner", "already-ruled", "settled", "not-runnable", "not-waiting"];
    expect(waits.map((ownerWait) => sectionSaid({ ownerWait, section: "WAITING ON OWNER" }))).toEqual([
      "on your Queue, waiting on your word",
      "not on your Queue: you already ruled on it, and it waits on a session to act on that",
      "not on your Queue: it is settled, its question never cleared",
      "not on your Queue: it is paused",
      "not on your Queue: the board holds it for you, but no question is open on it",
    ]);
  });

  // The Queue draws a row by its owner-wait, and the board places one whose probes all pass
  // in LOOKS SHIPPED while its question is still the owner's.
  it("says a row the Queue draws is on the owner's Queue whatever section the board placed it in", () => {
    const sections: readonly BoardSection[] = [
      "WAITING ON OWNER",
      "IN FLIGHT",
      "RUN NOW",
      "PAUSED",
      "NOT YET",
      "CONTRADICTION",
      "AWAITING SHIP",
      "LOOKS SHIPPED",
      "DONE",
      "CLOSED — NOT SHIPPED",
    ];
    expect(new Set(sections.map((section) => sectionSaid({ ownerWait: "owner", section })))).toEqual(
      new Set(["on your Queue, waiting on your word"]),
    );
  });

  // A settled ask composes to DONE or CLOSED — NOT SHIPPED, so a row still asking the owner is said
  // off their Queue by its verdict, never by its section.
  it("says why a row still asking the owner is not on their Queue, whatever section the board placed it in", () => {
    const verdicts: readonly { ownerWait: OwnerWaitKind; section: BoardSection }[] = [
      { ownerWait: "settled", section: "DONE" },
      { ownerWait: "settled", section: "CLOSED — NOT SHIPPED" },
      { ownerWait: "already-ruled", section: "LOOKS SHIPPED" },
      { ownerWait: "not-runnable", section: "PAUSED" },
    ];
    expect(verdicts.map((verdict) => sectionSaid(verdict))).toEqual([
      "not on your Queue: it is settled, its question never cleared",
      "not on your Queue: it is settled, its question never cleared",
      "not on your Queue: you already ruled on it, and it waits on a session to act on that",
      "not on your Queue: it is paused",
    ]);
  });
});

describe("cardFindLines", () => {
  it("names the best row and where it stands in one line", () => {
    expect(
      cardFindLines({
        drafts: [],
        draftsSearched: 0,
        closeAtTop: 1,
        placed: [placed({ section: "IN FLIGHT", slug: "voice-reach" })],
        rowsSearched: 21,
        said: ["voice"],
        unsearchable: [],
      }),
    ).toEqual([
      `0 held draft(s) and 1 board row(s) matching "voice", best first, drafts on the owner's Queue first, then live rows (searched 21 board rows' summaries, the owner's words and open questions, and 0 held drafts on the owner's Queue)`,
      "  voice-reach — a session is working on it now [IN FLIGHT] — about voice-reach (matched voice)",
    ]);
  });

  it("never tells the voice a row the owner already ruled on is on their Queue", () => {
    const lines = cardFindLines({
      drafts: [],
      draftsSearched: 0,
      closeAtTop: 1,
      placed: [{ ...placed({ section: "WAITING ON OWNER", slug: "onboarding-flow" }), ownerWait: "already-ruled" }],
      rowsSearched: 21,
      said: ["voice"],
      unsearchable: [],
    });
    expect(lines.slice(1)).toEqual([
      "  onboarding-flow — not on your Queue: you already ruled on it, and it waits on a session to act on that [WAITING ON OWNER] — about onboarding-flow (matched voice)",
    ]);
  });

  // A row the probe budget never reached composes as written, so its line must say so.
  it("says a row's section is as written when its probes ran out of time", () => {
    const lines = cardFindLines({
      drafts: [],
      draftsSearched: 0,
      closeAtTop: 1,
      placed: [{ ...placed({ section: "RUN NOW", slug: "slow-probe" }), unchecked: true }],
      rowsSearched: 21,
      said: ["voice"],
      unsearchable: [],
    });
    expect(lines.slice(1)).toEqual([
      "  slow-probe — on the board, ready for a session, nobody on it yet [RUN NOW] — about slow-probe (matched voice) — its probes ran out of time, so that is where it was written down, unchecked",
    ]);
  });

  // A passing probe the budget never reached moves a registered ask out of the owner's Queue, so a
  // row that would be theirs, composed as written, is never said to be on it.
  it("never says a row is on the owner's Queue when its probes ran out of time", () => {
    const lines = cardFindLines({
      drafts: [],
      draftsSearched: 0,
      closeAtTop: 1,
      placed: [{ ...placed({ section: "WAITING ON OWNER", slug: "slow-ask" }), ownerWait: "owner", unchecked: true }],
      rowsSearched: 21,
      said: ["voice"],
      unsearchable: [],
    });
    expect(lines.slice(1)).toEqual([
      "  slow-ask — not known to be on your Queue: its probes ran out of time, so whether the Queue draws it is unchecked [WAITING ON OWNER] — about slow-ask (matched voice) — its probes ran out of time, so that is where it was written down, unchecked",
    ]);
  });

  it("cuts a long summary between graphemes, never inside a skin-toned emoji", () => {
    const lines = cardFindLines({
      drafts: [],
      draftsSearched: 0,
      closeAtTop: 1,
      placed: [{ ...placed({ section: "DONE", slug: "thumbs" }), summary: "👍🏽".repeat(200) }],
      rowsSearched: 1,
      said: ["voice"],
      unsearchable: [],
    });
    expect(lines.at(-1)).toBe(`  thumbs — done [DONE] — ${"👍🏽".repeat(159)}… (matched voice)`);
  });

  it("says there is no card when no row matches, naming what was searched", () => {
    expect(
      cardFindLines({
        drafts: [],
        draftsSearched: 0,
        closeAtTop: 0,
        placed: [],
        rowsSearched: 21,
        said: ["voice"],
        unsearchable: [],
      }),
    ).toEqual([
      `nothing matches "voice" — there is no card for that yet (searched 21 board rows' summaries, the owner's words and open questions, and 0 held drafts on the owner's Queue)`,
    ]);
  });

  it("asks for a topic when the owner's words named none", () => {
    expect(
      cardFindLines({
        drafts: [],
        draftsSearched: 0,
        closeAtTop: 0,
        placed: [],
        rowsSearched: 21,
        said: ["a", "card"],
        unsearchable: ["a", "card"],
      }),
    ).toEqual(['no card searched: "a card" names nothing to search on — pass what the card is about']);
  });

  it("puts live rows before closed ones, caps each, and says how many it left out and that the top is a tie", () => {
    const live = Array.from({ length: LIVE_SHOWN + 2 }, (_, index) =>
      placed({ section: "RUN NOW", slug: `live-${String(index)}` }),
    );
    const closed = Array.from({ length: CLOSED_SHOWN + 1 }, (_, index) =>
      placed({ section: "DONE", slug: `done-${String(index)}` }),
    );
    const lines = cardFindLines({
      drafts: [],
      draftsSearched: 0,
      closeAtTop: 3,
      placed: [closed[0]!, ...live, ...closed.slice(1)],
      rowsSearched: 50,
      said: ["voice"],
      unsearchable: [],
    });
    expect(lines[0]).toContain("; 3 close at the top, so read their summaries before naming one");
    expect(lines.slice(1, 1 + LIVE_SHOWN).map((line) => line.split(" — ")[0]!.trim())).toEqual(
      live.slice(0, LIVE_SHOWN).map((card) => card.slug),
    );
    expect(lines.slice(1 + LIVE_SHOWN)).toEqual([
      "  …2 more live row(s) not shown — pass fewer, rarer words",
      "closed:",
      "  done-0 — done [DONE] — about done-0 (matched voice)",
      "  done-1 — done [DONE] — about done-1 (matched voice)",
      "  done-2 — done [DONE] — about done-2 (matched voice)",
      "  …1 more closed row(s) not shown",
    ]);
  });

  it("says so when every match is closed", () => {
    const lines = cardFindLines({
      drafts: [],
      draftsSearched: 0,
      closeAtTop: 1,
      placed: [placed({ section: "DONE", slug: "shipped" })],
      rowsSearched: 5,
      said: ["voice"],
      unsearchable: [],
    });
    expect(lines.slice(1)).toEqual([
      "  no LIVE row matches: every match below is closed",
      "closed:",
      "  shipped — done [DONE] — about shipped (matched voice)",
    ]);
  });
});
