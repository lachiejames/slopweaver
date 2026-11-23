/*
 * The owner's turns as a held rollover waits them out (`site/lib/voiceOwnerTurns.ts`): open turns keyed by id, and the newest
 * ended one awaiting the voice's words, cleared by order rather than by comparing clocks.
 */
import { describe, expect, it } from "vitest";

import {
  foldVoiceOwnerTurns,
  NO_OWNER_TURNS,
  type OwnerTurnEvent,
  type OwnerTurns,
  ownerCurrentOpenAtOf,
  ownerOpenAtOf,
  STREAM_SKEW_MS,
} from "../../lib/voiceOwnerTurns";

/** The owner's turns after a script of timed events, folded from none. */
function folded({ script }: { script: readonly (readonly [number, OwnerTurnEvent])[] }): OwnerTurns {
  return script.reduce<OwnerTurns>(
    (turns, [nowMs, event]) => foldVoiceOwnerTurns({ event, nowMs, turns }),
    NO_OWNER_TURNS,
  );
}

describe("foldVoiceOwnerTurns", () => {
  it("opens a turn on its segment, refreshes it on the next, and closes only it on its own final", () => {
    const open = folded({
      script: [
        [100, { final: false, id: "a", kind: "segment" }],
        [200, { final: false, id: "b", kind: "segment" }],
        [300, { final: false, id: "a", kind: "segment" }],
      ],
    });
    const closedA = foldVoiceOwnerTurns({ event: { final: true, id: "a", kind: "segment" }, nowMs: 400, turns: open });
    expect([[...open.open], [...closedA.open], closedA.awaiting]).toEqual([
      [
        ["a", 300],
        ["b", 200],
      ],
      [["b", 200]],
      { answerFromMs: 400, sinceMs: 400 },
    ]);
  });

  it("clears a spoken turn's wait on the next words, on an equal clock value too", () => {
    const ended = folded({ script: [[500, { final: true, id: "a", kind: "segment" }]] });
    const spoke = foldVoiceOwnerTurns({ event: { kind: "spoke" }, nowMs: 500, turns: ended });
    expect([ended.awaiting, spoke.awaiting]).toEqual([{ answerFromMs: 500, sinceMs: 500 }, undefined]);
  });

  it("keeps a typed turn's wait through words inside the skew, closes no open turn, and clears on words past it", () => {
    const typed = folded({
      script: [
        [0, { final: false, id: "a", kind: "segment" }],
        [1_000, { kind: "typed" }],
      ],
    });
    const inside = foldVoiceOwnerTurns({ event: { kind: "spoke" }, nowMs: 1_000 + STREAM_SKEW_MS - 1, turns: typed });
    const past = foldVoiceOwnerTurns({ event: { kind: "spoke" }, nowMs: 1_000 + STREAM_SKEW_MS, turns: inside });
    expect([[...typed.open], inside.awaiting, past.awaiting]).toEqual([
      [["a", 0]],
      { answerFromMs: 1_000 + STREAM_SKEW_MS, sinceMs: 1_000 },
      undefined,
    ]);
  });

  // A spoken final after a typed turn must not waive the typed turn's skew.
  it("keeps the latest answer instant any ended turn needs, while bounding the hold from the newest", () => {
    const both = folded({
      script: [
        [0, { kind: "typed" }],
        [1_000, { final: true, id: "s", kind: "segment" }],
      ],
    });
    const early = foldVoiceOwnerTurns({ event: { kind: "spoke" }, nowMs: 1_001, turns: both });
    const late = foldVoiceOwnerTurns({ event: { kind: "spoke" }, nowMs: STREAM_SKEW_MS, turns: early });
    expect([both.awaiting, early.awaiting, late.awaiting]).toEqual([
      { answerFromMs: STREAM_SKEW_MS, sinceMs: 1_000 },
      { answerFromMs: STREAM_SKEW_MS, sinceMs: 1_000 },
      undefined,
    ]);
  });

  it("leaves the owner's turns as they were when the voice speaks with nothing awaited", () => {
    expect(foldVoiceOwnerTurns({ event: { kind: "spoke" }, nowMs: 10, turns: NO_OWNER_TURNS })).toBe(NO_OWNER_TURNS);
  });
});

describe("ownerOpenAtOf", () => {
  it("reads the newest open segment, or nothing when none is open", () => {
    const turns = folded({
      script: [
        [80_000, { final: false, id: "growing", kind: "segment" }],
        [0, { final: false, id: "dropped", kind: "segment" }],
      ],
    });
    expect([ownerOpenAtOf({ turns }), ownerOpenAtOf({ turns: NO_OWNER_TURNS })]).toEqual([80_000, undefined]);
  });
});

describe("ownerCurrentOpenAtOf", () => {
  it("keeps a spoken turn current through a typed turn of the owner's, which they can send while still speaking", () => {
    const typed = folded({
      script: [
        [100, { final: false, id: "speaking", kind: "segment" }],
        [200, { kind: "typed" }],
      ],
    });
    expect(ownerCurrentOpenAtOf({ turns: typed })).toBe(100);
  });

  it("orders by fold, so a turn opened on the same clock value as the final before it is current", () => {
    const tied = folded({
      script: [
        [100, { final: false, id: "a", kind: "segment" }],
        [500, { final: true, id: "a", kind: "segment" }],
        [500, { final: false, id: "b", kind: "segment" }],
      ],
    });
    expect(ownerCurrentOpenAtOf({ turns: tied })).toBe(500);
  });

  it("reads an open turn only while no later turn of the owner's has ended past it", () => {
    const orphaned = folded({
      script: [
        [100, { final: false, id: "lost", kind: "segment" }],
        [200, { final: false, id: "next", kind: "segment" }],
        [300, { final: true, id: "next", kind: "segment" }],
      ],
    });
    const resumed = foldVoiceOwnerTurns({
      event: { final: false, id: "lost", kind: "segment" },
      nowMs: 400,
      turns: orphaned,
    });
    expect([
      ownerCurrentOpenAtOf({ turns: orphaned }),
      ownerOpenAtOf({ turns: orphaned }),
      ownerCurrentOpenAtOf({ turns: resumed }),
      ownerCurrentOpenAtOf({ turns: folded({ script: [[50, { final: false, id: "only", kind: "segment" }]] }) }),
    ]).toEqual([undefined, 100, 400, 50]);
  });
});
