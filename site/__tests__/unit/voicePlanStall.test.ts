/*
 * A recorded call replayed through the orb's fold: a plan call's hand-off to Codex that never comes back, and the
 * owner's words nothing answers. Both must read "working" with a nudge on offer, never "listening" with none — bar a
 * turn whose request is out to the model, which reads slow and never offers to throw that request away.
 */
import { describe, expect, it } from "vitest";

import {
  type ActivityInput,
  END_SKEW_MS,
  foldActivity,
  HEARING_LEVEL,
  HEARING_RMS,
  NO_ACTIVITY,
  nudgeOfferOf,
  resumeDueOf,
  STALL_MS,
  UNANSWERED_FORGET_MS,
  UNANSWERED_MS,
  type VoiceActivity,
  type VoiceStatus,
  voiceStatusOf,
} from "../../lib/voiceActivity";
import {
  owedFromMs,
  owedSinceMs,
  PROMISE_MS,
  promiseDueOf,
  type VoicePromise,
  voiceAsked,
  voicePromiseOf,
} from "../../lib/voiceOwed";
import { HANDOFF_SETTLE_MS } from "../../lib/voicePlanWork";

type Script = readonly (readonly [number, ActivityInput])[];

/** The owner's microphone while they talk: a measured spoken sample's RMS (`voiceTurnTaking.test.ts`'s repro). */
const SPOKEN_RMS = 0.042;

/**
 * The owner's quiet room, loud on the spectral level and silent on RMS: a measured sample logged while nobody spoke.
 * Repro, from the home: `grep -o 'held: the owner was transcribed moments ago (mic 0.311 rms 0.004' talk/calls/<call-id>-*.jsonl`
 */
const QUIET_ROOM = { micLevel: 0.311, micRms: 0.004 } as const;

function play({ script, from = NO_ACTIVITY }: { script: Script; from?: VoiceActivity }): VoiceActivity {
  return script.reduce<VoiceActivity>((activity, [nowMs, input]) => foldActivity({ activity, input, nowMs }), from);
}

function quietAt({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }): VoiceStatus {
  return voiceStatusOf({ activity, link: "live", micLevel: 0, micRms: 0, muted: false, nowMs, outputLevel: 0 });
}

function handoff({ id }: { id: string }): ActivityInput {
  return { id, kind: "delegated", responseId: undefined, target: "client" };
}

function started({ turnId }: { turnId: string }): ActivityInput {
  return { kind: "codex-turn", phase: "started", turnId };
}

function progress({ turnId }: { turnId: string }): ActivityInput {
  return { kind: "codex-turn", phase: "progress", step: null, turnId };
}

function ended({ turnId, status }: { turnId: string; status: "completed" | "interrupted" | "failed" }): ActivityInput {
  return { failure: null, kind: "codex-turn", phase: "completed", status, turnId };
}

/** The stalled call's shape: the voice spoke, the owner asked, it handed off, and nothing came back while the owner kept talking. */
const HANDED_OFF: Script = [
  [3_000, { kind: "spoke" }],
  [11_000, { kind: "heard" }],
  [23_000, { kind: "heard" }],
  [23_500, handoff({ id: "item_d1" })],
  [51_000, { kind: "heard" }],
];

describe("a plan call's hand-off that never comes back", () => {
  it("is in flight, never listening, and goes stale with a nudge on offer", () => {
    const handedOff = play({ script: HANDED_OFF.slice(0, 4) });
    const working = quietAt({ activity: handedOff, nowMs: 30_000 });
    expect(working.phase).toBe("working");
    expect(working.detail).toBe("handing to Codex · 6s");
    const activity = play({ script: HANDED_OFF });
    const stale = quietAt({ activity, nowMs: 23_500 + STALL_MS });
    expect(stale.headline).toBe("no update");
    expect(stale.nudge).toBe("ask");
  });

  it("is not kept fresh by the voice handing the same words over again", () => {
    const activity = play({ script: [...HANDED_OFF, [52_000, handoff({ id: "item_d2" })]] });
    expect(quietAt({ activity, nowMs: 23_500 + STALL_MS }).headline).toBe("no update");
  });

  it("is dropped once the voice answered after it and the owner answered back", () => {
    const activity = play({
      script: [...HANDED_OFF.slice(0, 4), [25_000, { kind: "spoke" }], [27_000, { kind: "heard" }]],
    });
    expect(quietAt({ activity, nowMs: 30_000 }).headline).toBe("listening");
  });

  it("stays in flight when the voice only said 'one sec' over it", () => {
    const activity = play({ script: [...HANDED_OFF.slice(0, 4), [25_000, { kind: "spoke" }]] });
    expect(quietAt({ activity, nowMs: 30_000 }).phase).toBe("working");
  });
});

