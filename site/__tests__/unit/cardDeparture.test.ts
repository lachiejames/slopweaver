/**
 * Who took an open card off the owner's list (`../../lib/cardDeparture.ts`). The landings are the ledger rows a
 * call writes (`talk/card-landings.jsonl`), words clipped: three on the Renovate card, the first
 * an aside about the bot, and three on the Rosa nudge, the first "[mouth noise".
 */
import { describe, expect, it } from "vitest";

import type { CardLanding, CardLandings } from "../../components/live/readCardLandings";
import type { LiveState } from "../../components/live/useLive";
import {
  type CardDeparture,
  cardDeparture,
  clippedWords,
  departureSentence,
  landingWho,
  openLeftSentence,
  panelRow,
} from "../../lib/cardDeparture";
import type { QueueRow } from "../../lib/queueRows";
import type { SteerOverlay, SteerRow } from "../../lib/steeredCards";

const RENOVATE = "post:sd-c640cb82";
const ROSA = "post:sd-ff16ba51";

/** The landings, written out of file order so the departure has to order them itself. */
const LANDINGS: readonly CardLanding[] = [
  {
    anchor: "talk:a0000012-0000-4000-8000-000000000013",
    atIso: "2026-10-06T10:52:45.098Z",
    cardKey: RENOVATE,
    decidedIso: "2026-10-06T10:52:44.920Z",
    laterAnchors: [],
    source: "relay",
    words: "All right... well I guess that's the steer",
    workSlug: "talk-a00000120000",
  },
  {
    anchor: "call:fixture-call#turn_first",
    atIso: "2026-10-06T10:51:18.486Z",
    cardKey: RENOVATE,
    decidedIso: "2026-10-06T10:50:28.730Z",
    laterAnchors: [],
    source: "transcript",
    words: "identifier on it... that indicated it, was from... it was started on like thirtieth September",
    workSlug: "talk-abaaa450c714",
  },
  {
    anchor: "call:fixture-call#turn_second",
    atIso: "2026-10-06T10:52:43.760Z",
    cardKey: RENOVATE,
    decidedIso: "2026-10-06T10:51:28.718Z",
    laterAnchors: [],
    source: "transcript",
    words: "All right... well I guess that's the steer",
    workSlug: "talk-card-6d82996353da",
  },
  {
    anchor: "call:fixture-call#turn_third",
    atIso: "2026-10-06T10:53:30.928Z",
    cardKey: ROSA,
    decidedIso: "2026-10-06T10:53:25.222Z",
    laterAnchors: [],
    source: "transcript",
    words: "[mouth noise",
    workSlug: "talk-card-086b521ab3d0",
  },
];

/** A `talk cards` reading that answered. */
function ready({ landings }: { landings: readonly CardLanding[] }): LiveState<CardLandings> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-06T10:56:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value: { landings, moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
  };
}

const LOADING = { phase: "loading" } as const;
type Steers = Pick<SteerOverlay, "cameBack" | "collapsed" | "hidden" | "revealed">;
const NO_COLLAPSED: Steers = { cameBack: [], collapsed: [], hidden: new Set(), revealed: new Set() };
const HELD_POST = { kind: "post", record: { kind: "post" } } as const;
const HELD_HAND = { kind: "hand", record: { kind: "hand" } } as const;
const HELD_ACT = { kind: "act", record: { kind: "act" } } as const;

/** The relay this browser collapsed the Rosa card under, before its landing was read. */
const STEER: SteerRow = {
  cardKey: ROSA,
  heard: "Oh, yeah, no, that's fine",
  relaySlug: "talk-a00000820000",
  sentAtIso: "2026-10-06T10:55:27.000Z",
  turnId: "a0000082-0000-4000-8000-000000000089",
};

/**
 * The work rows of the words a departure names, oldest first — throwing, like `unwrap`, on any other kind.
 *
 * @param departure the departure
 * @returns the work slugs
 */
