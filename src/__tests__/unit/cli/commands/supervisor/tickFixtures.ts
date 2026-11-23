/**
 * The fixed documents `tick/*.test.ts` feed `supervisor tick`: a reconciliation, a briefing form, a tick file, the
 * escalation rehearsals and the chair gate's evidence. Pure data — nothing here touches the temp directory the
 * harness in `tick/harness.ts` owns, which is why it can live apart from it.
 */
import type { ChairGateEvidence } from "../../../../../cli/commands/supervisor/chairGateRun.js";
import type { EscalationRead } from "../../../../../supervisor/fleetHealthGate.js";
import { FILL_LANES } from "../../../plans/laneFixtures.js";

export const NOW = "2026-09-27T01:00:00.000Z";

/** A list the chair handed in: datable, and pretty-printed with a non-ASCII byte so a re-encode would show. */
export const HANDED_TEXT = `${JSON.stringify({ handedBy: "the chair — bare", nowIso: NOW }, null, 2)}\n`;
export const HANDED_BYTES = Buffer.from(HANDED_TEXT, "utf8");

/** The smallest document a refresh accepts as a session-start run: the page's own check, with nothing ranked. */
export const REFRESHED_TEXT = `${JSON.stringify({ nowIso: NOW, ranking: { ranked: [] } })}\n`;

/**
 * A reconciliation carrying the alignment words and one witnessed owner turn — the one reading these cases
 * supply, because close validates every drafted reading against its producer's schema and an empty one is
 * left out of the draft rather than refused.
 */
export const RECONCILE = JSON.stringify({
  aligned: [],
  headline: "Aligned on the rewrite.",
  intake: {
    finding: {
      coverage: { linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: "2026-09-26T01:00:00.000Z",
      turns: [
        {
          inGrace: false,
          turn: {
            lineNumber: 10,
            pointer: "transcript:a1#t1",
            sessionId: "a1",
            source: "typed",
            text: "make the headline cap structural",
            timestamp: "2026-09-27T00:50:00.000Z",
            turnUuid: "t1",
          },
          witness: { kind: "row", witness: "one-typed-supervisor-tick-verb" },
        },
      ],
    },
    kind: "read",
  },
  intakeClause: "every turn the owner typed is witnessed",
  misaligned: [],
  rankedCount: 0,
  staleAsks: [],
  starving: [],
  unregistered: [],
});

/** A briefing form with no blocks yet. */
export const FORM = {
  alignment: { detail: { blocks: [], summary: "the reconcile line" }, headline: [], intake: [] },
  earlierToday: { notes: [], summary: "earlier today" },
  header: {
    handoff: "handoff-9292",
    lede: [{ kind: "text", text: "the old lede" }],
    model: "fable",
    pinnedAt: "2026-09-23T14:36:00Z",
    sleeping: false,
    workspace: "workspace:93",
  },
  reactNow: { meFacing: [], teamFacing: [] },
  recent: [],
};

/**
 * A filled tick file, with any field replaced.
 *
 * @param over the fields to replace
 * @returns the document's text
 */
export function tickFile(over: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    actions: [],
    foldSummary: "What the sweep read.",
    folds: ["The merge queue drained."],
    headline: { sentences: ["The merge queue is clear.", "Nothing needs the owner this hour."] },
    judgements: [],
    openPagesReviewed: false,
    schemaVersion: 1,
    shift: null,
    sleeping: false,
    ...over,
  });
}

/** A fleet health rehearsal reading clear, which no close refuses on. */
export const CLEAR_FLEET: EscalationRead = {
  kind: "read",
  notes: [],
  outcome: { actions: [], readings: [{ monitorId: "fleet-unhealthy", state: "clear" }] },
};

/** A fleet health rehearsal reading TRIPPED, whose card the pass would post because none is open. */
export const TRIPPED_FLEET: EscalationRead = {
  kind: "read",
  notes: [],
  outcome: {
    actions: [
      {
        detail: "would post: Check fleet health — syncs are dying mid-run",
        kind: "posted",
        monitorId: "fleet-unhealthy",
        stepId: "mon-health-deaths-0a1b2c",
      },
    ],
    readings: [
      {
        monitorId: "fleet-unhealthy",
        state: "firing",
        subjects: [{ id: "fleet health", key: "deaths", label: "as of 01:00Z, 3 died mid-run: resync-a" }],
      },
    ],
  },
};

/** A steer-risk rehearsal reading clear: no explicitly steered row is at risk. */
export const CLEAR_STEER: EscalationRead = {
  kind: "read",
  notes: [],
  outcome: { actions: [], readings: [{ monitorId: "steer-at-risk", state: "clear" }] },
};

/** A steer-risk rehearsal reading a clock-park, whose note nobody posted. */
export const PARKED_STEER: EscalationRead = {
  kind: "read",
  notes: [],
  outcome: {
    actions: [
      {
        detail: "would post: Your steered sup-4293 is at risk",
        kind: "posted",
        monitorId: "steer-at-risk",
        stepId: "mon-steer-sup-4293-1a2b3c",
      },
    ],
    readings: [
      {
        monitorId: "steer-at-risk",
        state: "firing",
        subjects: [
          {
            id: "sup-4293",
            key: "sup-4293-1a2b3c",
            label: "its seat closed until 2026-10-22T04:50:00Z, so nobody is working it",
          },
        ],
      },
    ],
  },
};

/** The gate read no chair, so the cadence is not judged and the sweep prompt stands. */
export const NOT_READ: ChairGateEvidence = { kind: "not-read", why: "this fixture exercises the close" };

/**
 * The gate's read of a chair on Fable, one session, whose plan is its boot credential's. Typed as the `read` arm
 * rather than the whole union, so a case spreading it to swap the chair or the lanes stays on that arm.
 */
export const READ_CHAIR: Extract<ChairGateEvidence, { kind: "read" }> = {
  chair: {
    kind: "resolved",
    sessions: [
      { pid: 75277, sessionId: "a0000049", verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } },
    ],
    workspaceCwd: "/wt/chair",
    workspaceId: "WS",
  },
  kind: "read",
  lanes: FILL_LANES,
};
