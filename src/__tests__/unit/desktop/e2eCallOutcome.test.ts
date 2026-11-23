import { describe, expect, it } from "vitest";

import {
  CRASH_SENTENCE_START,
  type E2eCrashedCall,
  judgeConnectingCrash,
  judgeCrashEvidence,
  judgeSecondCrash,
} from "../../../desktop/e2eCallCrash.js";
import type { E2eDesktopEvent, E2ePlanCallLogEvent } from "../../../desktop/e2eCallEvidence.js";
import {
  type E2eCallDriveSeen,
  type E2eCallEvidence,
  type E2eCallObserved,
  judgeCallScenario,
  NO_CALL_EVIDENCE,
  observedOf,
} from "../../../desktop/e2eCallOutcome.js";
import { callRequirementsOf, planCallOverlap } from "../../../desktop/e2eCallRequirements.js";
import { type E2eVerdict, failed } from "../../../desktop/e2eOutcome.js";
import { CLEAN } from "./e2eCallObservedFixture.js";

describe("judgeCallScenario on queue-search", () => {
  const searched = ({ answer }: { answer: "FOUND" | "NONE" | "FAILED" | undefined }): E2eCallObserved => ({
    ...CLEAN,
    queueSearch: { answer, toolCallIds: ["t1"] },
  });

  it("passes FOUND and NONE alike once the search ran on its call", () => {
    expect([
      judgeCallScenario({ id: "queue-search", observed: searched({ answer: "FOUND" }) }),
      judgeCallScenario({ id: "queue-search", observed: searched({ answer: "NONE" }) }),
    ]).toEqual([{ passed: true }, { passed: true }]);
  });

  it("fails a search the voice said FAILED, and an answer with no terminal word", () => {
    expect([
      judgeCallScenario({ id: "queue-search", observed: searched({ answer: "FAILED" }) }),
      judgeCallScenario({ id: "queue-search", observed: searched({ answer: undefined }) }),
    ]).toEqual([
      { detail: "the voice said the Queue search FAILED", kind: "queue-search-failed", passed: false },
      {
        detail: "the voice's last row after the typed question was not the one word FOUND or NONE",
        kind: "queue-search-failed",
        passed: false,
      },
    ]);
  });

  it("fails a FOUND with no find-card run on its call: the voice answered without searching", () => {
    const observed = { ...CLEAN, queueSearch: { answer: "FOUND" as const, toolCallIds: [] } };
    expect(judgeCallScenario({ id: "queue-search", observed })).toEqual({
      detail: "the voice said FOUND with no successful talk find-card run on its call",
      kind: "queue-search-failed",
      passed: false,
    });
  });

  it("fails a missing answer before it reads the search", () => {
    expect(
      judgeCallScenario({ id: "queue-search", observed: { ...searched({ answer: "FAILED" }), voiceAnswer: false } }),
    ).toEqual({
      detail: "no final voice row followed the owner's",
      kind: "answer-missing",
      passed: false,
    });
  });

  it("judges the search on queue-search only", () => {
    expect([
      callRequirementsOf({ id: "queue-search" }),
      judgeCallScenario({ id: "call-live", observed: searched({ answer: "FAILED" }) }),
    ]).toEqual([
      {
        cardNext: false,
        cardRead: false,
        crash: false,
        greeting: false,
        heap: false,
        ownerTurn: true,
        longTask: false,
        planCalls: 1,
        queueSearch: true,
        readingHold: false,
        reopen: false,
        voiceAnswer: true,
      },
      { passed: true },
    ]);
  });
});

