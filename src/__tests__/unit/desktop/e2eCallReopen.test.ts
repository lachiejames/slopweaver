/*
 * `call-reopen`'s witness over three real calls: a silent reopen hands the reminder at three seconds measured, naming
 * the call before it, and the voice speaks; a reopen the owner speaks into gives way inside the three seconds and never hands.
 */
import { describe, expect, it } from "vitest";

import { judgeCallScenario } from "../../../desktop/e2eCallOutcome.js";
import { HAND_SLACK_MS, reopenWitnessOf } from "../../../desktop/e2eCallReopen.js";
import { callRequirementsOf } from "../../../desktop/e2eCallRequirements.js";
import type { CallRecord, CallSegment } from "../../../talk/callRecord.js";
import type { CallToolNote } from "../../../talk/callToolLine.js";
import { CLEAN } from "./e2eCallObservedFixture.js";

const A = "1a2b3c4d-5e6f-4a7b-9c8d-000000000001";
const B = "1a2b3c4d-5e6f-4a7b-9c8d-000000000002";
const C = "1a2b3c4d-5e6f-4a7b-9c8d-000000000003";

/** One final segment at an instant. */
const segment = ({ atIso, who }: { atIso: string; who: "owner" | "voice" }): CallSegment => ({
  atIso,
  beganIso: atIso,
  final: true,
  id: `s-${atIso}`,
  open: undefined,
  text: who === "owner" ? "Hello." : "So, where we were: the staging pool.",
  who,
});

/** One reopen step's tool line. */
const step = ({
  atIso,
  elapsed,
  phase,
  previous,
  windowMs = 3000,
}: {
  atIso: string;
  elapsed: number;
  phase: "armed" | "handed" | "gave-way" | "failed";
  previous: string;
  windowMs?: number;
}): CallToolNote => ({
  answer: undefined,
  atIso,
  detail: `reopen reminder ${phase}`,
  kind: "tool",
  name: "reopen-reminder",
  opened: undefined,
  refused: phase === "failed",
  reopenReminder: { elapsedSinceArmedMs: elapsed, phase, previousCallId: previous, windowMs },
});

/** One call with its notes and segments. */
const call = ({
  callId,
  notes = [],
  segments,
}: {
  callId: string;
  notes?: CallRecord["notes"];
  segments: readonly CallSegment[];
}): CallRecord => ({
  callId,
  ended: { atIso: "2026-11-06T01:12:00.000Z", why: null },
  lastIso: "2026-11-06T01:11:59.000Z",
  notes: [...notes],
  offers: [],
  openedIso: "2026-11-06T01:10:00.000Z",
  origin: undefined,
  reconnects: [],
  segments: [...segments],
  sessionId: "sess_1",
  skipped: 0,
  surface: "voice",
  usages: [],
  voice: "marin",
  written: [],
});

const first = call({ callId: A, segments: [segment({ atIso: "2026-11-06T01:10:05.000Z", who: "owner" })] });
const silent = ({
  elapsed = 3040,
  voiceAt = "2026-11-06T01:11:06.000Z",
}: { elapsed?: number; voiceAt?: string } = {}) =>
  call({
    callId: B,
    notes: [
      step({ atIso: "2026-11-06T01:11:00.000Z", elapsed: 0, phase: "armed", previous: A }),
      step({ atIso: "2026-11-06T01:11:03.040Z", elapsed, phase: "handed", previous: A }),
    ],
    segments: [segment({ atIso: voiceAt, who: "voice" })],
  });
const spoken = ({ phase = "gave-way", elapsed = 640 }: { phase?: "gave-way" | "handed"; elapsed?: number } = {}) =>
  call({
    callId: C,
    notes: [
      step({ atIso: "2026-11-06T01:12:00.000Z", elapsed: 0, phase: "armed", previous: B }),
      step({ atIso: "2026-11-06T01:12:00.640Z", elapsed, phase, previous: B }),
    ],
    segments: [segment({ atIso: "2026-11-06T01:12:01.000Z", who: "owner" })],
  });

