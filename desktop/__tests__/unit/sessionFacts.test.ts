/*
 * A hosted session's facts picture, as the pure fold builds it from each tool activity: counted once by kind, placed in
 * flight or among the ended ones, bounded by both caps, and never moved back once ended. The registry carries it as an
 * observation, and a picture read carries none of the session's words.
 */
import { describe, expect, it } from "vitest";

import { APP_PICTURE_COMPLETED_CAP, APP_PICTURE_IN_FLIGHT_CAP, type AppSessionFacts } from "../../src/pictureWire";
import { EMPTY_SESSION_FACTS, foldToolActivity, sessionPictureOf } from "../../src/sessionFacts";
import { reduceRegistry } from "../../src/sessionRegistry";
import { EMPTY_REGISTRY, type RegistryEvent, type SessionRegistry } from "../../src/sessionRegistryShape";
import type { ToolActivity } from "../../src/sessionWorker/workerWire";

const T0 = "2026-11-09T01:00:00.000Z";
const T1 = "2026-11-09T01:00:01.000Z";
const T2 = "2026-11-09T01:00:02.000Z";
const ID = "0b5e";

function folded({ steps }: { steps: readonly { activity: ToolActivity; atIso: string }[] }): AppSessionFacts {
  return steps.reduce(
    (facts, { activity, atIso }) => foldToolActivity({ activity, atIso, facts }),
    EMPTY_SESSION_FACTS,
  );
}

const START: ToolActivity = { name: "Bash", status: "in_progress", toolCallId: "t1", toolKind: "execute" };

