/*
 * The two readings taken off the relay turn files: the registered relays since a floor, and the typed steers that
 * never reached the board — which a read of registered turns alone passes over silently.
 */
import { describe, expect, it } from "vitest";

import type { TurnRecord } from "../../../talk/relayStore.js";
import { registeredSince, steerTurnsOf } from "../../../talk/turnFiles.js";

const SINCE = "2026-10-03T09:00:00.000Z";

/** One relay turn, registered at 09:10 unless overridden. */
const turn = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  about: "",
  anchor: "talk:t",
  delivery: null,
  digest: "d",
  heard: "and bring the deck",
  picture: { kind: "none", reason: "screen-not-shared" },
  readsAfter: [],
  registeredAtIso: "2026-10-03T09:10:00.000Z",
  slug: "talk-a00000170000",
  stagedAtIso: "2026-10-03T09:10:00.000Z",
  state: "registered",
  turnId: "a0000017-0000-4000-8000-000000000019",
  typed: true,
  words: "",
  wordsAlone: false,
  ...over,
});

describe("registeredSince", () => {
  it("keeps the registered turns at or after the floor, oldest first", () => {
    const turns = [
      turn({ registeredAtIso: "2026-10-03T09:20:00.000Z", slug: "later" }),
      turn({ registeredAtIso: SINCE, slug: "at" }),
      turn({ registeredAtIso: "2026-10-03T08:59:59.999Z", slug: "before" }),
      turn({ registeredAtIso: null, slug: "unfinished", state: "intended" }),
    ];
    expect(registeredSince({ sinceIso: SINCE, turns }).map((kept) => kept.slug)).toEqual(["at", "later"]);
  });
});

describe("steerTurnsOf", () => {
  it("owes no note when every typed steer since the floor reached the board", () => {
    expect(steerTurnsOf({ sinceIso: SINCE, turns: [turn()] }).unread).toEqual([]);
  });

  // A typed steer whose registration failed or was killed is the owner's word, missing.
  it("says when a steer the owner typed since the floor never reached the board", () => {
    const turns = [
      turn(),
      turn({ registeredAtIso: null, state: "intended" }),
      turn({ registeredAtIso: null, state: "registering" }),
    ];
    expect(steerTurnsOf({ sinceIso: SINCE, turns })).toEqual({
      records: [turn()],
      unread: [
        {
          section: "steers",
          why: "2 steer(s) the owner typed on the console never reached the board, so what the owner typed is missing them",
        },
      ],
    });
  });

  it("owes no note for an unfinished voice relay, or a typed one staged before the floor", () => {
    const turns = [
      turn({ registeredAtIso: null, state: "intended", typed: false }),
      turn({ registeredAtIso: null, stagedAtIso: "2026-10-03T08:00:00.000Z", state: "intended" }),
    ];
    expect(steerTurnsOf({ sinceIso: SINCE, turns }).unread).toEqual([]);
  });
});