describe("a Codex turn that goes quiet", () => {
  const RUNNING: Script = [
    [10_000, { kind: "heard" }],
    [10_500, handoff({ id: "item_d1" })],
    [10_600, started({ turnId: "turn-1" })],
    [11_000, handoff({ id: "item_d2" })],
    [12_000, handoff({ id: "item_d3" })],
  ];

  it("reads as waiting for the model from its start, the hand-offs merged into it", () => {
    const activity = play({ script: RUNNING });
    const status = quietAt({ activity, nowMs: 20_000 });
    expect([status.phase, status.headline, status.detail]).toEqual([
      "working",
      "waiting",
      "waiting for the model · 9s",
    ]);
  });

  // MEASURED: the orb read "working · 140s", then ZZZ offering to nudge Codex, while the model took 233s to 346s to reply.
  it("reads a long wait on the model as slow from STALL_MS, never stalled, and offers no nudge to throw the request away", () => {
    const activity = play({ script: [...RUNNING, [40_000, { kind: "heard" }]] });
    const under = quietAt({ activity, nowMs: 10_600 + STALL_MS - 1 });
    const slow = quietAt({ activity, nowMs: 10_600 + 326_000 });
    expect([under.phase, under.headline, under.detail]).toEqual(["working", "waiting", "waiting for the model · 34s"]);
    expect([slow.phase, slow.headline, slow.detail, slow.nudge]).toEqual([
      "working",
      "model slow",
      "waiting for the model · no reply for 326s",
      undefined,
    ]);
    expect(nudgeOfferOf({ activity, nowMs: 10_600 + 326_000 })).toBe(undefined);
  });

  it("goes stale STALL_MS after its own last progress on a step of its own, offering to stop it", () => {
    const reasoning: ActivityInput = {
      kind: "codex-turn",
      phase: "progress",
      step: { kind: "reasoning" },
      turnId: "turn-1",
    };
    const activity = play({
      script: [
        ...RUNNING,
        [15_000, reasoning],
        [20_000, progress({ turnId: "turn-1" })],
        [30_000, handoff({ id: "item_d4" })],
        [40_000, { kind: "heard" }],
      ],
    });
    expect(quietAt({ activity, nowMs: 20_000 + STALL_MS - 1 }).headline).toBe("reasoning");
    const stale = quietAt({ activity, nowMs: 20_000 + STALL_MS });
    expect([stale.phase, stale.headline, stale.nudge]).toEqual(["stalled", "no update", "interrupt"]);
  });

  // The row said "running read_card" for the whole wait after the tool finished: a finished tool is never still named.
  it("stops naming a tool once its item completes, and counts the wait after it from 0s", () => {
    const tool: ActivityInput = {
      kind: "codex-turn",
      phase: "progress",
      step: { kind: "tool", name: "read_card" },
      turnId: "turn-1",
    };
    const done: ActivityInput = {
      kind: "codex-turn",
      phase: "progress",
      step: { kind: "awaiting", reason: "model" },
      turnId: "turn-1",
    };
    const activity = play({ script: [...RUNNING, [15_000, tool], [35_000, done]] });
    expect(quietAt({ activity, nowMs: 35_000 }).detail).toBe("waiting for the model · 0s");
  });

  it("keeps saying it is writing through a delta, and keeps a wait's start through a re-send inside it", () => {
    const writing: ActivityInput = {
      kind: "codex-turn",
      phase: "progress",
      step: { kind: "writing" },
      turnId: "turn-1",
    };
    const retry: ActivityInput = {
      kind: "codex-turn",
      phase: "progress",
      step: { kind: "awaiting", reason: "retry" },
      turnId: "turn-1",
    };
    const written = play({ script: [...RUNNING, [15_000, writing], [16_000, progress({ turnId: "turn-1" })]] });
    const resent = play({ script: [...RUNNING, [310_600, retry]] });
    expect([
      quietAt({ activity: written, nowMs: 17_000 }).detail,
      quietAt({ activity: resent, nowMs: 320_600 }).detail,
    ]).toEqual(["writing · 2s", "the model's reply dropped; Codex is re-sending · no reply for 310s"]);
  });

  // Codex review r1: awaiting the model after a re-send kept the re-send's clock, though an item had ended in between.
  it("counts a wait on the model after a re-send from that wait's own start, never the re-send's", () => {
    const retry: ActivityInput = {
      kind: "codex-turn",
      phase: "progress",
      step: { kind: "awaiting", reason: "retry" },
      turnId: "turn-1",
    };
    const back: ActivityInput = {
      kind: "codex-turn",
      phase: "progress",
      step: { kind: "awaiting", reason: "model" },
      turnId: "turn-1",
    };
    const activity = play({ script: [...RUNNING, [100_000, retry], [320_000, back]] });
    expect(quietAt({ activity, nowMs: 330_000 }).detail).toBe("waiting for the model · 10s");
  });

  it("is never stale while the page runs a tool for it, and offers no nudge then", () => {
    const activity = play({ script: [...RUNNING, [13_000, { callId: "t1", kind: "tool-started", name: "relay" }]] });
    expect(quietAt({ activity, nowMs: 13_000 + STALL_MS - 1 }).headline).toBe("checking");
    expect(nudgeOfferOf({ activity, nowMs: 13_000 + STALL_MS + 60_000 })).toBe(undefined);
  });

  it("is not reopened by a late notice after it ended", () => {
    const activity = play({
      script: [
        ...RUNNING,
        [15_000, ended({ status: "interrupted", turnId: "turn-1" })],
        [15_100, progress({ turnId: "turn-1" })],
      ],
    });
    expect(quietAt({ activity, nowMs: 16_000 }).headline).toBe("listening");
  });

  it("opens no hand-off row when its end beat its own late hand-off to the page", () => {
    const activity = play({
      script: [
        ...RUNNING,
        [15_000, ended({ status: "interrupted", turnId: "turn-1" })],
        [15_000 + HANDOFF_SETTLE_MS - 1, handoff({ id: "late" })],
      ],
    });
    expect(quietAt({ activity, nowMs: 20_000 }).headline).toBe("listening");
  });

  it("says why when it failed", () => {
    const failed: ActivityInput = {
      failure: "model overloaded",
      kind: "codex-turn",
      phase: "completed",
      status: "failed",
      turnId: "turn-1",
    };
    const activity = play({ script: [...RUNNING, [15_000, failed]] });
    expect(quietAt({ activity, nowMs: 16_000 }).why).toBe("model overloaded");
  });
});

