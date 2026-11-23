/**
 * Per-TREE state: how much of a top-level `src/` tree a test reaches, whether an area rule governs it, and
 * what standing ratchet debt sits inside it — plus the repo-wide totals those rows sum to.
 *
 * Split out of `./codebaseHealth.ts` rather than left in it, for the reason the page it feeds exists: the
 * owner wants files and folders split appropriately with good naming under a 300 code-line bar, and a module
 * that MEASURES that bar while sitting over it would be the first thing found out. The
 * three concepts are now three files — `./codeShape.ts` is one file's own shape, this is one tree's state,
 * and `./codebaseHealth.ts` is the document that ranks both.
 *
 * Imports `./codeShape.js` and never the other way round, so the three stand in a line rather than a cycle.
 * Pure: every function here folds rows a caller read off disk.
 *
 * ## Two coverage signals, and why neither is called coverage
 *
 * A module is counted twice here and the two claims are deliberately different, because conflating them
 * would hide the exact failure `.claude/rules/testing.md` warns about:
 *
 * - **mirrored** — `src/x/y.ts` has `src/__tests__/unit/x/y.test.ts`. `config/vitest/unit.ts` selects the
 *   unit lane by DIRECTORY, so a `*.test.ts` written beside its source is silently never run. The mirror
 *   count is the only signal that sees that; a test somewhere else does not restore it.
 * - **reached by a test** — some file under `src/__tests__/` imports the module directly, on any lane: the
 *   scan reads the whole test TREE and never asks which config would collect the file. Weaker per module
 *   and wider in scope: it proves a test names the module, never that the module's behaviour is asserted.
 *
 * Neither is line coverage and nothing here calls either one that. `yarn vitest --coverage` is what
 * measures execution; these two measure whether a test EXISTS and whether the unit lane can see it.
 */

import { areaRuleScope } from "./areaRules.js";
import { type AreaRuleFile, ruleForTree, treeOfPath } from "./codebaseAtlas.js";
import { type HealthModule, OWNER_CODE_LINE_BAR } from "./codeShape.js";

/** Every path any file under `src/__tests__/` imports, already resolved to repo-relative source paths. */
export interface TestReach {
  /** The test-tree file's own repo-relative path. */
  readonly path: string;
  /** The repo-relative `.ts` paths its relative import specifiers resolve to. */
  readonly imports: readonly string[];
}

/** One entry on a committed ratchet list: a path, and how many sites of the refused shape stand there. */
export interface DebtEntry {
  readonly path: string;
  readonly count: number;
}

/** What a debt list held the last time it CHANGED, so a size can be read as a direction. */
export interface DebtPrevious {
  /** The total the list carried at that commit. */
  readonly total: number;
  /** The commit that moved it, abbreviated. */
  readonly sha: string;
  /** When that commit landed. */
  readonly changedAtIso: string;
}

/**
 * One gate's committed debt list, as read off disk and out of git.
 *
 * `previous` is absent for a list whose history holds exactly one commit — reported as "first recorded"
 * rather than as a trend of zero, because a list that has never moved and a list that moved to the same
 * number are different facts.
 */
export interface DebtList {
  /** The gate whose refusals this list holds down, as `dev lint` prints its name. */
  readonly gate: string;
  /** The repo-relative baseline path, which is also the file a reader greps. */
  readonly file: string;
  /** Per-path entries, when the list carries paths. Empty for a list that records only a total. */
  readonly entries: readonly DebtEntry[];
  /** The list's own size: summed counts for a counted list, entry count for a named one. */
  readonly total: number;
  /** What it held at its previous change, absent when it has only ever been written once. */
  readonly previous: DebtPrevious | undefined;
}

