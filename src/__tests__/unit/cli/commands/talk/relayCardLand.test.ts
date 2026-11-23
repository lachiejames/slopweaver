/**
 * A relay about a card lands on it unless the disposition withheld it — the shape where words about a
 * public mis-send landed on an unrelated card — or the words can never answer it: a hand step, or a
 * greeting. The cards it also answers land the same way, each on its own disposition. Every write goes to a
 * `mkdtempSync` home this file mints.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { landEach, landRelayCards } from "../../../../../cli/commands/talk/relayCardLand.js";
import { unwrap } from "../../../../../lib/result.js";
import { readCardLandings } from "../../../../../talk/cardLandingStore.js";
import type { RelayCardDisposition } from "../../../../../talk/relayChannelSteer.js";
import { STILL_SPEAKING_HOLD } from "../../../../../talk/relayCutHold.js";
import { formRelayDraft, type RelayDraft } from "../../../../../talk/relayDraft.js";

const CARD = "draft:voice-mark-draft";
const SPLIT = "draft:split-oversized-files";
const WITHHELD = "draft:incident-channel-move";
const HAND = "hand:twilio-and-knock-read-only-keys";
const DECIDED = "2026-10-12T00:30:00.000Z";
const NONE: ReadonlyMap<string, RelayCardDisposition> = new Map();

let home = "";
let board = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "relay-card-land-"));
  board = join(home, "handovers");
  mkdirSync(board, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const relayAbout = ({
  about,
  alsoAnswers = [],
  heard = "what is a voice mark",
}: {
  about: string;
  alsoAnswers?: readonly string[];
  heard?: string;
}): RelayDraft =>
  unwrap(
    formRelayDraft({
      about,
      alsoAnswers,
      heard,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "they ask what a voice mark is",
      turnId: "a0000017-0000-4000-8000-000000000019",
      typed: false,
      wordsAlone: false,
    }),
  );

describe("landRelayCards", () => {
  it("lands the owner's heard words on the card the relay is about", async () => {
    await landRelayCards({
      also: NONE,
      decidedIso: DECIDED,
      dir: board,
      disposition: { kind: "land" },
      draft: relayAbout({ about: CARD }),
      hold: undefined,
      home,
      workspace: undefined,
    });
    const rows = unwrap(readCardLandings({ home })).rows;
    expect(rows.map((row) => row.cardKey)).toEqual([CARD]);
  });

  it("writes no landing when the disposition withheld the owner's words from the card", async () => {
    await landRelayCards({
      also: NONE,
      decidedIso: DECIDED,
      dir: board,
      disposition: { kind: "withheld", why: "the owner's words name sd-359bafb2, which this card never mentions" },
      draft: relayAbout({ about: CARD }),
      hold: undefined,
      home,
      workspace: undefined,
    });
    expect(unwrap(readCardLandings({ home })).rows).toEqual([]);
  });

  it("writes no landing for a relay about no card", async () => {
    await landRelayCards({
      also: NONE,
      decidedIso: DECIDED,
      dir: board,
      disposition: { kind: "land" },
      draft: relayAbout({ about: "" }),
      hold: undefined,
      home,
      workspace: undefined,
    });
    expect(unwrap(readCardLandings({ home })).rows).toEqual([]);
  });

  // Three relays about the open Twilio step took it off the owner's Queue.
  it("writes no landing and no row for a relay about a hand step, nor for a greeting about any card", async () => {
    for (const draft of [relayAbout({ about: HAND }), relayAbout({ about: CARD, heard: "Uh, good morning" })]) {
      await landRelayCards({
        also: NONE,
        decidedIso: DECIDED,
        dir: board,
        disposition: { kind: "land" },
        draft,
        hold: undefined,
        home,
        workspace: undefined,
      });
    }
    expect([unwrap(readCardLandings({ home })).rows, readdirSync(board)]).toEqual([[], []]);
  });

  // One ruling that decides several Queue cards takes every one of them off the owner's Queue.
  it("lands the open card and each also-answered card its own disposition lets through, and none it withheld", async () => {
    const also: ReadonlyMap<string, RelayCardDisposition> = new Map([
      [SPLIT, { kind: "land" }],
      [WITHHELD, { kind: "withheld", why: "the owner's words name #dev-alerts, and this card mentions none of them" }],
    ]);
    await landRelayCards({
      also,
      decidedIso: DECIDED,
      dir: board,
      disposition: { kind: "land" },
      draft: relayAbout({ about: CARD, alsoAnswers: [SPLIT, WITHHELD], heard: "oversized files always split" }),
      hold: undefined,
      home,
      workspace: undefined,
    });
    const rows = unwrap(readCardLandings({ home })).rows;
    expect(rows.map((row) => row.cardKey)).toEqual([CARD, SPLIT]);
  });

  it("still lands an also-answered card when the open card's own disposition withheld the owner's words", async () => {
    await landRelayCards({
      also: new Map([[SPLIT, { kind: "land" }]]),
      decidedIso: DECIDED,
      dir: board,
      disposition: { kind: "withheld", why: "the owner's words name sd-359bafb2, which this card never mentions" },
      draft: relayAbout({ about: CARD, alsoAnswers: [SPLIT], heard: "oversized files always split" }),
      hold: undefined,
      home,
      workspace: undefined,
    });
    const rows = unwrap(readCardLandings({ home })).rows;
    expect(rows.map((row) => row.cardKey)).toEqual([SPLIT]);
  });

  // A relay made while the owner was still speaking took every card it answered off the Queue.
  it("lands neither the open card nor any also-answered card when the relay is held, though every one would land", async () => {
    const draft = relayAbout({ about: CARD, alsoAnswers: [SPLIT], heard: "oversized files always split" });
    const also: ReadonlyMap<string, RelayCardDisposition> = new Map([[SPLIT, { kind: "land" }]]);
    const land = ({ hold }: { hold: string | undefined }): Promise<void> =>
      landRelayCards({
        also,
        decidedIso: DECIDED,
        dir: board,
        disposition: { kind: "land" },
        draft,
        hold,
        home,
        workspace: undefined,
      });
    await land({ hold: STILL_SPEAKING_HOLD });
    const held = unwrap(readCardLandings({ home })).rows.map((row) => row.cardKey);
    await land({ hold: undefined });
    const whole = unwrap(readCardLandings({ home })).rows.map((row) => row.cardKey);
    expect([held, whole]).toEqual([[], [CARD, SPLIT]]);
  });
});

// A throw landing one card must not skip the cards after it, nor fail the relay.
describe("landEach", () => {
  it("lands every target after one whose landing throws, and names only the one that threw", async () => {
    const reached: string[] = [];
    const threw = await landEach({
      land: async ({ cardKey }) => {
        reached.push(cardKey);
        if (cardKey === SPLIT) {
          throw new Error("work row front matter does not parse");
        }
      },
      targets: [{ cardKey: CARD }, { cardKey: SPLIT }, { cardKey: WITHHELD }],
    });
    expect([reached, threw]).toEqual([[CARD, SPLIT, WITHHELD], [SPLIT]]);
  });

  it("names nothing when no landing throws", async () => {
    const threw = await landEach({ land: async () => {}, targets: [{ cardKey: CARD }] });
    expect(threw).toEqual([]);
  });
});