describe("a Codex turn that comes back and is never voiced", () => {
  const BEFORE_END: Script = [
    [10_000, { kind: "heard" }],
    [10_500, handoff({ id: "item_d1" })],
    [10_600, started({ turnId: "turn-1" })],
    [12_000, { kind: "spoke" }],
  ];
  const COMPLETED: readonly [number, ActivityInput] = [30_000, ended({ status: "completed", turnId: "turn-1" })];

  it("reads still waiting from its end, with a nudge, until the silence is the owner's", () => {
    const activity = play({ script: [...BEFORE_END, COMPLETED] });
    expect(quietAt({ activity, nowMs: 30_000 + UNANSWERED_MS - 1 }).headline).toBe("listening");
    const waiting = quietAt({ activity, nowMs: 30_000 + UNANSWERED_MS });
    expect(waiting.headline).toBe("still waiting");
    expect(waiting.seconds).toBe(32);
    expect(waiting.nudge).toBe("ask");
    expect(quietAt({ activity, nowMs: 30_000 + UNANSWERED_FORGET_MS }).headline).toBe("listening");
  });

  it("is answered by speech landing within the skew of its end", () => {
    const activity = play({ script: [...BEFORE_END, [30_000 - END_SKEW_MS, { kind: "spoke" }], COMPLETED] });
    expect(quietAt({ activity, nowMs: 30_000 + UNANSWERED_MS }).headline).toBe("listening");
  });

  it("is not answered by a 'one sec' said before the skew", () => {
    const activity = play({ script: [...BEFORE_END, [30_000 - END_SKEW_MS - 1, { kind: "spoke" }], COMPLETED] });
    expect(quietAt({ activity, nowMs: 30_000 + UNANSWERED_MS }).headline).toBe("still waiting");
  });

  it("owes nothing when it was interrupted", () => {
    const activity = play({ script: [...BEFORE_END, [30_000, ended({ status: "interrupted", turnId: "turn-1" })]] });
    expect(quietAt({ activity, nowMs: 30_000 + UNANSWERED_MS }).headline).toBe("listening");
  });
});

describe("the nudge", () => {
  const UNANSWERED: Script = [
    [3_000, { kind: "spoke" }],
    [10_000, { kind: "heard" }],
  ];

  it("is offered on the owner's words nothing answered, once, until they speak again", () => {
    const activity = play({ script: UNANSWERED });
    expect(quietAt({ activity, nowMs: 10_000 + UNANSWERED_MS }).nudge).toBe("ask");
    const nudged = play({ from: activity, script: [[23_000, { kind: "nudged" }]] });
    const after = quietAt({ activity: nudged, nowMs: 24_000 });
    expect(after.headline).toBe("still waiting");
    expect(after.nudge).toBe(undefined);
    const spokeAgain = play({ from: nudged, script: [[30_000, { kind: "heard" }]] });
    expect(quietAt({ activity: spokeAgain, nowMs: 30_000 + UNANSWERED_MS }).nudge).toBe("ask");
  });

  it("is not on offer while a turn is still moving", () => {
    const activity = play({ script: [...UNANSWERED, [10_500, started({ turnId: "turn-1" })]] });
    expect(nudgeOfferOf({ activity, nowMs: 20_000 })).toBe(undefined);
  });

  it("is not on offer before the owner has said anything", () => {
    expect(nudgeOfferOf({ activity: NO_ACTIVITY, nowMs: 60_000 })).toBe(undefined);
  });
});

