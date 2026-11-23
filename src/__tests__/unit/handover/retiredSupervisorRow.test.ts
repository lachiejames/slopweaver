/**
 * The board transition a retired supervisor chair depends on, proved rather than assumed.
 *
 * `cmux takeover`'s step 6 and the one-time sweep of the standing chairs both write ONE `closed` row event
 * onto a journal whose cycle ended `orphaned` — the reaper's ending, which is what a chair that stepped down
 * without finishing its own run actually leaves behind. If that event did not move the row out of `RUN NOW`,
 * neither the verb nor the sweep would fix anything, and the 177 standing docs would have taken a write for
 * nothing. Both halves are asserted here: the row IS `RUN NOW` before, and DONE after.
 */
import { describe, expect, it } from "vitest";

import { composeBoardModels } from "../../../handover/boardState.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";

const SLUG = "fresh-supervisor-handoff-9235";

/** The retiring chair's own doc, exactly as one stands on the live board: `role: supervisor`, `status: ready`. */
function chairDoc(): HandoverDoc {
  return {
    anchor: undefined,
    artifact: undefined,
    askedIso: undefined,
    baseBranch: undefined,
    blockedBy: [],
    branch: undefined,
    doneWhen: [],
    evidence: [],
    kind: "doc",
    notDoneReason: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    origin: undefined,
    outputs: [],
    path: `/h/${SLUG}.md`,
    pausedOn: undefined,
    pausedSince: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    priority: "p1",
    probeWaiver: "the whole outcome is a live pin swap",
    lean: undefined,
    examples: [],
    exampleGap: undefined,
    options: [],
    problem: undefined,
    problems: [],
    repo: "/w/repo",
    role: "supervisor",
    ruling: undefined,
    rulingAnchor: undefined,
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    slug: SLUG,
    status: "ready",
    statusSummary: undefined,
    summary: "You are the next /slopweaver:supervisor chair.",
    supervisorState: "~/.slopweaver/handovers/supervisor-state-21aug.md",
  };
}

/** The chair's journal as the reaper leaves it: dispatched, started, launched, then orphaned. */
const REAPED_CYCLE: readonly RunEvent[] = [
  { atIso: "2026-09-11T05:50:11.643Z", by: "802a2cb4", kind: "dispatched", target: "workspace:106" },
  { atIso: "2026-09-11T05:50:29.948Z", branch: SLUG, docHash: "103eb05024df3df2", kind: "started" },
  {
    atIso: "2026-09-11T05:50:29.948Z",
    host: "claude-code",
    kind: "launched",
    pid: 75_708,
    sessionId: "f3cd2e68",
    worktree: `/w/.claude/worktrees.noindex/${SLUG}`,
  },
  {
    atIso: "2026-09-12T01:20:33.327Z",
    cycleEvents: 2,
    deadSessionId: "f3cd2e68",
    kind: "orphaned",
    lastEventIso: "2026-09-11T05:50:29.948Z",
  },
];

/** The board's placement for this chair, given its journal. */
function sectionFor({ events }: { events: readonly RunEvent[] }): string {
  const docs = [chairDoc()];
  const models = composeBoardModels({
    journals: new Map([[SLUG, { events, unreadableLines: [] }]]),
    probeStates: new Map(),
    resolutionDocs: docs,
    roots: docs,
  });
  return models[0]!.section;
}

describe("a retired supervisor chair's board row", () => {
  it("sits in RUN NOW while nothing has recorded its ending — the defect", () => {
    expect(sectionFor({ events: REAPED_CYCLE })).toBe("RUN NOW");
  });

  it("reads DONE once the takeover records it closed, with no edit to `status:`", () => {
    const section = sectionFor({
      events: [
        ...REAPED_CYCLE,
        {
          atIso: "2026-09-19T04:03:58.128Z",
          kind: "closed",
          residue: [],
          summary: "the supervisor pin moved to workspace:137; this chair retired",
        },
      ],
    });
    expect(section).toBe("DONE");
    expect(chairDoc().status).toBe("ready");
  });
});
