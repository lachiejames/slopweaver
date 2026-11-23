/**
 * `runTriageCommand` (`components/voice/triageCommandRun.ts`): a rapid-triage press from the menu bar, a floating note
 * or the orb — said into a voice call as the owner's words, else run on the page's own pass or sent to the typed conversation.
 */
import { describe, expect, it } from "vitest";

import {
  runTriageCommand,
  TRIAGE_COMMAND_WORDS,
  type TriageCommandSeams,
} from "../../components/voice/triageCommandRun";
import type { TypedInSend } from "../../components/voice/typedInClient";
import { NO_ALIGNMENT_CARDS } from "../../lib/cardToolPlan";
import type { TriageVisit, TriageWalk } from "../../lib/triageWalkTypes";

const WALK_ID = "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c";
const KEY = "hand:say-whether-the-orb-breathes";

/** The card in front of the owner, opened and unruled. */
const VISIT: TriageVisit = {
  arrived: false,
  fingerprint: "words",
  key: KEY,
  opened: true,
  presentedMs: 4000,
  rewritten: false,
  ruled: false,
  visitId: `${WALK_ID}-1`,
};

/**
 * A running pass with that card in front of the owner.
 *
 * @param over the fields that differ
 * @returns the pass
 */
function runningWalk({ over = {} }: { over?: Partial<TriageWalk> } = {}): TriageWalk {
  return {
    current: VISIT,
    focus: [],
    order: [KEY],
    out: [],
    paused: false,
    previous: undefined,
    rulings: [],
    settled: [],
    shown: [KEY],
    stoppedMs: undefined,
    touchedMs: 4000,
    visits: 1,
    walkId: WALK_ID,
    ...over,
  };
}

/**
 * Seams recording every word sent and every clock moved.
 *
 * @param walk the pass on the page
 * @param callUp whether a voice call is up
 * @param callSend how the call takes words
 * @param typedTakes whether the typed conversation takes words
 * @returns the seams and what they saw
 */
function fakes({
  walk,
  callUp,
  callSend = { kind: "taken" },
  typedTakes = true,
}: {
  walk: TriageWalk | undefined;
  callUp: boolean;
  callSend?: TypedInSend;
  typedTakes?: boolean;
}): {
  seams: TriageCommandSeams;
  saidIntoCall: string[];
  typedSent: string[];
  clocks: string[];
  kept: { walk: TriageWalk | undefined };
} {
  const saidIntoCall: string[] = [];
  const typedSent: string[] = [];
  const clocks: string[] = [];
  const kept = { walk };
  // The length the page keeps for each visit, so a press resumes a card on the length the owner gave it.
  const lengths = new Map<string, number>([[`${WALK_ID}-1`, 300_000]]);
  return {
    clocks,
    kept,
    saidIntoCall,
    seams: {
      seams: {
        cards: () => ({
          alignment: NO_ALIGNMENT_CARDS,
          focuses: [],
          fromPath: "/queue",
          recentlyLeft: [],
          rows: [],
          unread: [],
        }),
        triage: {
          frontOf: () => ({ seen: false }),
          keepLength: ({ visitId, lengthMs }) => {
            lengths.set(visitId, lengthMs);
          },
          lengthOf: ({ visitId }) => lengths.get(visitId),
          mintId: () => WALK_ID,
          nowMs: () => 90_000,
          read: () => kept.walk,
          startClock: ({ visit, lengthMs }) => {
            clocks.push(`start ${visit.visitId} at ${String(visit.presentedMs)} for ${String(lengthMs)}`);
          },
          stopClock: () => {
            clocks.push("stop");
          },
          turnStarted: () => undefined,
          write: ({ walk: next }) => {
            kept.walk = next;
          },
        },
      },
      sendTyped: async ({ text }) => {
        typedSent.push(text);
        return typedTakes;
      },
      typeIntoCall: async ({ text }) => {
        saidIntoCall.push(text);
        return callSend;
      },
      voiceCallUp: () => callUp,
    },
    typedSent,
  };
}