/*
 * A measured call: the voice asked "Is that it?", the owner said "Yes, that's the one, thanks", the voice
 * said "Good, yeah, that's clear." and stopped. The page read "listening" with nothing to press for 236.9s, until the
 * voice said "I'm right here - keep going." on its own. Times are ms from the call's start.
 */
describe("the turn the voice owes after speaking last", () => {
  const ACKED: Script = [
    [0, { kind: "spoke" }],
    [500, { asked: true, kind: "voice-finished", promised: false }],
    [6_000, { kind: "heard", text: "Yes, that's the one, thanks" }],
    [8_000, { kind: "spoke" }],
    [8_600, { asked: false, kind: "voice-finished", promised: false }],
  ];

  it("offers the nudge beside listening from 12s after the voice stopped, and still at 236.9s", () => {
    const activity = play({ script: ACKED });
    expect(quietAt({ activity, nowMs: 8_600 + UNANSWERED_MS - 1 }).nudge).toBe(undefined);
    expect(quietAt({ activity, nowMs: 8_600 + UNANSWERED_MS })).toEqual({
      detail: "the voice spoke last and asked you nothing",
      headline: "listening",
      nudge: "ask",
      phase: "listening",
      seconds: undefined,
    });
    expect(quietAt({ activity, nowMs: 8_600 + 236_900 }).nudge).toBe("ask");
  });

  it("dates the debt from the voice's last sound, which the rollover hold counts from", () => {
    const activity = play({ script: ACKED });
    const lateSpeech = play({ from: activity, script: [[9_100, { kind: "spoke" }]] });
    const nudged = play({ from: activity, script: [[30_000, { kind: "nudged" }]] });
    expect([
      owedSinceMs({ activity }),
      owedSinceMs({ activity: lateSpeech }),
      owedSinceMs({ activity: nudged }),
    ]).toEqual([8_600, 9_100, undefined]);
  });

  // The owner's words run ahead of their transcript, so a pause inside them is not the voice's turn.
  it("moves its quiet on for sound from the owner's microphone, never offering it inside their untranscribed words", () => {
    const activity = play({
      script: [
        ...ACKED,
        [20_000, { kind: "sounded", micLevel: 0.5, micRms: SPOKEN_RMS, muted: false, outputLevel: 0 }],
        [20_080, { kind: "sounded", micLevel: 0, micRms: 0, muted: false, outputLevel: 0 }],
      ],
    });
    expect(owedSinceMs({ activity })).toBe(20_000);
    // The rollover hold is timed from the debt's start, which no later sound slides on.
    expect(owedFromMs({ activity })).toBe(8_600);
    expect(nudgeOfferOf({ activity, nowMs: 8_600 + UNANSWERED_MS })).toBe(undefined);
    expect(nudgeOfferOf({ activity, nowMs: 20_000 + UNANSWERED_MS })).toBe("ask");
  });

  // A voice final can land after the owner's transcript for a turn the voice said before the owner spoke.
  it("dates the turn by the meters when the voice's final lands late", () => {
    const meter = ({ voice, owner }: { voice: number; owner: number }) =>
      ({
        kind: "sounded",
        micLevel: owner,
        micRms: owner > 0 ? SPOKEN_RMS : 0,
        muted: false,
        outputLevel: voice,
      }) as const;
    const ownerSpokeAfter = play({
      script: [
        [1_000, { kind: "spoke" }],
        [1_000, meter({ owner: 0, voice: 0.5 })],
        [1_080, meter({ owner: 0, voice: 0 })],
        [1_500, meter({ owner: 0.5, voice: 0 })],
        [1_580, meter({ owner: 0, voice: 0 })],
        [2_000, { kind: "heard", text: "thanks" }],
        [3_000, { asked: false, kind: "voice-finished", promised: false }],
      ],
    });
    const voiceAnswered = play({
      script: [
        [500, meter({ owner: 0.5, voice: 0 })],
        [580, meter({ owner: 0, voice: 0 })],
        [1_000, { kind: "spoke" }],
        [1_000, meter({ owner: 0, voice: 0.5 })],
        [1_080, meter({ owner: 0, voice: 0 })],
        [2_000, { kind: "heard", text: "thanks" }],
        [3_000, { asked: false, kind: "voice-finished", promised: false }],
      ],
    });
    const noVoiceMeter = play({
      script: [
        [1_000, { kind: "spoke" }],
        [1_500, meter({ owner: 0.5, voice: 0 })],
        [1_580, meter({ owner: 0, voice: 0 })],
        [2_000, { kind: "heard", text: "thanks" }],
        [3_000, { asked: false, kind: "voice-finished", promised: false }],
      ],
    });
    const voiceUntimed = play({
      script: [
        [1_500, meter({ owner: 0.5, voice: 0 })],
        [1_580, meter({ owner: 0, voice: 0 })],
        [2_000, { kind: "heard", text: "thanks" }],
        [3_000, { asked: false, kind: "voice-finished", promised: false }],
      ],
    });
    expect([
      owedSinceMs({ activity: ownerSpokeAfter }),
      owedSinceMs({ activity: voiceAnswered }),
      owedSinceMs({ activity: noVoiceMeter }),
      owedSinceMs({ activity: voiceUntimed }),
    ]).toEqual([undefined, 3_000, undefined, undefined]);
    expect(resumeDueOf({ activity: voiceAnswered, micLevel: 0, micRms: 0, muted: false, nowMs: 3_000 + 236_900 })).toBe(
      false,
    );
  });

  it("is never resumed on its own: only the owner's press acts on it", () => {
    const activity = play({ script: ACKED });
    // A voice final can arrive with no `spoke` before it, which leaves the owner's words "unanswered".
    const finalOnly = play({
      script: [
        [0, { kind: "heard", text: "Thanks" }],
        [1_000, { asked: false, kind: "voice-finished", promised: false }],
      ],
    });
    expect([
      resumeDueOf({ activity, micLevel: 0, micRms: 0, muted: false, nowMs: 8_600 + 236_900 }),
      resumeDueOf({ activity: finalOnly, micLevel: 0, micRms: 0, muted: false, nowMs: 10_000 }),
      nudgeOfferOf({ activity: finalOnly, nowMs: 1_000 + UNANSWERED_MS - 1 }),
      nudgeOfferOf({ activity: finalOnly, nowMs: 1_000 + UNANSWERED_MS }),
    ]).toEqual([false, false, undefined, "ask"]);
  });

  it("is taken once per thing the owner said, then re-armed by their next words", () => {
    const nudged = play({ script: [...ACKED, [30_000, { kind: "nudged" }]] });
    const carriedOn = play({
      from: nudged,
      script: [
        [31_000, { kind: "spoke" }],
        [33_000, { asked: false, kind: "voice-finished", promised: false }],
      ],
    });
    expect(quietAt({ activity: carriedOn, nowMs: 33_000 + UNANSWERED_MS })).toEqual({
      detail: undefined,
      headline: "listening",
      nudge: undefined,
      phase: "listening",
      seconds: undefined,
    });
    const again = play({
      from: carriedOn,
      script: [
        [40_000, { kind: "heard", text: "Okay, sounds good" }],
        [42_000, { kind: "spoke" }],
        [42_500, { asked: false, kind: "voice-finished", promised: false }],
      ],
    });
    expect(quietAt({ activity: again, nowMs: 42_500 + UNANSWERED_MS }).nudge).toBe("ask");
  });

  it("is not owed when the voice ended on a question", () => {
    const activity = play({ script: [...ACKED, [9_000, { asked: true, kind: "voice-finished", promised: false }]] });
    expect(nudgeOfferOf({ activity, nowMs: 9_000 + 236_900 })).toBe(undefined);
  });

  it("is not owed when the owner's words asked it to wait", () => {
    const activity = play({
      script: [
        [6_000, { kind: "heard", text: "hang on one sec" }],
        [8_000, { kind: "spoke" }],
        [8_600, { asked: false, kind: "voice-finished", promised: false }],
      ],
    });
    expect(nudgeOfferOf({ activity, nowMs: 8_600 + UNANSWERED_MS })).toBe(undefined);
  });

  it("is not owed when the owner's words came after the voice's", () => {
    const activity = play({ script: [...ACKED, [9_000, { kind: "heard", text: "So the next one" }]] });
    expect(quietAt({ activity, nowMs: 9_000 + UNANSWERED_MS }).headline).toBe("still waiting");
  });

  it("is not on offer while a hand-off is in flight", () => {
    const activity = play({ script: [...ACKED, [8_700, handoff({ id: "item_d1" })]] });
    expect(nudgeOfferOf({ activity, nowMs: 8_600 + UNANSWERED_MS })).toBe(undefined);
  });

  it("waits out speech that lands after the voice's turn finished", () => {
    const activity = play({ script: [...ACKED, [15_000, { kind: "spoke" }]] });
    expect(nudgeOfferOf({ activity, nowMs: 15_000 + UNANSWERED_MS - 1 })).toBe(undefined);
    expect(nudgeOfferOf({ activity, nowMs: 15_000 + UNANSWERED_MS })).toBe("ask");
  });

  // A transcript can drop its "?", and "Would you like me to continue" still hands the owner the turn.
  it("reads a question from its last sentence's opening when the transcript dropped the question mark", () => {
    expect(
      [
        "Good, yeah, that's clear.",
        "Good, we're aligned.",
        "Is that what you meant?",
        'Ready when you are. "Shall I go on?"',
        "Would you like me to continue",
        "Right, got it. What do you want next",
        "May I continue",
        "Sound good",
        "What a day.",
        "Okay, carrying on with the next item",
      ].map((text) => voiceAsked({ text })),
    ).toEqual([false, false, true, true, true, true, true, true, false, false]);
  });
});

