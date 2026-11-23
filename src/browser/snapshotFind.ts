/**
 * `browser read --find <text>` over a look's snapshot: only the lines holding the text, each under the ancestors
 * that place it. The tree, the budget and the cut are `./snapshotOutline.ts`'s; this is the search alone.
 *
 * A find answers "where is the Merge button" in a few lines, where the outline might leave that button under a
 * marker three levels down. A literal, case-insensitive substring over each line as filed — role, name and
 * attributes alike — because that is what a session types.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type ElementsError, ElementsErrors } from "./elementsError.js";
import {
  type ExcerptBudget,
  excerpt,
  parseSnapshot,
  type SnapshotExcerpt,
  type SnapshotNode,
} from "./snapshotOutline.js";

/** The most matches one `--find` prints; the rest are counted in a closing line, never printed. */
export const FIND_MAX_MATCHES = 20;

/**
 * Print only the lines holding `text`, case-insensitively, each under the chain of ancestors that places it —
 * shared ancestors printed once, everything in document order, at its depth in the file.
 *
 * @param yaml the snapshot file's whole text
 * @param text what to look for, literally
 * @param maxMatches the most matches printed; the rest are counted in a closing line
 * @param budget the byte and line ceiling on the printed lines, closing line included
 * @returns the excerpt — a search that matched nothing says so in its one line — or why it cannot run
 */
export function findInSnapshot({
  yaml,
  text,
  maxMatches,
  budget,
}: {
  yaml: string;
  text: string;
  maxMatches: number;
  budget: ExcerptBudget;
}): Result<SnapshotExcerpt, ElementsError> {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) {
    return err(ElementsErrors.emptyFind());
  }
  const roots = parseSnapshot({ yaml });
  const keep = new Set<SnapshotNode>();
  let matches = 0;
  const walk = ({ node, ancestors }: { node: SnapshotNode; ancestors: readonly SnapshotNode[] }): void => {
    if (node.text.toLowerCase().includes(needle)) {
      matches += 1;
      if (matches <= maxMatches) {
        for (const ancestor of ancestors) {
          keep.add(ancestor);
        }
        keep.add(node);
      }
    }
    for (const child of node.children) {
      walk({ ancestors: [...ancestors, node], node: child });
    }
  };
  for (const root of roots) {
    walk({ ancestors: [], node: root });
  }
  const lines: string[] = [];
  for (const root of roots) {
    renderKept({ keep, lines, node: root });
  }
  if (matches === 0) {
    // Quoted as JSON; `excerpt` escapes any line break left, so the echo stays one line (`./oneLine.ts`).
    lines.push(`(no line of this read contains ${JSON.stringify(text.trim())})`);
  }
  if (matches > maxMatches) {
    lines.push(`… ${String(matches - maxMatches)} more match(es) not shown — narrow --find, or open one with --under`);
  }
  return ok(excerpt({ budget, lines, roots, yaml }));
}

/** Render, in document order and at file depth, only the nodes a find kept. */
function renderKept({
  node,
  keep,
  lines,
}: {
  node: SnapshotNode;
  keep: ReadonlySet<SnapshotNode>;
  lines: string[];
}): void {
  if (!keep.has(node)) {
    return;
  }
  lines.push(`${"  ".repeat(node.depth)}${node.text}`);
  for (const child of node.children) {
    renderKept({ keep, lines, node: child });
  }
}
