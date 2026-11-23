/**
 * The codebase atlas's SECOND question. `./codebaseAtlas.ts` answers "where does the code live"; this
 * module answers "what state is it in" — what is tested, what a rule governs, what the committed ratchets
 * carry as standing debt, and where the tree has drifted from a pattern it declared for itself.
 *
 * The page exists because building fast loses sight of what is in the codebase, and a map the owner can react
 * to fixes that. The axes it covers:
 *
 * - appropriate naming of different concepts and domains
 * - files and folders split appropriately, with good naming
 * - good code sharing patterns
 * - consistency across memories
 * - all files under 300 lines of code excluding comments and whitespace
 * - more lint gates that ban anti patterns, and no more `??`
 * - enforced test coverage, and enforced prevention of test enshitification
 * - faster CI
 *
 * So the fold's job is to make each axis a number the owner can steer on. It is deliberately NOT the gates:
 * those are a separate seat, and this module refuses nothing and caps nothing.
 *
 * ## Three files, because the page says to split at 300
 *
 * The axes are folded across three modules standing in a line, not a cycle, and each is named for the
 * question it answers rather than for the layer it sits in:
 *
 * - `./codeShape.ts` — what ONE FILE looks like: its code lines against the owner's 300 bar, its name, the width of
 *   the directory holding it. A leaf; it imports `./codebaseAtlas.js` and nothing else here.
 * - `./treeHealth.ts` — what ONE TREE's state is: how much of it a test reaches, whether an area rule
 *   governs it, what ratchet debt stands in it, and the repo-wide totals those rows sum to. Its header
 *   carries the two coverage signals and why neither is called coverage.
 * - this file — the DOCUMENT: the `CodebaseHealth` shape, and the ranking that turns every axis above into
 *   work ordered by blast radius.
 *
 * That split is the steer applied to its own implementation. Before it, this module stood at 504 code lines
 * while computing the count of files over 300 (repro: `slopweaver catalog health --json | jq '.length'`).
 *
 * ## Pure, so the shell is the only thing that reads disk
 *
 * `src/cli/commands/catalog/healthRun.ts` lists the working tree, reads the bytes, counts code lines
 * through `src/devLint/duplicateWindows.ts`'s own `codeLinesOf`, resolves each import specifier and asks
 * git what each baseline held before its last change. Everything below is a fold over those stated inputs.
 * The code-line counter is IMPORTED at that edge rather than reimplemented here, so the number on the page
 * and the number `file-size-ratchet` enforces can never disagree.
 */

import { type AreaRuleFile } from "./codebaseAtlas.js";
import {
  type FolderFanout,
  folderFanoutOf,
  type HealthModule,
  type LengthReport,
  lengthOf,
  type RepeatedName,
  repeatedNamesOf,
} from "./codeShape.js";
import {
  type DebtList,
  type GateCensus,
  type HealthTotals,
  sortedByDebtSize,
  type TestReach,
  type TreeHealth,
  totalsOf,
  treesOf,
} from "./treeHealth.js";

/** Below this many modules, a tree having no area rule is not worth proposing as work. */
const UNRULED_TREE_FLOOR = 10;

/** Below this many untested modules, a tree's gap is noise beside the ones above it. */
const UNTESTED_TREE_FLOOR = 10;

/**
 * One ranked improvement the tree itself proposes.
 *
 * **The rank is BLAST RADIUS in files or sites, and nothing else.** Every kind below measures a count of
 * places, which is what makes them comparable at all; a severity weighting would be a taste this module has
 * no way to derive. A reader who disagrees with the order still has the measure in the row.
 *
 * @internal — reached as an element of {@link CodebaseHealth.opportunities}.
 */
export interface Opportunity {
  /** What kind of gap this is, so a reader can filter to one family. */
  readonly kind: OpportunityKind;
  /** The tree, gate, name or pattern it is about. */
  readonly subject: string;
  /** One line stating the gap in the terms the measure is in. */
  readonly headline: string;
  /** The count of places — the rank key. */
  readonly measure: number;
  /** The command that recomputes exactly this row. */
  readonly command: string;
}

/**
 * The families of gap this fold can derive, one per axis the page names.
 *
 * @internal — reached as {@link Opportunity.kind}.
 */
export type OpportunityKind = "untested" | "unruled" | "debt" | "pattern" | "length" | "naming" | "folder";

/** Everything the health atlas reports. */
export interface CodebaseHealth {
  readonly trees: readonly TreeHealth[];
  readonly debtLists: readonly DebtList[];
  readonly gates: GateCensus;
  readonly totals: HealthTotals;
  /** The length axis — the owner's 300 bar against the shipped cap. */
  readonly length: LengthReport;
  /** The naming axis — which file names recur, and how widely. */
  readonly repeatedNames: readonly RepeatedName[];
  /** The folder-splitting axis — the directories holding the most files. */
  readonly folders: readonly FolderFanout[];
  /** The ranked gaps, blast radius first. */
  readonly opportunities: readonly Opportunity[];
  /** When the measurement was taken, so a page can age its own tile rather than stamp a receipt time. */
  readonly observedAtIso: string;
}