describe("judgeCallScenario on card-read", () => {
  const witnessed = ({ callIds }: { callIds: readonly string[] }): E2eCallObserved => ({
    ...CLEAN,
    evidence: { ...CLEAN.evidence, cardReadWitnessCallIds: callIds },
  });

  it("is judged on the owner's turn, an answer and the witness", () => {
    expect(callRequirementsOf({ id: "card-read" })).toEqual({
      cardNext: false,
      cardRead: true,
      crash: false,
      greeting: false,
      heap: false,
      ownerTurn: true,
      longTask: false,
      planCalls: 1,
      queueSearch: false,
      readingHold: false,
      reopen: false,
      voiceAnswer: true,
    });
  });

  it("passes once one call holds the whole ordered witness", () => {
    expect(judgeCallScenario({ id: "card-read", observed: witnessed({ callIds: ["t1"] }) })).toEqual({ passed: true });
  });

  it("fails when no call holds it", () => {
    expect(judgeCallScenario({ id: "card-read", observed: witnessed({ callIds: [] }) })).toEqual({
      detail:
        "no call of this scenario holds the named card read or opened, an answer, the typed challenge, the card read " +
        "or opened again and an answer, in that order",
      kind: "evidence-missing",
      passed: false,
    });
  });

  it("names a missing answer before the witness", () => {
    const observed = { ...witnessed({ callIds: [] }), voiceAnswer: false };
    expect(judgeCallScenario({ id: "card-read", observed })).toEqual({
      detail: "no final voice row followed the owner's",
      kind: "answer-missing",
      passed: false,
    });
  });

  it("judges the witness on card-read only", () => {
    expect(judgeCallScenario({ id: "call-live", observed: witnessed({ callIds: [] }) })).toEqual({ passed: true });
  });
});

describe("judgeCallScenario", () => {
  it("passes a call that went live, heard the owner and answered", () => {
    expect(judgeCallScenario({ id: "call-live", observed: CLEAN })).toEqual({ passed: true });
  });

  it("fails on a cleanup failure before anything else, keeping a block beside it", () => {
    const observed = { ...CLEAN, blocked: "no talk", cleanup: "lease still live", live: false };
    expect([
      judgeCallScenario({ id: "call-live", observed }),
      judgeCallScenario({ id: "call-live", observed: { ...observed, blocked: undefined } }),
    ]).toEqual([
      { detail: "lease still live; no talk", kind: "cleanup-failed", passed: false },
      { detail: "lease still live", kind: "cleanup-failed", passed: false },
    ]);
  });

  it("fails a call that never went live", () => {
    expect(judgeCallScenario({ id: "call-live", observed: { ...CLEAN, live: false } })).toEqual({
      detail: "the call never showed its mute control",
      kind: "call-not-live",
      passed: false,
    });
  });

  it("fails a page error after a drop is ruled out", () => {
    const evidence = { ...NO_CALL_EVIDENCE, pageErrors: ["http://localhost:3000/voice: boom"] };
    expect(judgeCallScenario({ id: "call-live", observed: { ...CLEAN, evidence } })).toEqual({
      detail: "http://localhost:3000/voice: boom",
      kind: "page-error",
      passed: false,
    });
  });

  it("fails a missing answer", () => {
    expect(judgeCallScenario({ id: "call-live", observed: { ...CLEAN, voiceAnswer: false } })).toEqual({
      detail: "no final voice row followed the owner's",
      kind: "answer-missing",
      passed: false,
    });
  });

  it("fails a long task that never ran long, never passing a fast answer", () => {
    expect(judgeCallScenario({ id: "long-task-mid-call", observed: { ...CLEAN, longTaskMs: 4000 } })).toEqual({
      detail: "did not exercise a long task: 4000 ms of real work seen in flight, 10000 needed",
      kind: "long-task-missing",
      passed: false,
    });
    expect(judgeCallScenario({ id: "long-task-mid-call", observed: { ...CLEAN, longTaskMs: 12_000 } })).toEqual({
      passed: true,
    });
  });

  it("fails a hold with no heap verdict", () => {
    expect(judgeCallScenario({ id: "call-holds", observed: CLEAN })).toEqual({
      detail: "no heap samples were judged",
      kind: "heap-growth",
      passed: false,
    });
  });

  it("fails, in order, a blocked drive, an overlapping call and a drop", () => {
    const verdictOf = (over: Partial<E2eCallObserved>): unknown =>
      judgeCallScenario({ id: "call-live", observed: { ...CLEAN, ...over } });
    expect([
      verdictOf({ blocked: "no Talk button", overlap: "2 plan calls" }),
      verdictOf({ dropped: "the call dropped", overlap: "2 plan calls" }),
      verdictOf({ dropped: "the call dropped" }),
    ]).toEqual([
      { detail: "no Talk button", kind: "blocked", passed: false },
      { detail: "2 plan calls", kind: "overlapping-calls", passed: false },
      { detail: "the call dropped", kind: "call-dropped", passed: false },
    ]);
  });

  it("fails a call whose own words never reached the transcript", () => {
    expect(judgeCallScenario({ id: "call-live", observed: { ...CLEAN, ownerTurn: false } })).toEqual({
      detail: "no final row of the owner's reached the transcript",
      kind: "transcript-missing",
      passed: false,
    });
  });

  it("carries a heap trend that grew, and passes one that held", () => {
    const grew: E2eCallEvidence = {
      ...NO_CALL_EVIDENCE,
      heapVerdict: {
        detail: "grew 90 MiB",
        growthBytes: 94_371_840,
        kind: "monotonic-growth",
        minima: [100, 200, 300],
        passed: false,
      },
    };
    const held: E2eCallEvidence = {
      ...NO_CALL_EVIDENCE,
      heapVerdict: { growthBytes: 0, minima: [100, 100, 100], passed: true },
    };
    expect([
      judgeCallScenario({ id: "call-holds", observed: { ...CLEAN, evidence: grew } }),
      judgeCallScenario({ id: "call-holds", observed: { ...CLEAN, evidence: held } }),
    ]).toEqual([{ detail: "grew 90 MiB", kind: "heap-growth", passed: false }, { passed: true }]);
  });

  it("carries a crash judged failed, and passes one judged sound", () => {
    const failedCrash = failed({ detail: "two successors", kind: "overlapping-calls" });
    expect([
      judgeCallScenario({ id: "renderer-killed", observed: { ...CLEAN, crash: failedCrash } }),
      judgeCallScenario({ id: "renderer-killed", observed: { ...CLEAN, crash: { passed: true } } }),
    ]).toEqual([{ detail: "two successors", kind: "overlapping-calls", passed: false }, { passed: true }]);
  });

  it("fails a crash scenario whose crash was never judged", () => {
    expect(judgeCallScenario({ id: "renderer-killed", observed: CLEAN })).toEqual({
      detail: "the crash was never judged",
      kind: "evidence-missing",
      passed: false,
    });
  });
});

