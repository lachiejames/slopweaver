import { describe, expect, it } from "vitest";

import { type ActivityInput, foldActivity, RESUME_MS, type VoiceActivity } from "../../../lib/voiceActivity";
import { foldTurnOrder, NO_TURN_ORDER } from "../../../lib/voiceTurnOrder";
import { play, type Script } from "./harness";
import { dueAt, sounded } from "./resumeHarness";

/*
 * The shape of the incident replayed here: the owner's sentence, the voice's "Mm-hmm. Let me check." over its end, the
 * session ending the owner's turn there and opening a new one for the rest, the owner's microphone reading RMS 0.000
 * under the voice's audio, a Codex turn running to completion — and no resume until the owner asked for one.
 * Repro, from the home: `grep -nE '<turn-id>|"name":"resume"|stalled \(badge\)' talk/calls/<call-id>-*.jsonl`
 */

/** A segment of the owner's turn `id` on the ordered turn stream. */
const ownerSaid = ({ id, final }: { id: string; final: boolean }): ActivityInput => ({
  event: { final, id, kind: "segment" },
  kind: "owner",
});

/** When the Codex turn completed, on the script's clock. */
const COMPLETED_MS = 75_525;

/** The turns the owner's two fragments after the voice's arrive in, in order, `typed` for a turn they typed. */
type Tail = readonly [string, string];

/** The owner's fragment in turn `id`, or their typed turn. */
const fragment = ({ id }: { id: string }): ActivityInput =>
  id === "typed" ? { event: { kind: "typed" }, kind: "owner" } : ownerSaid({ final: false, id });

/**
 * The incident's order of events, the owner's two fragments after the voice's in the turns `tail` names.
 * @returns the script, the second of `tail` the turn the owner's last words arrive in
 */
const incident = ({ tail: [first, last], finalBeforeVoice }: { tail: Tail; finalBeforeVoice: boolean }): Script => {
  const head: Script = [
    [3_007, ownerSaid({ final: false, id: "A" })],
    [3_007, { kind: "heard", text: " Right, good. So, um, back to the briefing" }],
    [7_459, { kind: "codex-turn", phase: "started", turnId: "t1" }],
  ];
  const voice: Script = [
    [12_970, { id: "V", kind: "voice-turn" }],
    [12_970, { kind: "spoke" }],
    [13_208, { asked: false, kind: "voice-finished", promised: "whole-turn" }],
  ];
  const after: Script = [
    [13_235, fragment({ id: first })],
    [13_235, { kind: "heard", text: " results of" }],
    [14_000, fragment({ id: last })],
    [14_000, { kind: "heard", text: " these different jobs" }],
    [COMPLETED_MS, { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "t1" }],
  ];
  const closeHead: Script = finalBeforeVoice ? [[12_969, ownerSaid({ final: true, id: "A" })]] : [];
  return [...head, ...closeHead, ...voice, ...after];
};

/**
 * The incident's activity with the meters folded where the call file sampled them: the owner loud before the voice,
 * the voice loud over the owner's words, the owner's microphone silent under it.
 * @returns the activity once every event and sample is folded
 */
const replay = ({ tail, finalBeforeVoice }: { tail: Tail; finalBeforeVoice: boolean }): VoiceActivity => {
  const script = incident({ finalBeforeVoice, tail });
  const beforeVoice = play({ script: script.filter(([atMs]) => atMs < 10_000) });
  const ownerLoud = sounded({ activity: beforeVoice, micLevel: 0.457, micRms: 0.022, nowMs: 6_236, outputLevel: 0 });
  const voiceLoud = sounded({ activity: ownerLoud, micLevel: 0.431, micRms: 0, nowMs: 10_394, outputLevel: 0.208 });
  return script
    .filter(([atMs]) => atMs >= 10_000)
    .reduce<VoiceActivity>((activity, [nowMs, input]) => foldActivity({ activity, input, nowMs }), voiceLoud);
};

