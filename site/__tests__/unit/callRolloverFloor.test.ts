/*
 * The page's floor for a held rollover at each of its three stages: calm holds for every conversational turn, urgent
 * stops waiting for a turn the voice owes, last waits only for the voice's own work and a second of quiet on both meters. The
 * same floor over folded turns and whole calls is `callRolloverFloorTurns.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  heldAskStage,
  ROLLOVER_METER_QUIET_MS,
  ROLLOVER_OWED_HOLD_MS,
  type RolloverUrgency,
  rolloverUrgency,
  soonerRemainder,
} from "../../lib/callRollover";
import {
  pageRolloverHold,
  ROLLOVER_CUT_SLACK_MS,
  UNWRITTEN_HOLD,
  unwrittenSinceAt,
  voiceMidAnswerAt,
} from "../../lib/callRolloverFloor";
import { PLAN_CALL_LIMITS } from "../../lib/planCallContract";
import type { ActivityInput } from "../../lib/voiceActivity";
import { progressingWork } from "../../lib/voiceActivityRows";
import { COMPACTION_STALL_MS, STALL_MS } from "../../lib/voiceActivityState";
import { NO_TURN_TAKING, type TurnTaking } from "../../lib/voiceTurnTaking";
import { FREE, folded, holdOf, stretch } from "./callRolloverFloor/harness";

describe("rolloverUrgency", () => {
  it("is calm outside the urgent window, urgent inside it, last inside the last, and last once overdue", () => {
    expect(
      [
        PLAN_CALL_LIMITS.rolloverUrgentMs + 1,
        PLAN_CALL_LIMITS.rolloverUrgentMs,
        PLAN_CALL_LIMITS.rolloverLastMs + 1,
        PLAN_CALL_LIMITS.rolloverLastMs,
        -5_000,
      ].map((remainingMs) => rolloverUrgency({ remainingMs })),
    ).toEqual(["calm", "urgent", "urgent", "last", "last"]);
  });
});

/** The server's 180 seconds, received at page instant zero. */
const URGENT_KNOWN = { atMs: 0, remainingMs: 180_000 };

describe("heldAskStage", () => {
  it("stays calm with no time known, then counts the server's remainder down on the page's own clock", () => {
    expect([
      heldAskStage({ known: undefined, nowMs: 5_000_000 }),
      heldAskStage({ known: URGENT_KNOWN, nowMs: 0 }),
      heldAskStage({ known: URGENT_KNOWN, nowMs: 160_000 }),
    ]).toEqual([
      { remainingMs: undefined, urgency: "calm" },
      { remainingMs: 180_000, urgency: "urgent" },
      { remainingMs: 20_000, urgency: "last" },
    ]);
  });
});

describe("soonerRemainder", () => {
  const lastAsk = { atMs: 10_000, remainingMs: 20_000 };

  // Node's timers run through a Mac's sleep (libuv's `mach_continuous_time`) while the page's
  // `performance.now()` stops, so after one the page's own count says 170 s where the server's last ask says 20 s.
  it("takes the server's last ask over a count a sleep left behind, and never pushes a stage back", () => {
    expect([
      soonerRemainder({ arrived: lastAsk, held: URGENT_KNOWN, nowMs: 10_000 }),
      soonerRemainder({ arrived: URGENT_KNOWN, held: lastAsk, nowMs: 10_000 }),
      soonerRemainder({ arrived: undefined, held: URGENT_KNOWN, nowMs: 10_000 }),
      soonerRemainder({ arrived: lastAsk, held: undefined, nowMs: 10_000 }),
      heldAskStage({ known: soonerRemainder({ arrived: lastAsk, held: URGENT_KNOWN, nowMs: 10_000 }), nowMs: 10_000 }),
    ]).toEqual([lastAsk, lastAsk, URGENT_KNOWN, lastAsk, { remainingMs: 20_000, urgency: "last" }]);
  });
});

