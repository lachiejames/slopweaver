/**
 * `callShowsLandingCut` — whether the call file now shows a landed utterance's words cut, whatever its row said.
 *
 * The case that made it: a row landed "send it" whole, the owner restored the card, then an overtaken
 * batch put an empty unfinished stretch ahead of those words. The words normalise back to "send it", the restore keeps
 * any new row from being written, and only the call file still shows the cut.
 */
import { describe, expect, it } from "vitest";

import { CALL_TEXT_CHARS, type CallEntry, type CallSegment, OWNER_SPEAKER } from "../../../talk/callRecord.js";
import {
  callHoldsLandedAnchors,
  callPlacesLanding,
  callShowsLandingCut,
  stretchRunCut,
} from "../../../talk/landingCut.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const CARD = "post:sd-11112222";
const CLOSED: CallEntry = { atIso: "2026-09-26T21:09:00.000Z", kind: "closed", why: null };

/** One of the owner's stretches over the card. */
const said = ({
  at,
  final = true,
  id,
  text,
  who = OWNER_SPEAKER,
}: {
  at: string;
  final?: boolean;
  id: string;
  text: string;
  who?: CallSegment["who"];
}): Extract<CallEntry, { kind: "segment" }> => ({
  atIso: `2026-09-26T21:${at}.000Z`,
  final,
  id,
  kind: "segment",
  open: CARD,
  text,
  who,
});

const cutOf = ({ entries, anchors }: { entries: readonly CallEntry[]; anchors: readonly string[] }): boolean =>
  callShowsLandingCut({ anchors, callId: CALL, entries });

describe("callShowsLandingCut", () => {
  const sendIt = said({ at: "04:00", id: "s-1", text: "send it" });

  it("reads the landed words as cut once an empty unfinished stretch joins ahead of them", () => {
    const ahead = said({ at: "03:59", final: false, id: "s-0", text: " " });
    expect([
      cutOf({ anchors: [`call:${CALL}#s-1`], entries: [sendIt, CLOSED] }),
      cutOf({ anchors: [`call:${CALL}#s-1`], entries: [ahead, sendIt, CLOSED] }),
    ]).toEqual([false, true]);
  });

  // The overtaken stretch's only line is written after the voice spoke, and names when it began.
  it("orders a late-written unfinished stretch by when it began, so it still joins ahead of the landed words", () => {
    const voice = said({ at: "04:30", id: "v-1", text: "sending", who: "voice" });
    const late = { ...said({ at: "05:00", final: false, id: "s-0", text: " " }), beganIso: "2026-09-26T21:03:59.000Z" };
    const { beganIso: _dropped, ...unstamped } = late;
    expect([
      cutOf({ anchors: [`call:${CALL}#s-1`], entries: [sendIt, voice, unstamped, CLOSED] }),
      cutOf({ anchors: [`call:${CALL}#s-1`], entries: [sendIt, voice, late, CLOSED] }),
    ]).toEqual([false, true]);
  });

  it("reads a stretch at the call file's cap, or one still running, as cut", () => {
    const capped = said({ at: "04:00", id: "s-1", text: "a".repeat(CALL_TEXT_CHARS) });
    const running = said({ at: "04:00", final: false, id: "s-1", text: "send it and" });
    expect([
      cutOf({ anchors: [`call:${CALL}#s-1`], entries: [capped, CLOSED] }),
      cutOf({ anchors: [`call:${CALL}#s-1`], entries: [running] }),
    ]).toEqual([true, true]);
  });

  it("reads only the utterance the landing carries, never a cut one elsewhere in the call", () => {
    const voice = said({ at: "04:30", id: "v-1", text: "sending", who: "voice" });
    const other = said({ at: "05:00", final: false, id: "s-2", text: "and another" });
    const entries = [sendIt, voice, other, CLOSED];
    expect([
      cutOf({ anchors: [`call:${CALL}#s-1`], entries }),
      cutOf({ anchors: [`call:${CALL}#s-2`], entries }),
      cutOf({ anchors: [`call:${CALL}#s-1`], entries: [] }),
    ]).toEqual([false, true, false]);
  });
});

