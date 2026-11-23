/*
 * `talk cards`' text report: unread ledger lines first, then the Queue walk's moves, then what did not read on the
 * relay and intake side, then the landings — or the one line saying nothing holds a card off.
 */
import { describe, expect, it } from "vitest";

import { cardsTextLines } from "../../../../../cli/commands/talk/cardsText.js";

describe("cardsTextLines", () => {
  it("says nothing holds a card off when every ledger read whole and nothing is held", () => {
    expect(
      cardsTextLines({
        intakeGaps: [],
        landings: [],
        ledgers: [{ lines: [], path: "/h/talk/card-landings.jsonl" }],
        moves: [],
        triageUnreadable: 0,
      }),
    ).toEqual(["talk cards: no word of theirs is holding a card off their queue"]);
  });

  it("prints every section in order, a landing's triage verdict beside it", () => {
    expect(
      cardsTextLines({
        intakeGaps: [{ pointer: "intake-1", why: "no relay judged it" }],
        landings: [
          {
            anchor: "call:c-1#s-1",
            cardKey: "post:sd-1",
            decidedIso: "2026-11-02T12:15:00.000Z",
            source: "transcript",
            triage: { verdict: "park" },
            words: "park it",
            workSlug: "acme-work",
          },
        ],
        ledgers: [
          {
            lines: [
              { atIso: undefined, cardKey: undefined, lineNumber: 2 },
              { atIso: "2026-11-02T12:00:00.000Z", cardKey: "ask:acme-Fixture 1-seats", lineNumber: 5 },
            ],
            path: "/h/talk/card-landings.jsonl",
          },
          { lines: [], path: "/h/talk/card-moves.jsonl" },
        ],
        moves: [
          {
            anchor: "talk-call:c-1#turn_A",
            atIso: "2026-11-02T12:16:00.000Z",
            cardKey: "post:sd-2",
            decidedIso: "2026-11-02T12:16:00.000Z",
            kind: "moved-on",
            toCardKey: "post:sd-3",
          },
        ],
        triageUnreadable: 1,
      }),
    ).toEqual([
      "  2 ledger line(s) did not read (2 (no card key), 5 ask:acme-Fixture 1-seats) — /h/talk/card-landings.jsonl",
      "2026-11-02T12:16:00.000Z  post:sd-2 moved on from, to post:sd-3  talk-call:c-1#turn_A",
      "  1 relay line(s) did not read: a park they carried is not shown",
      "  intake mark intake-1 names a voice-opened card but lands nothing: no relay judged it",
      "2026-11-02T12:15:00.000Z  post:sd-1 → acme-work  (transcript)  triage park",
      '  "park it"  call:c-1#s-1',
    ]);
  });
});