describe("reopenWitnessOf", () => {
  it("holds the ruling, and reports the three seconds measured on the silent reopen", () => {
    expect(reopenWitnessOf({ calls: [first, silent(), spoken()] })).toEqual({
      callIds: [A, B, C],
      gaveWayElapsedMs: 640,
      handedElapsedMs: 3040,
      held: true,
      problem: undefined,
      windowMs: 3000,
    });
  });

  it("accepts a handing at the window and at its slack, and refuses one a millisecond either side", () => {
    const problems = [2999, 3000, 3000 + HAND_SLACK_MS, 3001 + HAND_SLACK_MS].map(
      (elapsed) => reopenWitnessOf({ calls: [first, silent({ elapsed }), spoken()] }).problem,
    );
    expect(problems).toEqual([
      "the silent reopen handed the reminder 2999 ms after arming, outside [3000, 5000] ms",
      undefined,
      undefined,
      "the silent reopen handed the reminder 5001 ms after arming, outside [3000, 5000] ms",
    ]);
  });

  // Voice speech begun before the handing is a greeting, read off the call file alone.
  it("fails a silent reopen the voice greeted before the handing, and one it never spoke in", () => {
    const mute = call({ callId: B, notes: silent().notes, segments: [] });
    expect([
      reopenWitnessOf({ calls: [first, silent({ voiceAt: "2026-11-06T01:11:02.000Z" }), spoken()] }).problem,
      reopenWitnessOf({ calls: [first, mute, spoken()] }).problem,
    ]).toEqual([
      `the silent reopen ${B} heard the voice before it handed the reminder, a greeting`,
      `the silent reopen ${B} handed the reminder, and the voice said nothing final after it`,
    ]);
  });

  it("fails a reopen minted past the minute, which logged no reopen step at all", () => {
    const late = call({ callId: B, segments: [segment({ atIso: "2026-11-06T01:11:06.000Z", who: "voice" })] });
    expect(reopenWitnessOf({ calls: [first, late, spoken()] }).problem).toBe(
      `the silent reopen ${B} logged reopen steps [none], not [armed, handed]`,
    );
  });

  it("fails a reopen the owner spoke into that handed anyway, or gave way only after the window", () => {
    expect([
      reopenWitnessOf({ calls: [first, silent(), spoken({ elapsed: 3010, phase: "handed" })] }).problem,
      reopenWitnessOf({ calls: [first, silent(), spoken({ elapsed: 3000 })] }).problem,
    ]).toEqual([
      `the reopen the owner spoke into ${C} logged reopen steps [armed, handed], not [armed, gave-way]`,
      "the spoken reopen gave way 3000 ms after arming, not inside its 3000 ms",
    ]);
  });

  // A gave-way step is not the owner's speech, so the owner's words must begin inside the window.
  it("fails a spoken reopen whose own words began late, at the window, never, or after the voice's", () => {
    const heard = ({ segments }: { segments: readonly CallSegment[] }) =>
      reopenWitnessOf({ calls: [first, silent(), call({ callId: C, notes: spoken().notes, segments })] }).problem;
    expect([
      heard({ segments: [segment({ atIso: "2026-11-06T01:12:10.000Z", who: "owner" })] }),
      heard({ segments: [segment({ atIso: "2026-11-06T01:12:03.000Z", who: "owner" })] }),
      heard({ segments: [segment({ atIso: "2026-11-06T01:12:02.999Z", who: "owner" })] }),
      heard({ segments: [] }),
      heard({
        segments: [
          segment({ atIso: "2026-11-06T01:12:00.200Z", who: "voice" }),
          segment({ atIso: "2026-11-06T01:12:01.000Z", who: "owner" }),
        ],
      }),
    ]).toEqual([
      `the spoken reopen ${C} heard the owner begin 10000 ms after arming, not inside its 3000 ms`,
      `the spoken reopen ${C} heard the owner begin 3000 ms after arming, not inside its 3000 ms`,
      undefined,
      `the spoken reopen ${C} heard the owner begin never, not inside its 3000 ms`,
      `the spoken reopen ${C} heard the voice before the owner's own opening, a reminder spoken over them`,
    ]);
  });

  it("fails a step naming any call but the one before it", () => {
    const misnamed = call({
      callId: C,
      notes: [
        step({ atIso: "2026-11-06T01:12:00.000Z", elapsed: 0, phase: "armed", previous: A }),
        step({ atIso: "2026-11-06T01:12:00.640Z", elapsed: 640, phase: "gave-way", previous: A }),
      ],
      segments: [],
    });
    expect(reopenWitnessOf({ calls: [first, silent(), misnamed] }).problem).toBe(
      `the spoken reopen's armed step names ${A}, not the call before it, ${B}`,
    );
  });

  // Each terminal step is judged against the arming's window too, never against its own window alone.
  it("fails a step carrying any window but the ruled three seconds, the arming's or the terminal's", () => {
    const armedLong = call({
      callId: B,
      notes: [
        step({ atIso: "2026-11-06T01:11:00.000Z", elapsed: 0, phase: "armed", previous: A, windowMs: 5000 }),
        step({ atIso: "2026-11-06T01:11:03.040Z", elapsed: 3040, phase: "handed", previous: A }),
      ],
      segments: [segment({ atIso: "2026-11-06T01:11:06.000Z", who: "voice" })],
    });
    const gaveLong = call({
      callId: C,
      notes: [
        step({ atIso: "2026-11-06T01:12:00.000Z", elapsed: 0, phase: "armed", previous: B }),
        step({ atIso: "2026-11-06T01:12:02.000Z", elapsed: 2000, phase: "gave-way", previous: B, windowMs: 1000 }),
      ],
      segments: [],
    });
    expect([
      reopenWitnessOf({ calls: [first, armedLong, spoken()] }).problem,
      reopenWitnessOf({ calls: [first, silent(), gaveLong] }).problem,
    ]).toEqual([
      "the silent reopen's armed step carries a 5000 ms window, not the ruled 3000 ms",
      "the spoken reopen's gave-way step carries a 1000 ms window, not the ruled 3000 ms",
    ]);
  });

  it("fails fewer than three calls, a first call that was itself a reopen, and a first call with no line", () => {
    const reopenedFirst = call({
      callId: A,
      notes: [step({ atIso: "2026-11-06T01:10:01.000Z", elapsed: 0, phase: "armed", previous: C })],
      segments: first.segments,
    });
    expect([
      reopenWitnessOf({ calls: [first, silent()] }).problem,
      reopenWitnessOf({ calls: [reopenedFirst, silent(), spoken()] }).problem,
      reopenWitnessOf({ calls: [call({ callId: A, segments: [] }), silent(), spoken()] }).problem,
    ]).toEqual([
      "the scenario wrote 2 call(s), not the three A, B and C",
      `the first call ${A} was itself a reopen: [armed]`,
      `the first call ${A} wrote no line, so nothing could be reopened onto`,
    ]);
  });
});