describe("observedOf", () => {
  const SEEN: E2eCallDriveSeen = {
    blocked: undefined,
    crash: undefined,
    dropped: undefined,
    ownerTurn: true,
    live: true,
    longTaskMs: 12_000,
    overlap: undefined,
    queueSearchAnswer: undefined,
    stuck: undefined,
    voiceAnswer: true,
  };
  const none = { closed: undefined, counted: undefined, unread: undefined };

  it("carries a clean drive through unchanged", () => {
    expect(observedOf({ ...none, evidence: CLEAN.evidence, seen: SEEN })).toEqual({
      ...CLEAN,
      longTaskMs: 12_000,
    });
  });

  it("composes the search from the drive's word and the calls read after cleanup", () => {
    const evidence: E2eCallEvidence = { ...NO_CALL_EVIDENCE, queueSearchToolCallIds: ["t1"] };
    expect(observedOf({ ...none, evidence, seen: { ...SEEN, queueSearchAnswer: "NONE" } }).queueSearch).toEqual({
      answer: "NONE",
      toolCallIds: ["t1"],
    });
  });

  it("ranks a stuck call over a failed close and the drive's overlap over the count, keeping unread logs AND a blocked drive", () => {
    const observed = observedOf({
      closed: "lease still live",
      counted: "3 plan calls opened",
      evidence: NO_CALL_EVIDENCE,
      seen: { ...SEEN, blocked: "no Talk button", overlap: "another call was live", stuck: "call c1 never ended" },
      unread: "desktop log unreadable",
    });
    expect([observed.cleanup, observed.blocked, observed.overlap]).toEqual([
      "call c1 never ended",
      "desktop log unreadable; no Talk button",
      "another call was live",
    ]);
  });

  it("falls to the second problem when the first is absent", () => {
    const observed = observedOf({
      closed: "lease still live",
      counted: "3 plan calls opened",
      evidence: NO_CALL_EVIDENCE,
      seen: { ...SEEN, blocked: "no Talk button" },
      unread: undefined,
    });
    expect([observed.cleanup, observed.blocked, observed.overlap]).toEqual([
      "lease still live",
      "no Talk button",
      "3 plan calls opened",
    ]);
  });

  it("judges the crash over the evidence read after cleanup", () => {
    const evidence: E2eCallEvidence = { ...NO_CALL_EVIDENCE, planCallIds: ["p1", "p2"] };
    const crash = ({ evidence: read }: { readonly evidence: E2eCallEvidence }): E2eVerdict =>
      failed({ detail: read.planCallIds.join(","), kind: "evidence-missing" });
    expect(observedOf({ ...none, evidence, seen: { ...SEEN, crash } }).crash).toEqual({
      detail: "p1,p2",
      kind: "evidence-missing",
      passed: false,
    });
  });
});