describe("voiceMidAnswerAt", () => {
  it("names the voice's newest words only while an answer is open", () => {
    expect([
      voiceMidAnswerAt({ answerOpen: true, lastSpokeMs: 2_000 }),
      voiceMidAnswerAt({ answerOpen: false, lastSpokeMs: 2_000 }),
      voiceMidAnswerAt({ answerOpen: false, lastSpokeMs: undefined }),
    ]).toEqual([2_000, undefined, undefined]);
  });

  // A final and the next answer's first words stamped in one millisecond read as no answer open,
  // so a pause inside the newer answer freed the last stage's floor.
  it("holds the last stage through a pause in an answer whose first words shared the last final's millisecond", () => {
    const spoke = { kind: "spoke" } as const;
    const final = { asked: true, kind: "voice-finished", promised: false } as const;
    const pauseMs = ROLLOVER_METER_QUIET_MS + 500;
    const turn = { ...NO_TURN_TAKING, voice: stretch({ lastMs: 0 }) };
    const holdAt = ({ script }: { script: readonly (readonly [number, ActivityInput])[] }): string | undefined =>
      holdOf({
        activity: { ...folded({ script }), turn },
        nowMs: pauseMs,
        stage: { remainingMs: undefined, urgency: "last" },
      });
    expect([
      holdAt({
        script: [
          [0, final],
          [0, spoke],
        ],
      }),
      holdAt({
        script: [
          [0, spoke],
          [0, final],
        ],
      }),
    ]).toEqual(["the voice is part-way through an answer", undefined]);
  });
});

describe("progressingWork", () => {
  const turnStarted = ({ turnId }: { turnId: string }): ActivityInput => ({
    kind: "codex-turn",
    phase: "started",
    turnId,
  });
  const turnMoved = ({ turnId }: { turnId: string }): ActivityInput => ({
    kind: "codex-turn",
    phase: "progress",
    step: null,
    turnId,
  });
  const toolStarted = ({ callId }: { callId: string }): ActivityInput => ({ callId, kind: "tool-started", name: "x" });
  const blocked: readonly (readonly [number, ActivityInput])[] = [
    [-61_000, turnStarted({ turnId: "a" })],
    [-60_000, toolStarted({ callId: "stuck" })],
  ];
  const at = ({ script }: { script: readonly (readonly [number, ActivityInput])[] }): number =>
    progressingWork({ activity: folded({ script }), nowMs: 0 });

  // A turn waiting on a page tool never shows stalled, and no row says which turn a tool is for,
  // so each turn is judged on its own progress: one blocked on a stalled tool is quiet, an unrelated one is not.
  it("counts a turn blocked on a stalled tool as stalled, and a concurrent turn still moving as progressing", () => {
    expect([
      at({ script: blocked }),
      at({ script: [...blocked, [-61_000, turnStarted({ turnId: "b" })], [-1_000, turnMoved({ turnId: "b" })]] }),
      at({ script: [...blocked, [-10_000, toolStarted({ callId: "fresh" })]] }),
      at({ script: [[-STALL_MS + 1, turnStarted({ turnId: "a" })]] }),
      at({ script: [[-STALL_MS, turnStarted({ turnId: "a" })]] }),
      at({ script: [] }),
    ]).toEqual([0, 1, 1, 1, 0, 0]);
  });

  // A compaction is silent until it ends, so the floor judges it on the same longer horizon the orb's row does.
  it("counts a compacting turn as progressing until COMPACTION_STALL_MS, and an ordinary one only until STALL_MS", () => {
    const compacting = ({ sinceMs }: { sinceMs: number }): readonly (readonly [number, ActivityInput])[] => [
      [sinceMs, turnStarted({ turnId: "a" })],
      [sinceMs, { kind: "codex-turn", phase: "progress", step: { kind: "compacting" }, turnId: "a" }],
    ];
    expect([
      at({ script: compacting({ sinceMs: -COMPACTION_STALL_MS + 1 }) }),
      at({ script: compacting({ sinceMs: -COMPACTION_STALL_MS }) }),
      at({ script: [[-STALL_MS, turnStarted({ turnId: "a" })]] }),
    ]).toEqual([1, 0, 0]);
  });
});

