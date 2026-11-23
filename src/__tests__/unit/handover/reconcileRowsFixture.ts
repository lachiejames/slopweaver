/**
 * The board docs `reconcileRows`' unit tests rank, shared by the sibling files they are split across.
 */
import type { HandoverDoc } from "../../../handover/doc.js";
import type { BoardRow } from "../../../handover/rank.js";

/**
 * A runnable chair's doc, exactly as one stands on the live board: `role: supervisor`, `status: ready`.
 *
 * @returns the doc
 */
export function chairDoc({ slug }: { slug: string }): HandoverDoc {
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
    path: `/h/${slug}.md`,
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
    slug,
    status: "ready",
    statusSummary: undefined,
    summary: "You are the next /slopweaver:supervisor chair.",
    supervisorState: "~/.slopweaver/handovers/supervisor-state-21aug.md",
  };
}

/**
 * The same doc with no supervisor role — an ordinary runnable row, so the chair rule can be shown to bind only chairs.
 *
 * @returns the doc
 */
export function ordinaryDoc({ slug }: { slug: string }): HandoverDoc {
  return { ...chairDoc({ slug }), role: undefined, supervisorState: undefined };
}

/**
 * One ranked row by its id.
 *
 * @returns the row, asserted present
 */
export function rowFor({ rows, id }: { rows: readonly BoardRow[]; id: string }): BoardRow {
  return rows.find((row) => row.id === id)!;
}