/** How many gates are written, declared and run, so the page can say where a rule is enforced at all. */
export interface GateCensus {
  /** Every check `lintChecks` plans, bespoke ratchets and external linters together. */
  readonly registered: number;
  /** How many carry a standing refusal row in the composed table `src/devLint/refusal/declarations.ts`. */
  readonly declared: number;
  /** How many run on the local `pre-push` lane, because CI cannot see their subject. */
  readonly localLane: number;
  /**
   * `file-size-ratchet`'s shipped cap for a non-test module, in code lines — what refuses the modules this
   * page measures. A test file's 500 is the gate's other number, and no test is on this page.
   */
  readonly fileLineCap: number;
}

/**
 * One top-level `src/` tree, as the health atlas reports it.
 *
 * @internal — reached as an element of {@link CodebaseHealth.trees}.
 */
export interface TreeHealth {
  /** The directory name, or {@link ROOT_TREE} for the loose files. */
  readonly tree: string;
  /** How many non-test `.ts` modules it holds. */
  readonly modules: number;
  /** Their code lines, summed — the tree's actual weight, comments and blanks excluded. */
  readonly codeLines: number;
  /** How many of them exceed {@link OWNER_CODE_LINE_BAR}. */
  readonly overOwnerBar: number;
  /** How many of them have a mirrored unit test the unit lane can see. */
  readonly mirrored: number;
  /** How many of them some file under `src/__tests__/` imports directly, on any lane. */
  readonly reachedByTest: number;
  /** The `paths:`-scoped area rule governing it, absent when no rule names it. */
  readonly rulePath: string | undefined;
  /** Imports reaching `src/lib/` on the `#lib/…` alias. */
  readonly libAliasImports: number;
  /** Imports reaching `src/lib/` by a resolved relative specifier. */
  readonly libRelativeImports: number;
  /** Which gates carry standing debt here, and how much, heaviest first. */
  readonly debt: readonly TreeDebt[];
}

/**
 * One gate's standing debt inside one tree.
 *
 * @internal — reached as an element of {@link TreeHealth.debt}.
 */
export interface TreeDebt {
  readonly gate: string;
  readonly count: number;
}

/**
 * The repo-wide figures, so a reader gets the headline before the table.
 *
 * @internal — reached as {@link CodebaseHealth.totals}.
 */
export interface HealthTotals {
  readonly modules: number;
  readonly codeLines: number;
  readonly mirrored: number;
  readonly reachedByTest: number;
  /** How many trees an area rule's `paths:` block names. */
  readonly treesWithRule: number;
  readonly trees: number;
  readonly libAliasImports: number;
  readonly libRelativeImports: number;
  /** Every debt list's total, summed — one number for "how much standing debt the ratchets carry". */
  readonly debtEntries: number;
}

/**
 * Which source path a `src/__tests__/unit/**` test mirrors.
 *
 * @param path a repo-relative test path
 * @returns the source path the unit lane's directory mirror implies, or `undefined` when the path is not a
 *   unit-lane test at all
 */
export function mirroredSourceOf({ path }: { path: string }): string | undefined {
  const prefix = "src/__tests__/unit/";
  if (!path.startsWith(prefix) || !path.endsWith(".test.ts")) {
    return undefined;
  }
  return `src/${path.slice(prefix.length, -".test.ts".length)}.ts`;
}

/**
 * The tree each area rule's `paths:` globs name, deduped.
 *
 * Read off the globs rather than off the heading, because the glob is what the harness actually scopes on;
 * a rule naming two trees (`area-handover` scopes `src/handover/**` and `src/cli/commands/handover/**`)
 * therefore binds to both, which is the truth a coverage figure has to reflect. Which rule wins a tree is
 * {@link ruleForTree}'s decision, called here rather than restated, so the atlas and the health report can
 * never bind a tree differently.
 *
 * @param rules every `.claude/rules/area-*.md`, as read off disk
 * @returns tree name to the rule path that governs it
 */
