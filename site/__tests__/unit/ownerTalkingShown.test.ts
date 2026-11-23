/**
 * The owner's typing dots read the owner TALKING, never a sound: a quiet room's spectral reading, a breath or a
 * single loud sample never shows them, a pause between words never drops them, and a word of the owner's landing in
 * the stretch ends them.
 */
import { describe, expect, it } from "vitest";
import { HEARING_LEVEL, HEARING_RMS } from "../../lib/micAudible";
import { OWNER_TALKING_ONSET_MS, ownerTalkingShown, wordsLatchOf } from "../../lib/ownerTalkingShown";
import { foldVoiceOwnerTurns, NO_OWNER_TURNS, type OwnerTurns } from "../../lib/voiceOwnerTurns";
import { foldTurnTaking, NO_TURN_TAKING, OWNER_GAP_MS, type TurnTaking } from "../../lib/voiceTurnTaking";

/** The page's sampling interval (`useVoiceActivity.ts`'s `METER_EVERY_MS`). */
const EVERY_MS = 80;

/** One sample of the owner's microphone, the voice silent. */
function sampleOf({ micLevel, micRms }: { micLevel: number; micRms: number }) {
  return { micLevel, micRms, muted: false, outputLevel: 0 };
}

/** Speech: both bars cleared. */
const SPEECH = sampleOf({ micLevel: HEARING_LEVEL, micRms: HEARING_RMS });

/** Silence. */
const QUIET = sampleOf({ micLevel: 0, micRms: 0 });

/** No word of the owner's yet: no fragment transcribed and no owner turn. */
const NO_WORDS = { owner: NO_OWNER_TURNS, lastHeardMs: undefined };

/** Folds samples one per 80 ms from instant 0, and returns the fold and the instant of the last sample. */
function foldAll({ samples }: { samples: readonly ReturnType<typeof sampleOf>[] }): {
  turn: TurnTaking;
  nowMs: number;
} {
  let turn = NO_TURN_TAKING;
  let nowMs = 0;
  samples.forEach((sample, index) => {
    nowMs = index * EVERY_MS;
    turn = foldTurnTaking({ nowMs, sample, turn });
  });
  return { nowMs, turn };
}

/** The owner's dots at one instant, over a stretch and the owner's words folded so far, latched from nothing. */
function shownAt({
  turn,
  nowMs,
  words,
}: {
  turn: TurnTaking;
  nowMs: number;
  words: { owner: OwnerTurns; lastHeardMs: number | undefined };
}): boolean {
  const wordsLatch = wordsLatchOf({ activity: { ...words, turn }, latched: undefined });
  return ownerTalkingShown({ nowMs, turn, wordsLatch });
}

