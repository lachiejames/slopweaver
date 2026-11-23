/**
 * A closed dispatch ask as `handover register` writes one, with no shape — the measured uncarded rows were exactly
 * this. Shared by the sweep tests that need a whole `HandoverDoc`.
 */
import type { HandoverDoc } from "../../../handover/doc.js";

/** The page the fixture's settlement witness names. */
export const PAGE = "acme-plan-page-17-nov";

/**
 * A closed ask settled answered with a page witness, overridable field by field.
 *
 * @param over the fields to replace
 * @returns a whole doc
 */
export function ask(over: Partial<HandoverDoc> = {}): HandoverDoc {
  return {
    anchor: "talk:a0000020",
    artifact: undefined,
    askedIso: "2026-11-02T08:00:00.000Z",
    baseBranch: undefined,
    blastRadius: undefined,
    blockedBy: [],
    branch: undefined,
    doneWhen: [],
    evidence: [],
    exampleGap: undefined,
    examples: [],
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    kind: "ask",
    lean: undefined,
    notDoneReason: undefined,
    observedBy: undefined,
    options: [],
    origin: undefined,
    outputs: [],
    path: "/h/home/handovers/plan-usage-strategy.md",
    pausedOn: undefined,
    pausedSince: undefined,
    priority: undefined,
    probeWaiver: undefined,
    problem: undefined,
    problems: [],
    registeredBy: undefined,
    registeredRun: undefined,
    repo: undefined,
    risk: undefined,
    role: undefined,
    ruling: undefined,
    rulingAnchor: undefined,
    settlement: "answered",
    settlementReason: undefined,
    settlementWitness: `page:${PAGE}`,
    slug: "plan-usage-strategy",
    status: "ready",
    statusSummary: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    summary: "Work out the plan-usage strategy",
    supervisorState: undefined,
    ...over,
  };
}