describe("a resume after the owner's words overlapped the voice's", () => {
  it("is due RESUME_MS after the Codex turn ends when the owner's words came in a turn opened after the voice's", () => {
    const activity = replay({ finalBeforeVoice: true, tail: ["B", "B"] });
    expect([
      activity.order.ownerLatestSinceVoice,
      dueAt({ activity, nowMs: COMPLETED_MS - 1 }),
      dueAt({ activity, nowMs: COMPLETED_MS + RESUME_MS - 1 }),
      dueAt({ activity, nowMs: COMPLETED_MS + RESUME_MS }),
    ]).toEqual([true, false, false, true]);
  });

  // A late fragment of words the voice already answered aloud holds the resume.
  it("is not due when the owner's last words are a late fragment of the turn they were in before the voice's", () => {
    const activity = replay({ finalBeforeVoice: false, tail: ["A", "A"] });
    expect([activity.order.ownerLatestSinceVoice, dueAt({ activity, nowMs: COMPLETED_MS + RESUME_MS })]).toEqual([
      false,
      false,
    ]);
  });

  // A fragment can land after its own turn's final.
  it("is not due when a late fragment of the owner's earlier turn lands after that turn's final", () => {
    const activity = replay({ finalBeforeVoice: true, tail: ["A", "A"] });
    expect([activity.order.ownerLatestSinceVoice, dueAt({ activity, nowMs: COMPLETED_MS + RESUME_MS })]).toEqual([
      false,
      false,
    ]);
  });

  // A new turn of the owner's opening first must not mark a later fragment of the old one.
  it("is not due when a late fragment of the owner's earlier turn lands after a new turn of theirs opened", () => {
    const activity = replay({ finalBeforeVoice: false, tail: ["B", "A"] });
    expect([activity.order.ownerLatestSinceVoice, dueAt({ activity, nowMs: COMPLETED_MS + RESUME_MS })]).toEqual([
      false,
      false,
    ]);
  });

  // The owner's microphone never sounds for a typed turn, so only the order can say it came after.
  it("is due when the owner's last words are a turn they typed after the voice's, and not when a late spoken fragment follows it", () => {
    const typed = replay({ finalBeforeVoice: false, tail: ["A", "typed"] });
    const late = replay({ finalBeforeVoice: false, tail: ["typed", "A"] });
    expect([
      typed.order.ownerLatestSinceVoice,
      dueAt({ activity: typed, nowMs: COMPLETED_MS + RESUME_MS }),
      late.order.ownerLatestSinceVoice,
      dueAt({ activity: late, nowMs: COMPLETED_MS + RESUME_MS }),
    ]).toEqual([true, true, false, false]);
  });

  // The voice's own final lands after the owner's new turn opened, with no Codex turn to answer and no voice audio after
  // the owner's words.
  it("is due RESUME_MS after the owner's new turn's words when a late final of the voice turn they spoke after lands", () => {
    const voiced = sounded({
      activity: play({ script: [[1_000, { id: "V", kind: "voice-turn" }]] }),
      micLevel: 0,
      micRms: 0,
      nowMs: 1_000,
      outputLevel: 0.3,
    });
    const fold = ({ script }: { script: Script }): VoiceActivity =>
      script.reduce<VoiceActivity>(
        (folded, [nowMs, input]) => foldActivity({ activity: folded, input, nowMs }),
        voiced,
      );
    const lateFinal: Script = [
      [1_200, { id: "V", kind: "voice-turn" }],
      [1_200, { asked: false, kind: "voice-finished", promised: false }],
    ];
    const afterHeard = fold({
      script: [
        [1_100, ownerSaid({ final: false, id: "B" })],
        [1_100, { kind: "heard", text: " new words" }],
        ...lateFinal,
      ],
    });
    // The final lands between the owner's new turn's segment and its heard words, on one instant.
    const beforeHeard = fold({
      script: [
        [1_100, ownerSaid({ final: false, id: "B" })],
        ...lateFinal,
        [1_200, { kind: "heard", text: " new words" }],
      ],
    });
    // A late transcript fragment of the same voice turn, its `spoke`, before the final.
    const lateSpoke = fold({
      script: [
        [1_100, ownerSaid({ final: false, id: "B" })],
        [1_100, { kind: "heard", text: " new words" }],
        [1_150, { kind: "spoke" }],
        ...lateFinal,
      ],
    });
    // The owner's words reach the page before their new turn's segment, the final between them.
    const segmentLast = fold({
      script: [
        [1_100, { kind: "heard", text: " new words" }],
        [1_200, { id: "V", kind: "voice-turn" }],
        [1_201, { asked: true, kind: "voice-finished", promised: false }],
        [1_300, ownerSaid({ final: false, id: "B" })],
      ],
    });
    // A `spoke` carries no turn ID, so one a NEW voice turn's transcript trails answers the owner.
    const newVoiceTurn = fold({
      script: [
        [1_100, ownerSaid({ final: false, id: "B" })],
        [1_100, { kind: "heard", text: " new words" }],
        [1_150, { kind: "spoke" }],
        [1_250, { id: "W", kind: "voice-turn" }],
      ],
    });
    // The older voice turn's audio after the owner's words, then its late fragments, holds only a quiet.
    const tailHeard = sounded({
      activity: fold({ script: [[1_100, { kind: "heard", text: " new words" }]] }),
      micLevel: 0,
      micRms: 0,
      nowMs: 1_200,
      outputLevel: 0.3,
    });
    const tail = [
      [1_300, ownerSaid({ final: false, id: "B" })],
      [1_400, { id: "V", kind: "voice-turn" }],
      [1_500, { kind: "spoke" }],
      [1_600, { asked: false, kind: "voice-finished", promised: false }],
    ] satisfies Script;
    const audibleTail = tail.reduce<VoiceActivity>(
      (folded, [nowMs, input]) => foldActivity({ activity: folded, input, nowMs }),
      tailHeard,
    );
    // A `spoke` between the owner's words and their new turn's segment still pays a new voice turn after it.
    const spokeThenSegment = fold({
      script: [
        [1_100, { kind: "heard", text: " new words" }],
        [1_200, { kind: "spoke" }],
        [1_300, ownerSaid({ final: false, id: "B" })],
        [1_400, { id: "W", kind: "voice-turn" }],
      ],
    });
    // That `spoke`, of the older turn, does not deliver a Codex turn ending after it.
    const codexAfter = fold({
      script: [
        [1_050, { kind: "codex-turn", phase: "started", turnId: "t1" }],
        [1_100, { kind: "heard", text: " new words" }],
        [1_150, { kind: "spoke" }],
        [1_200, ownerSaid({ final: false, id: "B" })],
        [1_300, { kind: "spoke" }],
        [1_400, { id: "V", kind: "voice-turn" }],
        [1_500, { asked: false, kind: "voice-finished", promised: false }],
        [1_600, { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "t1" }],
      ],
    });
    expect([
      spokeThenSegment.lastAnsweredMs,
      dueAt({ activity: spokeThenSegment, nowMs: 1_400 + RESUME_MS }),
      dueAt({ activity: codexAfter, nowMs: 1_600 + RESUME_MS - 1 }),
      dueAt({ activity: codexAfter, nowMs: 1_600 + RESUME_MS }),
    ]).toEqual([1_200, false, false, true]);
    expect([
      dueAt({ activity: segmentLast, nowMs: 1_100 + RESUME_MS - 1 }),
      dueAt({ activity: segmentLast, nowMs: 1_100 + RESUME_MS }),
      newVoiceTurn.lastAnsweredMs,
      dueAt({ activity: newVoiceTurn, nowMs: 1_250 + RESUME_MS }),
      dueAt({ activity: audibleTail, nowMs: 1_200 + RESUME_MS - 1 }),
      dueAt({ activity: audibleTail, nowMs: 1_200 + RESUME_MS }),
    ]).toEqual([false, true, 1_150, false, false, true]);
    expect([
      afterHeard.order.ownerLatestSinceVoice,
      dueAt({ activity: afterHeard, nowMs: 1_100 + RESUME_MS - 1 }),
      dueAt({ activity: afterHeard, nowMs: 1_100 + RESUME_MS }),
      dueAt({ activity: beforeHeard, nowMs: 1_200 + RESUME_MS - 1 }),
      dueAt({ activity: beforeHeard, nowMs: 1_200 + RESUME_MS }),
      dueAt({ activity: lateSpoke, nowMs: 1_100 + RESUME_MS - 1 }),
      dueAt({ activity: lateSpoke, nowMs: 1_100 + RESUME_MS }),
    ]).toEqual([true, false, true, false, true, false, true]);
  });

  // The owner's heard words belong to whichever turn's segment was seen last, so a late segment of their older turn after
  // a new one puts back the answer the new one set aside.
  it("is not due when a late segment of the owner's older turn follows the new one that set the voice's answer aside", () => {
    const answered: Script = [
      [900, ownerSaid({ final: true, id: "A" })],
      [1_000, { id: "V", kind: "voice-turn" }],
      [1_100, { kind: "heard", text: " words" }],
      [1_200, { asked: true, kind: "voice-finished", promised: false }],
      [1_300, ownerSaid({ final: true, id: "B" })],
      [1_400, ownerSaid({ final: true, id: "A" })],
    ];
    const restored = play({ script: answered });
    // A later segment of the new turn makes it the owner's latest again, and sets the answer aside once more.
    const remarked = play({ script: [...answered, [1_500, ownerSaid({ final: true, id: "B" })]] });
    // A new voice turn's first segment, no `spoke` yet, is the voice answering again.
    const newVoiceTurn = play({ script: [...answered.slice(0, 5), [1_400, { id: "W", kind: "voice-turn" }]] });
    // A `spoke` set aside the same way, before the late segment of the older turn, answers the owner once it lands.
    const spokeRestored = play({
      script: [
        [900, ownerSaid({ final: true, id: "A" })],
        [1_000, { id: "V", kind: "voice-turn" }],
        [1_050, ownerSaid({ final: true, id: "B" })],
        [1_100, { kind: "heard", text: " words" }],
        [1_200, { kind: "spoke" }],
        [1_300, ownerSaid({ final: true, id: "A" })],
      ],
    });
    expect([
      restored.order.ownerLatestSinceVoice,
      restored.lastAnsweredMs,
      restored.lastVoiceFinal!.atMs,
      dueAt({ activity: restored, nowMs: 1_400 + RESUME_MS }),
      dueAt({ activity: remarked, nowMs: 1_100 + RESUME_MS - 1 }),
      dueAt({ activity: remarked, nowMs: 1_100 + RESUME_MS }),
      spokeRestored.lastAnsweredMs,
      dueAt({ activity: spokeRestored, nowMs: 1_300 + RESUME_MS }),
      newVoiceTurn.lastAnsweredMs,
      dueAt({ activity: newVoiceTurn, nowMs: 1_400 + RESUME_MS }),
    ]).toEqual([false, 1_200, 1_200, false, false, true, 1_200, false, 1_200, false]);
  });

  // The voice's audio runs ahead of its transcript, so sound after the owner's words is it answering.
  it("is not due when the voice sounds after the owner's new turn's words, before its transcript", () => {
    const answering = sounded({
      activity: replay({ finalBeforeVoice: true, tail: ["B", "B"] }),
      micLevel: 0,
      micRms: 0,
      nowMs: COMPLETED_MS + 1_000,
      outputLevel: 0.3,
    });
    expect(dueAt({ activity: answering, nowMs: COMPLETED_MS + RESUME_MS })).toBe(false);
  });
});