describe("ownerTalkingShown", () => {
  it("never shows before any sound", () => {
    expect(shownAt({ nowMs: 1_000, turn: NO_TURN_TAKING, words: NO_WORDS })).toBe(false);
  });

  it("never shows for a quiet room whose spectral reading alone clears the old bar", () => {
    // Spectral 0.05 to 0.30, RMS 0.00, while the owner was silent.
    const room = sampleOf({ micLevel: 0.3, micRms: 0 });
    const { turn, nowMs } = foldAll({ samples: Array.from({ length: 20 }, () => room) });
    expect(shownAt({ nowMs, turn, words: NO_WORDS })).toBe(false);
  });

  it("never shows for one or two loud samples, a breath or a click", () => {
    const { turn, nowMs } = foldAll({ samples: [SPEECH, SPEECH] });
    expect([turn.owner!.lastMs - turn.owner!.sinceMs, shownAt({ nowMs, turn, words: NO_WORDS })]).toEqual([
      EVERY_MS,
      false,
    ]);
  });

  it("shows once the owner has been loud across the onset", () => {
    const { turn, nowMs } = foldAll({ samples: [SPEECH, SPEECH, SPEECH, SPEECH] });
    expect([
      turn.owner!.lastMs - turn.owner!.sinceMs >= OWNER_TALKING_ONSET_MS,
      shownAt({ nowMs, turn, words: NO_WORDS }),
    ]).toEqual([true, true]);
  });

  it("stays up across a pause between words and drops once the pause outlasts a breath", () => {
    const { turn, nowMs } = foldAll({ samples: [SPEECH, SPEECH, SPEECH, SPEECH, QUIET] });
    const lastLoudMs = turn.owner!.lastMs;
    expect([
      shownAt({ nowMs, turn, words: NO_WORDS }),
      shownAt({ nowMs: lastLoudMs + OWNER_GAP_MS, turn, words: NO_WORDS }),
      shownAt({ nowMs: lastLoudMs + OWNER_GAP_MS + 1, turn, words: NO_WORDS }),
    ]).toEqual([true, true, false]);
  });

  it("never comes back under the owner's turn once a fragment of the stretch is transcribed, through the breath hold", () => {
    // Loud 0..320 ms, a word heard at 200, the owner's turn settled at 321, then quiet to 800.
    const { turn } = foldAll({ samples: [SPEECH, SPEECH, SPEECH, SPEECH, SPEECH] });
    const heard = { owner: NO_OWNER_TURNS, lastHeardMs: 200 };
    expect([
      shownAt({ nowMs: 400, turn, words: heard }),
      shownAt({ nowMs: 720, turn, words: heard }),
      shownAt({ nowMs: 720, turn, words: NO_WORDS }),
    ]).toEqual([false, false, true]);
  });

  it("never comes back under a turn that settled inside a later stretch with no fresh fragment", () => {
    // A fragment at 80, a quiet past a breath, a new stretch from 720, the turn settled at 1000.
    const quiet = Array.from({ length: 7 }, () => QUIET);
    const { turn } = foldAll({ samples: [SPEECH, SPEECH, ...quiet, SPEECH, SPEECH, SPEECH, SPEECH] });
    const opened = foldVoiceOwnerTurns({
      event: { final: false, id: "t1", kind: "segment" },
      nowMs: 80,
      turns: NO_OWNER_TURNS,
    });
    const settled = foldVoiceOwnerTurns({
      event: { final: true, id: "t1", kind: "segment" },
      nowMs: 1_000,
      turns: opened,
    });
    expect([
      turn.owner!.sinceMs,
      shownAt({ nowMs: 990, turn, words: { owner: opened, lastHeardMs: 80 } }),
      shownAt({ nowMs: 1_040, turn, words: { owner: settled, lastHeardMs: 80 } }),
    ]).toEqual([9 * EVERY_MS, true, false]);
  });

  it("stays down for a latched stretch after the voice speaking clears the owner's turn's ending", () => {
    // The owner's turn settled at 250 inside the stretch, the voice spoke at 260, then quiet.
    const { turn } = foldAll({ samples: [SPEECH, SPEECH, SPEECH, SPEECH] });
    const opened = foldVoiceOwnerTurns({
      event: { final: false, id: "t1", kind: "segment" },
      nowMs: 200,
      turns: NO_OWNER_TURNS,
    });
    const settled = foldVoiceOwnerTurns({
      event: { final: true, id: "t1", kind: "segment" },
      nowMs: 250,
      turns: opened,
    });
    const answered = foldVoiceOwnerTurns({ event: { kind: "spoke" }, nowMs: 260, turns: settled });
    const latched = wordsLatchOf({ activity: { owner: settled, lastHeardMs: undefined, turn }, latched: undefined });
    const carried = wordsLatchOf({ activity: { owner: answered, lastHeardMs: undefined, turn }, latched });
    expect([
      answered.awaiting,
      carried,
      ownerTalkingShown({ nowMs: 320, turn, wordsLatch: carried }),
      ownerTalkingShown({ nowMs: 320, turn, wordsLatch: undefined }),
    ]).toEqual([undefined, 0, false, true]);
  });

  it("never shows while a segment of the owner's arrived inside the stretch is still open", () => {
    const { turn, nowMs } = foldAll({ samples: [SPEECH, SPEECH, SPEECH, SPEECH] });
    const open = foldVoiceOwnerTurns({
      event: { final: false, id: "t1", kind: "segment" },
      nowMs: 160,
      turns: NO_OWNER_TURNS,
    });
    expect(shownAt({ nowMs, turn, words: { owner: open, lastHeardMs: undefined } })).toBe(false);
  });

  it("shows again for a new stretch begun after the last word heard", () => {
    const quiet = Array.from({ length: 7 }, () => QUIET);
    const { turn, nowMs } = foldAll({ samples: [SPEECH, SPEECH, ...quiet, SPEECH, SPEECH, SPEECH, SPEECH] });
    const settled = foldVoiceOwnerTurns({
      event: { final: true, id: "t1", kind: "segment" },
      nowMs: 160,
      turns: NO_OWNER_TURNS,
    });
    expect([turn.owner!.sinceMs, shownAt({ nowMs, turn, words: { owner: settled, lastHeardMs: 80 } })]).toEqual([
      9 * EVERY_MS,
      true,
    ]);
  });

  it("never shows while the owner is muted, however loud the microphone reads", () => {
    const muted = { ...SPEECH, muted: true };
    const { turn, nowMs } = foldAll({ samples: Array.from({ length: 10 }, () => muted) });
    expect(shownAt({ nowMs, turn, words: NO_WORDS })).toBe(false);
  });
});
