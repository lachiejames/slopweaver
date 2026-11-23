/*
 * The HandoverDoc fixture every split handover doc test that calls `blockerFor` on a hand-built doc reads.
 */
import type { HandoverDoc } from "../../../../handover/doc.js";

/**
 * A minimal handover doc with every optional field absent, carrying only a slug, a status and its dependencies.
 *
 * @returns a doc at `/h/<slug>.md` whose only declared fields are the three named
 */
export function doc({
  slug,
  status = "ready",
  blockedBy = [],
}: {
  slug: string;
  status?: HandoverDoc["status"];
  blockedBy?: readonly string[];
}): HandoverDoc {
  return {
    anchor: undefined,
    askedIso: undefined,
    kind: "doc",
    priority: undefined,
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    origin: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    evidence: [],
    ruling: undefined,
    rulingAnchor: undefined,
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    artifact: undefined,
    baseBranch: undefined,
    blockedBy,
    branch: undefined,
    doneWhen: [],
    notDoneReason: undefined,
    outputs: [],
    pausedOn: undefined,
    pausedSince: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    path: `/h/${slug}.md`,
    probeWaiver: undefined,
    lean: undefined,
    examples: [],
    exampleGap: undefined,
    options: [],
    problem: undefined,
    problems: [],
    repo: undefined,
    role: undefined,
    slug,
    status,
    statusSummary: undefined,
    supervisorState: undefined,
    summary: undefined,
  };
}