describe("runTriageCommand on a voice call", () => {
  it("says each press into the call as the owner's words and leaves the page's pass to the tool the voice calls", async () => {
    const { seams, saidIntoCall, typedSent, clocks, kept } = fakes({ callUp: true, walk: runningWalk() });
    const ran = [];
    for (const command of ["start", "pause", "resume", "off"] as const) {
      ran.push(await runTriageCommand({ command, seams }));
    }
    expect(saidIntoCall).toEqual([
      "It's triage time.",
      "Pause the triage timer.",
      "Start the triage timer again.",
      "Turn triage off.",
    ]);
    expect([typedSent, clocks, kept.walk!.paused, kept.walk!.stoppedMs]).toEqual([[], [], false, undefined]);
    expect(ran.map((one) => one.detail)).toEqual([
      "triage start said into the call",
      "triage pause said into the call",
      "triage resume said into the call",
      "triage off said into the call",
    ]);
  });

  it("logs a press the call refused, with the call's reason", async () => {
    const { seams } = fakes({ callSend: { kind: "refused", why: "no call is live" }, callUp: true, walk: undefined });
    const ran = await runTriageCommand({ command: "pause", seams });
    expect(ran).toEqual({ detail: "triage pause not said into the call: no call is live", refused: true });
  });
});

describe("runTriageCommand off a call", () => {
  it("sends a start to the typed conversation, which walks the Queue with triage_next", async () => {
    const { seams, typedSent, saidIntoCall } = fakes({ callUp: false, walk: undefined });
    const ran = await runTriageCommand({ command: "start", seams });
    expect([ran, typedSent, saidIntoCall]).toEqual([
      { detail: "triage start sent to the typed conversation", refused: false },
      ["It's triage time."],
      [],
    ]);
  });

  it("says so when the typed conversation does not take a start", async () => {
    const { seams } = fakes({ callUp: false, typedTakes: false, walk: undefined });
    const ran = await runTriageCommand({ command: "start", seams });
    expect(ran).toEqual({ detail: "triage start not sent: the typed conversation did not take it", refused: true });
  });

  it("pauses the page's own clock, then resumes the same card on its own length from now", async () => {
    const { seams, clocks, kept, typedSent } = fakes({ callUp: false, walk: runningWalk() });
    const paused = await runTriageCommand({ command: "pause", seams });
    const pausedFlag = kept.walk!.paused;
    const resumed = await runTriageCommand({ command: "resume", seams });
    expect([paused, pausedFlag, resumed, kept.walk!.paused]).toEqual([
      { detail: "triage clock paused", refused: false },
      true,
      { detail: "triage clock running", refused: false },
      false,
    ]);
    expect([clocks, typedSent]).toEqual([["stop", "stop", `start ${WALK_ID}-1 at 90000 for 300000`], []]);
  });

  it("turns triage off, stopping the pass without dropping it", async () => {
    const { seams, clocks, kept } = fakes({ callUp: false, walk: runningWalk() });
    const ran = await runTriageCommand({ command: "off", seams });
    expect([ran.refused, clocks, kept.walk!.stoppedMs, kept.walk!.walkId]).toEqual([false, ["stop"], 90_000, WALK_ID]);
  });

  it("refuses a pause and an off with no pass running, and moves nothing", async () => {
    const { seams, kept } = fakes({ callUp: false, walk: undefined });
    const paused = await runTriageCommand({ command: "pause", seams });
    const off = await runTriageCommand({ command: "off", seams });
    expect([paused, off, kept.walk]).toEqual([
      { detail: "no triage pass", refused: true },
      { detail: "no triage pass", refused: true },
      undefined,
    ]);
  });

  it("names a press's words exactly as the voice hears them", () => {
    expect(TRIAGE_COMMAND_WORDS).toEqual({
      off: "Turn triage off.",
      pause: "Pause the triage timer.",
      resume: "Start the triage timer again.",
      start: "It's triage time.",
    });
  });
});