/*
 * A measured call: the owner asked it to read a Slack channel, the voice said "Mm-hm.", the owner added who was in
 * it, and the voice said "Right. Let me check those. One sec." — then called no tool and started no Codex turn. The
 * orb sat on "listening" beside "nudge it to answer" until the owner said it looked stuck, 114s later. Times are ms
 * from the call's start.
 */
describe("a promise the voice made and never started", () => {
  const PROMISED: Script = [
    [0, { kind: "heard", text: "Can you read through that channel for me" }],
    [500, { kind: "spoke" }],
    [800, { asked: false, kind: "voice-finished", promised: false }],
    [16_000, { kind: "heard", text: "The replies too, it's only the three of us in there" }],
    [16_500, { kind: "spoke" }],
    [20_000, { asked: false, kind: "voice-finished", promised: "whole-turn" }],
  ];

  const due = ({
    activity,
    nowMs,
    inFlight = 0,
    micLevel = 0,
    micRms = 0,
    muted = false,
  }: {
    activity: VoiceActivity;
    nowMs: number;
    inFlight?: number;
    micLevel?: number;
    micRms?: number;
    muted?: boolean;
  }): boolean => promiseDueOf({ activity, afterMs: PROMISE_MS, inFlight, micLevel, micRms, muted, nowMs });

  it("has the page press the nudge itself 10s into the quiet, before the owner's own is offered at 12s", () => {
    const activity = play({ script: PROMISED });
    expect([
      PROMISE_MS,
      due({ activity, nowMs: 20_000 + 9_999 }),
      due({ activity, nowMs: 20_000 + 10_000 }),
      nudgeOfferOf({ activity, nowMs: 20_000 + PROMISE_MS }),
    ]).toEqual([10_000, false, true, undefined]);
  });

  it("presses once, then offers the owner's own nudge a whole quiet after its press, until the owner presses", () => {
    const kept = play({ script: [...PROMISED, [30_000, { kind: "promise-kept" }]] });
    expect([
      due({ activity: kept, nowMs: 30_000 }),
      due({ activity: kept, nowMs: 200_000 }),
      nudgeOfferOf({ activity: kept, nowMs: 30_000 + UNANSWERED_MS - 1 }),
      nudgeOfferOf({ activity: kept, nowMs: 30_000 + UNANSWERED_MS }),
    ]).toEqual([false, false, undefined, "ask"]);
    const pressed = play({ from: kept, script: [[42_000, { kind: "nudged" }]] });
    expect(nudgeOfferOf({ activity: pressed, nowMs: 60_000 })).toBe(undefined);
  });

  it("never presses over a question, a plain statement, work in flight, the owner's mute or their microphone", () => {
    const asked = play({
      script: [...PROMISED, [20_100, { asked: true, kind: "voice-finished", promised: "whole-turn" }]],
    });
    const plain = play({ script: [...PROMISED, [20_100, { asked: false, kind: "voice-finished", promised: false }]] });
    const activity = play({ script: PROMISED });
    const nowMs = 20_100 + PROMISE_MS;
    expect([
      due({ activity: asked, nowMs }),
      due({ activity: plain, nowMs }),
      due({ activity, inFlight: 1, nowMs }),
      due({ activity, muted: true, nowMs }),
      due({ activity, micLevel: HEARING_LEVEL, micRms: HEARING_RMS, nowMs }),
      due({ activity, nowMs }),
    ]).toEqual([false, false, false, false, false, true]);
  });

  // The owner's quiet room read loud on the spectral level alone, which held the resume for good.
  it("presses through the owner's quiet room, folded the whole quiet, and never over their speech", () => {
    let room = play({ script: PROMISED });
    for (let atMs = 20_080; atMs <= 20_000 + PROMISE_MS; atMs += 80) {
      room = foldActivity({
        activity: room,
        input: { kind: "sounded", ...QUIET_ROOM, muted: false, outputLevel: 0 },
        nowMs: atMs,
      });
    }
    const nowMs = 20_000 + PROMISE_MS;
    expect([
      due({ activity: room, ...QUIET_ROOM, nowMs }),
      due({ activity: room, micLevel: QUIET_ROOM.micLevel, micRms: SPOKEN_RMS, nowMs }),
      due({ activity: room, ...QUIET_ROOM, muted: true, nowMs }),
    ]).toEqual([true, false, false]);
  });

  // After "On it." the turn it promised ran on, the voice began its answer, and a page pressing over the kept promise
  // made the voice say the answer twice.
  it("never presses over a promise a Codex turn completed after, only one that ended any other way", () => {
    const nowMs = 20_000 + 30_000;
    const turn = ({ status }: { status: "completed" | "failed" | "interrupted" }): VoiceActivity =>
      play({
        script: [...PROMISED, [20_500, started({ turnId: "t1" })], [25_000, ended({ status, turnId: "t1" })]],
      });
    const sound: ActivityInput = { kind: "sounded", micLevel: 0.5, micRms: SPOKEN_RMS, muted: false, outputLevel: 0 };
    const quiet: ActivityInput = { kind: "sounded", micLevel: 0, micRms: 0, muted: false, outputLevel: 0 };
    const before = play({
      script: [
        [-5_000, started({ turnId: "t0" })],
        [-1_000, ended({ status: "completed", turnId: "t0" })],
        ...PROMISED.slice(0, 3),
        [15_600, sound],
        [15_750, sound],
        [15_900, sound],
        [15_980, quiet],
        ...PROMISED.slice(3),
      ],
    });
    // A click after the turn ends, then a late fragment of the words it answered — not the owner again.
    const clicked = play({
      script: [
        [-5_000, started({ turnId: "t0" })],
        [-1_000, ended({ status: "completed", turnId: "t0" })],
        ...PROMISED.slice(0, 3),
        [15_900, sound],
        [15_980, quiet],
        ...PROMISED.slice(3),
      ],
    });
    // The same words with the owner's microphone silent since the turn ended: a late fragment of what it answered.
    const unsounded = play({
      script: [
        [-5_000, started({ turnId: "t0" })],
        [-1_000, ended({ status: "completed", turnId: "t0" })],
        ...PROMISED,
      ],
    });
    // The turn's end reaching the page ahead of the promise's final is the promise kept too.
    const reordered = play({
      script: [
        ...PROMISED.slice(0, -1),
        [17_000, started({ turnId: "t1" })],
        [19_000, ended({ status: "completed", turnId: "t1" })],
        PROMISED.at(-1)!,
      ],
    });
    // The turn completes and its answer is said, a late fragment of the owner's words lands, and only then
    // the promise's final — the fragment came with no sound from the owner, so the promise is still the one kept.
    const lateFragment = play({
      script: [
        ...PROMISED.slice(0, -1),
        [17_000, started({ turnId: "t1" })],
        [18_000, ended({ status: "completed", turnId: "t1" })],
        [18_500, { kind: "spoke" }],
        [19_000, { kind: "heard", text: " Tobias" }],
        PROMISED.at(-1)!,
      ],
    });
    expect([
      due({ activity: turn({ status: "completed" }), nowMs }),
      due({ activity: reordered, nowMs }),
      due({ activity: lateFragment, nowMs }),
      due({ activity: unsounded, nowMs }),
      due({ activity: clicked, nowMs }),
      due({ activity: turn({ status: "interrupted" }), nowMs }),
      due({ activity: turn({ status: "failed" }), nowMs }),
      due({ activity: before, nowMs }),
    ]).toEqual([false, false, false, false, false, true, true, true]);
  });

  it("is re-armed by the owner's next words and a fresh promise after them", () => {
    const again = play({
      script: [
        ...PROMISED,
        [30_000, { kind: "promise-kept" }],
        [40_000, { kind: "heard", text: "and the other thread too" }],
        [41_000, { kind: "spoke" }],
        [42_000, { asked: false, kind: "voice-finished", promised: "whole-turn" }],
      ],
    });
    expect(due({ activity: again, nowMs: 42_000 + PROMISE_MS })).toBe(true);
  });

  /**
   * A measured call: the voice answered, then closed on this line, verbatim, and nothing was checking. The answer
   * before it is shaped like that turn's. Which words read as a promise is `voicePromise.test.ts`'s.
   */
  const INCIDENT_CLOSE = "Let me check how callers are actually choosing modules.";
  const ANSWERED = "The picker reads the config first, then falls back to the default list.";

  it("makes the incident's turn due for the page's own nudge, and leaves an answered, completed or asking turn alone", () => {
    const finishedOn = ({ text }: { text: string }): VoiceActivity =>
      play({
        script: [
          [0, { kind: "heard", text: "Why does the module loader pick the old one" }],
          [500, { kind: "spoke" }],
          [20_000, { asked: voiceAsked({ text }), kind: "voice-finished", promised: voicePromiseOf({ text }) }],
        ],
      });
    const nowMs = 20_000 + PROMISE_MS;
    expect(
      [
        `${ANSWERED} ${INCIDENT_CLOSE}`,
        ANSWERED,
        `${ANSWERED} I checked how callers are actually choosing modules.`,
        `${ANSWERED} Want me to check how callers are actually choosing modules?`,
      ].map((text) => due({ activity: finishedOn({ text }), nowMs })),
    ).toEqual([true, false, false, false]);
  });

  /**
   * A measured call: a Codex turn wrote "…I haven't established whether your earlier answer was missed or that check
   * failed." and completed; the voice said it and closed on "I'll keep digging." 15.4s later, with nothing running,
   * until the owner pointed out nothing was being done. Repro:
   * `grep -n "keep digging" $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
   */
  const DIGGING_ANSWER =
    "Fresh reads can still show stale questions. I don't yet know if your earlier answer was missed.";

  // A terminal promise is due at once: the owner challenged this one 9.059s after its final, inside PROMISE_MS.
  it("presses at once over a promise closing the answer of a turn that had already completed, as the measured call's did", () => {
    const text = `${DIGGING_ANSWER} I'll keep digging.`;
    const answered = ({ promised }: { promised: VoicePromise }): Script => [
      [0, { kind: "heard", text: "Why is this card back when I already answered it" }],
      [1_000, started({ turnId: "t1" })],
      [3_000, ended({ status: "completed", turnId: "t1" })],
      [3_500, { kind: "spoke" }],
      [19_000, { asked: voiceAsked({ text }), kind: "voice-finished", promised }],
    ];
    const terminal = play({ script: answered({ promised: voicePromiseOf({ text }) }) });
    const whole = play({ script: answered({ promised: "whole-turn" }) });
    const keptLater = play({
      script: [
        ...answered({ promised: "terminal" }),
        [19_500, started({ turnId: "t2" })],
        [22_000, ended({ status: "completed", turnId: "t2" })],
      ],
    });
    // A turn ending on the promise's own instant never proves it came after.
    const sameInstant = play({
      script: [
        ...answered({ promised: "terminal" }).slice(0, -1),
        [18_000, started({ turnId: "t2" })],
        [19_000, ended({ status: "completed", turnId: "t2" })],
        answered({ promised: "terminal" }).at(-1)!,
      ],
    });
    const nowMs = 22_000 + PROMISE_MS;
    expect([
      due({ activity: terminal, nowMs: 19_000 }),
      due({ activity: whole, nowMs }),
      due({ activity: keptLater, nowMs }),
      due({ activity: sameInstant, nowMs: 19_000 }),
      due({ activity: terminal, inFlight: 1, nowMs: 19_000 }),
    ]).toEqual([true, false, false, true, false]);
  });

  it("holds a terminal 'still on it' while its turn runs, and leaves it kept once that turn completes after it", () => {
    const text = `${DIGGING_ANSWER} Still on it.`;
    const running = play({
      script: [
        [0, { kind: "heard", text: "Where are we on the card" }],
        [1_000, started({ turnId: "t1" })],
        [3_500, { kind: "spoke" }],
        [9_000, { asked: voiceAsked({ text }), kind: "voice-finished", promised: voicePromiseOf({ text }) }],
      ],
    });
    const completed = play({ from: running, script: [[14_000, ended({ status: "completed", turnId: "t1" })]] });
    expect([
      voicePromiseOf({ text }),
      due({ activity: running, inFlight: 1, nowMs: 9_000 }),
      due({ activity: completed, nowMs: 14_000 + PROMISE_MS }),
    ]).toEqual(["terminal", false, false]);
  });
});