describe("foldToolActivity", () => {
  it("starts from no counts, no calls and no instants", () => {
    expect(EMPTY_SESSION_FACTS.inFlight).toEqual([]);
    expect(EMPTY_SESSION_FACTS.lastCompleted).toEqual([]);
    expect(Object.values(EMPTY_SESSION_FACTS.countsByKind)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(EMPTY_SESSION_FACTS.firstActivityAtIso).toBeUndefined();
  });

  it("counts a new call once under its kind and holds it in flight, stamped with the receipt instant", () => {
    const facts = folded({ steps: [{ activity: START, atIso: T0 }] });
    expect(facts.countsByKind.execute).toBe(1);
    expect(facts.inFlight).toEqual([{ ...START, lastObservedAtIso: T0, startedAtIso: T0 }]);
    expect([facts.firstActivityAtIso, facts.lastActivityAtIso]).toEqual([T0, T0]);
  });

  it("files a call that named no kind or status as a pending other", () => {
    const facts = folded({ steps: [{ activity: { toolCallId: "t9" }, atIso: T0 }] });
    expect(facts.inFlight).toEqual([
      { lastObservedAtIso: T0, startedAtIso: T0, status: "pending", toolCallId: "t9", toolKind: "other" },
    ]);
    expect(facts.countsByKind.other).toBe(1);
  });

  it("carries a subagent's parent from the call's start through its end, and an end that omits it keeps it", () => {
    const facts = folded({
      steps: [
        {
          activity: { parentToolCallId: "toolu_1", status: "in_progress", toolCallId: "t3", toolKind: "search" },
          atIso: T0,
        },
        { activity: { status: "completed", toolCallId: "t3" }, atIso: T1 },
      ],
    });
    expect(facts.lastCompleted).toEqual([
      {
        lastObservedAtIso: T1,
        parentToolCallId: "toolu_1",
        startedAtIso: T0,
        status: "completed",
        toolCallId: "t3",
        toolKind: "search",
      },
    ]);
  });

  it("patches a call in flight in place, keeping what the update leaves out and not counting it again", () => {
    const facts = folded({
      steps: [
        { activity: { status: "pending", toolCallId: "t1", toolKind: "read" }, atIso: T0 },
        { activity: { name: "read_file", toolCallId: "t1" }, atIso: T1 },
      ],
    });
    expect(facts.inFlight).toEqual([
      {
        lastObservedAtIso: T1,
        name: "read_file",
        startedAtIso: T0,
        status: "pending",
        toolCallId: "t1",
        toolKind: "read",
      },
    ]);
    expect(facts.countsByKind.read).toBe(1);
  });

  it("moves the count when an update corrects a call's kind", () => {
    const facts = folded({
      steps: [
        { activity: { toolCallId: "t1" }, atIso: T0 },
        { activity: { toolCallId: "t1", toolKind: "search" }, atIso: T1 },
      ],
    });
    expect([facts.countsByKind.other, facts.countsByKind.search]).toEqual([0, 1]);
  });

  it("ends a call as completed or failed, newest first, with its start kept", () => {
    const facts = folded({
      steps: [
        { activity: START, atIso: T0 },
        { activity: { status: "in_progress", toolCallId: "t2", toolKind: "edit" }, atIso: T0 },
        { activity: { status: "completed", toolCallId: "t1" }, atIso: T1 },
        { activity: { status: "failed", toolCallId: "t2" }, atIso: T2 },
      ],
    });
    expect(facts.inFlight).toEqual([]);
    expect(facts.lastCompleted).toEqual([
      { lastObservedAtIso: T2, startedAtIso: T0, status: "failed", toolCallId: "t2", toolKind: "edit" },
      { ...START, lastObservedAtIso: T1, startedAtIso: T0, status: "completed" },
    ]);
    expect([facts.countsByKind.execute, facts.countsByKind.edit]).toEqual([1, 1]);
    expect([facts.firstActivityAtIso, facts.lastActivityAtIso]).toEqual([T0, T2]);
  });

  it("counts an orphan result, never seen starting, once as an ended other", () => {
    const facts = folded({ steps: [{ activity: { status: "completed", toolCallId: "t7" }, atIso: T1 }] });
    expect(facts.lastCompleted).toEqual([
      { lastObservedAtIso: T1, startedAtIso: T1, status: "completed", toolCallId: "t7", toolKind: "other" },
    ]);
    expect(facts.countsByKind.other).toBe(1);
  });

  it("treats an ended call as final: a re-sent start or end neither recounts it nor moves it back in flight", () => {
    const facts = folded({
      steps: [
        { activity: START, atIso: T0 },
        { activity: { status: "completed", toolCallId: "t1" }, atIso: T1 },
        { activity: START, atIso: T2 },
        { activity: { status: "failed", toolCallId: "t1", toolKind: "read" }, atIso: T2 },
      ],
    });
    expect(facts.inFlight).toEqual([]);
    expect(facts.lastCompleted).toEqual([{ ...START, lastObservedAtIso: T1, startedAtIso: T0, status: "completed" }]);
    expect([facts.countsByKind.execute, facts.countsByKind.read]).toEqual([1, 0]);
    expect(facts.lastActivityAtIso).toBe(T2);
  });

  it("keeps the newest 20 ended calls while the counts keep all 21", () => {
    const steps = Array.from({ length: APP_PICTURE_COMPLETED_CAP + 1 }, (_, index) => ({
      activity: { status: "completed" as const, toolCallId: `c${index}`, toolKind: "read" as const },
      atIso: T0,
    }));
    const facts = folded({ steps });
    expect(facts.lastCompleted.length).toBe(20);
    expect([facts.lastCompleted[0]!.toolCallId, facts.lastCompleted[19]!.toolCallId]).toEqual(["c20", "c1"]);
    expect(facts.countsByKind.read).toBe(21);
  });

  it("drops the 65th call in flight, counting the drop rather than the call, and still ends one it holds", () => {
    const steps = Array.from({ length: APP_PICTURE_IN_FLIGHT_CAP + 1 }, (_, index) => ({
      activity: { status: "in_progress" as const, toolCallId: `f${index}`, toolKind: "execute" as const },
      atIso: T0,
    }));
    const full = folded({ steps });
    expect(full.inFlight.length).toBe(64);
    expect(full.droppedActivityEvents).toBe(1);
    expect(full.countsByKind.execute).toBe(64);
    const ended = foldToolActivity({ activity: { status: "completed", toolCallId: "f0" }, atIso: T1, facts: full });
    expect([ended.inFlight.length, ended.lastCompleted.length, ended.droppedActivityEvents]).toEqual([63, 1, 1]);
  });
});

describe("the registry and a picture read", () => {
  const PREPARED: RegistryEvent = {
    atIso: T0,
    kind: "prepared",
    launchToken: "token-1",
    sessionId: ID,
    spec: {
      codexHome: "/home/codex",
      directory: "/work/acme",
      judgedInstanceId: "instance-a",
      ledgerKey: "abc-1",
      title: "abc-1",
      vendor: "codex",
    },
  };
  const prepared: SessionRegistry = reduceRegistry({ event: PREPARED, registry: EMPTY_REGISTRY }).registry;
  const asked = reduceRegistry({
    event: { atIso: T0, delivery: "later", kind: "message", sessionId: ID, text: "FIXTURE-PROMPT" },
    registry: prepared,
  }).registry;

  it("folds a tool activity as an observation: no send, and the state and held messages unmoved", () => {
    const step = reduceRegistry({
      event: { atIso: T1, kind: "worker", report: { activity: START, kind: "tool-activity", sessionId: ID } },
      registry: asked,
    });
    expect(step.sends).toEqual([]);
    const [before, after] = [asked.get(ID)!, step.registry.get(ID)!];
    expect([after.snapshot.state, after.pending, after.urgent]).toEqual([before.snapshot.state, ["FIXTURE-PROMPT"], 0]);
    expect(after.facts.inFlight).toEqual([{ ...START, lastObservedAtIso: T1, startedAtIso: T1 }]);
  });

  it("answers the session's identity, state and facts, and none of its words", () => {
    const entry = asked.get(ID)!;
    const withWords = {
      ...entry,
      snapshot: { ...entry.snapshot, lastAgentText: "FIXTURE-REPLY", lastSubmittedText: "FIXTURE-PROMPT" },
    };
    const picture = sessionPictureOf({ entry: withWords, readAtIso: T2 });
    expect(picture).toEqual({
      facts: EMPTY_SESSION_FACTS,
      readAtIso: T2,
      session: { handle: "app:0b5e", sessionId: ID, state: "starting", title: "abc-1", vendor: "codex" },
    });
    expect(JSON.stringify(picture)).not.toContain("FIXTURE-");
  });
});
