/*
 * The voice lifts a region of the owner's screen only when the owner asked to be shown, once per ask, and only into the desktop app's
 * own picture taken on that ask. Turn timing is read off the
 * synthetic plan session (`fixtures/talkPlanSession.jsonl`), where the owner's one question runs over three turns with the
 * voice's backchannels between them and the hand-off fires before the owner's turn is done.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  askWindowOf,
  latestOwnerTurnOf,
  lookOf,
  type ScreenLook,
  SHOW_ASK,
  screenFocusVerdict,
} from "../../lib/screenFocus";
import { foldPlanEvent, type PlanTurn } from "../../lib/talkPlanEvents";
import type { HeardSegment } from "../../lib/voiceTranscript";

/** The synthetic session, one event per line, in arrival order. */
const SYNTHETIC: readonly unknown[] = readFileSync(join(__dirname, "fixtures", "talkPlanSession.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as unknown);

/**
 * The conversation as the page holds it after some events: each turn once, in order, as its latest segment said.
 *
 * @param events the events folded, in order
 * @returns the segments
 */
function heardAfter({ events }: { events: readonly unknown[] }): readonly HeardSegment[] {
  let turns: ReadonlyMap<string, PlanTurn> = new Map();
  const heard = new Map<string, HeardSegment>();
  for (const event of events) {
    const next = foldPlanEvent({ event, turns });
    turns = next.turns;
    for (const effect of next.effects) {
      if (effect.kind === "segment") {
        heard.set(effect.id, { final: effect.final, id: effect.id, text: effect.text, who: effect.who });
      }
    }
  }
  return [...heard.values()];
}

/** The line the second hand-off (`item_synthetic30`) arrives on, while the owner's third turn is still open. */
const SECOND_HANDOFF = SYNTHETIC.findIndex((event) => JSON.stringify(event).includes('"id":"item_synthetic30"'));

/** A desktop look's picture, as the model was told its size. */
const SENT = { height: 768, width: 1365 };

/** A box inside {@link SENT}: a fifth of its width, an eighth of its height. */
const BOX = { height: 96, width: 273, x: 273, y: 192 };

/**
 * One segment.
 *
 * @returns it, final
 */
function said({ id, who, text }: { id: string; who: "owner" | "voice"; text: string }): HeardSegment {
  return { final: true, id, text, who };
}

/** The owner's ask, run over two turns with a backchannel between them. */
const ASKED: readonly HeardSegment[] = [
  said({ id: "c1-t1", text: "I'm stuck on this page. Can you show me", who: "owner" }),
  said({ id: "c1-t2", text: "Yeah?", who: "voice" }),
  said({ id: "c1-t3", text: "where I click to add a new member?", who: "owner" }),
];

/** A look the desktop app took on that ask. */
const LOOK: ScreenLook = { ownerTurnId: "c1-t3", sight: "native", size: SENT };

describe("over the synthetic session", () => {
  it("pins a look taken at the hand-off to the owner's still-open turn, and the done turn after it keeps that ask", () => {
    const atHandoff = heardAfter({ events: SYNTHETIC.slice(0, SECOND_HANDOFF + 1) });
    const whole = heardAfter({ events: SYNTHETIC });
    expect(atHandoff.findLast((segment) => segment.who === "owner")).toEqual({
      final: false,
      id: "turn_synthetic05",
      text: " records what I say twice. What do you think",
      who: "owner",
    });
    expect(
      lookOf({ ownerTurnId: latestOwnerTurnOf({ segments: atHandoff }), looked: { sight: "native", size: SENT } }),
    ).toEqual({
      ownerTurnId: "turn_synthetic05",
      sight: "native",
      size: SENT,
    });
    expect(askWindowOf({ segments: whole })).toEqual({
      askTurnId: undefined,
      ownerTurnId: "turn_synthetic05",
      text: "So I was looking at the board this morning, and I was wondering whether the relay gate records what I say twice. What do you think",
    });
  });

  it("refuses to point when the owner's question never asked to be shown", () => {
    const whole = heardAfter({ events: SYNTHETIC });
    const look: ScreenLook = { ownerTurnId: "turn_synthetic05", sight: "native", size: SENT };
    expect(screenFocusVerdict({ args: BOX, focusedFor: undefined, look, segments: whole })).toEqual({
      kind: "refused",
      why: "the owner has not asked to be shown; say it in words, and point only when they ask you to show them",
    });
  });
});

describe("askWindowOf", () => {
  it("reads the owner's ask across the voice's backchannel", () => {
    expect(askWindowOf({ segments: ASKED })).toEqual({
      askTurnId: "c1-t3",
      ownerTurnId: "c1-t3",
      text: "I'm stuck on this page. Can you show me where I click to add a new member?",
    });
  });

  it("keeps an ask split over two turns on the turn it ends in, after the voice answers and the owner moves on", () => {
    const split = [
      said({ id: "c2-t1", text: "what do I", who: "owner" }),
      said({ id: "c2-t2", text: "Mm?", who: "voice" }),
      said({ id: "c2-t3", text: "click here?", who: "owner" }),
    ];
    const movedOn = [
      ...split,
      said({ id: "c2-t4", text: "This one, top right.", who: "voice" }),
      said({ id: "c2-t5", text: "okay thanks", who: "owner" }),
    ];
    expect([askWindowOf({ segments: split })!.askTurnId, askWindowOf({ segments: movedOn })!.askTurnId]).toEqual([
      "c2-t3",
      "c2-t3",
    ]);
  });

  it("stops at anything longer the voice said, and has nothing before the owner speaks", () => {
    const answered = [
      said({ id: "c1-t1", text: "where is the add button", who: "owner" }),
      said({ id: "c1-t2", text: "It's at the top right of the members list", who: "voice" }),
      said({ id: "c1-t3", text: "okay thanks", who: "owner" }),
    ];
    expect(askWindowOf({ segments: answered })).toEqual({
      askTurnId: undefined,
      ownerTurnId: "c1-t3",
      text: "okay thanks",
    });
    expect(askWindowOf({ segments: [said({ id: "c1-t1", text: "Hey.", who: "voice" })] })).toBeUndefined();
  });
});

describe("SHOW_ASK", () => {
  it("reads asking to be shown, and not a question about something else", () => {
    const asks = ["show me", "Where is it?", "which one", "point to it", "What do I click here?", "highlight that"];
    const notAsks = [
      "whether the relay gate works",
      "what is this card about",
      "somewhere else entirely",
      "where are we on the migration",
      "let's focus on the queue",
      "what's the point of this card",
      "let's circle back on that",
      "the show starts at nine",
    ];
    expect(asks.map((text) => SHOW_ASK.test(text))).toEqual(asks.map(() => true));
    expect(notAsks.map((text) => SHOW_ASK.test(text))).toEqual(notAsks.map(() => false));
  });
});

describe("screenFocusVerdict", () => {
  it("lifts the box as fractions of the picture, for the owner's latest turn", () => {
    expect(screenFocusVerdict({ args: BOX, focusedFor: undefined, look: LOOK, segments: ASKED })).toEqual({
      askTurnId: "c1-t3",
      ownerTurnId: "c1-t3",
      kind: "focus",
      region: { height: 0.125, left: 0.2, top: 0.25, width: 0.2 },
    });
  });

  it("refuses a second lift on the same ask, a look from before the owner's latest words, none, and a share's", () => {
    const later = [...ASKED, said({ id: "c1-t4", text: "which one though", who: "owner" })];
    const verdicts = [
      screenFocusVerdict({ args: BOX, focusedFor: "c1-t3", look: LOOK, segments: ASKED }),
      screenFocusVerdict({ args: BOX, focusedFor: "c1-t3", look: LOOK, segments: later }),
      screenFocusVerdict({ args: BOX, focusedFor: undefined, look: undefined, segments: ASKED }),
      screenFocusVerdict({ args: BOX, focusedFor: undefined, look: { ...LOOK, sight: "share" }, segments: ASKED }),
    ];
    expect(verdicts).toEqual([
      { kind: "refused", why: "already shown for this ask; wait until the owner asks again" },
      { kind: "refused", why: "the last picture is from before the owner's latest words; call read_screen again" },
      { kind: "refused", why: "call read_screen first, on this ask" },
      {
        kind: "refused",
        why: "only the desktop app's own look at the owner's screen can be pointed at; say where in words",
      },
    ]);
  });

  it("lifts nothing on the owner's next words after a lift across the voice's short answer, until they ask again", () => {
    const moved = [
      ...ASKED,
      said({ id: "c1-t4", text: "This one here.", who: "voice" }),
      said({ id: "c1-t5", text: "okay, now let's go back to the queue", who: "owner" }),
    ];
    const askedAgain = [...moved, said({ id: "c1-t6", text: "and where's the filter?", who: "owner" })];
    expect([
      screenFocusVerdict({
        args: BOX,
        focusedFor: "c1-t3",
        look: { ...LOOK, ownerTurnId: "c1-t5" },
        segments: moved,
      }),
      screenFocusVerdict({
        args: BOX,
        focusedFor: "c1-t3",
        look: { ...LOOK, ownerTurnId: "c1-t6" },
        segments: askedAgain,
      }),
    ]).toEqual([
      { kind: "refused", why: "already shown for this ask; wait until the owner asks again" },
      {
        askTurnId: "c1-t6",
        ownerTurnId: "c1-t6",
        kind: "focus",
        region: { height: 0.125, left: 0.2, top: 0.25, width: 0.2 },
      },
    ]);
  });

  it("lifts nothing when the owner's first turn falls out of the window and moves the old ask onto a later turn", () => {
    const asked = [
      said({ id: "d1-t1", text: "can you show", who: "owner" }),
      said({ id: "d1-t2", text: "Mm?", who: "voice" }),
      said({ id: "d1-t3", text: "where", who: "owner" }),
      said({ id: "d1-t4", text: "Go on.", who: "voice" }),
      said({ id: "d1-t5", text: "is it", who: "owner" }),
    ];
    const thanked = [
      ...asked,
      said({ id: "d1-t6", text: "There.", who: "voice" }),
      said({ id: "d1-t7", text: "okay", who: "owner" }),
      said({ id: "d1-t8", text: "Yep.", who: "voice" }),
      said({ id: "d1-t9", text: "thanks", who: "owner" }),
    ];
    expect([
      screenFocusVerdict({
        args: BOX,
        focusedFor: undefined,
        look: { ...LOOK, ownerTurnId: "d1-t5" },
        segments: asked,
      }),
      screenFocusVerdict({
        args: BOX,
        focusedFor: "d1-t5",
        look: { ...LOOK, ownerTurnId: "d1-t9" },
        segments: thanked,
      }),
    ]).toEqual([
      {
        askTurnId: "d1-t3",
        ownerTurnId: "d1-t5",
        kind: "focus",
        region: { height: 0.125, left: 0.2, top: 0.25, width: 0.2 },
      },
      { kind: "refused", why: "already shown for this ask; wait until the owner asks again" },
    ]);
  });

  it("lifts nothing for an asking phrase that starts in the lifted turn, a window shift or a leftover word", () => {
    const shifted = [
      said({ id: "d2-t1", text: "can you show", who: "owner" }),
      said({ id: "d2-t2", text: "Mm?", who: "voice" }),
      said({ id: "d2-t3", text: "where", who: "owner" }),
      said({ id: "d2-t4", text: "There.", who: "voice" }),
      said({ id: "d2-t5", text: "is it", who: "owner" }),
      said({ id: "d2-t6", text: "Yep.", who: "voice" }),
      said({ id: "d2-t7", text: "okay", who: "owner" }),
      said({ id: "d2-t8", text: "Sure.", who: "voice" }),
      said({ id: "d2-t9", text: "thanks", who: "owner" }),
    ];
    const leftover = [
      said({ id: "d3-t1", text: "can you show me which", who: "owner" }),
      said({ id: "d3-t2", text: "Mm?", who: "voice" }),
      said({ id: "d3-t3", text: "one adds a member", who: "owner" }),
    ];
    expect([
      screenFocusVerdict({
        args: BOX,
        focusedFor: "d2-t3",
        look: { ...LOOK, ownerTurnId: "d2-t9" },
        segments: shifted,
      }),
      screenFocusVerdict({
        args: BOX,
        focusedFor: "d3-t1",
        look: { ...LOOK, ownerTurnId: "d3-t3" },
        segments: leftover,
      }),
    ]).toEqual([
      { kind: "refused", why: "already shown for this ask; wait until the owner asks again" },
      { kind: "refused", why: "already shown for this ask; wait until the owner asks again" },
    ]);
  });

  it("refuses a box that is not whole pixels, a speck, off the picture, or most of the owner's screen", () => {
    const boxes = [
      { ...BOX, x: 1.5 },
      { ...BOX, width: 8 },
      { ...BOX, x: 1200 },
      { height: 700, width: 1300, x: 0, y: 0 },
    ];
    expect(
      boxes.map((args) => screenFocusVerdict({ args, focusedFor: undefined, look: LOOK, segments: ASKED })),
    ).toEqual([
      { kind: "refused", why: "x, y, width and height must be whole pixels of the picture read_screen sent" },
      { kind: "refused", why: "the box must be at least 12 pixels a side; box the whole thing" },
      { kind: "refused", why: "the box runs off the picture, which was sent at 1365×768" },
      {
        kind: "refused",
        why: "the box covers most of the owner's screen, which points at nothing; box the one thing they asked about",
      },
    ]);
  });
});

describe("lookOf", () => {
  it("remembers nothing for a look that took no frame, or before the owner has spoken", () => {
    expect(lookOf({ ownerTurnId: "c1-t3", looked: undefined })).toBeUndefined();
    expect(lookOf({ ownerTurnId: undefined, looked: { sight: "native", size: SENT } })).toBeUndefined();
  });
});