describe("planCallOverlap", () => {
  it("allows one plan call per press and one per reconnect", () => {
    expect([
      callRequirementsOf({ id: "call-live" }).planCalls,
      callRequirementsOf({ id: "renderer-killed" }).planCalls,
    ]).toEqual([1, 2]);
    expect(planCallOverlap({ id: "renderer-killed", opened: ["p1", "p2"] })).toBeUndefined();
  });

  it("names a call past what the scenario could open", () => {
    expect(planCallOverlap({ id: "call-live", opened: ["p1", "p2"] })).toBe(
      "2 plan calls opened while it ran, at most 1 its own: p1, p2",
    );
  });
});

const opened = ({ callId, lineIndex }: { callId: string; lineIndex: number }): E2ePlanCallLogEvent => ({
  atIso: "2026-10-25T19:00:00.000Z",
  callId,
  kind: "opened",
  lineIndex,
  reason: "open",
});
const ended = ({ callId, lineIndex }: { callId: string; lineIndex: number }): E2ePlanCallLogEvent => ({
  atIso: "2026-10-25T19:01:00.000Z",
  callId,
  kind: "ended",
  lineIndex,
  reason: `${CRASH_SENTENCE_START}was killed (killed, exit 133)`,
});
const gone = ({
  planCallId,
  transcriptCallId,
  reconnect,
}: {
  planCallId: string;
  transcriptCallId: string;
  reconnect: boolean;
}): E2eDesktopEvent => ({
  atIso: "2026-10-25T19:00:30.000Z",
  call: { planCallId, transcriptCallId },
  exitCode: 133,
  kind: "renderer-gone",
  reason: "killed",
  reconnect,
  window: "overlay",
});
const taken = ({ transcriptCallId }: { transcriptCallId: string }): E2eDesktopEvent => ({
  ageMs: 900,
  atIso: "2026-10-25T19:00:31.000Z",
  kind: "recovery-taken",
  transcriptCallId,
});
const crashed = ({
  planCallId,
  transcriptCallId,
}: {
  planCallId: string;
  transcriptCallId: string;
}): E2eCrashedCall => ({
  ended: { atIso: "2026-10-25T19:00:32.000Z", why: `${CRASH_SENTENCE_START}was killed (killed, exit 133)` },
  planCallId,
  transcriptCallId,
});
const evidenceOf = ({
  desktopEvents,
  planEvents,
}: {
  desktopEvents: readonly E2eDesktopEvent[];
  planEvents: readonly E2ePlanCallLogEvent[];
}): E2eCallEvidence => ({ ...NO_CALL_EVIDENCE, desktopEvents, planEvents });

const P1_T1 = { planCallId: "p1", transcriptCallId: "t1" };
const P2_T2 = { planCallId: "p2", transcriptCallId: "t2" };

describe("judgeCrashEvidence", () => {
  const handled = evidenceOf({
    desktopEvents: [gone({ ...P1_T1, reconnect: true }), taken({ transcriptCallId: "t1" })],
    planEvents: [
      opened({ callId: "p1", lineIndex: 0 }),
      ended({ callId: "p1", lineIndex: 1 }),
      opened({ callId: "p2", lineIndex: 2 }),
    ],
  });

  it("passes a crash the shell logged, the page recovered, and exactly one successor followed", () => {
    expect(judgeCrashEvidence({ call: crashed(P1_T1), evidence: handled })).toEqual({ passed: true });
  });

  it("fails a recovery that opened two successors", () => {
    const evidence = { ...handled, planEvents: [...handled.planEvents, opened({ callId: "p3", lineIndex: 3 })] };
    expect(judgeCrashEvidence({ call: crashed(P1_T1), evidence })).toEqual({
      detail: "2 plan calls opened after p1 ended: p2, p3",
      kind: "overlapping-calls",
      passed: false,
    });
  });

  it("fails a successor that opened before the dead call's end", () => {
    const evidence = evidenceOf({
      desktopEvents: handled.desktopEvents,
      planEvents: [
        opened({ callId: "p1", lineIndex: 0 }),
        opened({ callId: "p2", lineIndex: 1 }),
        ended({ callId: "p1", lineIndex: 2 }),
      ],
    });
    expect(judgeCrashEvidence({ call: crashed(P1_T1), evidence })).toEqual({
      detail: "no plan call opened after p1 ended",
      kind: "call-not-live",
      passed: false,
    });
  });

  it("fails a transcript not closed with the crash sentence", () => {
    const call = { ...crashed(P1_T1), ended: { atIso: "2026-10-25T19:00:32.000Z", why: "the caller hung up" } };
    expect(judgeCrashEvidence({ call, evidence: handled }).passed).toBe(false);
    expect(judgeCrashEvidence({ call, evidence: handled })).toEqual({
      detail:
        'transcript t1 was not closed with the crash sentence (ended: {"atIso":"2026-10-25T19:00:32.000Z","why":"the caller hung up"})',
      kind: "transcript-missing",
      passed: false,
    });
  });

  it("fails a crash no shell entry names, ignoring entries for the owner's own calls", () => {
    const evidence = {
      ...handled,
      desktopEvents: [gone({ planCallId: "owner-plan", reconnect: true, transcriptCallId: "owner-tx" })],
    };
    expect(judgeCrashEvidence({ call: crashed(P1_T1), evidence })).toEqual({
      detail: "no renderer-gone entry names call t1",
      kind: "evidence-missing",
      passed: false,
    });
  });
});