export function rulesByTree({ rules }: { rules: readonly AreaRuleFile[] }): ReadonlyMap<string, string> {
  const trees = new Set(
    rules
      .flatMap((rule) => areaRuleScope({ content: rule.content }).globs)
      .map((glob) => /^src\/([^/]+)\//.exec(glob)?.[1])
      .filter((tree): tree is string => tree !== undefined && tree !== "__tests__"),
  );
  const byTree = new Map<string, string>();
  for (const tree of trees) {
    const rulePath = ruleForTree({ rules, tree });
    if (rulePath !== undefined) {
      byTree.set(tree, rulePath);
    }
  }
  return byTree;
}

/** One tree's running tallies while the fold walks the module list. */
interface TreeTally {
  modules: number;
  codeLines: number;
  overOwnerBar: number;
  mirrored: number;
  reachedByTest: number;
  libAliasImports: number;
  libRelativeImports: number;
  debt: Map<string, number>;
}

/**
 * A fresh tally, so the fold never has to ask whether a tree has been seen before.
 *
 * @returns every counter at zero
 */
function emptyTally(): TreeTally {
  return {
    codeLines: 0,
    debt: new Map(),
    libAliasImports: 0,
    libRelativeImports: 0,
    mirrored: 0,
    modules: 0,
    overOwnerBar: 0,
    reachedByTest: 0,
  };
}

/**
 * Read a tree's tally out of the map, minting one when the tree is new.
 *
 * @param tree the tree name
 * @returns the tally, now certainly present in the map
 */
function tallyFor({ tallies, tree }: { tallies: Map<string, TreeTally>; tree: string }): TreeTally {
  const held = tallies.get(tree);
  if (held !== undefined) {
    return held;
  }
  const fresh = emptyTally();
  tallies.set(tree, fresh);
  return fresh;
}

/** Which modules a test mirrors, and which a test imports — the two signals, kept apart. */
interface TestSignals {
  readonly mirrors: ReadonlySet<string>;
  readonly reached: ReadonlySet<string>;
}

/**
 * Index the two test signals over every test file, once.
 *
 * @param testReach every test file and what it imports
 * @returns the mirrored set and the imported set, never merged
 */
function testSignalsOf({ testReach }: { testReach: readonly TestReach[] }): TestSignals {
  const mirrors = new Set<string>();
  const reached = new Set<string>();
  for (const test of testReach) {
    const mirrored = mirroredSourceOf({ path: test.path });
    if (mirrored !== undefined) {
      mirrors.add(mirrored);
    }
    for (const imported of test.imports) {
      reached.add(imported);
    }
  }
  return { mirrors, reached };
}

/**
 * Fold every module into its tree's tally.
 *
 * @param modules every non-test module
 * @param signals the two test signals
 * @param tallies the accumulator, mutated in place
 */
function tallyModules({
  modules,
  signals,
  tallies,
}: {
  modules: readonly HealthModule[];
  signals: TestSignals;
  tallies: Map<string, TreeTally>;
}): void {
  for (const module of modules) {
    const tree = treeOfPath({ path: module.path });
    if (tree === undefined) {
      continue;
    }
    const tally = tallyFor({ tallies, tree });
    tally.modules += 1;
    tally.codeLines += module.codeLines;
    tally.libAliasImports += module.libAliasImports;
    tally.libRelativeImports += module.libRelativeImports;
    if (module.codeLines > OWNER_CODE_LINE_BAR) {
      tally.overOwnerBar += 1;
    }
    if (signals.mirrors.has(module.path)) {
      tally.mirrored += 1;
    }
    if (signals.reached.has(module.path)) {
      tally.reachedByTest += 1;
    }
  }
}

/**
 * Attribute every standing debt entry to the tree its path sits in.
 *
 * A path a delete has already removed still counts, because the gate still prints it — the entry is what
 * the committed baseline holds, not what the working tree does.
 *
 * @param debtLists every committed ratchet list
 * @param tallies the accumulator, mutated in place
 */
function tallyDebt({ debtLists, tallies }: { debtLists: readonly DebtList[]; tallies: Map<string, TreeTally> }): void {
  for (const list of debtLists) {
    for (const entry of list.entries) {
      const tree = treeOfPath({ path: entry.path });
      if (tree === undefined) {
        continue;
      }
      const tally = tallyFor({ tallies, tree });
      const standing = tally.debt.get(list.gate);
      let base = 0;
      if (standing !== undefined) {
        base = standing;
      }
      tally.debt.set(list.gate, base + entry.count);
    }
  }
}

/**
 * Assemble one row per tree that holds at least one non-test module.
 *
 * A tree appears exactly when it holds a module, so the row set matches `catalog trees` without either verb
 * reading the other. Debt standing against a path no module occupies — a deleted file still on a baseline —
 * is counted into its tree anyway, because that is standing debt the gate will still print.
 *
 * @param modules every non-test `.ts` module under `src/`
 * @param testReach every file under `src/__tests__/`, with the source paths its imports resolve to
 * @param rules every `.claude/rules/area-*.md`
 * @param debtLists every committed ratchet list
 * @returns one row per tree, heaviest first
 */
export function treesOf({
  modules,
  testReach,
  rules,
  debtLists,
}: {
  modules: readonly HealthModule[];
  testReach: readonly TestReach[];
  rules: readonly AreaRuleFile[];
  debtLists: readonly DebtList[];
}): readonly TreeHealth[] {
  const signals = testSignalsOf({ testReach });
  const byTree = rulesByTree({ rules });
  const tallies = new Map<string, TreeTally>();
  tallyModules({ modules, signals, tallies });
  tallyDebt({ debtLists, tallies });
  return [...tallies.entries()]
    .map(([tree, tally]): TreeHealth => ({
      codeLines: tally.codeLines,
      debt: [...tally.debt.entries()]
        .map(([gate, count]): TreeDebt => ({ count, gate }))
        .toSorted((left, right) => right.count - left.count || left.gate.localeCompare(right.gate)),
      libAliasImports: tally.libAliasImports,
      libRelativeImports: tally.libRelativeImports,
      mirrored: tally.mirrored,
      modules: tally.modules,
      overOwnerBar: tally.overOwnerBar,
      reachedByTest: tally.reachedByTest,
      rulePath: byTree.get(tree),
      tree,
    }))
    .toSorted((left, right) => right.modules - left.modules || left.tree.localeCompare(right.tree));
}

/**
 * Debt lists heaviest first, alphabetical within a size.
 *
 * A sort rather than a comparator, because a two-parameter comparator is a signature written in this
 * repository and `named-object-params` refuses one: the exemption covers a callback whose shape a consumer
 * chose, and `toSorted` choosing it only holds while the function stays inline at the call site.
 *
 * @param debtLists every committed ratchet list, in any order
 * @returns a new array, heaviest first
 */
export function sortedByDebtSize({ debtLists }: { debtLists: readonly DebtList[] }): readonly DebtList[] {
  return [...debtLists].toSorted((left, right) => right.total - left.total || left.gate.localeCompare(right.gate));
}

/**
 * Sum the per-tree rows into the repo-wide headline.
 *
 * @param trees every tree row
 * @param debtLists every committed ratchet list
 * @returns the totals
 */
export function totalsOf({
  trees,
  debtLists,
}: {
  trees: readonly TreeHealth[];
  debtLists: readonly DebtList[];
}): HealthTotals {
  let modules = 0;
  let codeLines = 0;
  let mirrored = 0;
  let reachedByTest = 0;
  let treesWithRule = 0;
  let libAliasImports = 0;
  let libRelativeImports = 0;
  for (const tree of trees) {
    modules += tree.modules;
    codeLines += tree.codeLines;
    mirrored += tree.mirrored;
    reachedByTest += tree.reachedByTest;
    libAliasImports += tree.libAliasImports;
    libRelativeImports += tree.libRelativeImports;
    if (tree.rulePath !== undefined) {
      treesWithRule += 1;
    }
  }
  let debtEntries = 0;
  for (const list of debtLists) {
    debtEntries += list.total;
  }
  return {
    codeLines,
    debtEntries,
    libAliasImports,
    libRelativeImports,
    mirrored,
    modules,
    reachedByTest,
    trees: trees.length,
    treesWithRule,
  };
}
