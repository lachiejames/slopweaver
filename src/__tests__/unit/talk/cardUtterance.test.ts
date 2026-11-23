/**
 * `closedCardUtterances` — the owner's speech cut into finished utterances, each with the card open when it began.
 *
 * The worked example: the owner asked "what is a voice mark" with a hand step open and
 * never relayed it, so nothing reached the card. Every case here builds a call's lines the way the page writes
 * them — snapshots that repeat an id, then a final — and asserts the exact utterances that come out.
 */
import { describe, expect, it } from "vitest";

import type { CallEntry } from "../../../talk/callRecord.js";
import {
  callSegmentAnchor,
  closedCardUtterances,
  transcriptCardUtterances,
  unfinishedBefore,
} from "../../../talk/cardUtterance.js";
import { CLOSED, said } from "./cardUtteranceFixture.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const TURN = "a0000071-0000-4000-8000-000000000077";
const HAND = "hand:voice-mark-step";
const PR = "pr:16406";

describe("closedCardUtterances", () => {
  it("lands the worked example: one question over a hand step, finished by the voice answering", () => {
    const entries = [
      said({ at: "40:00", final: false, id: "s-1", open: HAND, text: "what is a" }),
      said({ at: "40:01", id: "s-1", open: HAND, text: "what is a voice mark" }),
      said({ at: "40:03", id: "v-1", open: HAND, text: "A voice mark is", who: "voice" }),
    ];
    expect(closedCardUtterances({ callId: CALL, entries })).toEqual([
      {
        anchor: `call:${CALL}#s-1`,
        cardKey: HAND,
        decidedIso: "2026-09-25T15:40:00.000Z",
        laterAnchors: [],
        relayTurns: [],
        words: "what is a voice mark",
        wordsCut: false,
      },
    ]);
  });

  it("joins consecutive stretches on one card into one utterance, anchored at the first", () => {
    const entries = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "what is" }),
      said({ at: "40:02", id: "s-2", open: HAND, text: "a voice mark" }),
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.anchor, u.words, u.laterAnchors])).toEqual([
      [`call:${CALL}#s-1`, "what is a voice mark", [`call:${CALL}#s-2`]],
    ]);
  });

  it("splits at a card change, and keeps the card each stretch BEGAN on", () => {
    const entries = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "what is a voice mark" }),
      said({ at: "40:05", id: "s-2", open: PR, text: "and merge this one" }),
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.cardKey, u.words])).toEqual([
      [HAND, "what is a voice mark"],
      [PR, "and merge this one"],
    ]);
  });

  it("splits where the card's opener changes, and says the voice opened the one it did", () => {
    const entries = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "what is a voice mark" }),
      { ...said({ at: "40:05", id: "s-2", open: HAND, text: "coming back to it" }), openBy: "voice" as const },
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.cardKey, u.words, u.openBy])).toEqual([
      [HAND, "what is a voice mark", undefined],
      [HAND, "coming back to it", "voice"],
    ]);
  });

  it("holds back the last utterance until something proves it finished", () => {
    const entries = [said({ at: "40:00", id: "s-1", open: HAND, text: "what is a voice mark" })];
    expect(closedCardUtterances({ callId: CALL, entries })).toEqual([]);
  });

  it("stops at the owner's stretch still going on, even with a finished one after it in the file", () => {
    const entries = [
      said({ at: "40:00", final: false, id: "s-1", open: HAND, text: "what is a" }),
      said({ at: "40:04", id: "v-1", open: HAND, text: "go on", who: "voice" }),
    ];
    expect(closedCardUtterances({ callId: CALL, entries })).toEqual([]);
  });

  it("lands a cut-off stretch once the call closed", () => {
    const entries = [said({ at: "40:00", final: false, id: "s-1", open: HAND, text: "what is a" }), CLOSED];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => u.words)).toEqual(["what is a"]);
  });

  it("skips speech with no card open, and never lands the voice's own words", () => {
    const entries = [
      said({ at: "40:00", id: "s-1", open: undefined, text: "how is staging" }),
      said({ at: "40:02", id: "v-1", open: HAND, text: "it is fine", who: "voice" }),
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries })).toEqual([]);
  });

  it("orders stretches by the instant they began, not by file position", () => {
    const entries = [
      said({ at: "40:05", id: "s-2", open: PR, text: "and merge this one" }),
      said({ at: "40:00", id: "s-1", open: HAND, text: "what is a voice mark" }),
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => u.cardKey)).toEqual([HAND, PR]);
  });

  it("names a relay the voice made of these words onto this card, and not one onto another card", () => {
    const relay = ({ at, about }: { at: string; about: string }): CallEntry => ({
      about,
      atIso: `2026-09-25T15:${at}.000Z`,
      detail: "",
      heard: "What is a voice-mark?",
      kind: "relay",
      outcome: "registered",
      say: "",
      turnId: TURN,
    });
    const entries = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "what is a voice mark" }),
      relay({ about: HAND, at: "40:02" }),
      relay({ about: PR, at: "40:03" }),
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => u.relayTurns)).toEqual([[TURN]]);
  });

  // A relay about the card that heard none of the owner's speech carried a typed steer, not these words.
  it("names no relay onto this card that heard nothing the owner said", () => {
    const entries: CallEntry[] = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "alpha" }),
      said({ at: "40:01", id: "v-1", open: HAND, text: "Noted.", who: "voice" }),
      {
        about: HAND,
        atIso: "2026-09-25T15:40:04.000Z",
        detail: "",
        heard: "",
        kind: "relay",
        outcome: "registered",
        say: "beta",
        turnId: TURN,
      },
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.words, u.relayTurns])).toEqual([
      ["alpha", []],
    ]);
  });

  // A relay of words begun over two cards names neither, and each utterance it carried reuses its row.
  it("names a card-less relay on every earlier utterance whose words it heard, and on none it did not", () => {
    const entries: CallEntry[] = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "ship A" }),
      said({ at: "40:05", id: "s-2", open: PR, text: "inspect B" }),
      {
        about: "",
        atIso: "2026-09-25T15:40:09.000Z",
        detail: "",
        heard: "ship A  inspect B",
        kind: "relay",
        outcome: "registered",
        say: "",
        turnId: TURN,
      },
      said({ at: "40:12", id: "s-3", open: HAND, text: "and one more" }),
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.cardKey, u.relayTurns])).toEqual([
      [HAND, [TURN]],
      [PR, [TURN]],
      [HAND, []],
    ]);
  });

  // The owner spoke again over the same card while the relay was capturing; the relay heard both utterances.
  it("names a card's relay on every earlier utterance on that card whose words it heard", () => {
    const entries: CallEntry[] = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "ship A" }),
      said({ at: "40:02", id: "v-1", open: HAND, text: "On it.", who: "voice" }),
      said({ at: "40:05", id: "s-2", open: HAND, text: "also inspect it" }),
      {
        about: HAND,
        atIso: "2026-09-25T15:40:09.000Z",
        detail: "",
        heard: "ship A also inspect it",
        kind: "relay",
        outcome: "registered",
        say: "",
        turnId: TURN,
      },
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.words, u.relayTurns])).toEqual([
      ["ship A", [TURN]],
      ["also inspect it", [TURN]],
    ]);
  });

  // A relay about the card that heard other words carried none of these, so they keep their own row.
  it("names no relay onto this card that heard other words than these", () => {
    const entries: CallEntry[] = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "alpha" }),
      said({ at: "40:01", id: "v-1", open: HAND, text: "Noted.", who: "voice" }),
      {
        about: HAND,
        atIso: "2026-09-25T15:40:04.000Z",
        detail: "",
        heard: "beta",
        kind: "relay",
        outcome: "registered",
        say: "beta",
        turnId: TURN,
      },
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.words, u.relayTurns])).toEqual([
      ["alpha", []],
    ]);
  });

  // The gate log and the transcript may spell one word with and without its apostrophe.
  it("matches a relay's heard words ignoring case, punctuation and apostrophes", () => {
    const entries: CallEntry[] = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "dont ship" }),
      said({ at: "40:01", id: "v-1", open: HAND, text: "Noted.", who: "voice" }),
      {
        about: HAND,
        atIso: "2026-09-25T15:40:04.000Z",
        detail: "",
        heard: "Don’t ship!",
        kind: "relay",
        outcome: "registered",
        say: "",
        turnId: TURN,
      },
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => u.relayTurns)).toEqual([[TURN]]);
  });

  // Lower-casing alone reads "ΟΣ" as "ος" and "οσ" as itself, and "STRASSE" never as "straße".
  it("matches a relay's heard words in any letter case, not only ASCII", () => {
    const relayOf = ({ heard, turnId }: { heard: string; turnId: string }): CallEntry => ({
      about: HAND,
      atIso: "2026-09-25T15:40:04.000Z",
      detail: "",
      heard,
      kind: "relay",
      outcome: "registered",
      say: "",
      turnId,
    });
    const turns = [
      { heard: "οσ", said: "ΟΣ" },
      { heard: "die straße", said: "STRASSE" },
    ].map(({ heard, said: text }) =>
      closedCardUtterances({
        callId: CALL,
        entries: [said({ at: "40:00", id: "s-1", open: HAND, text }), relayOf({ heard, turnId: TURN }), CLOSED],
      }).map((u) => u.relayTurns),
    );
    expect(turns).toEqual([[[TURN]], [[TURN]]]);
  });

  // A relay's later state repeats what it heard when it began, so it never claims speech said since.
  it("places a relay at its first line, so its later state never names words it did not hear", () => {
    const relay = ({ at, outcome }: { at: string; outcome: string }): CallEntry => ({
      about: HAND,
      atIso: `2026-09-25T15:${at}.000Z`,
      detail: "",
      heard: "alpha",
      kind: "relay",
      outcome,
      say: "",
      turnId: TURN,
    });
    const entries: CallEntry[] = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "alpha" }),
      relay({ at: "40:01", outcome: "sending" }),
      said({ at: "40:02", id: "s-2", open: PR, text: "gamma" }),
      said({ at: "40:04", id: "s-3", open: HAND, text: "beta" }),
      relay({ at: "40:06", outcome: "relayed" }),
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.words, u.relayTurns])).toEqual([
      ["alpha", [TURN]],
      ["gamma", []],
      ["beta", []],
    ]);
  });

  // Joined across the relay, the two would be heard by no relay and the relayed half would land twice.
  it("ends the owner's utterance at a relay, so words over one card either side of it land apart", () => {
    const entries: CallEntry[] = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "ship alpha" }),
      {
        about: HAND,
        atIso: "2026-09-25T15:40:01.000Z",
        detail: "",
        heard: "ship alpha",
        kind: "relay",
        outcome: "relayed",
        say: "",
        turnId: TURN,
      },
      said({ at: "40:02", id: "s-2", open: HAND, text: "also test beta" }),
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.words, u.relayTurns])).toEqual([
      ["ship alpha", [TURN]],
      ["also test beta", []],
    ]);
  });

  it("holds an utterance while its relay is still sending, so it lands on the relay's row once that exists", () => {
    const relay = ({ at, outcome }: { at: string; outcome: string }): CallEntry => ({
      about: HAND,
      atIso: `2026-09-25T15:${at}.000Z`,
      detail: "",
      heard: "ship it",
      kind: "relay",
      outcome,
      say: "",
      turnId: TURN,
    });
    const spoken = [
      said({ at: "40:00", id: "s-1", open: HAND, text: "ship it" }),
      relay({ at: "40:01", outcome: "sending" }),
      said({ at: "40:02", id: "v-1", open: HAND, text: "On it.", who: "voice" }),
    ];
    const slugsOf = ({ entries }: { entries: readonly CallEntry[] }): readonly (readonly string[])[] =>
      closedCardUtterances({ callId: CALL, entries }).map((u) => u.relayTurns);
    expect(slugsOf({ entries: spoken })).toEqual([]);
    expect(slugsOf({ entries: [...spoken, relay({ at: "40:04", outcome: "relayed" })] })).toEqual([[TURN]]);
    expect(slugsOf({ entries: [...spoken, CLOSED] })).toEqual([]);
    expect(
      closedCardUtterances({ callId: CALL, ended: true, entries: [...spoken, CLOSED] }).map((u) => u.relayTurns),
    ).toEqual([[TURN]]);
    expect(unfinishedBefore({ entries: [...spoken, CLOSED], openedIso: "2026-09-25T16:00:00.000Z" })).toBe(true);
    expect(
      unfinishedBefore({
        entries: [...spoken, relay({ at: "40:04", outcome: "relayed" }), CLOSED],
        openedIso: "2026-09-25T16:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("callSegmentAnchor", () => {
  it("keeps a plain segment id literal and hashes anything else", () => {
    expect(callSegmentAnchor({ callId: CALL, segmentId: "item_1.a" })).toBe(`call:${CALL}#item_1.a`);
    // sha256 of "a b#c" as UTF-16LE, its first 24 hex digits.
    expect(callSegmentAnchor({ callId: CALL, segmentId: "a b#c" })).toBe(`call:${CALL}#~cceb0f9844fb3a1b4c3ff721`);
  });

  // A 200-character id the call file accepts percent-encoded past the ledger's 300-character anchor bound.
  it("names every id the call file accepts within the ledger's anchor bound, a lone surrogate included", () => {
    const ids = ["#".repeat(200), "\u{1F600}".repeat(100), "\ud800", "\ud801"];
    const anchors = ids.map((segmentId) => callSegmentAnchor({ callId: CALL, segmentId }));
    expect(anchors.map((anchor) => anchor.length)).toEqual([67, 67, 67, 67]);
    expect(new Set(anchors).size).toBe(4);
  });
});

describe("a call that dropped", () => {
  const cut = [said({ at: "40:00", final: false, id: "s-1", open: HAND, text: "what is a voice mark" })];

  it("lands its unfinished last stretch once it is known to have ended", () => {
    expect(closedCardUtterances({ callId: CALL, entries: cut })).toEqual([]);
    expect(closedCardUtterances({ callId: CALL, ended: true, entries: cut }).map((u) => [u.cardKey, u.words])).toEqual([
      [HAND, "what is a voice mark"],
    ]);
  });

  it("reads as unfinished only with no close line and no line after the next call opened, a same-millisecond one included", () => {
    expect(unfinishedBefore({ entries: cut, openedIso: "2026-09-25T15:41:00.000Z" })).toBe(true);
    expect(unfinishedBefore({ entries: cut, openedIso: "2026-09-25T15:40:00.000Z" })).toBe(true);
    expect(unfinishedBefore({ entries: cut, openedIso: "2026-09-25T15:39:59.999Z" })).toBe(false);
    expect(unfinishedBefore({ entries: [...cut, CLOSED], openedIso: "2026-09-25T16:00:00.000Z" })).toBe(false);
    expect(unfinishedBefore({ entries: [], openedIso: "2026-09-25T16:00:00.000Z" })).toBe(false);
  });

  it("never reads a reconnect step written after the close as the call still running", () => {
    const step: CallEntry = {
      atIso: "2026-09-25T16:01:00.000Z",
      event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
      kind: "reconnect",
    };
    expect(unfinishedBefore({ entries: [...cut, step], openedIso: "2026-09-25T16:00:00.000Z" })).toBe(true);
    expect(unfinishedBefore({ entries: [...cut, CLOSED, step], openedIso: "2026-09-25T16:00:00.000Z" })).toBe(false);
  });
});

// The voice called open_card on this ask unasked, and every aside the owner made
// over it — "just coming back to the computer", a thank-you, "Yeah" — landed as a ruling and took it off their Queue.
describe("transcriptCardUtterances", () => {
  const MIGRATION_ASK =
    "ask:the-proposal-that-a-bad-db-migration-can-never-break-ci-again-found-with-what-happened-to-it-and-todays-failed-migration-tied-to-it";
  const aside = "Y- Um... Mm... uh- just coming back to the computer in a minute to have a better look at that";

  const answered = ({
    about,
    at,
    heard,
    answersCard = true,
    turnId = TURN,
    alsoAnswers,
  }: {
    about: string;
    at: string;
    heard: string;
    answersCard?: boolean;
    turnId?: string;
    alsoAnswers?: string[];
  }): CallEntry => ({
    about,
    ...(alsoAnswers === undefined ? {} : { alsoAnswers }),
    ...(answersCard ? { answersCard: true } : {}),
    atIso: `2026-09-25T15:${at}.000Z`,
    detail: "",
    heard,
    kind: "relay",
    outcome: "registered",
    say: heard,
    turnId,
  });

  it("lands nothing the owner said over a card the voice opened, and still lands what they said over one they opened", () => {
    const entries = [
      { ...said({ at: "50:51", id: "s-1", open: MIGRATION_ASK, text: aside }), openBy: "voice" as const },
      said({ at: "51:10", id: "s-2", open: PR, text: "yes, go ahead" }),
      answered({ about: PR, at: "51:12", heard: "yes, go ahead" }),
      CLOSED,
    ];
    expect(transcriptCardUtterances({ callId: CALL, entries }).map((u) => [u.cardKey, u.words])).toEqual([
      [PR, "yes, go ahead"],
    ]);
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.cardKey, u.openBy])).toEqual([
      [MIGRATION_ASK, "voice"],
      [PR, undefined],
    ]);
  });

  // "Uh, good morning" and seventeen stretches about other work, said with a
  // Twilio hand step open, landed on it and took it off their Queue.
  it("lands nothing the voice did not judge an answer to the card, nor any line written before it judged", () => {
    const entries = [
      said({ at: "51:10", id: "s-1", open: PR, text: "what changed in the vulnerability bumps" }),
      answered({ about: PR, answersCard: false, at: "51:12", heard: "what changed in the vulnerability bumps" }),
      said({ at: "51:20", id: "s-2", open: PR, text: "and bump the rest" }),
      CLOSED,
    ];
    expect(transcriptCardUtterances({ callId: CALL, entries })).toEqual([]);
  });

  // A card a relay named in alsoAnswers was landed by `talk relay` under its own anchor.
  it("lands nothing on a card a later relay of the same words landed through alsoAnswers, and lands it without one", () => {
    const ASK = "ask:may-the-fleet-split-oversized-files";
    const words = "always split oversized files";
    const over = [
      said({ at: "51:10", id: "s-1", open: ASK, text: words }),
      answered({ about: ASK, at: "51:12", heard: words }),
    ];
    const later = answered({
      about: PR,
      alsoAnswers: [ASK],
      at: "51:30",
      heard: `${words} and merge it`,
      turnId: "a0000077-0000-4000-8000-000000000084",
    });
    const landed = [...over, said({ at: "51:20", id: "s-2", open: PR, text: "and merge it" }), later, CLOSED];
    const without = [...over, CLOSED];
    expect(closedCardUtterances({ callId: CALL, entries: landed }).map((u) => [u.cardKey, u.relayLanded])).toEqual([
      [ASK, true],
      [PR, undefined],
    ]);
    expect(transcriptCardUtterances({ callId: CALL, entries: landed }).map((u) => u.cardKey)).toEqual([PR]);
    expect(transcriptCardUtterances({ callId: CALL, entries: without }).map((u) => u.cardKey)).toEqual([ASK]);
  });

  it("covers no words an alsoAnswers relay never heard", () => {
    const ASK = "ask:may-the-fleet-split-oversized-files";
    const entries = [
      said({ at: "51:10", id: "s-1", open: ASK, text: "always split oversized files" }),
      answered({ about: ASK, at: "51:12", heard: "always split oversized files" }),
      answered({
        about: PR,
        alsoAnswers: [ASK],
        at: "51:30",
        heard: "merge it",
        turnId: "a0000077-0000-4000-8000-000000000084",
      }),
      CLOSED,
    ];
    expect(
      closedCardUtterances({ callId: CALL, entries }).map((u) => [u.cardKey, u.relayLanded, u.relayTurns]),
    ).toEqual([[ASK, undefined, [TURN]]]);
  });

  it("lands nothing on a hand step, nor a greeting on any card, the voice's yes notwithstanding", () => {
    const entries = [
      said({ at: "51:10", id: "s-1", open: HAND, text: "yes, go ahead" }),
      answered({ about: HAND, at: "51:12", heard: "yes, go ahead" }),
      said({ at: "51:20", id: "s-2", open: PR, text: "Uh, good morning" }),
      answered({ about: PR, at: "51:22", heard: "Uh, good morning", turnId: "a0000077-0000-4000-8000-000000000084" }),
      CLOSED,
    ];
    expect(closedCardUtterances({ callId: CALL, entries }).map((u) => [u.cardKey, u.answered])).toEqual([
      [HAND, true],
      [PR, true],
    ]);
    expect(transcriptCardUtterances({ callId: CALL, entries })).toEqual([]);
  });

  // `slopweaver desktop e2e --call` speaks through the owner's console: a walk's yes over a card is never their answer to it.
  it("lands nothing from a call the desktop test instance opened, though the voice judged it an answer", () => {
    const own = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 };
    const seat = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
    const open = ({ origin }: { origin: typeof own & { instance?: "e2e" } }): CallEntry => ({
      atIso: "2026-09-25T15:50:00.000Z",
      kind: "open",
      model: "m",
      origin,
      sessionId: "s",
      voice: "v",
    });
    const answer = [
      said({ at: "51:10", id: "s-1", open: PR, text: "yes, go ahead" }),
      answered({ about: PR, at: "51:12", heard: "yes, go ahead" }),
      CLOSED,
    ];
    const marked = [open({ origin: { ...own, instance: "e2e" } }), ...answer];
    expect(transcriptCardUtterances({ callId: CALL, entries: marked })).toEqual([]);
    const unmarked = transcriptCardUtterances({ callId: CALL, entries: [open({ origin: own }), ...answer] });
    expect(unmarked.map((u) => [u.cardKey, u.words])).toEqual([[PR, "yes, go ahead"]]);
    // Only the mark sets a call aside, so an unmarked seat console lands as it always did.
    const unmarkedSeat = transcriptCardUtterances({ callId: CALL, entries: [open({ origin: seat }), ...answer] });
    expect(unmarkedSeat.map((u) => [u.cardKey, u.words])).toEqual([[PR, "yes, go ahead"]]);
  });

  it("lands an answer only from a relay judged about THAT card", () => {
    const entries = [
      said({ at: "51:10", id: "s-1", open: PR, text: "send it" }),
      answered({ about: MIGRATION_ASK, at: "51:12", heard: "send it" }),
      CLOSED,
    ];
    expect(transcriptCardUtterances({ callId: CALL, entries })).toEqual([]);
  });
});
