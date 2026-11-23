/*
 * The page's rollover floor over folded turns and whole calls: the owner's turns hold it until the last stage, and
 * the calls cut at their lifetime roll over in the pause the last stage finds.
 */
import { describe, expect, it } from "vitest";

import { CONTEXT_URGENT_DETAIL, ROLLOVER_METER_QUIET_MS, ROLLOVER_OWED_HOLD_MS } from "../../lib/callRollover";
import { ROLLOVER_CUT_SLACK_MS } from "../../lib/callRolloverFloor";
import { PLAN_CALL_LIMITS } from "../../lib/planCallContract";
import { type ActivityInput, activityRows, END_SKEW_MS, foldActivity, NO_ACTIVITY } from "../../lib/voiceActivity";
import { ownerOpenAtOf } from "../../lib/voiceOwnerTurns";
import { NO_TURN_TAKING, type TurnTaking } from "../../lib/voiceTurnTaking";
import { ask, folded, holdOf, recording, SWAP, said, stretch, TYPED } from "./callRolloverFloor/harness";

describe("the page's rollover floor over the owner's turns", () => {
  // Measured on one call: the context rollover was asked on a free floor, the owner began a 72s turn about a second
  // later, and the held ask went ahead 72.6s after it began, on a second of meter quiet inside it. Replayed on offsets from the voice's
  // first word, the owner's segments at the 4s cadence the call file shows. Repro:
  // `grep -n -E '<hh>:1[6-8]:' $SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl | tail -n 30`, with `<hh>` the turn's hour.
  it("does not roll over on a breath inside a long turn of the owner's that began after the server asked", () => {
    const script: (readonly [number, ActivityInput])[] = [
      [0, { kind: "spoke" }],
      [9_151, { asked: true, kind: "voice-finished", promised: false }],
    ];
    for (let atMs = 14_550; atMs <= 87_102; atMs += 4_000) {
      script.push(
        [atMs, { kind: "heard", text: " and more" }],
        [atMs, said({ final: false, id: "turn_000000000000000000026" })],
      );
    }
    const activity = folded({ script });
    const lastSegment = ownerOpenAtOf({ turns: activity.owner })!;
    const held = recording();
    const { did, rollover } = held;
    ask({ atMs: 0, held, lifetimeRemainingMs: null });
    const sample = ({ nowMs }: { nowMs: number }): readonly string[] => {
      rollover.observed({ hold: holdOf({ activity, nowMs }), nowMs });
      return did.filter((line) => !line.startsWith("journal: "));
    };
    // Past the transcript quiet, which a pause inside a long turn can reach, only the owner's open turn holds it.
    const turnIgnored = holdOf({
      activity: { ...activity, owner: { ...activity.owner, open: new Map() } },
      nowMs: lastSegment + PLAN_CALL_LIMITS.rolloverQuietMs,
    });
    expect([lastSegment, turnIgnored]).toEqual([86_550, undefined]);
    expect([
      sample({ nowMs: lastSegment + ROLLOVER_METER_QUIET_MS }),
      sample({ nowMs: lastSegment + PLAN_CALL_LIMITS.rolloverQuietMs }),
      sample({ nowMs: lastSegment + ROLLOVER_OWED_HOLD_MS - 1 }),
      sample({ nowMs: lastSegment + ROLLOVER_OWED_HOLD_MS }),
    ]).toEqual([[], [], [], SWAP]);
  });

  // A final of the voice's turn the owner barged into lands after their words began, and is no answer.
  it("does not read a late final of the voice's interrupted turn as an answer to the words that cut it off", () => {
    const activity = folded({
      script: [
        [0, { kind: "spoke" }],
        [1_000, { kind: "heard", text: "wait" }],
        [1_000, said({ final: false, id: "owner-1" })],
        [1_100, { asked: false, kind: "voice-finished", promised: false }],
        [1_400, said({ final: true, id: "owner-1" })],
      ],
    });
    // Ordered by timestamp alone, 1,100 >= 1,000 read the owner's words as answered and freed the floor at 5,000.
    const answered = foldActivity({ activity, input: { kind: "spoke" }, nowMs: 6_000 });
    expect([holdOf({ activity, nowMs: 5_000 }), holdOf({ activity: answered, nowMs: 10_000 })]).toEqual([
      "the owner's turn still awaits the voice",
      undefined,
    ]);
  });

  // One unkeyed slot let a typed turn, answered, close a spoken turn of the owner's still open.
  it("keeps a spoken turn of the owner's open across a typed one, and across another turn's final", () => {
    const opened = folded({
      script: [
        [1_000, { kind: "heard", text: "so the" }],
        [1_000, said({ final: false, id: "owner-1" })],
        [1_500, { kind: "heard", text: "typed", typed: true }],
        [1_500, TYPED],
        [1_600, { kind: "spoke" }],
      ],
    });
    // The fold gets exactly what `typedInHandler` sends, so the typed words leave the last transcribed instant at the
    // spoken ones.
    expect(opened.lastTranscribedMs).toBe(1_000);
    const otherFinal = foldActivity({ activity: opened, input: said({ final: true, id: "owner-0" }), nowMs: 1_700 });
    const closed = foldActivity({ activity: opened, input: said({ final: true, id: "owner-1" }), nowMs: 1_700 });
    const quiet = 1_500 + PLAN_CALL_LIMITS.rolloverQuietMs;
    expect([
      ownerOpenAtOf({ turns: opened.owner }),
      holdOf({ activity: opened, nowMs: quiet }),
      holdOf({ activity: otherFinal, nowMs: quiet + 200 }),
      holdOf({ activity: opened, nowMs: 1_500 + ROLLOVER_OWED_HOLD_MS }),
      ownerOpenAtOf({ turns: closed.owner }),
    ]).toEqual([1_000, "the owner's turn is still open", "the owner's turn is still open", undefined, undefined]);
  });

  // A typed turn comes over the server's stream and the voice's words over the
  // session's, so words said before it can land just after it; only words END_SKEW_MS past it answer it.
  it("answers a typed turn of the owner's only with the voice's words past the streams' skew", () => {
    const typed = folded({
      script: [
        [3_000, { kind: "heard", text: "typed", typed: true }],
        [3_000, TYPED],
      ],
    });
    const early = foldActivity({ activity: typed, input: { kind: "spoke" }, nowMs: 3_000 + END_SKEW_MS - 1 });
    const late = foldActivity({ activity: early, input: { kind: "spoke" }, nowMs: 3_000 + END_SKEW_MS });
    expect([early.owner.awaiting, late.owner.awaiting, holdOf({ activity: early, nowMs: 3_000 + 10_000 })]).toEqual([
      { answerFromMs: 3_000 + END_SKEW_MS, sinceMs: 3_000 },
      undefined,
      "the owner's turn still awaits the voice",
    ]);
  });

  it("reads the newest open turn of the owner's, so a turn whose final never came cannot age a growing one out", () => {
    const activity = folded({
      script: [
        [0, said({ final: false, id: "owner-dropped" })],
        [80_000, said({ final: false, id: "owner-2" })],
      ],
    });
    expect([
      ownerOpenAtOf({ turns: activity.owner }),
      ownerOpenAtOf({ turns: NO_ACTIVITY.owner }),
      holdOf({ activity, nowMs: ROLLOVER_OWED_HOLD_MS }),
    ]).toEqual([80_000, undefined, "the owner's turn is still open"]);
  });
});