/**
 * Fold the working tree, the test tree and the committed ratchet lists into the health atlas.
 *
 * A tree appears here exactly when it holds at least one non-test module, so the row set matches
 * `catalog trees` without either verb reading the other. Debt standing against a path no module occupies
 * (a deleted file still on a baseline) is counted into its tree anyway, because that is standing debt the
 * gate will still print.
 *
 * @param modules every non-test `.ts` module under `src/`, with its code-line count and lib-import counts
 * @param testReach every file under `src/__tests__/`, with the source paths its imports resolve to
 * @param rules every `.claude/rules/area-*.md`
 * @param debtLists every committed ratchet list, with what it held at its previous change
 * @param gates how many gates are registered, declared and on the local lane, and the shipped length cap
 * @param observedAtIso when the measurement was taken
 * @returns every axis, each in display order
 */
export function codebaseHealth({
  modules,
  testReach,
  rules,
  debtLists,
  gates,
  observedAtIso,
}: {
  modules: readonly HealthModule[];
  testReach: readonly TestReach[];
  rules: readonly AreaRuleFile[];
  debtLists: readonly DebtList[];
  gates: GateCensus;
  observedAtIso: string;
}): CodebaseHealth {
  const trees = treesOf({ debtLists, modules, rules, testReach });
  const totals = totalsOf({ debtLists, trees });
  const length = lengthOf({ gateCap: gates.fileLineCap, modules });
  const repeatedNames = repeatedNamesOf({ modules });
  const folders = folderFanoutOf({ modules });
  return {
    debtLists: sortedByDebtSize({ debtLists }),
    folders,
    gates,
    length,
    observedAtIso,
    opportunities: rank({ debtLists, folders, length, repeatedNames, totals, trees }),
    repeatedNames,
    totals,
    trees,
  };
}

/**
 * The per-tree opportunities — an untested tree, and a tree no area rule names.
 *
 * Ranked on the IMPORT signal, never on the mirror. The mirror is reported beside it because it is the only
 * thing that sees a `*.test.ts` the unit lane silently never collects — but it cries wolf as a ranking key,
 * and the repo proves it: `src/devLint/coverageFloor.ts`'s own header records that its functions are
 * deliberately unit-tested through `src/__tests__/unit/devLint/coverageRatchet/`, a sibling's tests. A rank on
 * mirrored paths calls that gap permanent with no honest fix, and would put work at the top of the page that
 * nobody should do.
 *
 * @param trees every tree row
 * @returns the rows those two floors admit, unsorted
 */
function treeOpportunities({ trees }: { trees: readonly TreeHealth[] }): readonly Opportunity[] {
  const out: Opportunity[] = [];
  for (const tree of trees) {
    const untested = tree.modules - tree.reachedByTest;
    if (untested >= UNTESTED_TREE_FLOOR) {
      out.push({
        command: `slopweaver catalog health --json | jq '.trees[] | select(.tree == "${tree.tree}")'`,
        headline: `${String(untested)} of ${String(tree.modules)} modules in src/${tree.tree} are imported by no test on any lane`,
        kind: "untested",
        measure: untested,
        subject: `src/${tree.tree}`,
      });
    }
    if (tree.rulePath === undefined && tree.modules >= UNRULED_TREE_FLOOR) {
      out.push({
        command: "slopweaver catalog health --json | jq '.trees[] | select(.rulePath == null) | .tree'",
        headline: `src/${tree.tree} holds ${String(tree.modules)} modules and no area rule names it, so only the always-on rules govern it`,
        kind: "unruled",
        measure: tree.modules,
        subject: `src/${tree.tree}`,
      });
    }
  }
  return out;
}

/**
 * One opportunity per ratchet list that still carries standing sites.
 *
 * @param debtLists every committed ratchet list
 * @returns the rows, unsorted; an emptied list contributes nothing
 */
function debtOpportunities({ debtLists }: { debtLists: readonly DebtList[] }): readonly Opportunity[] {
  const out: Opportunity[] = [];
  for (const list of debtLists) {
    if (list.total > 0) {
      out.push({
        command: `yarn lint --only ${list.gate}`,
        headline: `${list.gate} carries ${String(list.total)} standing site(s) on ${list.file}`,
        kind: "debt",
        measure: list.total,
        subject: list.gate,
      });
    }
  }
  return out;
}