describe("judgeCallScenario on call-reopen", () => {
  it("is judged on the owner's turn and the reopen witness over three plan calls", () => {
    expect(callRequirementsOf({ id: "call-reopen" })).toEqual({
      cardNext: false,
      cardRead: false,
      crash: false,
      greeting: false,
      heap: false,
      ownerTurn: true,
      longTask: false,
      planCalls: 3,
      queueSearch: false,
      readingHold: false,
      reopen: true,
      voiceAnswer: false,
    });
  });

  it("passes a held witness, fails a broken one with its problem, and fails one never read", () => {
    const held = reopenWitnessOf({ calls: [first, silent(), spoken()] });
    const broken = reopenWitnessOf({ calls: [first, silent({ elapsed: 2000 })] });
    expect([
      judgeCallScenario({ id: "call-reopen", observed: { ...CLEAN, evidence: { ...CLEAN.evidence, reopen: held } } }),
      judgeCallScenario({ id: "call-reopen", observed: { ...CLEAN, evidence: { ...CLEAN.evidence, reopen: broken } } }),
      judgeCallScenario({ id: "call-reopen", observed: CLEAN }),
    ]).toEqual([
      { passed: true },
      { detail: "the scenario wrote 2 call(s), not the three A, B and C", kind: "reopen-not-held", passed: false },
      { detail: "the three calls' reopen steps were never read", kind: "evidence-missing", passed: false },
    ]);
  });

  it("never judges the witness on another scenario", () => {
    const broken = reopenWitnessOf({ calls: [] });
    expect(
      judgeCallScenario({ id: "call-live", observed: { ...CLEAN, evidence: { ...CLEAN.evidence, reopen: broken } } }),
    ).toEqual({ passed: true });
  });
});