function heldBy({ departure }: { departure: CardDeparture }): readonly string[] {
  if (departure.kind !== "words") {
    throw new Error(`expected the owner's words to hold the card, got ${departure.kind}`);
  }
  return departure.holds.map((hold) => hold.workSlug);
}

/** The overlay the page reads while {@link STEER} is the newest steer on the Rosa card and still waiting. */
const STEER_HIDES: Steers = { ...NO_COLLAPSED, collapsed: [STEER], hidden: new Set([ROSA]) };

describe("cardDeparture", () => {
  it("names the landing that took the card off first, then every other hold, oldest first", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: [],
      key: RENOVATE,
      spoken: ready({ landings: LANDINGS }),
      steers: NO_COLLAPSED,
    });
    expect(departure).toEqual({
      holds: [
        {
          atIso: "2026-10-06T10:51:18.486Z",
          who: "Your words, heard by the voice with this card open",
          words: "identifier on it... that indicated it, was from... it was started on like thirtieth September",
          workSlug: "talk-abaaa450c714",
        },
        {
          atIso: "2026-10-06T10:52:43.760Z",
          who: "Your words, heard by the voice with this card open",
          words: "All right... well I guess that's the steer",
          workSlug: "talk-card-6d82996353da",
        },
        {
          atIso: "2026-10-06T10:52:45.098Z",
          who: "Your words, relayed by the voice",
          words: "All right... well I guess that's the steer",
          workSlug: "talk-a00000120000",
        },
      ],
      kind: "words",
    });
  });

  it("quotes a mouth noise as the words that took the card off, rather than calling it a steer", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: [],
      key: ROSA,
      spoken: ready({ landings: LANDINGS }),
      steers: STEER_HIDES,
    });
    expect(departureSentence({ departure })).toBe(
      'Off your list, held there by your words, heard by the voice with this card open at 2026-10-06T10:53:30.928Z ("[mouth noise"), and a session acts on it as talk-card-086b521ab3d0. It stays open until you close it.',
    );
  });

  it("names the voice's relay when the steer collapsed the card before any landing on it was read", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: [],
      key: ROSA,
      spoken: LOADING,
      steers: STEER_HIDES,
    });
    expect(departure).toEqual({
      heard: "Oh, yeah, no, that's fine",
      kind: "steer",
      relaySlug: "talk-a00000820000",
      sentAtIso: "2026-10-06T10:55:27.000Z",
    });
  });

  it("names the newest steer on the card, whatever order the steers are held in", () => {
    const newer: SteerRow = { ...STEER, heard: "park it", sentAtIso: "2026-10-06T10:58:00.000Z", turnId: "t-newer" };
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: [],
      key: ROSA,
      spoken: LOADING,
      steers: { ...NO_COLLAPSED, collapsed: [STEER, newer], hidden: new Set([ROSA]) },
    });
    expect(departure).toEqual({
      heard: "park it",
      kind: "steer",
      relaySlug: "talk-a00000820000",
      sentAtIso: "2026-10-06T10:58:00.000Z",
    });
  });

  it("never blames a waiting steer the page is not hiding the card by", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: [],
      key: ROSA,
      spoken: LOADING,
      steers: { ...NO_COLLAPSED, collapsed: [STEER] },
    });
    expect(departure).toEqual({ kind: "held" });
  });

  it("skips the landing of a steer that came back, naming the words that hold the card now", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: [],
      key: RENOVATE,
      spoken: ready({ landings: LANDINGS }),
      steers: {
        ...NO_COLLAPSED,
        cameBack: [
          { cardKey: RENOVATE, sentAtIso: "2026-10-06T10:55:28.000Z", turnId: "a0000012-0000-4000-8000-000000000013" },
        ],
      },
    });
    expect(departure).toEqual({
      holds: [
        {
          atIso: "2026-10-06T10:51:18.486Z",
          who: "Your words, heard by the voice with this card open",
          words: "identifier on it... that indicated it, was from... it was started on like thirtieth September",
          workSlug: "talk-abaaa450c714",
        },
        {
          atIso: "2026-10-06T10:52:43.760Z",
          who: "Your words, heard by the voice with this card open",
          words: "All right... well I guess that's the steer",
          workSlug: "talk-card-6d82996353da",
        },
      ],
      kind: "words",
    });
  });

  it("keeps a landing whose steer came back on ANOTHER card, as the page does", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: [],
      key: RENOVATE,
      spoken: ready({ landings: LANDINGS }),
      steers: {
        ...NO_COLLAPSED,
        cameBack: [
          { cardKey: ROSA, sentAtIso: "2026-10-06T10:55:28.000Z", turnId: "a0000012-0000-4000-8000-000000000013" },
        ],
      },
    });
    expect(heldBy({ departure })).toEqual(["talk-abaaa450c714", "talk-card-6d82996353da", "talk-a00000120000"]);
  });

  // The first relay comes back and draws the card again, the owner reopens it, then the second relay comes back too. It takes it off, and
  // neither relay was picked up, so neither line may say a session acts on it.
  it("names only the newest of two relays that came back, and says no session picked it up", () => {
    const own = LANDINGS.filter((landing) => landing.cardKey === ROSA).map((landing) => ({
      ...landing,
      anchor: "talk:r1",
    }));
    const other = { ...own[0], anchor: "talk:r2", atIso: "2026-10-06T10:54:00.000Z", workSlug: "talk-r2" };
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: [],
      key: ROSA,
      spoken: ready({ landings: [other, ...own] }),
      steers: {
        ...NO_COLLAPSED,
        cameBack: [
          { cardKey: ROSA, sentAtIso: "2026-10-06T10:55:28.000Z", turnId: "r1" },
          { cardKey: ROSA, sentAtIso: "2026-10-06T10:56:00.000Z", turnId: "r2" },
        ],
      },
    });
    expect(departureSentence({ departure })).toBe(
      'Off your list, held there by your words, heard by the voice with this card open at 2026-10-06T10:54:00.000Z ("[mouth noise"), which no session picked up. It stays open until you close it.',
    );
  });

  it("names the newer steer, not the landing of the one that came back before it", () => {
    const failed = { ...LANDINGS[3], anchor: "talk:r1", workSlug: "talk-r1" };
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: [],
      key: ROSA,
      spoken: ready({ landings: [failed] }),
      steers: { ...STEER_HIDES, cameBack: [{ cardKey: ROSA, sentAtIso: "2026-10-06T10:55:28.000Z", turnId: "r1" }] },
    });
    expect(departure).toEqual({
      heard: "Oh, yeah, no, that's fine",
      kind: "steer",
      relaySlug: "talk-a00000820000",
      sentAtIso: "2026-10-06T10:55:27.000Z",
    });
  });

  it("names no landing on a card a steer that came back draws again", () => {
    const departure = cardDeparture({
      board: ready({ landings: [] }),
      held: HELD_POST,
      kept: [],
      key: ROSA,
      spoken: ready({ landings: LANDINGS }),
      steers: { ...NO_COLLAPSED, revealed: new Set([ROSA]) },
    });
    expect(departure).toEqual({ kind: "held" });
  });

  it("says an act deep-linked on the Queue belongs to the Alignment page", () => {
    const departure = cardDeparture({
      board: ready({ landings: [] }),
      held: HELD_ACT,
      kept: [],
      key: "act:a-1",
      spoken: ready({ landings: [] }),
      steers: NO_COLLAPSED,
    });
    expect(departureSentence({ departure })).toBe(
      "It is an act, which the Alignment page draws rather than the Queue; nobody took it.",
    );
  });

  it("says nobody took a card whose register is drawn from an earlier reading", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_POST,
      kept: ["post"],
      key: ROSA,
      spoken: ready({ landings: [] }),
      steers: NO_COLLAPSED,
    });
    expect(departure).toEqual({ kind: "kept" });
  });

  it("says nobody took a hand step still waiting on the board to be placed", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: HELD_HAND,
      kept: [],
      key: "hand:h-1",
      spoken: ready({ landings: [] }),
      steers: NO_COLLAPSED,
    });
    expect(departure).toEqual({ kind: "placing" });
  });

  it("says a held card's cause is unknown rather than guessing one", () => {
    const departure = cardDeparture({
      board: ready({ landings: [] }),
      held: HELD_HAND,
      kept: [],
      key: "hand:h-1",
      spoken: ready({ landings: [] }),
      steers: NO_COLLAPSED,
    });
    expect(departureSentence({ departure })).toBe(
      "A register still holds it, and nothing the page reads says why it is not in the list.",
    );
  });

  it("keeps naming the owner's words after a session settles the row they landed on", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: undefined,
      kept: [],
      key: ROSA,
      spoken: ready({ landings: LANDINGS }),
      steers: STEER_HIDES,
    });
    expect(departure).toEqual({
      holds: [
        {
          atIso: "2026-10-06T10:53:30.928Z",
          who: "Your words, heard by the voice with this card open",
          words: "[mouth noise",
          workSlug: "talk-card-086b521ab3d0",
        },
      ],
      kind: "words",
    });
  });

  it("leaves a card no register holds and no reading names to its register's own word", () => {
    const departure = cardDeparture({
      board: LOADING,
      held: undefined,
      kept: [],
      key: ROSA,
      spoken: ready({ landings: [] }),
      steers: NO_COLLAPSED,
    });
    expect(departure).toEqual({ kind: "register" });
    expect(departureSentence({ departure })).toBe(
      "No register holds this card any more; unless your own press did it, nothing the page reads names who removed it.",
    );
  });
});