describe("pageRolloverHold, calm", () => {
  it("is free once neither meter has sounded for the whole quiet, and not a millisecond before", () => {
    const turn: TurnTaking = {
      ...NO_TURN_TAKING,
      owner: stretch({ lastMs: 5_000 }),
      voice: stretch({ lastMs: 3_000 }),
    };
    expect([
      pageRolloverHold({ ...FREE, nowMs: 5_000 + ROLLOVER_METER_QUIET_MS - 1, turn }),
      pageRolloverHold({ ...FREE, nowMs: 5_000 + ROLLOVER_METER_QUIET_MS, turn }),
    ]).toEqual(["the owner's meter is not quiet", undefined]);
  });

  it("holds for the voice alone, and is free on a call where nothing has sounded yet", () => {
    const voiceOnly: TurnTaking = { ...NO_TURN_TAKING, voice: stretch({ lastMs: 9_800 }) };
    expect([
      pageRolloverHold({ ...FREE, nowMs: 10_000, turn: voiceOnly }),
      pageRolloverHold({ ...FREE, nowMs: 0 }),
    ]).toEqual(["the voice's meter is not quiet", undefined]);
  });

  // A tool call that began after the server asked must still hold the swap.
  it("holds while any work is in flight, however long the meters have been silent", () => {
    expect([
      pageRolloverHold({ ...FREE, inFlight: 1, nowMs: 60_000 }),
      pageRolloverHold({ ...FREE, nowMs: 60_000 }),
    ]).toEqual(["work is in flight", undefined]);
  });

  it("holds for the server's own quiet after the page asked the voice to take its turn, or the owner pressed a nudge", () => {
    const atMs = 50_000;
    expect([
      pageRolloverHold({ ...FREE, nowMs: atMs + PLAN_CALL_LIMITS.rolloverQuietMs - 1, resumedAtMs: atMs }),
      pageRolloverHold({ ...FREE, nowMs: atMs + PLAN_CALL_LIMITS.rolloverQuietMs, resumedAtMs: atMs }),
      pageRolloverHold({ ...FREE, nowMs: atMs + PLAN_CALL_LIMITS.rolloverQuietMs - 1, nudgedAtMs: atMs }),
      pageRolloverHold({ ...FREE, nowMs: atMs + PLAN_CALL_LIMITS.rolloverQuietMs, nudgedAtMs: atMs }),
    ]).toEqual(["the voice was just prompted", undefined, "the voice was just prompted", undefined]);
  });

  // The turn's row goes while both meters have been quiet since the owner stopped, and the held ask fired 51ms
  // later — before the voice said the answer it had been handed 25ms earlier.
  it("holds for the server's own quiet after a Codex turn completed or an answer was handed, though the meters are quiet", () => {
    const atMs = 600_000;
    const turn: TurnTaking = { ...NO_TURN_TAKING, owner: stretch({ lastMs: atMs - 10_000 }) };
    expect([
      pageRolloverHold({ ...FREE, completedAtMs: atMs, nowMs: atMs + 51, turn }),
      pageRolloverHold({ ...FREE, completedAtMs: atMs, nowMs: atMs + PLAN_CALL_LIMITS.rolloverQuietMs, turn }),
      pageRolloverHold({ ...FREE, answerHandedAtMs: atMs, nowMs: atMs + PLAN_CALL_LIMITS.rolloverQuietMs - 1 }),
      pageRolloverHold({ ...FREE, answerHandedAtMs: atMs, nowMs: atMs + PLAN_CALL_LIMITS.rolloverQuietMs }),
    ]).toEqual(["the voice was just prompted", undefined, "the voice was just prompted", undefined]);
  });

  // A reconnect past the event ring can drop the `pending:false`, so the hold is bounded by quiet on both meters after
  // the event that raised it, and the owner's talking keeps it up.
  it("lets a pending flag go after the owed hold of quiet since it and both meters, and not a millisecond before", () => {
    const answerPendingMs = 200_000;
    const heard = answerPendingMs + 60_000;
    const turn: TurnTaking = { ...NO_TURN_TAKING, owner: stretch({ lastMs: heard }) };
    expect([
      pageRolloverHold({ ...FREE, answerPendingMs, nowMs: answerPendingMs + ROLLOVER_OWED_HOLD_MS - 1 }),
      pageRolloverHold({ ...FREE, answerPendingMs, nowMs: answerPendingMs + ROLLOVER_OWED_HOLD_MS }),
      pageRolloverHold({ ...FREE, answerPendingMs, nowMs: heard + ROLLOVER_OWED_HOLD_MS - 1, turn }),
      pageRolloverHold({ ...FREE, answerPendingMs, nowMs: heard + ROLLOVER_OWED_HOLD_MS, turn }),
    ]).toEqual(["a completed answer is still pending", undefined, "a completed answer is still pending", undefined]);
  });

  // A successor's fold starts empty, so a rollover takes the owed turn's nudge away — held,
  // but bounded well inside the ten minutes between the rollover's start and the lifetime cut.
  it("holds while the voice owes the next turn, for the bounded hold only", () => {
    const owedFromMs = 80_000;
    expect([
      pageRolloverHold({ ...FREE, nowMs: owedFromMs + ROLLOVER_OWED_HOLD_MS - 1, owedFromMs }),
      pageRolloverHold({ ...FREE, nowMs: owedFromMs + ROLLOVER_OWED_HOLD_MS, owedFromMs }),
    ]).toEqual(["the voice still owes its turn", undefined]);
    expect(ROLLOVER_OWED_HOLD_MS).toBeLessThan(PLAN_CALL_LIMITS.lifetimeMs - PLAN_CALL_LIMITS.rolloverFromMs);
  });

  // A pause for emphasis inside one answer leaves the meter quiet with the answer unfinished.
  it("holds while the voice is part-way through an answer, for the server's own quiet after its newest words only", () => {
    const voiceMidAnswerMs = 700_000;
    expect([
      pageRolloverHold({ ...FREE, nowMs: voiceMidAnswerMs + PLAN_CALL_LIMITS.rolloverQuietMs - 1, voiceMidAnswerMs }),
      pageRolloverHold({ ...FREE, nowMs: voiceMidAnswerMs + PLAN_CALL_LIMITS.rolloverQuietMs, voiceMidAnswerMs }),
    ]).toEqual(["the voice is part-way through an answer", undefined]);
  });

  it("holds for the server's own quiet after any of the owner's words, and not a millisecond longer", () => {
    const heardAtMs = 500_000;
    expect([
      pageRolloverHold({ ...FREE, heardAtMs, nowMs: heardAtMs + PLAN_CALL_LIMITS.rolloverQuietMs - 1 }),
      pageRolloverHold({ ...FREE, heardAtMs, nowMs: heardAtMs + PLAN_CALL_LIMITS.rolloverQuietMs }),
    ]).toEqual(["the owner's words are inside the rollover quiet", undefined]);
  });

  it("holds while a turn of the owner's is open, or one ended awaits the voice, for the bounded hold only", () => {
    const atMs = 400_000;
    expect([
      pageRolloverHold({ ...FREE, ownerOpenAtMs: atMs, nowMs: atMs + ROLLOVER_OWED_HOLD_MS - 1 }),
      pageRolloverHold({ ...FREE, ownerOpenAtMs: atMs, nowMs: atMs + ROLLOVER_OWED_HOLD_MS }),
      pageRolloverHold({ ...FREE, ownerAwaitingVoiceMs: atMs, nowMs: atMs + ROLLOVER_OWED_HOLD_MS - 1 }),
      pageRolloverHold({ ...FREE, ownerAwaitingVoiceMs: atMs, nowMs: atMs + ROLLOVER_OWED_HOLD_MS }),
    ]).toEqual(["the owner's turn is still open", undefined, "the owner's turn still awaits the voice", undefined]);
  });

  // A successor's mint reads the call it replaces from its file: one minted while the voice's answer was still queued
  // in the transcript sink was told an exchange ending on the owner's question.
  it("holds while the call's words are not on disk, for the bounded hold from when they fell behind only", () => {
    const sinceMs = 400_000;
    expect(
      (["calm", "urgent"] as const).flatMap((urgency) => [
        pageRolloverHold({ ...FREE, nowMs: sinceMs + ROLLOVER_OWED_HOLD_MS - 1, unwrittenSinceMs: sinceMs, urgency }),
        pageRolloverHold({ ...FREE, nowMs: sinceMs + ROLLOVER_OWED_HOLD_MS, unwrittenSinceMs: sinceMs, urgency }),
      ]),
    ).toEqual([UNWRITTEN_HOLD, undefined, UNWRITTEN_HOLD, undefined]);
  });
});