describe("callPlacesLanding", () => {
  // A late snapshot that began earlier re-places the stretch on the card it names, text unchanged.
  it("places the landed words on their card only while the call still says them over it, opened by the owner", () => {
    const anchors = [`call:${CALL}#s-1`];
    const sendIt = said({ at: "04:00", id: "s-1", text: "send it" });
    const moved = { ...said({ at: "05:00", id: "s-1", text: "send it" }), beganIso: "2026-09-26T21:03:59.000Z" };
    const placedOn = ({ entries, cardKey }: { entries: readonly CallEntry[]; cardKey: string }): boolean =>
      callPlacesLanding({ anchors, callId: CALL, cardKey, entries });
    expect([
      placedOn({ cardKey: CARD, entries: [sendIt, CLOSED] }),
      placedOn({ cardKey: "post:sd-99998888", entries: [sendIt, CLOSED] }),
      placedOn({ cardKey: CARD, entries: [sendIt, { ...moved, open: "post:sd-99998888" }, CLOSED] }),
      placedOn({ cardKey: CARD, entries: [{ ...sendIt, openBy: "voice" }, CLOSED] }),
    ]).toEqual([true, false, false, false]);
  });

  // A snapshot that began at the same instant leaves the earliest line's card in place while its words win.
  it("does not place the landed words while any line of their stretch names another card, or the voice's", () => {
    const anchors = [`call:${CALL}#s-1`];
    const partial = said({ at: "04:00", final: false, id: "s-1", text: "yes send" });
    const winner = said({ at: "04:30", id: "s-1", text: "yes send it" });
    const placedWith = ({ last }: { last: CallEntry }): boolean =>
      callPlacesLanding({ anchors, callId: CALL, cardKey: CARD, entries: [partial, last, CLOSED] });
    expect([
      placedWith({ last: winner }),
      placedWith({ last: { ...winner, open: "post:sd-99998888" } }),
      placedWith({ last: { ...winner, openBy: "voice" } }),
    ]).toEqual([true, false, false]);
  });
});

describe("callHoldsLandedAnchors", () => {
  // Finding no cut in a file that no longer holds the landed stretch proves nothing about it.
  it("holds a landing only while the call file has a line for every stretch it names", () => {
    const anchors = [`call:${CALL}#s-1`, `call:${CALL}#s-2`];
    const s1 = said({ at: "04:00", id: "s-1", text: "send" });
    const s2 = said({ at: "04:01", id: "s-2", text: "it" });
    expect([
      callHoldsLandedAnchors({ anchors, callId: CALL, entries: [s1, s2, CLOSED] }),
      callHoldsLandedAnchors({ anchors, callId: CALL, entries: [s1, CLOSED] }),
      callHoldsLandedAnchors({ anchors, callId: "another-call", entries: [s1, s2, CLOSED] }),
      callHoldsLandedAnchors({ anchors, callId: CALL, entries: [CLOSED] }),
    ]).toEqual([true, false, false, false]);
  });
});