/**
 * The length row's sentence, which depends on whether the owner's bar and the shipped cap are the same number.
 *
 * They are today — `file-size-ratchet` adopted the owner's 300 — so printing two counts reads as a stutter.
 * Printing one would be wrong the moment either number moves, so the sentence is derived rather than fixed.
 *
 * It splits the debt from the exempt ceilings because the older wording said "every one of them is frozen on
 * its baseline" of a set that included eight files frozen by nothing at all. They are two
 * different claims: a debt row has to fall under the cap one day, a ceiling never does.
 *
 * A file the committed floor holds NO row for is neither, and it is named only when there is one — in a
 * green tree the count is zero and the clause would be noise. Saying it when it is not zero is the
 * difference between reporting and asserting: the r2 review broke the first cut of this for calling a file
 * frozen on the strength of its marker, without reading the baseline at all.
 *
 * @param length the length axis, carrying both numbers and all four counts
 * @returns the headline
 */
function lengthHeadline({ length }: { length: LengthReport }): string {
  const over = String(length.overOwnerBar);
  const debt = String(length.overOwnerBar - length.exemptOverBar - length.unrecordedOverBar);
  const exempt = String(length.exemptOverBar);
  let unrecorded = "";
  if (length.unrecordedOverBar > 0) {
    unrecorded = `, ${String(length.unrecordedOverBar)} on no baseline row at all`;
  }
  if (length.ownerBar === length.gateCap) {
    return `${over} modules are over the owner's ${String(length.ownerBar)} code-line bar, which is the cap file-size-ratchet refuses at — ${debt} held as debt that has to come down, ${exempt} frozen at their own exempt ceiling${unrecorded}`;
  }
  // `exemptOverBar` and `unrecordedOverBar` are both counted against the OWNER's bar, so they attach to that clause
  // and never to the gate-cap one. Written the other way this read "0 are over the 560-line cap, 1 of them
  // exempt" — one member of an empty set (r3 review). The branch is dormant while the two numbers agree,
  // which is exactly how a sentence like that survives to the day they diverge.
  return `${over} modules are over the owner's ${String(length.ownerBar)} code-line bar, ${exempt} of them frozen at their own exempt ceiling${unrecorded}; ${String(length.overGateCap)} are over the ${String(length.gateCap)}-line cap file-size-ratchet refuses at`;
}

/**
 * Rank what the tree proposes about itself, blast radius first.
 *
 * Each row names the command that recomputes exactly it, because a ranked list nobody can re-derive is a
 * claim rather than a measurement.
 *
 * @param trees every tree row
 * @param debtLists every committed ratchet list
 * @param totals the repo-wide figures, for the rows that are not per-tree
 * @param length the length axis
 * @param repeatedNames the naming axis
 * @param folders the folder-splitting axis
 * @returns the opportunities, heaviest first
 */
function rank({
  trees,
  debtLists,
  totals,
  length,
  repeatedNames,
  folders,
}: {
  trees: readonly TreeHealth[];
  debtLists: readonly DebtList[];
  totals: HealthTotals;
  length: LengthReport;
  repeatedNames: readonly RepeatedName[];
  folders: readonly FolderFanout[];
}): readonly Opportunity[] {
  const out: Opportunity[] = [...treeOpportunities({ trees }), ...debtOpportunities({ debtLists })];
  if (length.overOwnerBar > 0) {
    out.push({
      command: "slopweaver catalog health --json | jq '.length'",
      headline: lengthHeadline({ length }),
      kind: "length",
      measure: length.overOwnerBar,
      subject: `files over ${String(length.ownerBar)} code lines`,
    });
  }
  const widest = folders[0];
  if (widest !== undefined) {
    out.push({
      command: "slopweaver catalog health --json | jq '.folders'",
      headline: `${widest.dir} holds ${String(widest.files)} files directly, the widest directory in the tree`,
      kind: "folder",
      measure: widest.files,
      subject: widest.dir,
    });
  }
  const commonest = repeatedNames[0];
  if (commonest !== undefined) {
    out.push({
      command: "slopweaver catalog health --json | jq '.repeatedNames'",
      headline: `${String(commonest.files)} files are named ${commonest.name}, across ${String(commonest.trees)} trees — a name that says which layer it is, not what it holds`,
      kind: "naming",
      measure: commonest.files,
      subject: commonest.name,
    });
  }
  if (totals.libRelativeImports > 0) {
    out.push({
      command: "slopweaver catalog health --json | jq '.totals | {libAliasImports, libRelativeImports}'",
      headline: `${String(totals.libRelativeImports)} imports reach src/lib by a relative path against ${String(totals.libAliasImports)} on the #lib/ alias`,
      kind: "pattern",
      measure: totals.libRelativeImports,
      subject: "#lib/ subpath import",
    });
  }
  return out.toSorted((left, right) => right.measure - left.measure || left.subject.localeCompare(right.subject));
}