describe("judgeSecondCrash", () => {
  const desktop = [
    gone({ ...P1_T1, reconnect: true }),
    taken({ transcriptCallId: "t1" }),
    gone({ ...P2_T2, reconnect: false }),
    taken({ transcriptCallId: "t2" }),
  ];
  const twoCalls = [
    opened({ callId: "p1", lineIndex: 0 }),
    ended({ callId: "p1", lineIndex: 1 }),
    opened({ callId: "p2", lineIndex: 2 }),
    ended({ callId: "p2", lineIndex: 3 }),
  ];

  it("passes a second crash that did not reconnect", () => {
    const evidence = evidenceOf({ desktopEvents: desktop, planEvents: twoCalls });
    expect(judgeSecondCrash({ evidence, first: crashed(P1_T1), second: crashed(P2_T2) })).toEqual({
      passed: true,
    });
  });

  it("fails a third call opened after the second crash", () => {
    const plan = [...twoCalls, opened({ callId: "p3", lineIndex: 4 })];
    expect(
      judgeSecondCrash({
        evidence: evidenceOf({ desktopEvents: desktop, planEvents: plan }),
        first: crashed(P1_T1),
        second: crashed(P2_T2),
      }),
    ).toEqual({
      detail: "the second crash inside the settle window still opened p3",
      kind: "overlapping-calls",
      passed: false,
    });
  });
});

describe("judgeConnectingCrash", () => {
  const noCall: E2eDesktopEvent = {
    atIso: "2026-10-25T19:00:30.000Z",
    call: null,
    exitCode: 133,
    kind: "renderer-gone",
    reason: "killed",
    reconnect: null,
    window: "overlay",
  };

  const noEvents = evidenceOf({ desktopEvents: [noCall], planEvents: [] });

  it("passes an attempt that never minted, or whose plan call ended", () => {
    expect(judgeConnectingCrash({ attemptPlanCallIds: [], evidence: noEvents, leftLeaseIds: [] })).toEqual({
      passed: true,
    });
    const evidence = evidenceOf({
      desktopEvents: [noCall],
      planEvents: [opened({ callId: "p1", lineIndex: 0 }), ended({ callId: "p1", lineIndex: 1 })],
    });
    expect(judgeConnectingCrash({ attemptPlanCallIds: ["p1"], evidence, leftLeaseIds: [] })).toEqual({ passed: true });
  });

  it("fails an attempt whose plan call never ended, or that left a lease", () => {
    const evidence = evidenceOf({ desktopEvents: [noCall], planEvents: [opened({ callId: "p1", lineIndex: 0 })] });
    expect(judgeConnectingCrash({ attemptPlanCallIds: ["p1"], evidence, leftLeaseIds: [] })).toEqual({
      detail: "the connecting attempt's plan call(s) never ended: p1",
      kind: "evidence-missing",
      passed: false,
    });
    expect(judgeConnectingCrash({ attemptPlanCallIds: [], evidence: noEvents, leftLeaseIds: ["l1"] })).toEqual({
      detail: "the connecting attempt left lease(s) live: l1",
      kind: "overlapping-calls",
      passed: false,
    });
  });
});