describe("the page's rollover floor over a call reaching its lifetime", () => {
  // Measured on one call: the voice's last final landed with the lifetime's cut 13.3s away, the owner began again 11s
  // later, and the cut landed mid-word 2.3s after that — every pause since the ask, about eight minutes before the
  // final, having fallen inside a 90s hold. Replayed with the voice's final as zero: the
  // ask is already in its last stage, so the voice's meter going quiet for a second frees the floor whatever turn is
  // owed. Repro: `grep -n -e '"kind":"closed"' -e '"final":true' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl | tail -n 12`.
  it("rolls a call over a second after the voice's last words, eleven seconds before the owner speaks again", () => {
    const activity = folded({
      script: [
        [-20_000, { kind: "spoke" }],
        [0, { asked: true, kind: "voice-finished", promised: false }],
      ],
    });
    const voiceAt: TurnTaking = { ...activity.turn, voice: stretch({ lastMs: 0 }) };
    const atLast = { ...activity, turn: voiceAt };
    const held = recording();
    const { did, rollover } = held;
    // Asked while the cut was far, then again as the server's urgent window opened, 180s before the cut at 13s.
    ask({ atMs: -480_000, held, lifetimeRemainingMs: null });
    ask({
      atMs: 13_000 - PLAN_CALL_LIMITS.rolloverUrgentMs,
      held,
      lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverUrgentMs,
    });
    const sample = ({ nowMs }: { nowMs: number }): void => {
      const stage = rollover.stage({ nowMs })!;
      rollover.observed({ hold: holdOf({ activity: atLast, nowMs, owedFromMs: 0, stage }), nowMs });
    };
    sample({ nowMs: 0 });
    sample({ nowMs: ROLLOVER_METER_QUIET_MS - 1 });
    const calmAtTheSamePause = holdOf({ activity: atLast, nowMs: ROLLOVER_METER_QUIET_MS, owedFromMs: 0 });
    sample({ nowMs: ROLLOVER_METER_QUIET_MS });
    expect(calmAtTheSamePause).toBe("the voice still owes its turn");
    expect(did).toEqual([
      "journal: ask received",
      "journal: ask received: 180 seconds remain",
      "journal: entered last: 13 seconds remain",
      "journal: held: the voice's meter is not quiet",
      "journal: released in a meter pause (last)",
      ...SWAP,
    ]);
  });

  // The same call with an answer still pending and the owner talking on into the last stage. Renewed by their sound
  // for 90s, the pending hold outlived the cut 13s away; sampled every 80ms, as the meter loop does.
  it("rolls the same call over in the owner's first pause though an answer is pending and they talked through the last stage", () => {
    const activity = folded({
      script: [
        [-20_000, { kind: "spoke" }],
        [0, { asked: true, kind: "voice-finished", promised: false }],
      ],
    });
    const pending = { ...activity, plan: { ...activity.plan, answerPendingMs: -60_000 } };
    const held = recording();
    const { did, rollover } = held;
    ask({ atMs: -167_000, held, lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverUrgentMs });
    let releasedAtMs: number | undefined;
    for (let nowMs = 0; nowMs < 13_000 && releasedAtMs === undefined; nowMs += 80) {
      const turn = {
        ...NO_TURN_TAKING,
        owner: stretch({ lastMs: Math.min(nowMs, 5_000) }),
        voice: stretch({ lastMs: 0 }),
      };
      const stage = rollover.stage({ nowMs })!;
      rollover.observed({ hold: holdOf({ activity: { ...pending, turn }, nowMs, owedFromMs: 0, stage }), nowMs });
      releasedAtMs = did.includes("open") ? nowMs : undefined;
    }
    expect([releasedAtMs, did]).toEqual([
      5_000 + ROLLOVER_METER_QUIET_MS,
      [
        "journal: ask received: 180 seconds remain",
        "journal: entered last: 13 seconds remain",
        "journal: held: a completed answer is still pending",
        "journal: held: the owner's meter is not quiet",
        "journal: released in a meter pause (last)",
        ...SWAP,
      ],
    ]);
  });

  // A tool call whose answer never came stays a row, stalled but never closed, and the Codex turn
  // waiting on it never shows stalled at all; together they held every pause of the last stage, so the voice speaking
  // again just before the cut was cut mid-word.
  it("rolls over on the voice's quiet in the last stage though a stalled tool call and the turn it blocks are still rows", () => {
    const activity = folded({
      script: [
        [-61_000, { kind: "codex-turn", phase: "started", turnId: "turn-1" }],
        [-60_000, { callId: "call-stuck", kind: "tool-started", name: "lookup" }],
        [-20_000, { kind: "spoke" }],
        [0, { asked: true, kind: "voice-finished", promised: false }],
      ],
    });
    const stuck = { ...activity, turn: { ...NO_TURN_TAKING, voice: stretch({ lastMs: 0 }) } };
    const held = recording();
    const { did, rollover } = held;
    ask({
      atMs: 13_000 - PLAN_CALL_LIMITS.rolloverUrgentMs,
      held,
      lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverUrgentMs,
    });
    let releasedAtMs: number | undefined;
    for (let nowMs = 0; nowMs < 13_000 && releasedAtMs === undefined; nowMs += 80) {
      const stage = rollover.stage({ nowMs })!;
      rollover.observed({ hold: holdOf({ activity: stuck, nowMs, stage }), nowMs });
      releasedAtMs = did.includes("open") ? nowMs : undefined;
    }
    const calmAtTheSamePause = holdOf({ activity: stuck, nowMs: 1_040 });
    const rows = activityRows({ activity: stuck, nowMs: 1_040 }).map((row) => [row.key, row.stale]);
    expect([releasedAtMs, calmAtTheSamePause, rows, did]).toEqual([
      1_040,
      "work is in flight",
      [
        ["t:call-stuck", true],
        ["c:turn-1", false],
      ],
      [
        "journal: ask received: 180 seconds remain",
        "journal: entered last: 13 seconds remain",
        "journal: held: the voice's meter is not quiet",
        "journal: released in a meter pause (last)",
        ...SWAP,
      ],
    ]);
  });

  // No row says which turn a tool is for, so a rule that took every turn to be blocked on a
  // stalled tool let a rollover end an unrelated turn still moving, and its answer with it.
  it("holds the last stage for a concurrent turn still moving beside a stalled tool, until its answer could no longer hold", () => {
    const activity = folded({
      script: [
        [-61_000, { kind: "codex-turn", phase: "started", turnId: "blocked" }],
        [-60_000, { callId: "call-stuck", kind: "tool-started", name: "lookup" }],
        [-30_000, { kind: "codex-turn", phase: "started", turnId: "moving" }],
        [-1_000, { kind: "codex-turn", phase: "progress", step: null, turnId: "moving" }],
        [-20_000, { kind: "spoke" }],
        [0, { asked: true, kind: "voice-finished", promised: false }],
      ],
    });
    const both = { ...activity, turn: { ...NO_TURN_TAKING, voice: stretch({ lastMs: 0 }) } };
    const held = recording();
    const { did, rollover } = held;
    ask({
      atMs: 13_000 - PLAN_CALL_LIMITS.rolloverUrgentMs,
      held,
      lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverUrgentMs,
    });
    let releasedAtMs: number | undefined;
    for (let nowMs = 0; nowMs < 13_000 && releasedAtMs === undefined; nowMs += 80) {
      const stage = rollover.stage({ nowMs })!;
      rollover.observed({ hold: holdOf({ activity: both, nowMs, stage }), nowMs });
      releasedAtMs = did.includes("open") ? nowMs : undefined;
    }
    // Five seconds before the cut: the server's quiet for its answer, and the second's margin before the cut.
    expect([releasedAtMs, did]).toEqual([
      13_000 - ROLLOVER_CUT_SLACK_MS - PLAN_CALL_LIMITS.rolloverQuietMs,
      [
        "journal: ask received: 180 seconds remain",
        "journal: entered last: 13 seconds remain",
        "journal: held: work is in flight",
        "journal: released in a meter pause (last)",
        ...SWAP,
      ],
    ]);
  });

  // A Codex turn completing 3.2s before the cut held the floor to 0.8s past it, so the voice
  // starting its answer 0.4s before the cut was cut mid-word. The voice's meter is the witness that holds now.
  it("rolls over on the voice's quiet after a completion too near the cut for its hold to end first", () => {
    const activity = folded({
      script: [
        [-20_000, { kind: "spoke" }],
        [0, { asked: true, kind: "voice-finished", promised: false }],
      ],
    });
    const completedAtMs = 13_000 - 3_200;
    const near = {
      ...activity,
      plan: { ...activity.plan, lastCompletedMs: completedAtMs },
      turn: { ...NO_TURN_TAKING, voice: stretch({ lastMs: completedAtMs }) },
    };
    const held = recording();
    const { did, rollover } = held;
    ask({
      atMs: 13_000 - PLAN_CALL_LIMITS.rolloverUrgentMs,
      held,
      lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverUrgentMs,
    });
    let releasedAtMs: number | undefined;
    for (let nowMs = completedAtMs; nowMs < 13_000 && releasedAtMs === undefined; nowMs += 80) {
      const stage = rollover.stage({ nowMs })!;
      rollover.observed({ hold: holdOf({ activity: near, nowMs, stage }), nowMs });
      releasedAtMs = did.includes("open") ? nowMs : undefined;
    }
    const unbounded = holdOf({ activity: near, nowMs: 10_840, stage: { remainingMs: undefined, urgency: "last" } });
    // The first 80ms sample a full second past the voice's last sound.
    expect([releasedAtMs, unbounded, did]).toEqual([
      10_840,
      "the voice was just prompted",
      [
        "journal: ask received: 180 seconds remain",
        "journal: entered last: 4 seconds remain",
        "journal: held: the voice's meter is not quiet",
        "journal: released in a meter pause (last)",
        ...SWAP,
      ],
    ]);
  });
});

