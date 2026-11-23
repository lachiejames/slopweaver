/**
 * How `slopweaver catalog health` prints — the table a reader gets in a terminal, and the document the
 * docs-site atlas page renders from.
 *
 * Separate from `./catalog.ts` for the reason that file's own split already establishes: a renderer is
 * where a figure's LABEL lives, and a label that lies is the whole failure the health atlas exists to
 * prevent. Both functions are pure over the folded report.
 */

import type { CodebaseHealth } from "../canon/codebaseHealth.js";
import type { LengthReport } from "../canon/codeShape.js";
import type { DebtList, TreeHealth } from "../canon/treeHealth.js";

/** How many ranked opportunities the human table prints before it stops. */
const RANKED_SHOWN = 12;

/** How many tree rows the human table prints before it stops; `--json` carries all of them. */
const TREES_SHOWN = 15;

/**
 * Which way one ratchet list last moved, as a phrase the debt row ends in.
 *
 * @param list the ratchet list and its previous reading
 * @returns the trend phrase; "first recorded" when there is no previous reading to compare against
 */
function trendOf({ list }: { list: DebtList }): string {
  const previous = list.previous;
  if (previous === undefined) {
    return "first recorded";
  }
  const delta = list.total - previous.total;
  let direction = "unchanged";
  if (delta > 0) {
    direction = `+${String(delta)}`;
  }
  if (delta < 0) {
    direction = String(delta);
  }
  return `${direction} since ${previous.sha} on ${previous.changedAtIso.slice(0, 10)}`;
}

/**
 * One tree's row, already padded to the table's columns.
 *
 * @param tree the tree row
 * @param ownerBar the 300-line bar the over-count is measured against, printed so the column is readable
 * @returns the printable line
 */
function treeLine({ tree, ownerBar }: { tree: TreeHealth; ownerBar: number }): string {
  let rule = "no area rule";
  if (tree.rulePath !== undefined) {
    rule = tree.rulePath.replace(".claude/rules/", "");
  }
  return (
    `  src/${tree.tree.padEnd(16)} ${String(tree.modules).padStart(4)} modules · ` +
    `${String(tree.reachedByTest).padStart(4)} test-reached · ${String(tree.mirrored).padStart(4)} mirrored · ` +
    `${String(tree.overOwnerBar).padStart(3)} over ${String(ownerBar)} · ${rule}`
  );
}

/**
 * The `length:` cell. The owner's bar and the shipped cap are the same number today, so two counts read as a
 * stutter; they are still both printed whenever they diverge, because only then is there a gap to close.
 *
 * The debt half and the exempt half are named separately because this cell used to say "all frozen on
 * file-size-ratchet's baseline" of a set that included eight files the gate was not measuring at all.
 * Both halves are frozen; they are still two different claims.
 *
 * @param length the length axis
 * @returns the cell, without its label
 */
function lengthCell({ length }: { length: LengthReport }): string {
  const over = `${String(length.overOwnerBar)} over the owner's ${String(length.ownerBar)}-line bar`;
  const debt = length.overOwnerBar - length.exemptOverBar - length.unrecordedOverBar;
  let split = `${String(debt)} as debt · ${String(length.exemptOverBar)} exempt ceilings`;
  // "All frozen" is a claim about the WHOLE set, so one file with no row makes it false — and the r3 review
  // caught this cell asserting it beside the very count that contradicted it ("frozen on file-size-ratchet's
  // baseline — … 1 on no row"). Whichever half of the sentence a reader believed, the other one was lying.
  if (length.unrecordedOverBar > 0) {
    split = `${split} · ${String(length.unrecordedOverBar)} on no baseline row`;
    if (length.ownerBar === length.gateCap) {
      return `${over} — ${split}`;
    }
  }
  if (length.ownerBar === length.gateCap) {
    return `${over}, every one frozen on file-size-ratchet's baseline — ${split}`;
  }
  // The split is counted against the owner's bar, so it stays beside `over` and never beside the gate-cap figure:
  // "0 over the 560-line cap · 1 exempt ceilings" reads as one exempt member of an empty set (r3 review).
  return `${over} — ${split} · ${String(length.overGateCap)} over the ${String(length.gateCap)}-line cap that refuses today`;
}

/**
 * The health atlas as a human table — the headline, the ranked gaps, then the heaviest trees.
 *
 * Opportunities come FIRST and trees second, deliberately. The point is that the owner
 * has lost sight of what is in the codebase; a table that opens on one row per tree restates the problem
 * rather than answering it.
 *
 * @param health the folded report
 * @returns the printable table
 */
export function renderCodebaseHealth({ health }: { health: CodebaseHealth }): string {
  const { totals, gates, length } = health;
  const lines: string[] = [
    `slopweaver — ${String(totals.modules)} modules in ${String(totals.trees)} trees, ` +
      `${String(totals.codeLines)} code lines (comments and blanks excluded)`,
    `  tested:  ${String(totals.reachedByTest)} imported by a test · ${String(totals.mirrored)} with a mirrored unit test`,
    `  ruled:   ${String(totals.treesWithRule)} of ${String(totals.trees)} trees named by an area rule · ` +
      `${String(gates.registered)} gates registered, ${String(gates.declared)} with a refusal row, ` +
      `${String(gates.localLane)} on the pre-push lane`,
    `  length:  ${lengthCell({ length })}`,
    `  debt:    ${String(totals.debtEntries)} standing sites across ${String(health.debtLists.length)} ratchet lists`,
    `  sharing: ${String(totals.libAliasImports)} imports on #lib/ against ${String(totals.libRelativeImports)} relative`,
    "",
    "RANKED BY BLAST RADIUS — how many places each gap touches",
  ];
  for (const opportunity of health.opportunities.slice(0, RANKED_SHOWN)) {
    lines.push(`  ${String(opportunity.measure).padStart(6)}  [${opportunity.kind}] ${opportunity.headline}`);
    lines.push(`          ${opportunity.command}`);
  }

  lines.push("", "DEBT LISTS — size, and which way it last moved");
  for (const list of health.debtLists) {
    lines.push(`  ${String(list.total).padStart(6)}  ${list.gate} (${trendOf({ list })})`);
  }

  lines.push("", `TREES — heaviest first, ${String(TREES_SHOWN)} of ${String(health.trees.length)} shown`);
  for (const tree of health.trees.slice(0, TREES_SHOWN)) {
    lines.push(treeLine({ ownerBar: length.ownerBar, tree }));
  }

  lines.push("", "Recompute any figure above with `slopweaver catalog health --json`.");
  return lines.join("\n");
}

/**
 * The health atlas as JSON, which is what the docs-site page renders from.
 *
 * @param health the folded report
 * @returns the pretty-printed JSON document
 */
export function renderCodebaseHealthJson({ health }: { health: CodebaseHealth }): string {
  return JSON.stringify(health, null, 2);
}
