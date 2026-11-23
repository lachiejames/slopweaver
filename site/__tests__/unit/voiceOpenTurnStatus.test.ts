/*
 * The orb while a turn of the owner's is still open: the voice holding for the owner to finish is never ZZZ.
 *
 * On a clock from the owner's turn opening: a partial at +5.892s, the Codex turn completing at +19.424s, and ZZZ
 * drawn at +31.449s — 12s later — with the owner's turn still open until +49.658s.
 */
import { describe, expect, it } from "vitest";

import {
  type ActivityInput,
  foldActivity,
  NO_ACTIVITY,
  STALL_MS,
  UNANSWERED_FORGET_MS,
  UNANSWERED_MS,
  type VoiceActivity,
  type VoiceStatus,
  voiceStatusOf,
} from "../../lib/voiceActivity";
import { OPEN_TURN_WORDS } from "../../lib/voiceActivityStatus";

/** A timed script of inputs. */
type Script = readonly (readonly [number, ActivityInput])[];

/** Fold a timed script from nothing. */
function play({ script }: { script: Script }): VoiceActivity {
  return script.reduce<VoiceActivity>(
    (activity, [nowMs, input]) => foldActivity({ activity, input, nowMs }),
    NO_ACTIVITY,
  );
}

/** The status of a live call with both levels silent, at one instant. */
function quietAt({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }): VoiceStatus {
  return voiceStatusOf({ activity, link: "live", micLevel: 0, micRms: 0, muted: false, nowMs, outputLevel: 0 });
}

/** One segment of a turn of the owner's (`t1` unless named) on the session's turn stream. */
function segment({ final, id = "t1" }: { final: boolean; id?: string }): ActivityInput {
  return { event: { final, id, kind: "segment" }, kind: "owner" };
}

/** A Codex turn that started at 100ms and went quiet on a step of its own, so it goes stale STALL_MS later. */
const REASONING: Script = [
  [100, { kind: "codex-turn", phase: "started", turnId: "c1" }],
  [100, { kind: "codex-turn", phase: "progress", step: { kind: "reasoning" }, turnId: "c1" }],
];

const PARTIAL_MS = 5_892;
const COMPLETED_MS = 19_424;
const ZZZ_MS = COMPLETED_MS + UNANSWERED_MS;

/** The measured stretch: the owner's words heard, the Codex turn running then completing, with or without their open turn. */
function measured({ withTurn }: { withTurn: boolean }): Script {
  const words: Script = [
    [0, { kind: "heard" }],
    [PARTIAL_MS, { kind: "heard" }],
  ];
  const turn: Script = [
    [0, segment({ final: false })],
    [PARTIAL_MS, segment({ final: false })],
  ];
  const codex: Script = [
    [100, { kind: "codex-turn", phase: "started", turnId: "c1" }],
    [COMPLETED_MS, { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "c1" }],
  ];
  const all = withTurn ? [...words, ...turn, ...codex] : [...words, ...codex];
  return all.toSorted((a, b) => a[0] - b[0]);
}