describe("unwrittenSinceAt", () => {
  it("starts on the first unwritten sample, keeps that instant while it stays unwritten, and clears once caught up", () => {
    const first = unwrittenSinceAt({ nowMs: 1_000, previousMs: undefined, unwritten: true });
    const kept = unwrittenSinceAt({ nowMs: 1_080, previousMs: first, unwritten: true });
    const cleared = unwrittenSinceAt({ nowMs: 1_160, previousMs: kept, unwritten: false });
    const again = unwrittenSinceAt({ nowMs: 1_240, previousMs: cleared, unwritten: true });
    expect([first, kept, cleared, again]).toEqual([1_000, 1_000, undefined, 1_240]);
  });
});

describe("pageRolloverHold, urgent and last", () => {
  const nowMs = 1_000_000;
  const recent = nowMs - 1_000;
  const at = ({ urgency, over }: { urgency: RolloverUrgency; over: object }): string | undefined =>
    pageRolloverHold({ ...FREE, ...over, nowMs, urgency });

  const each = ({ urgency }: { urgency: RolloverUrgency }): readonly (string | undefined)[] =>
    [
      { owedFromMs: recent },
      { ownerAwaitingVoiceMs: recent },
      { unwrittenSinceMs: recent },
      { heardAtMs: recent },
      { ownerOpenAtMs: recent },
      { inFlight: 1, progressingInFlight: 1 },
      { answerPendingMs: recent },
      { voiceMidAnswerMs: recent },
      { resumedAtMs: recent },
      { turn: { ...NO_TURN_TAKING, owner: stretch({ lastMs: nowMs - 200 }) } },
      { turn: { ...NO_TURN_TAKING, voice: stretch({ lastMs: nowMs - 200 }) } },
    ].map((over) => at({ over, urgency }));
  const voiceWork = [
    "work is in flight",
    "a completed answer is still pending",
    "the voice is part-way through an answer",
    "the voice was just prompted",
    "the owner's meter is not quiet",
    "the voice's meter is not quiet",
  ];

  it("holds for every turn when calm", () => {
    expect(each({ urgency: "calm" })).toEqual([
      "the voice still owes its turn",
      "the owner's turn still awaits the voice",
      UNWRITTEN_HOLD,
      "the owner's words are inside the rollover quiet",
      "the owner's turn is still open",
      ...voiceWork,
    ]);
  });

  // A successor opened on an owner's turn the voice never answered leaves that question with nobody; the voice's
  // next words clear the hold, so it never renews across a steady conversation the way the voice's own debt does.
  it("stops waiting on a turn the voice owes when urgent, and keeps the owner's unanswered turn and every other hold", () => {
    expect(each({ urgency: "urgent" })).toEqual([
      undefined,
      "the owner's turn still awaits the voice",
      UNWRITTEN_HOLD,
      "the owner's words are inside the rollover quiet",
      "the owner's turn is still open",
      ...voiceWork,
    ]);
  });

  // A pause inside an answer, or a turn about to complete, loses to an early rollover what the
  // lifetime would only take later. A breath inside the owner's turn can lose the rest of a sentence that would have ended
  // before the cut: the named trade, against a cut that lands mid-word.
  it("stops waiting on the owner's turn in the last stage too, and still holds for the voice's work and both meters", () => {
    expect(each({ urgency: "last" })).toEqual([undefined, undefined, undefined, undefined, undefined, ...voiceWork]);
  });

  // Renewed by every sound for the owed hold, a pending answer pinned the last stage to the cut.
  it("lets a pending answer go in the last stage after the server's quiet, however much the owner has talked since", () => {
    const answerPendingMs = nowMs - 60_000;
    const quiet = PLAN_CALL_LIMITS.rolloverQuietMs;
    const owner = { ...NO_TURN_TAKING, owner: stretch({ lastMs: nowMs - ROLLOVER_METER_QUIET_MS }) };
    const voice = { ...NO_TURN_TAKING, voice: stretch({ lastMs: nowMs - quiet + 1 }) };
    expect([
      at({ over: { answerPendingMs, turn: owner }, urgency: "urgent" }),
      at({ over: { answerPendingMs, turn: owner }, urgency: "last" }),
      at({ over: { answerPendingMs, turn: voice }, urgency: "last" }),
      at({ over: { answerPendingMs: nowMs - quiet + 1 }, urgency: "last" }),
    ]).toEqual([
      "a completed answer is still pending",
      undefined,
      "a completed answer is still pending",
      "a completed answer is still pending",
    ]);
  });

  // A four-second hold raised with less than four seconds left can only end after the cut, so a
  // pause inside it is lost and a word the voice begins later is cut by the lifetime instead. One ending AT the cut
  // leaves no meter sample to release on, so it must end a margin before it.
  it("holds the last stage for the voice's timed work only while that hold ends a margin before the cut, and for its sound always", () => {
    const endsInMs = recent + PLAN_CALL_LIMITS.rolloverQuietMs - nowMs;
    const last = ({ over, remainingMs }: { over: object; remainingMs: number }): string | undefined =>
      pageRolloverHold({ ...FREE, ...over, nowMs, remainingMs, urgency: "last" });
    const timedHolds = [{ completedAtMs: recent }, { answerPendingMs: recent }, { voiceMidAnswerMs: recent }];
    expect([
      endsInMs + ROLLOVER_CUT_SLACK_MS,
      ...timedHolds.flatMap((over) => [
        last({ over, remainingMs: endsInMs + ROLLOVER_CUT_SLACK_MS }),
        last({ over, remainingMs: endsInMs + ROLLOVER_CUT_SLACK_MS - 1 }),
      ]),
      last({ over: { turn: { ...NO_TURN_TAKING, voice: stretch({ lastMs: nowMs - 200 }) } }, remainingMs: 0 }),
    ]).toEqual([
      4_000,
      "the voice was just prompted",
      undefined,
      "a completed answer is still pending",
      undefined,
      "the voice is part-way through an answer",
      undefined,
      "the voice's meter is not quiet",
    ]);
  });

  // A row whose work had stopped, or one never marked stale, held every pause of the last stage
  // through the cut. Work holds there only while a row progresses and its answer could still hold the floor after it.
  it("holds the last stage for progressing work only while its answer's hold could still end in time, and never for stalled work", () => {
    const quiet = PLAN_CALL_LIMITS.rolloverQuietMs + ROLLOVER_CUT_SLACK_MS;
    const hold = ({ over, urgency }: { over: object; urgency: RolloverUrgency }): string | undefined =>
      pageRolloverHold({ ...FREE, ...over, nowMs, urgency });
    expect([
      hold({ over: { inFlight: 1, progressingInFlight: 1, remainingMs: quiet + 1 }, urgency: "last" }),
      hold({ over: { inFlight: 1, progressingInFlight: 1, remainingMs: quiet }, urgency: "last" }),
      hold({ over: { inFlight: 2, progressingInFlight: 0, remainingMs: 20_000 }, urgency: "last" }),
      hold({ over: { inFlight: 2, progressingInFlight: 1, remainingMs: 20_000 }, urgency: "last" }),
      hold({ over: { inFlight: 1, progressingInFlight: 0, remainingMs: 120_000 }, urgency: "urgent" }),
      hold({ over: { inFlight: 1, progressingInFlight: 0 }, urgency: "calm" }),
    ]).toEqual([
      "work is in flight",
      undefined,
      undefined,
      "work is in flight",
      "work is in flight",
      "work is in flight",
    ]);
  });
});