describe("foldTurnOrder", () => {
  const seenA = foldTurnOrder({ id: "A", order: NO_TURN_ORDER, who: "owner" });
  const voice = foldTurnOrder({ id: "V", order: seenA, who: "voice" });
  const after = foldTurnOrder({ id: "B", order: voice, who: "owner" });

  it("records the owner's first turn before the voice has had one without marking it", () => {
    expect([seenA.ownerLatestSinceVoice, [...seenA.ownerSeen], [...seenA.ownerSinceVoice]]).toEqual([false, ["A"], []]);
  });

  it("marks a turn of the owner's first seen after the voice's, and a fragment of one seen before as nothing", () => {
    expect([after.ownerLatestSinceVoice, foldTurnOrder({ id: "A", order: voice, who: "owner" })]).toEqual([
      true,
      voice,
    ]);
  });

  it("unmarks the owner's latest words when a late fragment of a turn seen before the voice's follows their new one", () => {
    const late = foldTurnOrder({ id: "A", order: after, who: "owner" });
    const back = foldTurnOrder({ id: "B", order: late, who: "owner" });
    expect([late.ownerLatestSinceVoice, [...late.ownerSinceVoice], back.ownerLatestSinceVoice]).toEqual([
      false,
      ["B"],
      true,
    ]);
  });

  it("keeps the mark through a later fragment of the same voice turn, and clears it on the voice's next turn", () => {
    expect([
      foldTurnOrder({ id: "V", order: after, who: "voice" }).ownerLatestSinceVoice,
      foldTurnOrder({ id: "W", order: after, who: "voice" }),
    ]).toEqual([
      true,
      {
        ownerLatestSinceVoice: false,
        ownerSeen: new Set(["A", "B"]),
        ownerSinceVoice: new Set(),
        voiceSeen: new Set(["V", "W"]),
        voiceTurnId: "W",
      },
    ]);
  });

  // A late fragment of an older voice turn is not its newest.
  it("keeps the mark when a late fragment of an older voice turn follows the owner's turn after the newest one", () => {
    const newest = foldTurnOrder({ id: "W", order: voice, who: "voice" });
    const owners = foldTurnOrder({ id: "C", order: newest, who: "owner" });
    const late = foldTurnOrder({ id: "V", order: owners, who: "voice" });
    expect([late === owners, late.voiceTurnId, late.ownerLatestSinceVoice]).toEqual([true, "W", true]);
  });
});