describe("the orb while a turn of the owner's is open", () => {
  it("reads listening, waiting for the owner to finish, where the same quiet with no open turn reads still waiting", () => {
    const open = quietAt({ activity: play({ script: measured({ withTurn: true }) }), nowMs: ZZZ_MS });
    const closed = quietAt({ activity: play({ script: measured({ withTurn: false }) }), nowMs: ZZZ_MS });
    expect([open.phase, open.headline, open.detail, open.nudge]).toEqual([
      "listening",
      "listening",
      OPEN_TURN_WORDS,
      "ask",
    ]);
    expect([closed.phase, closed.headline]).toEqual(["stalled", "still waiting"]);
  });

  it("reads still waiting once the owner's turn's final arrives", () => {
    const ended = play({ script: [...measured({ withTurn: true }), [COMPLETED_MS + 1, segment({ final: true })]] });
    expect(quietAt({ activity: ended, nowMs: ZZZ_MS }).phase).toBe("stalled");
  });

  it("stops holding once the page resumed for these words, or the owner nudged for them", () => {
    const activity = play({ script: measured({ withTurn: true }) });
    const resumed = foldActivity({ activity, input: { kind: "resumed", post: 1 }, nowMs: COMPLETED_MS + 1 });
    const nudged = foldActivity({ activity, input: { kind: "nudged" }, nowMs: COMPLETED_MS + 1 });
    expect([
      quietAt({ activity: resumed, nowMs: ZZZ_MS }).phase,
      quietAt({ activity: nudged, nowMs: ZZZ_MS }).phase,
    ]).toEqual(["stalled", "stalled"]);
  });

  it("lapses UNANSWERED_FORGET_MS after the turn's newest segment, so a lost final cannot hide ZZZ for good", () => {
    const activity = play({ script: measured({ withTurn: true }) });
    expect([
      quietAt({ activity, nowMs: PARTIAL_MS + UNANSWERED_FORGET_MS - 1 }).phase,
      quietAt({ activity, nowMs: PARTIAL_MS + UNANSWERED_FORGET_MS }).phase,
    ]).toEqual(["listening", "stalled"]);
  });

  it("reads listening over a Codex turn gone quiet while the owner's turn is open, keeping the row as its detail", () => {
    const words: Script = [[0, { kind: "heard" }], ...REASONING];
    const atMs = 100 + STALL_MS;
    const open = quietAt({ activity: play({ script: [[0, segment({ final: false })], ...words] }), nowMs: atMs });
    const closed = quietAt({ activity: play({ script: words }), nowMs: atMs });
    expect([open.phase, open.headline, open.detail]).toEqual(["listening", "listening", closed.detail]);
    expect([closed.phase, closed.headline]).toEqual(["stalled", "no update"]);
  });

  it("reads listening over a quiet Codex turn when the owner's turn's segment came with no transcribed words", () => {
    const work = REASONING;
    const atMs = 100 + STALL_MS;
    const open = quietAt({ activity: play({ script: [[0, segment({ final: false })], ...work] }), nowMs: atMs });
    const closed = quietAt({ activity: play({ script: work }), nowMs: atMs });
    expect([open.phase, closed.phase]).toEqual(["listening", "stalled"]);
  });

  it("holds listening over a quiet Codex turn when the owner types while their spoken turn is still open", () => {
    const script: Script = [
      [0, segment({ final: false })],
      [1_000, { kind: "heard" }],
      [1_000, { event: { kind: "typed" }, kind: "owner" }],
      [1_100, { kind: "codex-turn", phase: "started", turnId: "c1" }],
      [1_100, { kind: "codex-turn", phase: "progress", step: { kind: "reasoning" }, turnId: "c1" }],
    ];
    const typedOnly = script.slice(1);
    expect([
      quietAt({ activity: play({ script }), nowMs: 1_100 + STALL_MS }).phase,
      quietAt({ activity: play({ script: typedOnly }), nowMs: 1_100 + STALL_MS }).phase,
    ]).toEqual(["listening", "stalled"]);
  });

  it("reads listening over a Codex turn slow on the model while the owner's turn is open, keeping its wait as the detail", () => {
    const work: Script = [[100, { kind: "codex-turn", phase: "started", turnId: "c1" }]];
    const atMs = 100 + STALL_MS;
    const open = quietAt({ activity: play({ script: [[0, segment({ final: false })], ...work] }), nowMs: atMs });
    const closed = quietAt({ activity: play({ script: work }), nowMs: atMs });
    expect([open.phase, open.headline, open.detail, open.nudge]).toEqual([
      "listening",
      "listening",
      "waiting for the model · no reply for 35s",
      undefined,
    ]);
    expect([closed.phase, closed.headline, closed.nudge]).toEqual(["working", "model slow", undefined]);
  });

  it("never lets an older turn whose final was lost hold a later turn's quiet, refreshed just before it", () => {
    const later = 30_000;
    const script: Script = [
      [0, segment({ final: false })],
      [later - 1_000, segment({ final: false })],
      [later, { kind: "heard" }],
      [later, segment({ final: false, id: "t2" })],
    ];
    const atMs = later + 1_000 + UNANSWERED_MS;
    const ended = play({ script: [...script, [later + 1_000, segment({ final: true, id: "t2" })]] });
    expect([
      quietAt({ activity: play({ script }), nowMs: atMs }).phase,
      quietAt({ activity: ended, nowMs: atMs }).phase,
    ]).toEqual(["listening", "stalled"]);
  });
});