describe("stretchRunCut", () => {
  /** One folded stretch, the owner's unless said otherwise, over `open`. */
  const stretch = ({
    final = true,
    id,
    open,
    text = "yes, send it",
    who = OWNER_SPEAKER,
  }: {
    final?: boolean;
    id: string;
    open: string | undefined;
    text?: string;
    who?: CallSegment["who"];
  }): CallSegment => ({
    atIso: "2026-09-26T21:04:00.000Z",
    beganIso: "2026-09-26T21:04:00.000Z",
    final,
    id,
    open,
    text,
    who,
  });
  const cutAt = ({
    entries = [],
    segments,
  }: {
    entries?: readonly CallEntry[];
    segments: readonly CallSegment[];
  }): boolean => stretchRunCut({ entries, segmentId: "s-1", segments });
  const retract = ({ open }: { open: string | undefined }): CallSegment =>
    stretch({ final: false, id: "s-2", open, text: "actually, don't" });

  it("reads a whole stretch as cut when a later stretch of the owner's run is unfinished, card open or not", () => {
    expect([
      cutAt({ segments: [stretch({ id: "s-1", open: undefined }), retract({ open: undefined })] }),
      cutAt({ segments: [stretch({ id: "s-1", open: CARD }), retract({ open: CARD })] }),
      cutAt({ segments: [stretch({ id: "s-1", open: undefined })] }),
    ]).toEqual([true, true, false]);
  });

  it("reads a whole stretch as cut when an unfinished stretch of the owner's runs ahead of it, unless the voice spoke between", () => {
    const ahead = stretch({ final: false, id: "s-0", open: undefined, text: " " });
    const voice = stretch({ id: "v-1", open: undefined, text: "sending", who: "voice" });
    expect([
      cutAt({ segments: [ahead, stretch({ id: "s-1", open: undefined })] }),
      cutAt({ segments: [ahead, voice, stretch({ id: "s-1", open: undefined })] }),
    ]).toEqual([true, false]);
  });

  it("ends the run at the voice speaking or the card changing, and reads a capped stretch as cut", () => {
    const voice = stretch({ id: "v-1", open: undefined, text: "sending", who: "voice" });
    expect([
      cutAt({ segments: [stretch({ id: "s-1", open: undefined }), voice, retract({ open: undefined })] }),
      cutAt({ segments: [stretch({ id: "s-1", open: undefined }), retract({ open: CARD })] }),
      cutAt({ segments: [stretch({ id: "s-1", open: undefined, text: "a".repeat(CALL_TEXT_CHARS) })] }),
      cutAt({ segments: [] }),
    ]).toEqual([false, false, true, false]);
  });

  // The fold keeps one text per stretch, so a final that does not print an earlier line of the
  // same stretch — a take-back dropped, however long the final — leaves the stretch cut, as a card utterance is.
  it("reads a stretch as cut when its folded text does not print another line of it", () => {
    const line = ({ final, text }: { final: boolean; text: string }): CallEntry => ({
      atIso: "2026-09-26T21:04:00.000Z",
      final,
      id: "s-1",
      kind: "segment",
      text,
      who: OWNER_SPEAKER,
    });
    const folded = [stretch({ id: "s-1", open: undefined, text: "yes send it to everyone" })];
    const withBefore = ({ before }: { before: string }): boolean =>
      cutAt({
        entries: [line({ final: false, text: before }), line({ final: true, text: "yes send it to everyone" })],
        segments: folded,
      });
    expect([withBefore({ before: "yes send it but wait" }), withBefore({ before: "yes send it" })]).toEqual([
      true,
      false,
    ]);
  });

  // A second final the winner prints is still a revision the first-final-wins fold dropped.
  it("reads a stretch as cut when a second final line of it says other words", () => {
    const final = ({ text }: { text: string }): CallEntry => ({
      atIso: "2026-09-26T21:04:00.000Z",
      final: true,
      id: "s-1",
      kind: "segment",
      text,
      who: OWNER_SPEAKER,
    });
    const folded = [stretch({ id: "s-1", open: undefined, text: "yes, send it" })];
    const withLater = ({ later }: { later: string }): boolean =>
      cutAt({ entries: [final({ text: "yes, send it" }), final({ text: later })], segments: folded });
    expect([withLater({ later: "yes" }), withLater({ later: "yes, send it" })]).toEqual([true, false]);
  });

  // A voice line sharing the owner's segment id may be the one that finished it, whatever its text.
  it("reads a stretch as cut when a line under another speaker shares its id", () => {
    const line = ({ final, who }: { final: boolean; who: CallSegment["who"] }): CallEntry => ({
      atIso: "2026-09-26T21:04:00.000Z",
      final,
      id: "s-1",
      kind: "segment",
      text: "yes, send it",
      who,
    });
    const folded = [stretch({ id: "s-1", open: undefined, text: "yes, send it" })];
    const withFinal = ({ who }: { who: CallSegment["who"] }): boolean =>
      cutAt({ entries: [line({ final: false, who: OWNER_SPEAKER }), line({ final: true, who })], segments: folded });
    expect([withFinal({ who: "voice" }), withFinal({ who: OWNER_SPEAKER })]).toEqual([true, false]);
  });
});