// What the page's rollover holds on (`pageRolloverHold`, `callRolloverFloor.ts`).
describe("what a rollover reads of a plan call's answers", () => {
  const heldAnswer = ({
    phase,
    pending,
  }: {
    phase: "held" | "handing" | "released" | "failed";
    pending: boolean;
  }): ActivityInput => ({
    detail: "why",
    itemId: "a-1",
    kind: "held-answer",
    pending,
    phase,
    turnId: "t-1",
  });

  it("stamps a completed turn and leaves an interrupted one unstamped", () => {
    const completed = play({
      script: [
        [1_000, started({ turnId: "t-1" })],
        [2_000, ended({ status: "completed", turnId: "t-1" })],
      ],
    });
    const interrupted = play({
      script: [
        [1_000, started({ turnId: "t-2" })],
        [2_000, ended({ status: "interrupted", turnId: "t-2" })],
      ],
    });
    expect([completed.plan.lastCompletedMs, interrupted.plan.lastCompletedMs]).toEqual([2_000, undefined]);
  });

  // A failed hand-over is stamped too, since a timed-out write may still have reached the voice.
  it("carries the server's own word on whether an answer is owed, and stamps every hand-over that ended", () => {
    const steps: Script = [
      [500, heldAnswer({ pending: true, phase: "handing" })],
      [1_000, heldAnswer({ pending: true, phase: "held" })],
      [2_000, heldAnswer({ pending: true, phase: "released" })],
      [3_000, heldAnswer({ pending: false, phase: "failed" })],
    ];
    const seen = steps.map((_, i) => play({ script: steps.slice(0, i + 1) }).plan);
    expect(seen.map(({ answerPendingMs, lastAnswerHandedMs }) => [answerPendingMs, lastAnswerHandedMs])).toEqual([
      [500, undefined],
      [1_000, undefined],
      [2_000, 2_000],
      [undefined, 3_000],
    ]);
  });
});