/** Only what the panel's selection reads: the key, and the work context `shows` judges by. */
function row({ key, context }: { key: string; context: "here" | "there" }): QueueRow {
  return { context, key } as unknown as QueueRow;
}

/** A context drawing only rows marked `here`. */
const showsHere = (candidate: QueueRow): boolean => (candidate as unknown as { context: string }).context === "here";

describe("panelRow — the card the voice hears is the card on the owner's screen", () => {
  const OPEN = row({ context: "here", key: ROSA });

  it("is the register's row on a reload, when no snapshot was taken", () => {
    expect(panelRow({ every: [OPEN], live: undefined, open: ROSA, shows: showsHere, snapshot: undefined })).toBe(OPEN);
  });

  it("is nothing when the register's row is in the other work context", () => {
    const there = row({ context: "there", key: ROSA });
    expect(panelRow({ every: [there], live: undefined, open: ROSA, shows: showsHere, snapshot: undefined })).toBe(
      undefined,
    );
  });

  it("gives the voice the departure on a reload too", () => {
    expect(
      openLeftSentence({
        board: LOADING,
        every: [OPEN],
        kept: [],
        live: undefined,
        open: ROSA,
        shows: showsHere,
        snapshot: undefined,
        spoken: ready({ landings: LANDINGS }),
        steers: NO_COLLAPSED,
      }),
    ).toBe(
      'Off your list, held there by your words, heard by the voice with this card open at 2026-10-06T10:53:30.928Z ("[mouth noise"), and a session acts on it as talk-card-086b521ab3d0. It stays open until you close it.',
    );
  });
});

describe("landingWho", () => {
  it("names a session landing the owner's words from another card", () => {
    expect(landingWho({ source: "session" })).toBe("A session, landing your words from another card");
  });
});

describe("clippedWords", () => {
  it("keeps words that fit, trimmed", () => {
    expect(clippedWords({ words: "  [mouth noise " })).toBe("[mouth noise");
  });

  it("cuts long words at the clip and marks the cut", () => {
    const clipped = clippedWords({ words: "a".repeat(400) });
    expect(clipped).toBe(`${"a".repeat(159)}…`);
  });
});
