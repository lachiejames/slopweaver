/**
 * `closedCardUtterances`' `wordsCut` — whether an utterance's words may be fewer than the owner said.
 *
 * A close or a drop lands a stretch the call never finished, and the call file caps a long one: either is fewer
 * words than were said, so the utterance says so and the landing carries it to the reader that binds a yes.
 */
import { describe, expect, it } from "vitest";

import { CALL_TEXT_CHARS, type CallEntry, OWNER_SPEAKER } from "../../../talk/callRecord.js";
import { closedCardUtterances } from "../../../talk/cardUtterance.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const HAND = "hand:voice-mark-step";
const CLOSED: CallEntry = { atIso: "2026-09-25T15:59:00.000Z", kind: "closed", why: null };

/** One of the owner's segment lines over the hand step. */
const said = ({
  at,
  final = true,
  id,
  text,
}: {
  at: string;
  final?: boolean;
  id: string;
  text: string;
}): Extract<CallEntry, { kind: "segment" }> => ({
  atIso: `2026-09-25T15:${at}.000Z`,
  final,
  id,
  kind: "segment",
  open: HAND,
  text,
  who: OWNER_SPEAKER,
});

const cutOf = ({ entries }: { entries: readonly CallEntry[] }): readonly boolean[] =>
  closedCardUtterances({ callId: CALL, entries }).map((utterance) => utterance.wordsCut);

describe("closedCardUtterances wordsCut", () => {
  it("says the words were cut when a closed call lands an unfinished stretch, or one at the call file's cap", () => {
    const unfinished = [
      said({ at: "40:00", id: "s-1", text: "yes send it" }),
      said({ at: "40:02", final: false, id: "s-2", text: "oh wait no" }),
      CLOSED,
    ];
    const capped = [said({ at: "40:00", id: "s-1", text: "a".repeat(CALL_TEXT_CHARS) }), CLOSED];
    const whole = [said({ at: "40:00", id: "s-1", text: "yes send it" }), CLOSED];
    expect([cutOf({ entries: unfinished }), cutOf({ entries: capped }), cutOf({ entries: whole })]).toEqual([
      [true],
      [true],
      [false],
    ]);
  });

  // A final line replaces the snapshot it follows, so a final that does not print an earlier
  // snapshot — shorter, the same length, or longer — would erase that snapshot's words, a take-back included; the
  // record cannot tell a correction from a loss, and the call file's cap is a loss whatever won after it.
  it("says the words were cut when the line that won does not print another line of its stretch, or one reached the cap", () => {
    const stretch = ({ before, after }: { before: string; after: string }): readonly CallEntry[] => [
      said({ at: "40:00", final: false, id: "s-1", text: before }),
      said({ at: "40:02", id: "s-1", text: after }),
      CLOSED,
    ];
    expect(
      [
        stretch({ after: "yes send it", before: "yes send it to the whole team" }),
        stretch({ after: "please create", before: "please delete" }),
        stretch({ after: "yes send it to everyone", before: "yes send it but wait" }),
        stretch({ after: "yes send it", before: "a".repeat(CALL_TEXT_CHARS) }),
        stretch({ after: "yes send it", before: "yes send" }),
        stretch({ after: "yes send it", before: "" }),
      ].map((entries) => cutOf({ entries })),
    ).toEqual([[true], [true], [true], [true], [false], [false]]);
  });

  // The first final wins the fold, so a later final saying other words — even one the winner prints — is
  // a revision the landed words never carried.
  it("says the words were cut when a second final line of a stretch says other words", () => {
    const finals = ({ later }: { later: string }): readonly CallEntry[] => [
      said({ at: "40:00", id: "s-1", text: "yes, send it" }),
      said({ at: "40:02", id: "s-1", text: later }),
      CLOSED,
    ];
    expect([finals({ later: "yes" }), finals({ later: "yes, send it" })].map((entries) => cutOf({ entries }))).toEqual([
      [true],
      [false],
    ]);
  });

  // A voice line sharing the owner's segment id may be the one that finished it, whatever its text.
  it("says the words were cut when a line under another speaker shares the stretch's id", () => {
    const partial = said({ at: "40:00", final: false, id: "s-1", text: "yes, send it" });
    const finished = said({ at: "40:02", id: "s-1", text: "yes, send it" });
    expect([
      cutOf({ entries: [partial, { ...finished, who: "voice" }, CLOSED] }),
      cutOf({ entries: [partial, finished, CLOSED] }),
    ]).toEqual([[true], [false]]);
  });
});