describe("the page's rollover floor over a thread nearly full", () => {
  // Measured on one call: the context ask was held at calm for six minutes before the voice's final; from that final
  // the owner said nothing for 52.8s, and only "the voice still owes its turn" held it. The thread had passed 88% 18s
  // before the ask was held, where the server now asks at once, marked urgent; replayed with that final as zero, the
  // pause frees the floor once the voice's meter is quiet, 51s before the owner spoke and the turn that compacted
  // began. Repro: `grep -n -e '<final-hh:mm>:0[0-9]' -e '<next-hh:mm:ss>' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`,
  // with the minute of the voice's final and the second of the owner's next words.
  it("rolls a call over in the pause its calm ask let pass, once the context made the ask urgent", () => {
    const activity = folded({
      script: [
        [-9_426, { kind: "spoke" }],
        [0, { asked: true, kind: "voice-finished", promised: false }],
      ],
    });
    const quietVoice = { ...activity, turn: { ...activity.turn, voice: stretch({ lastMs: 0 }) } };
    const held = recording();
    const { did, rollover } = held;
    ask({ atMs: -387_442, contextUrgent: true, held, lifetimeRemainingMs: null });
    const sample = ({ nowMs }: { nowMs: number }): void => {
      const stage = rollover.stage({ nowMs })!;
      rollover.observed({ hold: holdOf({ activity: quietVoice, nowMs, owedFromMs: 0, stage }), nowMs });
    };
    const calmAtTheSamePause = holdOf({ activity: quietVoice, nowMs: 52_000, owedFromMs: 0 });
    sample({ nowMs: ROLLOVER_METER_QUIET_MS - 1 });
    sample({ nowMs: ROLLOVER_METER_QUIET_MS });
    expect(calmAtTheSamePause).toBe("the voice still owes its turn");
    expect(did).toEqual([
      "journal: ask received",
      `journal: ${CONTEXT_URGENT_DETAIL}`,
      "journal: held: the voice's meter is not quiet",
      "journal: released in a meter pause (urgent)",
      ...SWAP,
    ]);
  });
});
