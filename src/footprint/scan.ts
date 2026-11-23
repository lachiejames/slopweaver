/**
 * The scan's pure half: nodes and a folded ledger in, a BRIEF out for a visible session to group.
 *
 * ## Why this emits a brief rather than a grouping
 *
 * Topical grouping needs judgement, and `AGENTS.md` rule 2 bans a model running inside the CLI: all
 * reasoning happens in a session the owner can see and interrupt, while the CLI gathers evidence and
 * validates what that session composed. So the deterministic half stops here, at the point where the
 * remaining question is "what is this pile about" — the same shape the ask fan-out already uses.
 *
 * ## What the brief is careful to separate
 *
 * `alreadyAssigned` never reaches the session for re-grouping. An established assignment moving because a
 * later pass phrased things differently is the drift that makes a view untrustworthy, so only genuinely
 * unassigned nodes are proposed on. That is the identity half of `./ledger.ts` doing its job.
 *
 * Pure: no clock beyond the instant handed in, no filesystem, no network.
 */

import { type Component, componentsOf } from "./grouping.js";
import type { LedgerState, WorkstreamId } from "./ledger.js";
import { type FootprintNode, type FootprintStatus, quietHoursOf, statusOf } from "./nodes.js";

/**
 * How long a node may be quiet before it stops counting as moving.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const DEFAULT_QUIET_HOURS = 24;

/**
 * One node as the brief presents it, with its judged status already attached.
 *
 * @internal the shape {@link composeBrief} returns, read by its own tests.
 */
export interface BriefNode {
  readonly node: FootprintNode;
  readonly status: FootprintStatus;
  readonly quietHours: number;
  /** The workstream it already belongs to, when the ledger has one. */
  readonly workstreamId: WorkstreamId | undefined;
}

/**
 * What one scan produced.
 *
 * @internal the contract between the scan and the session that groups from it.
 */
export interface FootprintBrief {
  /** Every node read, judged. */
  readonly nodes: readonly BriefNode[];
  /** The components hard edges formed, including singletons. */
  readonly components: readonly Component[];
  /** Nodes with no assignment yet — the only ones a session may propose a grouping for. */
  readonly unassigned: readonly BriefNode[];
  /** Nodes whose assignment already stands and must not be re-proposed. */
  readonly alreadyAssigned: readonly BriefNode[];
  /** How many nodes each status holds, so the yield is reportable without walking the list. */
  readonly statusCounts: Readonly<Record<FootprintStatus, number>>;
  /** The instant this scan judged its clocks at. */
  readonly nowIso: string;
}

/**
 * Build the brief.
 *
 * @param nodes every node the readers produced
 * @param ledger the folded assignment ledger
 * @param nowIso the instant clocks are judged at, supplied rather than read
 * @param quietHours how long with no movement before a node stops counting as moving
 * @returns the brief a visible session groups from
 */
export function composeBrief({
  nodes,
  ledger,
  nowIso,
  quietHours = DEFAULT_QUIET_HOURS,
}: {
  nodes: readonly FootprintNode[];
  ledger: LedgerState;
  nowIso: string;
  quietHours?: number;
}): FootprintBrief {
  const judged: BriefNode[] = nodes.map((node) => ({
    node,
    quietHours: quietHoursOf({ node, nowIso }),
    status: statusOf({ node, nowIso, quietHours }),
    workstreamId: ledger.assignments.get(node.id),
  }));
  const statusCounts: Record<FootprintStatus, number> = {
    "awaiting-decision": 0,
    moving: 0,
    resolved: 0,
    "status-check": 0,
  };
  for (const entry of judged) {
    statusCounts[entry.status] += 1;
  }
  return {
    alreadyAssigned: judged.filter((entry) => entry.workstreamId !== undefined),
    components: componentsOf({ nodes }),
    nodes: judged,
    nowIso,
    statusCounts,
    unassigned: judged.filter((entry) => entry.workstreamId === undefined),
  };
}
