/*
 * The plain fake seams a `runTalkTool` test over a triage pass hands the page's tools: one card, a pass opened on
 * it, and a kept record of every clock start, clock stop and pass written. A seam, never a mock.
 */
import type { ToolSeams } from "../components/voice/talkToolRunTypes";
import { NO_ALIGNMENT_CARDS } from "../lib/cardToolPlan";
import { markTriageOpened, nextTriageCard, startTriageWalk } from "../lib/triageWalk";
import type { TriageWalk, TriageWalkRow } from "../lib/triageWalkTypes";
import { seams } from "./talkToolSeams";

/** One card a triage pass walks. */
export const TRIAGE_ROW: TriageWalkRow = {
  fingerprint: "words",
  key: "act:ev-9",
  kind: "act",
  section: "fleet-blocked",
  tier: "fleet-blocked",
};

/**
 * A triage pass with its one card in front of the owner and opened, the clock running.
 *
 * @returns the pass
 */
export function walkOnTriageCard(): TriageWalk {
  const begun = startTriageWalk({
    focus: [],
    nowMs: 0,
    rows: [TRIAGE_ROW],
    walkId: "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c",
  });
  const taken = nextTriageCard({ focus: [], nowMs: 0, rows: [TRIAGE_ROW], walk: begun }).walk;
  return markTriageOpened({ visitId: taken.current!.visitId, walk: taken });
}

/**
 * Seams over a kept triage pass, whose card opener finds no card, recording every clock stop and every pass written.
 *
 * @param walk the pass on the page, `undefined` with none running
 * @param heard the owner's own words the call heard, which a named clock length is checked against
 * @returns the seams, and what the clock and the kept pass did
 */
export function triageSeams({ walk, heard = [] }: { walk: TriageWalk | undefined; heard?: readonly string[] }): {
  readonly seams: ToolSeams;
  readonly kept: { stops: number; started: number; lengths: number[]; walk: TriageWalk | undefined };
} {
  const lengths: number[] = [];
  const kept = { lengths, started: 0, stops: 0, walk };
  const base = seams({ relayed: { answer: undefined, detail: "", refused: false } });
  return {
    kept,
    seams: {
      ...base,
      cards: () => ({
        alignment: NO_ALIGNMENT_CARDS,
        focuses: [],
        fromPath: "/queue",
        recentlyLeft: [],
        rows: [],
        unread: [],
      }),
      gateLog: () => heard.map((text) => ({ kind: "heard" as const, text })),
      triage: {
        ...base.triage,
        keepLength: () => undefined,
        lengthOf: () => undefined,
        nowMs: () => 7000,
        read: () => kept.walk,
        startClock: ({ lengthMs }) => {
          kept.started += 1;
          kept.lengths.push(lengthMs);
        },
        stopClock: () => {
          kept.stops += 1;
        },
        write: ({ walk: next }) => {
          kept.walk = next;
        },
      },
    },
  };
}
