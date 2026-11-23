/**
 * The PURE parts of a Linear issue node that substitute nothing: its planning scalars, its lifecycle timestamps,
 * and the `raw` payload actually stored. `parseLinearIssueNode` in `parse.ts` assembles them into the item, under
 * that file's rule that a fetched field needs a destination in `attrs` or `text`.
 */
import type { NestedNodes } from "./nested.js";
import { num, optionalStrings, str } from "./parseFields.js";

/**
 * The plannning scalars an issue carries — every one of them free on the query that was already being sent,
 * and every one of them previously dropped. Pure.
 *
 * `branchName` is captured deliberately, and it is the one field here that needs a warning attached: it embeds
 * the team key and a slugified title, which makes it a private-identifier vector. Inside the corpus that is
 * fine — the corpus is local and full of private content by design — but it must never reach a fixture, a
 * cassette, a test name, or a PR body.
 *
 * @param node one raw issue node
 * @returns only the scalars actually present; each is omitted when absent rather than defaulted, so an unset
 *   priority cannot be confused with priority zero
 */
export function parseIssueScalars({ node }: { node: Record<string, unknown> }): {
  priority?: number;
  priorityLabel?: string;
  estimate?: number;
  dueDate?: string;
  branchName?: string;
  number?: number;
} {
  const priority = num({ value: node["priority"] });
  const priorityLabel = str({ value: node["priorityLabel"] });
  const estimate = num({ value: node["estimate"] });
  const dueDate = str({ value: node["dueDate"] });
  const branchName = str({ value: node["branchName"] });
  const issueNumber = num({ value: node["number"] });
  return {
    ...(priority !== undefined ? { priority } : {}),
    ...(priorityLabel !== undefined ? { priorityLabel } : {}),
    ...(estimate !== undefined ? { estimate } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(branchName !== undefined ? { branchName } : {}),
    ...(issueNumber !== undefined ? { number: issueNumber } : {}),
  };
}

/**
 * The lifecycle timestamps — the raw material for "how long did this take?", all previously dropped. Pure.
 *
 * @param node one raw issue node
 * @returns only the timestamps actually present — an absent one is omitted, so "never completed" and
 *   "completion time we failed to read" stay distinct
 */
export function parseIssueLifecycle({ node }: { node: Record<string, unknown> }): {
  createdAtIso?: string;
  completedAtIso?: string;
  startedAtIso?: string;
  canceledAtIso?: string;
  archivedAtIso?: string;
  triagedAtIso?: string;
} {
  return optionalStrings({
    node,
    pairs: [
      ["createdAt", "createdAtIso"],
      ["completedAt", "completedAtIso"],
      ["startedAt", "startedAtIso"],
      ["canceledAt", "canceledAtIso"],
      ["archivedAt", "archivedAtIso"],
      ["triagedAt", "triagedAtIso"],
    ],
  });
}

/**
 * The `raw` payload actually stored: the node with each connection replaced by its COMPLETE node list, and the
 * two history streams dropped.
 *
 * Dropping them is a size decision with a real number behind it: ~192,000 events at ~510 raw bytes each is
 * ~98 MB, and bronze would be carrying a second copy of a store that already exists. Pure.
 *
 * @returns the node's entries, connections completed and both history streams removed
 */
export function issueRaw({
  node,
  nested,
}: {
  node: Record<string, unknown>;
  nested: NestedNodes;
}): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "history" || key === "stateHistory") {
      continue;
    }
    out[key] = key in nested ? { nodes: nested[key] } : value;
  }
  return out;
}
